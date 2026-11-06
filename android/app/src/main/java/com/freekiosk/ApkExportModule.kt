package com.freekiosk

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okio.BufferedSink
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.io.IOException
import java.io.RandomAccessFile
import java.util.concurrent.TimeUnit
import java.util.zip.CRC32
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

/**
 * Sends an app installed on this tablet to the APK library of the management website, so that it can be
 * installed on the others (the pull_apk command). An app from the Play Store is usually a base APK and a
 * few parts; they go together, as a zip of base.apk and split_*.apk, the form the library takes from an
 * upload. The APKs of an installed app can be read by any app: no special right is needed.
 *
 * In parts, like an upload from the website: Cloudflare refuses a request over 100 MB.
 */
class ApkExportModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "ApkExport"

    companion object {
        private const val TAG = "ApkExport"
        private const val PART_ATTEMPTS = 3
    }

    private val client by lazy {
        OkHttpClient.Builder()
            .connectTimeout(20, TimeUnit.SECONDS)
            .readTimeout(120, TimeUnit.SECONDS)
            .writeTimeout(120, TimeUnit.SECONDS)
            .build()
    }
    private val json = "application/json".toMediaType()
    private val binary = "application/octet-stream".toMediaType()

    @ReactMethod
    fun upload(packageName: String, cloudUrl: String, deviceId: String, apiKey: String, commandId: String, promise: Promise) {
        Thread({
            var bundle: File? = null
            try {
                val pm = reactApplicationContext.packageManager
                @Suppress("DEPRECATION")
                val info = pm.getPackageInfo(packageName, 0)
                val app = info.applicationInfo ?: throw IOException("No application info for $packageName")
                val base = File(app.sourceDir)
                val splits = app.splitSourceDirs?.map { File(it) }.orEmpty()
                val names = info.splitNames?.toList().orEmpty()

                val file: File
                val fileName: String
                if (splits.isEmpty()) {
                    file = base
                    fileName = "$packageName.apk"
                } else {
                    bundle = bundleOf(packageName, base, splits, names)
                    file = bundle
                    fileName = "$packageName.zip"
                }
                DebugLog.d(TAG, "Sending $packageName: ${splits.size + 1} APK(s), ${file.length() / 1024} KB")

                val server = cloudUrl.trimEnd('/')
                val started = post(
                    "$server/api/v1/devices/$deviceId/apk-uploads/",
                    apiKey,
                    JSONObject().put("command_id", commandId).put("file_name", fileName).put("size_bytes", file.length()),
                )
                val uploadId = started.getString("upload_id")
                val partBytes = started.optLong("part_bytes", 16L * 1024 * 1024).coerceIn(1L * 1024 * 1024, 32L * 1024 * 1024)

                var offset = 0L
                while (offset < file.length()) {
                    val length = minOf(partBytes, file.length() - offset)
                    offset = sendPart("$server/api/v1/devices/$deviceId/apk-uploads/$uploadId/part/", apiKey, file, offset, length)
                }

                val finished = post("$server/api/v1/devices/$deviceId/apk-uploads/$uploadId/finish/", apiKey, JSONObject())
                val result = Arguments.createMap().apply {
                    putString("apk_id", finished.optString("apk_id"))
                    putString("file_name", finished.optString("file_name"))
                    putString("version_name", finished.optString("version_name"))
                    putBoolean("already_in_library", finished.optBoolean("already_in_library"))
                    putDouble("size_bytes", file.length().toDouble())
                    putInt("parts", splits.size + 1)
                }
                promise.resolve(result)
            } catch (e: Exception) {
                DebugLog.errorProduction(TAG, "Could not send $packageName: ${e.message}")
                promise.reject("PULL_FAILED", e.message ?: "Could not send the app", e)
            } finally {
                bundle?.delete()
            }
        }, TAG).start()
    }

    /**
     * The parts stored as they are, as the website writes them itself: APKs are compressed already. A
     * stored entry needs its CRC before its bytes, hence two reads of each file.
     */
    private fun bundleOf(packageName: String, base: File, splits: List<File>, names: List<String>): File {
        val dir = File(reactApplicationContext.cacheDir, "apk-export").apply { mkdirs() }
        dir.listFiles()?.forEach { it.delete() }
        val out = File(dir, "$packageName.zip")
        ZipOutputStream(out.outputStream().buffered()).use { zip ->
            zip.setMethod(ZipOutputStream.STORED)
            val entries = listOf("base.apk" to base) + splits.mapIndexed { index, file ->
                val name = names.getOrNull(index)?.replace(Regex("[^A-Za-z0-9._-]"), "_") ?: "part$index"
                "split_$name.apk" to file
            }
            for ((name, file) in entries) {
                val entry = ZipEntry(name).apply {
                    method = ZipEntry.STORED
                    size = file.length()
                    compressedSize = file.length()
                    crc = crcOf(file)
                }
                zip.putNextEntry(entry)
                FileInputStream(file).use { it.copyTo(zip, 64 * 1024) }
                zip.closeEntry()
            }
        }
        return out
    }

    private fun crcOf(file: File): Long {
        val crc = CRC32()
        val buffer = ByteArray(64 * 1024)
        FileInputStream(file).use { input ->
            while (true) {
                val read = input.read(buffer)
                if (read < 0) break
                crc.update(buffer, 0, read)
            }
        }
        return crc.value
    }

    private fun post(url: String, apiKey: String, body: JSONObject): JSONObject {
        val request = Request.Builder().url(url).header("Authorization", "Bearer $apiKey").post(body.toString().toRequestBody(json)).build()
        client.newCall(request).execute().use { response ->
            val text = response.body?.string() ?: ""
            if (!response.isSuccessful) throw IOException(messageOf(text) ?: "HTTP ${response.code}")
            return JSONObject(text.ifEmpty { "{}" })
        }
    }

    /** One part, with more tries if the connection breaks: school Wi-Fi drops connections */
    private fun sendPart(url: String, apiKey: String, file: File, offset: Long, length: Long): Long {
        var attempt = 1
        while (true) {
            try {
                val body = object : RequestBody() {
                    override fun contentType() = binary
                    override fun contentLength() = length
                    override fun writeTo(sink: BufferedSink) {
                        RandomAccessFile(file, "r").use { input ->
                            input.seek(offset)
                            val buffer = ByteArray(64 * 1024)
                            var left = length
                            while (left > 0) {
                                val read = input.read(buffer, 0, minOf(buffer.size.toLong(), left).toInt())
                                if (read < 0) throw IOException("File ended early")
                                sink.write(buffer, 0, read)
                                left -= read
                            }
                        }
                    }
                }
                val request = Request.Builder().url("$url?offset=$offset").header("Authorization", "Bearer $apiKey").put(body).build()
                client.newCall(request).execute().use { response ->
                    val text = response.body?.string() ?: ""
                    if (!response.isSuccessful) throw IllegalStateException(messageOf(text) ?: "HTTP ${response.code}")
                    val received = JSONObject(text).optLong("received", -1L)
                    // The server says where it stands: a part it already had, or one it lost
                    if (received < 0) throw IllegalStateException("No position in the answer")
                    return received
                }
            } catch (e: IOException) {
                if (attempt >= PART_ATTEMPTS) throw e
                DebugLog.d(TAG, "Part at $offset failed, trying again: ${e.message}")
                Thread.sleep(3_000L * attempt)
                attempt++
            }
        }
    }

    private fun messageOf(text: String): String? =
        try {
            val answer = JSONObject(text)
            answer.optString("message").ifEmpty { answer.optString("error") }.ifEmpty { null }
        } catch (_: Exception) {
            null
        }

    @ReactMethod
    fun addListener(eventName: String) {
        // Required for RN built-in EventEmitter calls
    }

    @ReactMethod
    fun removeListeners(count: Int) {
        // Required for RN built-in EventEmitter calls
    }
}
