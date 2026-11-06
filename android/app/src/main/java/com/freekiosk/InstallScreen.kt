package com.freekiosk

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.util.Log
import com.facebook.react.bridge.ReactApplicationContext
import java.util.concurrent.atomic.AtomicBoolean

/**
 * The screen during an install: a tablet whose screen was off lights it for the install and turns it off
 * again once the install is over. One whose screen was on keeps it as it is, and so does one someone
 * touched in the meantime.
 *
 * An update of this app stops the process before it can turn anything off. It leaves a note instead, and
 * the new version turns the screen off once it is up (BootReceiver.handlePackageReplaced).
 */
object InstallScreen {
    private const val TAG = "InstallScreen"
    private const val PREFS = "FreeKioskInstallScreen"
    private const val SELF_UPDATE_AT = "lit_for_self_update_at"
    private const val LIGHT_WAIT_MS = 3_000L
    /** Covers the report of the result, and the next install of a batch, which keeps the screen lit */
    private const val OFF_DELAY_MS = 5_000L
    /** Long enough for the new version to come up and report the install */
    private const val AFTER_SELF_UPDATE_MS = 10_000L
    /** A note older than this comes from an update that ended some other way */
    private const val NOTE_VALID_MS = 15 * 60_000L
    private const val KEEP_LIT_MAX_MS = 30 * 60_000L

    private val lock = Any()
    private val main = Handler(Looper.getMainLooper())
    private var running = 0
    /** When the screen was lit for the installs of this process, 0 when they found it on */
    private var litAt = 0L
    private var keepLit: PowerManager.WakeLock? = null
    @Volatile private var touchedAt = 0L

    class Install internal constructor(private val context: Context) {
        private val ended = AtomicBoolean(false)

        /** [selfUpdated]: this app was replaced, and the new version takes over */
        fun end(selfUpdated: Boolean = false) {
            if (ended.compareAndSet(false, true)) InstallScreen.end(context, selfUpdated)
        }
    }

    /** Someone used the tablet: what they look at stays lit */
    fun noteUserInteraction() {
        touchedAt = SystemClock.elapsedRealtime()
    }

    /** Before the download, off the main thread: waits up to 3 seconds for the screen */
    fun begin(context: ReactApplicationContext): Install {
        val power = context.getSystemService(Context.POWER_SERVICE) as PowerManager
        val light: Boolean
        synchronized(lock) {
            running++
            light = litAt == 0L && !power.isInteractive
            if (light) {
                litAt = SystemClock.elapsedRealtime()
                // The kiosk keeps the screen on while in front, but an app opened since may not
                keepLit = keepLitLock(power)
            }
        }
        if (light) {
            ScreenController.turnScreenOn(context)
            waitUntilLit(power)
            Log.i(TAG, "Install with the screen off: lit it, interactive=${power.isInteractive}")
        }
        return Install(context.applicationContext)
    }

    /**
     * Right before committing an update of this app. Installing over itself stops this process, and with
     * it every wake lock of the app: with the screen off the whole tablet then slept within a second, in
     * the middle of the install, and Android finished it only when something woke the CPU, most often
     * someone pressing the power button (logcat on an SM-X210: not one line from anyone for 4 minutes,
     * with 1.3 seconds of uptime in them). A lit screen keeps the tablet awake, and nothing else outlives
     * the stop. The note asks the new version to turn the screen off again.
     */
    fun beforeSelfUpdate(context: ReactApplicationContext) {
        val power = context.getSystemService(Context.POWER_SERVICE) as PowerManager
        val light: Boolean
        synchronized(lock) {
            light = !power.isInteractive
            if (light && litAt == 0L) litAt = SystemClock.elapsedRealtime()
        }
        if (light) {
            ScreenController.turnScreenOn(context)
            waitUntilLit(power)
            Log.i(TAG, "Self-update with the screen off: lit it, interactive=${power.isInteractive}")
        }
        val turnOffAfter = synchronized(lock) { litAt != 0L && touchedAt < litAt }
        if (turnOffAfter) {
            // commit, not apply: this process is about to stop
            prefs(context).edit().putLong(SELF_UPDATE_AT, System.currentTimeMillis()).commit()
        }
    }

    /** The new version is up after an update of itself: turns off the screen lit for it */
    fun afterSelfUpdate(context: Context) {
        val prefs = prefs(context)
        val at = prefs.getLong(SELF_UPDATE_AT, 0L)
        if (at == 0L) return
        prefs.edit().remove(SELF_UPDATE_AT).apply()
        val age = System.currentTimeMillis() - at
        if (age < 0 || age > NOTE_VALID_MS) return
        Log.i(TAG, "Updated with the screen lit for it: turning it off in ${AFTER_SELF_UPDATE_MS / 1000} s")
        synchronized(lock) {
            // As if this process had lit it: an install starting meanwhile turns it off at its end
            if (litAt == 0L) litAt = SystemClock.elapsedRealtime()
        }
        main.postDelayed({ settle(context.applicationContext) }, AFTER_SELF_UPDATE_MS)
    }

    private fun end(context: Context, selfUpdated: Boolean) {
        synchronized(lock) {
            if (running > 0) running--
            // The process is about to stop: the note, written before the commit, is for the new version
            if (selfUpdated) return
            if (running > 0 || litAt == 0L) return
        }
        main.postDelayed({ settle(context) }, OFF_DELAY_MS)
    }

    private fun settle(context: Context) {
        val lit: Long
        synchronized(lock) {
            // Another install began meanwhile: its end turns the screen off
            if (running > 0 || litAt == 0L) return
            lit = litAt
            litAt = 0L
            keepLit?.let { if (it.isHeld) it.release() }
            keepLit = null
        }
        // An update of this app that failed: the process is still here, and the note is for nobody
        prefs(context).edit().remove(SELF_UPDATE_AT).apply()
        if (touchedAt > lit) {
            Log.i(TAG, "Install over, someone used the tablet meanwhile: leaving the screen on")
            return
        }
        val power = context.getSystemService(Context.POWER_SERVICE) as PowerManager
        if (!power.isInteractive) return
        Log.i(TAG, "Install over: turning the screen off again")
        ScreenController.turnScreenOff(context)
    }

    @Suppress("DEPRECATION")
    private fun keepLitLock(power: PowerManager): PowerManager.WakeLock? =
        try {
            power.newWakeLock(PowerManager.SCREEN_BRIGHT_WAKE_LOCK, "FreeKiosk:Install").apply {
                setReferenceCounted(false)
                acquire(KEEP_LIT_MAX_MS)
            }
        } catch (e: Exception) {
            Log.w(TAG, "Could not hold the screen on: ${e.message}")
            null
        }

    private fun waitUntilLit(power: PowerManager) {
        val deadline = SystemClock.elapsedRealtime() + LIGHT_WAIT_MS
        while (!power.isInteractive && SystemClock.elapsedRealtime() < deadline) Thread.sleep(100)
    }

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}
