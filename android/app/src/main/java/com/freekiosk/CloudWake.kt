package com.freekiosk

import android.content.Context
import android.content.Intent
import okhttp3.Call
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * Keeps one request open to the management website (GET /api/v1/devices/{id}/wait/), which answers it
 * the moment a command or a setting is queued for this tablet, so it arrives within seconds rather
 * than at the next heartbeat.
 *
 * Here and not in JS because React Native stops JS timers while another app is in front (see
 * CloudHeartbeatTaskService), which is when a teacher most wants to reach a tablet. This only hears
 * that there is something: the usual JS fetches it, through the headless task that works behind an
 * app and with the screen off. A word that gets lost costs nothing but time, since the heartbeat
 * still carries everything.
 */
object CloudWake {
    private const val TAG = "CloudWake"
    private const val MIN_RETRY_MS = 2_000L
    private const val MAX_RETRY_MS = 30_000L
    /** Whatever the server says, not more often than this */
    private const val MIN_ROUND_MS = 1_000L
    /** A server without this route, an older one or another cloud, will not grow it in a moment */
    private const val NO_SUCH_ROUTE_RETRY_MS = 10 * 60_000L

    // Longer than the server holds a request (25 seconds): a read that times out means a dead connection
    private val client by lazy {
        OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(40, TimeUnit.SECONDS)
            .writeTimeout(15, TimeUnit.SECONDS)
            .build()
    }

    private class Target(val cloudUrl: String, val deviceId: String, val apiKey: String) {
        fun sameAs(cloudUrl: String, deviceId: String, apiKey: String) =
            this.cloudUrl == cloudUrl && this.deviceId == deviceId && this.apiKey == apiKey
    }

    @Volatile private var target: Target? = null
    @Volatile private var call: Call? = null
    private var worker: Thread? = null

    /** Called with every heartbeat: does nothing while it runs with these credentials */
    @Synchronized
    fun start(context: Context, cloudUrl: String, deviceId: String, apiKey: String) {
        val url = cloudUrl.trimEnd('/')
        // An Android update in the middle, or just back from the restart that installed it
        SystemUpdater.resume(context, url, deviceId, apiKey)
        if (target?.sameAs(url, deviceId, apiKey) == true && worker?.isAlive == true) return
        stop()
        val mine = Target(url, deviceId, apiKey)
        target = mine
        val app = context.applicationContext
        worker = Thread({ loop(app, mine) }, TAG).apply {
            isDaemon = true
            start()
        }
    }

    @Synchronized
    fun stop() {
        target = null
        call?.cancel()
        worker?.interrupt()
        worker = null
    }

    private fun loop(context: Context, mine: Target) {
        val request = Request.Builder()
            .url("${mine.cloudUrl}/api/v1/devices/${mine.deviceId}/wait/")
            .header("Authorization", "Bearer ${mine.apiKey}")
            .build()
        var retryMs = MIN_RETRY_MS
        while (target === mine) {
            val startedAt = System.currentTimeMillis()
            var pauseMs: Long
            try {
                val running = client.newCall(request)
                call = running
                running.execute().use { response ->
                    when {
                        response.isSuccessful -> {
                            retryMs = MIN_RETRY_MS
                            pauseMs = MIN_ROUND_MS - (System.currentTimeMillis() - startedAt)
                            val answer = JSONObject(response.body?.string() ?: "{}")
                            if (answer.optBoolean("live") && target === mine) {
                                // Someone watches this screen on the website: natively, like this loop
                                LiveScreen.start(context, mine.cloudUrl, mine.deviceId, mine.apiKey)
                            }
                            if (answer.optBoolean("wake") && target === mine && (answer.optBoolean("commands") || answer.optBoolean("config"))) {
                                deliver(context, answer.optBoolean("commands"), answer.optBoolean("config"))
                            }
                        }
                        response.code == 404 -> pauseMs = NO_SUCH_ROUTE_RETRY_MS
                        else -> {
                            pauseMs = retryMs
                            retryMs = (retryMs * 2).coerceAtMost(MAX_RETRY_MS)
                        }
                    }
                }
            } catch (e: Exception) {
                // No network, or the server is restarting. The heartbeat carries on regardless
                if (target !== mine) return
                DebugLog.d(TAG, "Wait failed: ${e.message}")
                pauseMs = retryMs
                retryMs = (retryMs * 2).coerceAtMost(MAX_RETRY_MS)
            }
            if (pauseMs > 0) {
                try {
                    Thread.sleep(pauseMs)
                } catch (e: InterruptedException) {
                    return
                }
            }
        }
    }

    private fun deliver(context: Context, commands: Boolean, config: Boolean) {
        try {
            context.startService(
                Intent(context, CloudHeartbeatTaskService::class.java)
                    .putExtra("wake", true)
                    .putExtra("commands", commands)
                    .putExtra("config", config),
            )
        } catch (e: Exception) {
            // Background-start restrictions, or no React context yet. The next heartbeat delivers it
            DebugLog.errorProduction(TAG, "Could not start the task for a wake: ${e.message}")
        }
    }
}
