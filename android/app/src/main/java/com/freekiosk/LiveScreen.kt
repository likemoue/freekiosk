package com.freekiosk

import android.accessibilityservice.AccessibilityService
import android.content.Context
import android.graphics.Bitmap
import android.hardware.display.DisplayManager
import android.os.PowerManager
import android.os.SystemClock
import android.util.DisplayMetrics
import android.view.Display
import android.view.KeyEvent
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder
import java.util.concurrent.TimeUnit

/**
 * The screen on the management website, live, and a hand on it (Ảnh màn hình > Trực tiếp).
 *
 * While someone watches, this sends a picture of the screen every second or so, and does what comes back
 * with the answer: a tap, a swipe, Back, Home, Recents, text. The wake channel starts it (CloudWake), and
 * it stops when the website says nobody watches any more, or after half an hour whatever it says.
 *
 * A picture of another app comes from the accessibility service, which Android lets take one a second,
 * and the hand needs the service too. Native, like CloudWake: JS timers stop with another app in front.
 */
object LiveScreen {
    private const val TAG = "LiveScreen"
    private const val MAX_SESSION_MS = 30 * 60_000L
    private const val MAX_FAILURES = 5

    private val client by lazy {
        OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(20, TimeUnit.SECONDS)
            .writeTimeout(20, TimeUnit.SECONDS)
            .build()
    }
    private val jpeg = "image/jpeg".toMediaType()

    @Volatile private var worker: Thread? = null

    @Synchronized
    fun start(context: Context, cloudUrl: String, deviceId: String, apiKey: String) {
        if (worker?.isAlive == true) return
        val app = context.applicationContext
        worker = Thread({ loop(app, cloudUrl.trimEnd('/'), deviceId, apiKey) }, TAG).apply {
            isDaemon = true
            start()
        }
        DebugLog.d(TAG, "Live screen started")
    }

    private fun loop(context: Context, cloudUrl: String, deviceId: String, apiKey: String) {
        var intervalMs = 1_000L
        var maxWidth = 960
        var quality = 60
        var failures = 0
        val startedAt = SystemClock.elapsedRealtime()
        try {
            while (SystemClock.elapsedRealtime() - startedAt < MAX_SESSION_MS) {
                val began = SystemClock.elapsedRealtime()
                val (width, height) = displaySize(context)
                var frame = ByteArray(0)
                val problem = when {
                    !(context.getSystemService(Context.POWER_SERVICE) as PowerManager).isInteractive -> "screen_off"
                    else -> {
                        val react = KioskModule.reactContextOrNull()
                        if (react == null) {
                            "starting"
                        } else {
                            val bytes = ScreenCapture.capture(react, Bitmap.CompressFormat.JPEG, quality, maxWidth)
                            if (bytes == null) ScreenCapture.lastError ?: "capture_failed" else {
                                frame = bytes
                                null
                            }
                        }
                    }
                }
                val control = if (FreeKioskAccessibilityService.canPerformGestures()) "1" else "0"
                val url = StringBuilder("$cloudUrl/api/v1/devices/$deviceId/live/frame/?w=$width&h=$height&control=$control")
                if (problem != null) url.append("&problem=").append(URLEncoder.encode(problem.take(300), "UTF-8"))
                val answer = try {
                    client.newCall(
                        Request.Builder()
                            .url(url.toString())
                            .header("Authorization", "Bearer $apiKey")
                            .post(frame.toRequestBody(jpeg))
                            .build(),
                    ).execute().use { response ->
                        if (response.isSuccessful) JSONObject(response.body?.string() ?: "{}") else null
                    }
                } catch (e: Exception) {
                    DebugLog.d(TAG, "Frame not sent: ${e.message}")
                    null
                }
                if (answer == null) {
                    if (++failures >= MAX_FAILURES) break
                    Thread.sleep(2_000L)
                    continue
                }
                failures = 0
                if (!answer.optBoolean("active")) break
                intervalMs = answer.optLong("interval_ms", 1_000L).coerceIn(500L, 15_000L)
                maxWidth = answer.optInt("max_width", 960).coerceIn(240, 1920)
                quality = answer.optInt("quality", 60).coerceIn(20, 90)
                answer.optJSONArray("inputs")?.let { apply(it, width, height) }
                val rest = intervalMs - (SystemClock.elapsedRealtime() - began)
                if (rest > 0) Thread.sleep(rest)
            }
        } catch (e: InterruptedException) {
            // Stopped: nothing to tidy up
        } finally {
            DebugLog.d(TAG, "Live screen stopped")
        }
    }

    /** What the website asked for, in the order it was asked. Positions come as fractions of the picture */
    private fun apply(inputs: JSONArray, width: Int, height: Int) {
        for (i in 0 until inputs.length()) {
            val input = inputs.optJSONObject(i) ?: continue
            val x = (input.optDouble("x", -1.0) * width).toFloat()
            val y = (input.optDouble("y", -1.0) * height).toFloat()
            val done = when (input.optString("type")) {
                "tap" -> x >= 0 && y >= 0 && FreeKioskAccessibilityService.stroke(x, y, x, y, 60L)
                "long_press" -> x >= 0 && y >= 0 && FreeKioskAccessibilityService.stroke(x, y, x, y, 800L)
                "swipe" -> {
                    val x2 = (input.optDouble("x2", -1.0) * width).toFloat()
                    val y2 = (input.optDouble("y2", -1.0) * height).toFloat()
                    x >= 0 && y >= 0 && x2 >= 0 && y2 >= 0 &&
                        FreeKioskAccessibilityService.stroke(x, y, x2, y2, input.optLong("ms", 300L))
                }
                "key" -> when (input.optString("key")) {
                    "back" -> FreeKioskAccessibilityService.performAction(AccessibilityService.GLOBAL_ACTION_BACK)
                    "home" -> FreeKioskAccessibilityService.performAction(AccessibilityService.GLOBAL_ACTION_HOME)
                    "recents" -> FreeKioskAccessibilityService.performAction(AccessibilityService.GLOBAL_ACTION_RECENTS)
                    "enter" -> FreeKioskAccessibilityService.sendKey(KeyEvent.KEYCODE_ENTER)
                    "backspace" -> FreeKioskAccessibilityService.sendKey(KeyEvent.KEYCODE_DEL)
                    else -> false
                }
                "text" -> FreeKioskAccessibilityService.sendText(input.optString("text").take(500))
                else -> false
            }
            if (!done) DebugLog.d(TAG, "Input not done: ${input.optString("type")}")
            // A tap on a button that opens something must land before the next one
            Thread.sleep(150L)
        }
    }

    /** The whole display, as the accessibility service takes its picture and places its gestures */
    private fun displaySize(context: Context): Pair<Int, Int> {
        val display = (context.getSystemService(Context.DISPLAY_SERVICE) as DisplayManager).getDisplay(Display.DEFAULT_DISPLAY)
        val metrics = DisplayMetrics()
        @Suppress("DEPRECATION")
        display.getRealMetrics(metrics)
        return metrics.widthPixels to metrics.heightPixels
    }
}
