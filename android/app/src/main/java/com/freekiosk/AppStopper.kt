package com.freekiosk

import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.SharedPreferences
import android.util.Log

/**
 * Closes an app. Only system apps may force-stop another app, but Android kills an app the moment a
 * Device Owner hides it, so hiding one and showing it again stops it and leaves its data and
 * sign-ins as they were. An app left hidden would be gone from the tablet, so the package is written
 * down first, and every start of FreeKiosk finishes the job if the process died halfway.
 */
object AppStopper {
    private const val TAG = "AppStopper"
    private const val PREFS = "app_stopper"
    private const val KEY_HIDDEN = "hidden_package"
    private const val SHOW_ATTEMPTS = 3

    private fun prefs(context: Context): SharedPreferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun forget(context: Context) {
        prefs(context).edit().remove(KEY_HIDDEN).commit()
    }

    /** Whether the app was stopped. No for one hidden on purpose, like Safety Hub, or that Android refuses. */
    fun stop(context: Context, dpm: DevicePolicyManager, admin: ComponentName, packageName: String): Boolean {
        return try {
            if (dpm.isApplicationHidden(admin, packageName)) return false
            prefs(context).edit().putString(KEY_HIDDEN, packageName).commit()
            if (!dpm.setApplicationHidden(admin, packageName, true)) {
                forget(context)
                return false
            }
            show(context, dpm, admin, packageName)
        } catch (e: Exception) {
            Log.w(TAG, "Could not stop $packageName: ${e.message}")
            show(context, dpm, admin, packageName)
            false
        }
    }

    private fun show(context: Context, dpm: DevicePolicyManager, admin: ComponentName, packageName: String): Boolean {
        repeat(SHOW_ATTEMPTS) { attempt ->
            try {
                dpm.setApplicationHidden(admin, packageName, false)
                if (!dpm.isApplicationHidden(admin, packageName)) {
                    forget(context)
                    return true
                }
            } catch (e: Exception) {
                Log.e(TAG, "Could not show $packageName again: ${e.message}")
            }
            if (attempt < SHOW_ATTEMPTS - 1) Thread.sleep(200)
        }
        // Still written down, for the next start to try again
        Log.e(TAG, "$packageName is still hidden")
        return false
    }

    /** Shows again an app a process that died halfway left hidden. */
    fun recover(context: Context) {
        try {
            val packageName = prefs(context).getString(KEY_HIDDEN, null) ?: return
            val dpm = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
            if (!dpm.isDeviceOwnerApp(context.packageName)) {
                forget(context)
                return
            }
            show(context, dpm, ComponentName(context, DeviceAdminReceiver::class.java), packageName)
        } catch (e: Exception) {
            Log.e(TAG, "Could not recover a hidden app: ${e.message}")
        }
    }
}
