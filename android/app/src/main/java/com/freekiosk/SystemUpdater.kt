package com.freekiosk

import android.app.ActivityManager
import android.app.admin.DevicePolicyManager
import android.app.admin.SystemUpdatePolicy
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.SharedPreferences
import android.graphics.Rect
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.BatteryManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.provider.Settings
import android.view.accessibility.AccessibilityNodeInfo
import android.widget.Toast
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * Cập nhật Android from the website (command system_update): the maker's own update, through its own
 * screens, since nothing else may start it. On a Samsung its update agent (com.wssyncmldm) and the
 * Settings page that opens it both want a permission of Samsung's, and the one way in left to an app is
 * the link Settings answers, settings://com.samsung.android.settings.softwareupdate. On a Lenovo the
 * update app (com.lenovo.ota) opens with a permission of protection level normal, which FreeKiosk asks
 * for in its manifest; it checks, downloads and installs by itself, the install (A/B, while Android runs)
 * only while the tablet is idle, so the screen goes off for it and is lit every few minutes for a look.
 *
 * In kiosk mode FreeKiosk keeps Samsung's update apps suspended and updates postponed (blockUpdates,
 * from MainActivity.enableKioskRestrictions). For the length of the update that is lifted, the update
 * policy is made automatic so a downloaded update goes in at once, and Settings and the update agent are
 * let into lock task. Then the accessibility service presses on as a person would: Tải về và cài đặt,
 * Tải về, and Cài đặt ngay if it is asked. Samsung's screens show the percent on the tablet, and the
 * same number goes to the website (POST commands/{id}/progress/). The tablet restarts to install, and
 * the result goes once it is back, by its build against the one before (resume, at the first heartbeat).
 *
 * The state lives in SharedPreferences, so that it outlives the process and the restart. The credentials
 * do not: they come again with each heartbeat (CloudWake.start). Native, like LiveScreen: JS timers stop
 * with another app in front.
 */
object SystemUpdater {
    private const val TAG = "SystemUpdater"
    private const val PREFS = "freekiosk_system_update"

    private const val SETTINGS = "com.android.settings"
    private const val FOTA = "com.wssyncmldm"
    private const val SAMSUNG_LINK = "settings://com.samsung.android.settings.softwareupdate"
    private const val PRIMARY_BUTTON = "$FOTA:id/bt_highEmphasis"
    private val DOWNLOAD_AND_INSTALL = listOf("Tải về và cài đặt", "Download and install")

    // Lenovo's update app, and its words in English and Vietnamese (from its own strings)
    private const val LENOVO_OTA = "com.lenovo.ota"
    private const val LENOVO_OPEN = "com.lenovo.row.ota.activity.start"
    private val LENOVO_RESTART = listOf("Restart now", "Restart immediately", "Restart", "Khởi động lại ngay", "Khởi động lại")
    private val LENOVO_INSTALL = listOf("Install now", "Install", "Cài ngay", "Cài đặt")
    private val LENOVO_DOWNLOAD = listOf("Download and install", "Resume download", "Continue", "Tải về", "Tiếp tục tải về", "Tiếp tục")
    private val LENOVO_LATEST = listOf("You have the latest", "phiên bản mới nhất", "phiên bản hệ thống mới nhất")
    private val LENOVO_INSTALL_PAUSED = listOf("Update paused", "Installation paused", "Đã tạm dừng cập nhật", "Tạm dừng cài đặt")
    /** The install is done and only a restart is left: the words of its page, and of its dialog */
    private val LENOVO_COMPLETE = listOf("restart to complete", "khởi động lại để hoàn tất")
    private val LENOVO_INSTALLING = listOf("Installing", "System update in progress", "Đang cài đặt", "Đang cập nhật hệ thống", "about to complete", "sắp hoàn tất")
    private const val LENOVO_LOOK_EVERY_MS = 3 * 60_000L
    private const val LENOVO_INSTALL_TIMEOUT_MS = 90 * 60_000L

    /** What kiosk mode keeps suspended: Samsung's update apps, which otherwise prompt and restart at will */
    private val SAMSUNG_UPDATE_APPS = arrayOf(
        "com.samsung.android.app.updatecenter",
        "com.sec.android.fotaclient",
        "com.wssyncmldm",
        "com.samsung.android.sdm.config",
        "com.sec.android.soagent",
    )

    private const val MIN_BATTERY = 30
    private const val STEP_MS = 1_500L
    private const val REPORT_EVERY_MS = 20_000L
    private const val OPEN_TIMEOUT_MS = 90_000L
    private const val CHECK_TIMEOUT_MS = 3 * 60_000L
    private const val STALL_MS = 15 * 60_000L
    private const val INSTALL_TIMEOUT_MS = 20 * 60_000L
    private const val MAX_RUN_MS = 6 * 60 * 60_000L

    private val client by lazy {
        OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(20, TimeUnit.SECONDS)
            .writeTimeout(20, TimeUnit.SECONDS)
            .build()
    }
    private val jsonType = "application/json".toMediaType()

    private class Server(val url: String, val deviceId: String, val apiKey: String)

    @Volatile private var worker: Thread? = null
    @Volatile private var settling = false
    /** The window in front, from the accessibility service: Samsung's screens are told apart by class */
    @Volatile private var lastWindow = ""
    private var wakeLock: PowerManager.WakeLock? = null

    private fun prefs(context: Context): SharedPreferences =
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    // ─── For the kiosk ──────────────────────────────────────────────────────

    /** An update the website asked for is under way: kiosk mode leaves the update apps alone */
    fun isActive(context: Context): Boolean {
        val p = prefs(context)
        if (p.getString("command_id", null) == null || p.getString("stage", "") == "report") return false
        return System.currentTimeMillis() - p.getLong("started_at", 0L) < MAX_RUN_MS
    }

    /** What lock task must let in while it runs, also when the kiosk starts again in the meantime */
    fun lockTaskPackages(context: Context): List<String> = if (isActive(context)) packagesOf(context) else emptyList()

    /** The screens of the maker's update: Samsung's go through Settings, Lenovo's app is its own */
    private fun packagesOf(context: Context): List<String> = when {
        hasPackage(context.applicationContext, FOTA) -> listOf(SETTINGS, FOTA)
        hasPackage(context.applicationContext, LENOVO_OTA) -> listOf(LENOVO_OTA)
        else -> emptyList()
    }

    /** Kiosk mode: no update prompts, no restart in the middle of a lesson */
    fun blockUpdates(dpm: DevicePolicyManager, admin: ComponentName) {
        dpm.setPackagesSuspended(admin, SAMSUNG_UPDATE_APPS, true)
        dpm.setSystemUpdatePolicy(admin, SystemUpdatePolicy.createPostponeInstallPolicy())
    }

    /** Out of kiosk mode: Android's own behaviour */
    fun unblockUpdates(dpm: DevicePolicyManager, admin: ComponentName) {
        dpm.setPackagesSuspended(admin, SAMSUNG_UPDATE_APPS, false)
        dpm.setSystemUpdatePolicy(admin, null)
    }

    /** From the accessibility service, for each window that comes in front */
    fun onWindow(packageName: String, className: String?) {
        if (packageName == FOTA || packageName == SETTINGS || packageName == LENOVO_OTA) lastWindow = className ?: ""
    }

    /** Null when this tablet can, or why not, in the words the website puts in Vietnamese */
    fun whyNot(context: Context): String? {
        val app = context.applicationContext
        val dpm = app.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
        if (!dpm.isDeviceOwnerApp(app.packageName)) return "System update needs Device Owner mode"
        if (!hasPackage(app, FOTA) && !hasPackage(app, LENOVO_OTA)) return "No Samsung or Lenovo software update on this tablet"
        if (FreeKioskAccessibilityService.instance == null) return "System update needs the accessibility service of FreeKiosk"
        return null
    }

    // ─── Start ──────────────────────────────────────────────────────────────

    /** Null once it is under way, or why it cannot start: then nothing was changed */
    fun start(react: ReactApplicationContext, commandId: String, cloudUrl: String, deviceId: String, apiKey: String): String? {
        val app = react.applicationContext
        whyNot(app)?.let { return it }
        if (!onWifi(app)) return "System update needs Wi-Fi"
        val (level, charging) = battery(app)
        if (level in 0 until MIN_BATTERY && !charging) return "Battery too low for a system update ($level%)"
        val p = prefs(app)
        val running = p.getString("command_id", null)
        if (running != null && running != commandId && isActive(app)) return "A system update is already under way"

        p.edit()
            .putString("command_id", commandId)
            .putString("from_build", Build.DISPLAY ?: "")
            .putInt("boot_count", bootCount(app))
            .putLong("started_at", System.currentTimeMillis())
            .putString("stage", "opening")
            .remove("pending")
            .commit()
        DebugLog.d(TAG, "Android update asked by the website, from ${Build.DISPLAY}")

        try {
            allowUpdates(app)
        } catch (e: Exception) {
            restore(app)
            p.edit().clear().commit()
            return "Software update did not answer (${e.message})"
        }
        // A screen that is off shows nothing, and a tablet that is asleep downloads nothing
        val asleep = !(app.getSystemService(Context.POWER_SERVICE) as PowerManager).isInteractive
        if (asleep) {
            try { ScreenController.turnScreenOn(react) } catch (e: Exception) { DebugLog.d(TAG, "Screen not lit: ${e.message}") }
        }
        keepScreenOn(app, true)
        startWorker(app, Server(cloudUrl.trimEnd('/'), deviceId, apiKey), if (asleep) 2_000L else 300L)
        return null
    }

    // ─── Each heartbeat ─────────────────────────────────────────────────────

    /**
     * Called with the credentials at each heartbeat (CloudWake.start): reports what a restart decided, sends
     * a result the network refused, or watches again after the process died in the middle.
     */
    fun resume(context: Context, cloudUrl: String, deviceId: String, apiKey: String) {
        val app = context.applicationContext
        val p = prefs(app)
        if (p.getString("command_id", null) == null) return
        if (worker?.isAlive == true || settling) return
        settling = true
        val server = Server(cloudUrl.trimEnd('/'), deviceId, apiKey)
        Thread({
            try {
                when {
                    p.getString("stage", "") == "report" -> sendPending(app, server)
                    bootCount(app) != p.getInt("boot_count", -2) -> afterRestart(app, server)
                    System.currentTimeMillis() - p.getLong("started_at", 0L) > MAX_RUN_MS ->
                        finish(app, server, false, null, "Software update did not answer")
                    else -> startWorker(app, server, 0L)
                }
            } catch (e: Exception) {
                DebugLog.d(TAG, "Resume failed: ${e.message}")
            } finally {
                settling = false
            }
        }, "$TAG-resume").start()
    }

    /** The tablet came back: a new build is the update in, the same one is an update that did not go in */
    private fun afterRestart(app: Context, server: Server) {
        val from = prefs(app).getString("from_build", "") ?: ""
        val now = Build.DISPLAY ?: ""
        if (now.isNotEmpty() && now != from) {
            val result = JSONObject()
                .put("from", shortBuild(from))
                .put("to", shortBuild(now))
                .put("security_patch", securityPatch())
            finish(app, server, true, result, null)
            toast(app, "Đã cập nhật Android lên bản ${shortBuild(now)}")
        } else {
            finish(app, server, false, null, "Restarted on the same build")
        }
    }

    // ─── Watching the maker's screens ───────────────────────────────────────

    @Synchronized
    private fun startWorker(app: Context, server: Server, delayMs: Long) {
        if (worker?.isAlive == true) return
        worker = Thread({ watch(app, server, delayMs) }, TAG).apply {
            isDaemon = true
            start()
        }
    }

    private fun watch(app: Context, server: Server, delayMs: Long) {
        val p = prefs(app)
        var stageSince = SystemClock.elapsedRealtime()
        var lastPercent = -1
        var lastPercentAt = SystemClock.elapsedRealtime()
        var reportedPercent = -1
        var reportedAt = 0L
        var openedAt = 0L
        var pressedAt = SystemClock.elapsedRealtime()
        // Lenovo: the screen off while it installs, lit for a look now and then
        val lenovo = !hasPackage(app, FOTA) && hasPackage(app, LENOVO_OTA)
        var idle = false
        var lookAt = 0L
        var restartAskedAt = 0L
        keepScreenOn(app, true)
        try {
            Thread.sleep(delayMs)
            while (true) {
                val commandId = p.getString("command_id", null) ?: return
                var stage = p.getString("stage", "opening") ?: "opening"
                if (stage == "report") return
                val now = SystemClock.elapsedRealtime()
                if (System.currentTimeMillis() - p.getLong("started_at", 0L) > MAX_RUN_MS) {
                    finish(app, server, false, null, "Software update did not answer")
                    return
                }
                if (idle) {
                    if (now < lookAt) {
                        Thread.sleep(STEP_MS * 4)
                        continue
                    }
                    // A look: lit for a few seconds, its screen in front again, then left alone if not done
                    wake(app)
                    openSoftwareUpdate(app)
                    openedAt = SystemClock.elapsedRealtime()
                    Thread.sleep(5_000L)
                    idle = false
                    continue
                }
                fun moveTo(next: String) {
                    p.edit().putString("stage", next).commit()
                    stage = next
                    stageSince = SystemClock.elapsedRealtime()
                    DebugLog.d(TAG, "Stage $next")
                    progress(server, commandId, next, null)
                }

                val root = root()
                val pkg = root?.packageName?.toString()
                val window = lastWindow
                when {
                    pkg == LENOVO_OTA -> {
                        val text = textOf(root)
                        val percent = percentOn(root)
                        val restart = findExact(root, LENOVO_RESTART)
                        val install = findExact(root, LENOVO_INSTALL)
                        val download = findExact(root, LENOVO_DOWNLOAD)
                        val complete = LENOVO_COMPLETE.any { text.contains(it, ignoreCase = true) }
                        when {
                            complete || restart != null -> {
                                if (restartAskedAt == 0L) {
                                    // Lenovo's own Restart now, once: pressed again it only brings its dialog back
                                    if (restart != null) click(restart)
                                    restartAskedAt = now
                                    if (stage != "installing") moveTo("installing")
                                    progress(server, commandId, "installing", 100, "Đang khởi động lại để hoàn tất")
                                } else if (complete && now - restartAskedAt > 15_000L) {
                                    // In kiosk mode Lenovo's restart never came on a TB330XU, pressed for a minute.
                                    // The install is done, so a restart by the Device Owner completes it the same way
                                    rebootNow(app)
                                    restartAskedAt = now
                                }
                            }
                            install != null -> if (click(install)) moveTo("installing")
                            download != null && stage != "installing" -> if (click(download)) moveTo("downloading")
                            percent == null && LENOVO_LATEST.any { text.contains(it, ignoreCase = true) } -> {
                                val result = JSONObject().put("up_to_date", true).put("build", shortBuild(Build.DISPLAY ?: "")).put("security_patch", securityPatch())
                                finish(app, server, true, result, null)
                                return
                            }
                            LENOVO_INSTALL_PAUSED.any { text.contains(it, ignoreCase = true) } -> {
                                // "Resumes when the device is idle", Lenovo says: so the screen goes off for it
                                if (stage != "installing") moveTo("installing")
                                progress(server, commandId, "installing", percent, "Màn hình tắt trong lúc cài: Lenovo chỉ cài khi máy rảnh")
                                keepScreenOn(app, false)
                                lockScreen(app)
                                idle = true
                                lookAt = SystemClock.elapsedRealtime() + LENOVO_LOOK_EVERY_MS
                            }
                            else -> {
                                val next = when {
                                    LENOVO_INSTALLING.any { text.contains(it, ignoreCase = true) } -> "installing"
                                    percent != null -> "downloading"
                                    stage == "opening" -> "checking"
                                    else -> stage
                                }
                                if (next != stage) moveTo(next)
                                if (percent != null && percent != lastPercent) {
                                    lastPercent = percent
                                    lastPercentAt = now
                                }
                                if (percent != null && ((percent != reportedPercent && now - reportedAt > 3_000L) || now - reportedAt > REPORT_EVERY_MS)) {
                                    progress(server, commandId, stage, percent)
                                    reportedPercent = percent
                                    reportedAt = now
                                }
                            }
                        }
                    }
                    pkg == FOTA && window.endsWith("IDMUIActivityForDialog") -> {
                        // A question or a problem of Samsung's, in the tablet's language: said as it is
                        finish(app, server, false, null, "Samsung: ${textOf(root)}".take(400))
                        return
                    }
                    pkg == FOTA && window.contains("NoUpdatable") -> {
                        val result = JSONObject().put("up_to_date", true).put("build", shortBuild(Build.DISPLAY ?: "")).put("security_patch", securityPatch())
                        finish(app, server, true, result, null)
                        return
                    }
                    pkg == FOTA && window.contains("DownloadConfirm") -> {
                        if (clickById(root, PRIMARY_BUTTON)) moveTo("downloading")
                    }
                    pkg == FOTA && window.contains("InstallConfirm") -> {
                        if (clickById(root, PRIMARY_BUTTON)) moveTo("installing")
                    }
                    pkg == FOTA && window.contains("Progress") -> {
                        if (stage != "downloading" && stage != "installing") moveTo("downloading")
                        val percent = percentOn(root)
                        if (percent != null && percent != lastPercent) {
                            lastPercent = percent
                            lastPercentAt = now
                        }
                        if (percent != null && ((percent != reportedPercent && now - reportedAt > 3_000L) || now - reportedAt > REPORT_EVERY_MS)) {
                            progress(server, commandId, stage, percent)
                            reportedPercent = percent
                            reportedAt = now
                        }
                    }
                    pkg == SETTINGS && stage == "opening" -> {
                        val item = findByText(root, DOWNLOAD_AND_INSTALL) ?: firstTitle(root)
                        if (item != null && click(item)) {
                            pressedAt = now
                            moveTo("checking")
                        }
                    }
                    pkg == SETTINGS && (stage == "checking" || stage == "downloading") && now - pressedAt > 10_000L -> {
                        // Back on the page with nothing of Samsung's in front: its screen was covered, or the
                        // press went nowhere. Samsung takes it again as the same check, or shows the download
                        // under way, and its percent with it
                        val item = findByText(root, DOWNLOAD_AND_INSTALL) ?: firstTitle(root)
                        if (item != null && click(item)) pressedAt = now
                    }
                    pkg != FOTA && pkg != SETTINGS && pkg != LENOVO_OTA && (stage != "installing" || lenovo) && now - openedAt > 20_000L -> {
                        // Not in front, at first or after someone left it: the maker goes on downloading in the
                        // background, and opening its screen again shows it where it is
                        openSoftwareUpdate(app)
                        openedAt = now
                    }
                }

                val waited = SystemClock.elapsedRealtime() - stageSince
                val stuck = when (stage) {
                    "opening" -> waited > OPEN_TIMEOUT_MS
                    "checking" -> waited > CHECK_TIMEOUT_MS
                    "downloading" -> waited > STALL_MS && SystemClock.elapsedRealtime() - lastPercentAt > STALL_MS
                    "installing" -> waited > (if (lenovo) LENOVO_INSTALL_TIMEOUT_MS else INSTALL_TIMEOUT_MS)
                    else -> false
                }
                if (stuck) {
                    finish(app, server, false, null, if (stage == "downloading") "Download stopped at $lastPercent%" else "Software update did not answer ($stage)")
                    return
                }
                Thread.sleep(STEP_MS)
            }
        } catch (e: InterruptedException) {
            // Stopped with the process
        } catch (e: Exception) {
            DebugLog.errorProduction(TAG, "Watching the update failed: ${e.message}")
            finish(app, server, false, null, "Software update did not answer (${e.javaClass.simpleName})")
        } finally {
            keepScreenOn(app, false)
        }
    }

    // ─── The end of it ──────────────────────────────────────────────────────

    /** Puts the kiosk back as it was, then says how it went. A result the network refused waits for the next heartbeat */
    private fun finish(app: Context, server: Server, ok: Boolean, result: JSONObject?, error: String?) {
        val p = prefs(app)
        val commandId = p.getString("command_id", null) ?: return
        DebugLog.d(TAG, if (ok) "Done: $result" else "Failed: $error")
        p.edit()
            .putString("stage", "report")
            .putString("pending", JSONObject().put("ok", ok).put("result", result ?: JSONObject.NULL).put("error", error ?: "").toString())
            .commit()
        restore(app)
        if (sendResult(server, commandId, ok, result, error)) p.edit().clear().commit()
    }

    private fun sendPending(app: Context, server: Server) {
        val p = prefs(app)
        val commandId = p.getString("command_id", null) ?: return
        val pending = try { JSONObject(p.getString("pending", "{}") ?: "{}") } catch (_: Exception) { JSONObject() }
        val ok = pending.optBoolean("ok", false)
        val result = pending.optJSONObject("result")
        val error = pending.optString("error", "").ifEmpty { null }
        if (sendResult(server, commandId, ok, result, error)) p.edit().clear().commit()
    }

    private fun restore(app: Context) {
        val dpm = app.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
        val admin = ComponentName(app, DeviceAdminReceiver::class.java)
        try {
            if (!dpm.isDeviceOwnerApp(app.packageName)) return
            val locked = (app.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager).lockTaskModeState != ActivityManager.LOCK_TASK_MODE_NONE
            // Only what this added: whatever else let them in still wants them
            val added = prefs(app).getString("added_packages", "")?.split(',')?.filter { it.isNotEmpty() } ?: emptyList()
            val current = LockTaskCompat.readPackages(dpm, admin)
            if (current != null && added.isNotEmpty()) dpm.setLockTaskPackages(admin, current.filterNot { it in added }.toTypedArray())
            if (locked) blockUpdates(dpm, admin) else unblockUpdates(dpm, admin)
            if (locked) {
                app.startActivity(
                    Intent(app, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT),
                )
            }
        } catch (e: Exception) {
            DebugLog.d(TAG, "Kiosk not put back fully: ${e.message}")
        }
    }

    /** The update apps back, an automatic policy for what downloads, and their screens let into lock task */
    private fun allowUpdates(app: Context) {
        val dpm = app.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
        val admin = ComponentName(app, DeviceAdminReceiver::class.java)
        dpm.setPackagesSuspended(admin, SAMSUNG_UPDATE_APPS, false)
        dpm.setSystemUpdatePolicy(admin, SystemUpdatePolicy.createAutomaticInstallPolicy())
        val current = LockTaskCompat.readPackages(dpm, admin)
        if (current != null) {
            val added = packagesOf(app).filterNot { it in current }
            prefs(app).edit().putString("added_packages", added.joinToString(",")).commit()
            if (added.isNotEmpty()) dpm.setLockTaskPackages(admin, (current.toList() + added).toTypedArray())
        }
    }

    // ─── The website ────────────────────────────────────────────────────────

    private fun progress(server: Server, commandId: String, stage: String, percent: Int?, message: String? = null) {
        val body = JSONObject().put("stage", stage)
        if (percent != null) body.put("percent", percent)
        if (message != null) body.put("message", message)
        post(server, "/api/v1/commands/$commandId/progress/", body)
    }

    private fun sendResult(server: Server, commandId: String, ok: Boolean, result: JSONObject?, error: String?): Boolean {
        val body = JSONObject()
            .put("status", if (ok) "success" else "error")
            .put("result", result ?: JSONObject.NULL)
            .put("error_message", error ?: "")
        return post(server, "/api/v1/commands/$commandId/result/", body)
    }

    private fun post(server: Server, path: String, body: JSONObject): Boolean = try {
        client.newCall(
            Request.Builder()
                .url(server.url + path)
                .header("Authorization", "Bearer ${server.apiKey}")
                .post(body.toString().toRequestBody(jsonType))
                .build(),
        ).execute().use { it.isSuccessful }
    } catch (e: Exception) {
        DebugLog.d(TAG, "Not sent to the website: ${e.message}")
        false
    }

    // ─── The screen ─────────────────────────────────────────────────────────

    private fun openSoftwareUpdate(app: Context) {
        try {
            val intent = if (hasPackage(app, FOTA)) {
                Intent(Intent.ACTION_VIEW, Uri.parse(SAMSUNG_LINK))
            } else {
                Intent(LENOVO_OPEN).setPackage(LENOVO_OTA)
            }
            app.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (e: Exception) {
            DebugLog.d(TAG, "Software update not opened: ${e.message}")
        }
    }

    private fun root(): AccessibilityNodeInfo? = try {
        FreeKioskAccessibilityService.instance?.rootInActiveWindow
    } catch (_: Exception) {
        null
    }

    /**
     * An entry by its title. On a tablet Settings shows its own list beside the page, where Cập nhật phần
     * mềm says Tải về và cài đặt too, as a summary: only a title is the button
     */
    private fun findByText(root: AccessibilityNodeInfo, texts: List<String>): AccessibilityNodeInfo? {
        val titles = root.findAccessibilityNodeInfosByViewId("android:id/title") ?: return null
        return titles.firstOrNull { node ->
            node.isVisibleToUser && texts.any { node.text?.toString()?.trim().equals(it, ignoreCase = true) }
        }
    }

    /** A button by its whole label, in the order given: Restart now before Restart */
    private fun findExact(root: AccessibilityNodeInfo, texts: List<String>): AccessibilityNodeInfo? {
        for (text in texts) {
            val hit = root.findAccessibilityNodeInfosByText(text)?.firstOrNull { node ->
                node.isVisibleToUser && node.text?.toString()?.trim().equals(text, ignoreCase = true) && pressable(node)
            }
            if (hit != null) return hit
        }
        return null
    }

    private fun pressable(node: AccessibilityNodeInfo): Boolean {
        var current: AccessibilityNodeInfo? = node
        var depth = 0
        while (current != null && depth++ < 4) {
            if (current.isClickable && current.isEnabled) return true
            current = current.parent
        }
        return false
    }

    private fun rebootNow(app: Context) {
        try {
            (app.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager)
                .reboot(ComponentName(app, DeviceAdminReceiver::class.java))
        } catch (e: Exception) {
            DebugLog.errorProduction(TAG, "Restart refused: ${e.message}")
        }
    }

    private fun lockScreen(app: Context) {
        try {
            (app.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager).lockNow()
        } catch (e: Exception) {
            DebugLog.d(TAG, "Screen not turned off: ${e.message}")
        }
    }

    /** The screen on again: the kiosk's own way first, which works where a wake lock may not wake it */
    private fun wake(app: Context) {
        val react = KioskModule.reactContextOrNull()
        try {
            if (react != null) ScreenController.turnScreenOn(react)
        } catch (e: Exception) {
            DebugLog.d(TAG, "Screen not lit: ${e.message}")
        }
        keepScreenOn(app, true)
    }

    /** The first entry of a Settings list, where Samsung puts Tải về và cài đặt whatever the language */
    private fun firstTitle(root: AccessibilityNodeInfo): AccessibilityNodeInfo? =
        root.findAccessibilityNodeInfosByViewId("android:id/title")?.firstOrNull { it.isVisibleToUser }

    private fun clickById(root: AccessibilityNodeInfo, id: String): Boolean {
        val node = root.findAccessibilityNodeInfosByViewId(id)?.firstOrNull { it.isVisibleToUser && it.isEnabled } ?: return false
        DebugLog.d(TAG, "Pressing ${node.text}")
        return click(node)
    }

    private fun click(node: AccessibilityNodeInfo): Boolean {
        var current: AccessibilityNodeInfo? = node
        while (current != null) {
            if (current.isClickable && current.isEnabled) return current.performAction(AccessibilityNodeInfo.ACTION_CLICK)
            current = current.parent
        }
        // Nothing clickable on the way up: a tap in its middle
        val bounds = Rect()
        node.getBoundsInScreen(bounds)
        return FreeKioskAccessibilityService.stroke(bounds.exactCenterX(), bounds.exactCenterY(), bounds.exactCenterX(), bounds.exactCenterY(), 60L)
    }

    /** A progress bar says it best, then a text with a percent sign */
    private fun percentOn(root: AccessibilityNodeInfo): Int? {
        val queue = ArrayDeque<AccessibilityNodeInfo>()
        queue.add(root)
        var fromText: Int? = null
        var seen = 0
        while (queue.isNotEmpty() && seen++ < 500) {
            val node = queue.removeFirst()
            val range = node.rangeInfo
            if (range != null && range.max > range.min && node.className?.toString()?.contains("ProgressBar") == true) {
                return (((range.current - range.min) * 100f) / (range.max - range.min)).toInt().coerceIn(0, 100)
            }
            if (fromText == null) {
                Regex("""(\d{1,3})\s?%""").find(node.text ?: "")?.let { fromText = it.groupValues[1].toInt().coerceIn(0, 100) }
            }
            for (i in 0 until node.childCount) node.getChild(i)?.let { queue.add(it) }
        }
        return fromText
    }

    private fun textOf(root: AccessibilityNodeInfo?): String {
        if (root == null) return ""
        val parts = mutableListOf<String>()
        val queue = ArrayDeque<AccessibilityNodeInfo>()
        queue.add(root)
        var seen = 0
        while (queue.isNotEmpty() && seen++ < 300) {
            val node = queue.removeFirst()
            node.text?.toString()?.trim()?.takeIf { it.isNotEmpty() && it !in parts }?.let { parts.add(it) }
            for (i in 0 until node.childCount) node.getChild(i)?.let { queue.add(it) }
        }
        return parts.joinToString(" · ")
    }

    @Suppress("DEPRECATION")
    @Synchronized
    private fun keepScreenOn(app: Context, on: Boolean) {
        if (on && wakeLock == null) {
            val power = app.getSystemService(Context.POWER_SERVICE) as PowerManager
            wakeLock = power.newWakeLock(PowerManager.SCREEN_BRIGHT_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP, "FreeKiosk:SystemUpdate")
                .apply { acquire(MAX_RUN_MS) }
        } else if (!on) {
            wakeLock?.let { if (it.isHeld) it.release() }
            wakeLock = null
        }
    }

    private fun toast(app: Context, text: String) {
        Handler(Looper.getMainLooper()).post {
            try { Toast.makeText(app, text, Toast.LENGTH_LONG).show() } catch (_: Exception) {}
        }
    }

    // ─── The tablet ─────────────────────────────────────────────────────────

    private fun hasPackage(app: Context, name: String): Boolean = try {
        @Suppress("DEPRECATION")
        app.packageManager.getPackageInfo(name, 0)
        true
    } catch (_: Exception) {
        false
    }

    private fun onWifi(app: Context): Boolean {
        val connectivity = app.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val caps = connectivity.getNetworkCapabilities(connectivity.activeNetwork) ?: return false
        return caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) || caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)
    }

    private fun battery(app: Context): Pair<Int, Boolean> {
        val status = app.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED)) ?: return -1 to false
        val level = status.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
        val scale = status.getIntExtra(BatteryManager.EXTRA_SCALE, 100).takeIf { it > 0 } ?: 100
        val plugged = status.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) != 0
        return (if (level < 0) -1 else level * 100 / scale) to plugged
    }

    private fun bootCount(app: Context): Int = Settings.Global.getInt(app.contentResolver, Settings.Global.BOOT_COUNT, -1)

    private fun securityPatch(): String = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) Build.VERSION.SECURITY_PATCH ?: "" else ""

    /**
     * The part that changes with each update: BP2A.250605.031.A3.X210XXSBEZBA reads as X210XXSBEZBA, and
     * TB330XU_ROW_OPEN_USER_V5_V_ZUI_17.0.254_ST_251109 as ZUI 17.0.254
     */
    private fun shortBuild(build: String): String =
        Regex("""ZUI_([0-9.]+)""").find(build)?.let { "ZUI ${it.groupValues[1]}" } ?: build.substringAfterLast('.')
}

/** For CloudCommandService: starts an update, and says whether this tablet can (capabilities) */
class SystemUpdateModule(private val react: ReactApplicationContext) : ReactContextBaseJavaModule(react) {
    override fun getName() = "SystemUpdateModule"

    @ReactMethod
    fun supported(promise: Promise) {
        promise.resolve(SystemUpdater.whyNot(react) == null)
    }

    /** Resolves null once under way, the result then coming from the native side, or why it could not start */
    @ReactMethod
    fun start(commandId: String, cloudUrl: String, deviceId: String, apiKey: String, promise: Promise) {
        try {
            promise.resolve(SystemUpdater.start(react, commandId, cloudUrl, deviceId, apiKey))
        } catch (e: Exception) {
            promise.resolve("Software update did not answer (${e.message})")
        }
    }
}
