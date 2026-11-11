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
import android.os.SystemClock
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
 * In parts, like an upload from the website: Cloudflare refuses a request over 100 MB, and answers 524 to one
 * that has had no answer in 100 seconds. On a slow link (two Lenovos sent Chrome at about 180 KB/s) a part
 * that took long, or failed, is followed by smaller ones.
 */
class ApkExportModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "ApkExport"

    companion object {
        private const val TAG = "ApkExport"
        // Each try of a part that failed goes with a smaller part, so a few more than for a broken connection
        private const val PART_ATTEMPTS = 5
        private const val MIN_PART_BYTES = 1L * 1024 * 1024
        // Half of Cloudflare's 100 seconds: a part that took this long is followed by a smaller one
        private const val SLOW_PART_MS = 50_000L

        /** An answer worth another try: a gateway that gave up (Cloudflare's 524) or a server busy for a moment */
        fun retryable(code: Int): Boolean = code == 408 || code == 429 || code in 500..599
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
                var partBytes = started.optLong("part_bytes", 16L * 1024 * 1024).coerceIn(MIN_PART_BYTES, 32L * 1024 * 1024)
                val partUrl = "$server/api/v1/devices/$deviceId/apk-uploads/$uploadId/part/"

                var offset = 0L
                var attempt = 1
                while (offset < file.length()) {
                    val length = minOf(partBytes, file.length() - offset)
                    val began = SystemClock.elapsedRealtime()
                    try {
                        offset = sendPart(partUrl, apiKey, file, offset, length)
                        attempt = 1
                        if (SystemClock.elapsedRealtime() - began > SLOW_PART_MS) partBytes = maxOf(MIN_PART_BYTES, partBytes / 2)
                    } catch (e: IOException) {
                        // Where the server stands comes back with the next part, whether it took this one or not
                        if (attempt >= PART_ATTEMPTS) throw e
                        partBytes = maxOf(MIN_PART_BYTES, partBytes / 2)
                        DebugLog.d(TAG, "Part at $offset failed (${e.message}), trying again with ${partBytes / 1024} KB")
                        Thread.sleep(3_000L * attempt)
                        attempt++
                    }
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

    /**
     * One part, once. An IOException is worth another try: the connection broke (school Wi-Fi drops
     * connections), or a gateway gave up waiting, as Cloudflare does after 100 seconds with its 524.
     */
    private fun sendPart(url: String, apiKey: String, file: File, offset: Long, length: Long): Long {
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
            if (!response.isSuccessful) {
                val message = messageOf(text) ?: "HTTP ${response.code}"
                if (retryable(response.code)) throw IOException(message)
                throw IllegalStateException(message)
            }
            val received = JSONObject(text).optLong("received", -1L)
            // The server says where it stands: a part it already had, or one it lost
            if (received < 0) throw IllegalStateException("No position in the answer")
            return received
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
