package com.freekiosk

import android.app.PendingIntent
import android.app.admin.DevicePolicyManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageInstaller
import android.os.Build
import android.os.PowerManager
import android.os.SystemClock
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.atomic.AtomicBoolean
import java.util.zip.ZipFile

/**
 * Installs a *managed third-party APK* pushed by FreeKiosk Cloud (OTA).
 *
 * Distinct from [UpdateModule], which self-updates FreeKiosk from GitHub and is
 * gated by ENABLE_SELF_UPDATE. This module downloads an arbitrary APK over an
 * authenticated URL and installs it **silently via the PackageInstaller session
 * API**, which only succeeds in Device Owner mode (a kiosk cannot show the
 * system install prompt). The silent-install path mirrors UpdateModule.installApk().
 */
class ManagedAppInstallerModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "ManagedAppInstaller"

    companion object {
        private const val TAG = "ManagedAppInstaller"
        private const val INSTALL_ACTION = "com.freekiosk.MANAGED_APP_INSTALL_RESULT"
        private const val DOWNLOAD_ATTEMPTS = 3
        private const val DOWNLOAD_RETRY_DELAY_MS = 5_000L
        private const val MIN_APK_BYTES = 50_000L // anything smaller is almost certainly an HTML error page
        private const val SCREEN_ON_WAIT_MS = 3_000L
    }

    @ReactMethod
    fun isDeviceOwner(promise: Promise) {
        try {
            val dpm = reactApplicationContext
                .getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
            promise.resolve(dpm.isDeviceOwnerApp(reactApplicationContext.packageName))
        } catch (e: Exception) {
            promise.resolve(false)
        }
    }

    /**
     * Download [downloadUrl] (with an optional `Authorization: Bearer <authToken>`
     * header) and install it silently. Rejects if not Device Owner, on download
     * failure, or on install failure. Resolves with `{status, package}` on success.
     */
    @ReactMethod
    fun installFromUrl(
        downloadUrl: String,
        authToken: String?,
        expectedPackage: String?,
        promise: Promise,
    ) {
        Thread {
            var apkFile: File? = null
            try {
                val dpm = reactApplicationContext
                    .getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
                if (!dpm.isDeviceOwnerApp(reactApplicationContext.packageName)) {
                    promise.reject(
                        "NOT_DEVICE_OWNER",
                        "Silent install requires Device Owner mode.",
                    )
                    return@Thread
                }
                if (downloadUrl.isEmpty()) {
                    promise.reject("BAD_URL", "Download URL is empty.")
                    return@Thread
                }
                // A silent Device Owner install is a full-privilege operation, so the caller
                // must declare which package it expects; we verify the downloaded APK against
                // it below before committing (defends against a swapped/malicious APK).
                if (expectedPackage.isNullOrEmpty()) {
                    promise.reject("BAD_PACKAGE", "expectedPackage is required for a silent install.")
                    return@Thread
                }

                apkFile = downloadApk(downloadUrl, authToken)
                val parts = partsOf(apkFile)
                // Verify the downloaded APK actually is the expected package before install.
                // The base comes first; the installer holds the others to the same package.
                verifyApkPackage(parts.first(), expectedPackage)
                // installSilently owns the promise from here (async via receiver).
                installSilently(apkFile, parts, expectedPackage, promise)
            } catch (e: Exception) {
                android.util.Log.e(TAG, "Install error: ${e.message}", e)
                apkFile?.let { cleanUp(it) }
                promise.reject("INSTALL_ERROR", e.message ?: "Unknown install error", e)
            }
        }.start()
    }

    /**
     * School Wi-Fi drops connections ("Connection reset"), and an install that failed for that would
     * wait for someone to send it again. A broken connection gets more tries, a refusal does not.
     */
    private fun downloadApk(downloadUrl: String, authToken: String?): File {
        var attempt = 1
        while (true) {
            try {
                return downloadOnce(downloadUrl, authToken)
            } catch (e: java.io.IOException) {
                if (attempt >= DOWNLOAD_ATTEMPTS) throw e
                android.util.Log.w(TAG, "Download attempt $attempt failed, trying again: ${e.message}")
                Thread.sleep(DOWNLOAD_RETRY_DELAY_MS * attempt)
                attempt++
            }
        }
    }

    private fun downloadOnce(downloadUrl: String, authToken: String?): File {
        // Enforce HTTPS: this APK is installed silently with Device Owner privileges, so a
        // cleartext download (which the app otherwise permits) would let a network MITM swap
        // in a malicious APK. HttpURLConnection does not auto-follow cross-protocol redirects
        // (https -> http), so validating the initial scheme is sufficient; a downgrade redirect
        // surfaces as a non-2xx response and is rejected below.
        val parsed = URL(downloadUrl)
        if (!parsed.protocol.equals("https", ignoreCase = true)) {
            throw RuntimeException("Refusing non-HTTPS APK download URL (scheme: ${parsed.protocol}).")
        }
        val conn = (parsed.openConnection() as HttpURLConnection).apply {
            connectTimeout = 30_000
            readTimeout = 120_000
            requestMethod = "GET"
            instanceFollowRedirects = true
            if (!authToken.isNullOrEmpty()) {
                setRequestProperty("Authorization", "Bearer $authToken")
            }
            setRequestProperty("Accept", "application/vnd.android.package-archive")
            setRequestProperty("User-Agent", "FreeKiosk-ManagedInstaller")
        }

        try {
            conn.connect()
            if (conn.responseCode in 500..599) {
                throw java.io.IOException("Download failed: HTTP ${conn.responseCode}")
            }
            if (conn.responseCode !in 200..299) {
                throw RuntimeException("Download failed: HTTP ${conn.responseCode}")
            }

            val dir = File(reactApplicationContext.cacheDir, "managed_apks").apply { mkdirs() }
            dir.listFiles()?.forEach { it.deleteRecursively() } // clean up previous downloads
            val outFile = File(dir, "managed-${System.currentTimeMillis()}.apk")

            conn.inputStream.use { input ->
                outFile.outputStream().use { output -> input.copyTo(output) }
            }

            if (outFile.length() < MIN_APK_BYTES) {
                val size = outFile.length()
                outFile.delete()
                throw RuntimeException("Downloaded file too small ($size bytes); likely not an APK.")
            }
            return outFile
        } finally {
            conn.disconnect()
        }
    }

    /**
     * What to install from a download: the APK itself, or the APKs inside it, base first. An app
     * built as an App Bundle comes from the management server as a zip of its parts. An APK is a
     * zip too, told apart by the manifest at its root.
     */
    private fun partsOf(download: File): List<File> {
        ZipFile(download).use { zip ->
            if (zip.getEntry("AndroidManifest.xml") != null) return listOf(download)

            val dir = partsDirOf(download).apply { mkdirs() }
            val parts = mutableListOf<File>()
            for (entry in zip.entries()) {
                // The name alone, never a path from the archive
                val name = File(entry.name).name
                if (entry.isDirectory || !name.endsWith(".apk", ignoreCase = true)) continue
                val part = File(dir, name)
                zip.getInputStream(entry).use { input -> part.outputStream().use { output -> input.copyTo(output) } }
                parts.add(part)
            }
            val base = parts.firstOrNull { it.name == "base.apk" }
                ?: throw RuntimeException("Downloaded file has neither a manifest nor a base.apk.")
            return listOf(base) + parts.filter { it !== base }
        }
    }

    private fun partsDirOf(download: File) = File(download.parentFile, "${download.name}.parts")

    private fun cleanUp(download: File) {
        partsDirOf(download).deleteRecursively()
        download.delete()
    }

    /**
     * Parse the downloaded APK's manifest (without installing it) and reject if its package
     * name does not match [expectedPackage]. Closes the gap where a MITM/malicious download
     * could deliver an APK for a different package than the one the cloud asked to install.
     */
    private fun verifyApkPackage(apkFile: File, expectedPackage: String?) {
        if (expectedPackage.isNullOrEmpty()) {
            throw RuntimeException("expectedPackage is required for a silent install.")
        }
        val pm = reactApplicationContext.packageManager
        val info = pm.getPackageArchiveInfo(apkFile.absolutePath, 0)
            ?: throw RuntimeException("Downloaded file is not a valid APK (cannot parse manifest).")
        if (info.packageName != expectedPackage) {
            throw RuntimeException(
                "APK package mismatch: downloaded ${info.packageName}, expected $expectedPackage.",
            )
        }
    }

    private fun installSilently(download: File, parts: List<File>, expectedPackage: String?, promise: Promise) {
        val context = reactApplicationContext
        val packageInstaller = context.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(
            PackageInstaller.SessionParams.MODE_FULL_INSTALL
        )
        if (!expectedPackage.isNullOrEmpty()) {
            params.setAppPackageName(expectedPackage)
        }

        val sessionId = packageInstaller.createSession(params)
        val session = packageInstaller.openSession(sessionId)
        // All the parts of an app go into one session: Android checks them as one install
        for (part in parts) {
            session.openWrite(part.name, 0, part.length()).use { output ->
                part.inputStream().use { input -> input.copyTo(output) }
                session.fsync(output)
            }
        }

        // Per-session broadcast carries the PackageInstaller result back to us so
        // we can resolve/reject the JS promise.
        val action = "$INSTALL_ACTION.$sessionId"
        val settled = AtomicBoolean(false)
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(c: Context?, intent: Intent?) {
                if (!settled.compareAndSet(false, true)) return
                try { context.unregisterReceiver(this) } catch (_: Exception) {}
                cleanUp(download)

                val status = intent?.getIntExtra(
                    PackageInstaller.EXTRA_STATUS,
                    PackageInstaller.STATUS_FAILURE,
                ) ?: PackageInstaller.STATUS_FAILURE
                val message = intent?.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE) ?: ""

                if (status == PackageInstaller.STATUS_SUCCESS) {
                    val result = Arguments.createMap().apply {
                        putString("status", "success")
                        putString("package", expectedPackage ?: "")
                    }
                    promise.resolve(result)
                } else {
                    promise.reject("INSTALL_FAILED", "Install failed (status $status): $message")
                }
            }
        }
        val filter = IntentFilter(action)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            context.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            context.registerReceiver(receiver, filter)
        }

        val intent = Intent(action).setPackage(context.packageName)
        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            PendingIntent.FLAG_MUTABLE
        } else {
            0
        }
        val pendingIntent = PendingIntent.getBroadcast(context, sessionId, intent, flags)
        if (expectedPackage == context.packageName) lightScreenForSelfUpdate()
        session.commit(pendingIntent.intentSender)
        session.close()
    }

    /**
     * Installing over itself stops this process, and with it every wake lock of the app. With the screen
     * off the whole tablet then slept within a second, in the middle of the install: Android finished it
     * and told the new version only when something woke the CPU, most often someone pressing the power
     * button (logcat on an SM-X210: not one line from anyone for 4 minutes, with 1.3 seconds of uptime in
     * them). A tablet with a lit screen does not sleep, and nothing else outlives the stop. The new version
     * lights the screen on starting anyway.
     */
    private fun lightScreenForSelfUpdate() {
        val power = reactApplicationContext.getSystemService(Context.POWER_SERVICE) as PowerManager
        if (power.isInteractive) return
        ScreenController.turnScreenOn(reactApplicationContext)
        val deadline = SystemClock.elapsedRealtime() + SCREEN_ON_WAIT_MS
        while (!power.isInteractive && SystemClock.elapsedRealtime() < deadline) Thread.sleep(100)
        android.util.Log.i(TAG, "Self-update with the screen off: lit it, interactive=${power.isInteractive}")
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
