package com.freekiosk

import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.SharedPreferences
import android.content.pm.PackageManager

/**
 * What Home opens on a tablet this app is Device Owner of. Android goes by the pinned activity, and
 * with none pinned by the holder of its Home role, which pinning an activity also moves. Removing a
 * pin leaves that role where it was: with FreeKiosk, so Home keeps opening the kiosk. Handing Home
 * to another launcher therefore takes pinning that launcher.
 */
object DefaultHome {
    private const val PREFS = "default_home"
    private const val KEY_LEFT_KIOSK = "left_kiosk"
    private const val KEY_HOME_WAS_KIOSK = "home_was_kiosk"

    private fun prefs(context: Context): SharedPreferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun homeIntent() = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)

    fun pin(context: Context, dpm: DevicePolicyManager, admin: ComponentName, home: ComponentName) {
        clearPins(context, dpm, admin)
        val filter = IntentFilter(Intent.ACTION_MAIN).apply {
            addCategory(Intent.CATEGORY_HOME)
            addCategory(Intent.CATEGORY_DEFAULT)
        }
        dpm.addPersistentPreferredActivity(admin, filter, home)
    }

    /** A pin goes by the package it points at: the kiosk's own, or the launcher it left for. */
    fun clearPins(context: Context, dpm: DevicePolicyManager, admin: ComponentName) {
        val packages = context.packageManager.queryIntentActivities(homeIntent(), 0).map { it.activityInfo.packageName }.toSet() + context.packageName
        packages.forEach { dpm.clearPackagePersistentPreferredActivities(admin, it) }
    }

    /** No pin left behind, and the role with this activity. */
    fun handBack(context: Context, dpm: DevicePolicyManager, admin: ComponentName, home: ComponentName) {
        pin(context, dpm, admin, home)
        clearPins(context, dpm, admin)
    }

    /** The admin leaves the kiosk: Home goes to the launcher until the kiosk comes back. */
    fun leaveKiosk(context: Context, dpm: DevicePolicyManager, admin: ComponentName, launcher: ComponentName) {
        val current = context.packageManager.resolveActivity(homeIntent(), PackageManager.MATCH_DEFAULT_ONLY)?.activityInfo?.packageName
        pin(context, dpm, admin, launcher)
        prefs(context).edit()
            .putBoolean(KEY_LEFT_KIOSK, true)
            .putBoolean(KEY_HOME_WAS_KIOSK, current == context.packageName)
            .commit()
    }

    fun hasLeftKiosk(context: Context): Boolean = prefs(context).getBoolean(KEY_LEFT_KIOSK, false)

    /**
     * The kiosk is running: Home is what its setting says. With the setting off, Home goes back to
     * where it was before the admin left, which a tablet enrolled with FreeKiosk pinned has as the kiosk.
     */
    fun applyKioskPolicy(context: Context, dpm: DevicePolicyManager, admin: ComponentName, pinned: Boolean) {
        val own = ComponentName(context, MainActivity::class.java)
        val homeWasKiosk = hasLeftKiosk(context) && prefs(context).getBoolean(KEY_HOME_WAS_KIOSK, false)
        when {
            pinned -> pin(context, dpm, admin, own)
            homeWasKiosk -> handBack(context, dpm, admin, own)
            else -> clearPins(context, dpm, admin)
        }
        prefs(context).edit().remove(KEY_LEFT_KIOSK).remove(KEY_HOME_WAS_KIOSK).commit()
    }

    /**
     * Leaving lasts until the tablet restarts. When nothing else opens FreeKiosk at boot, this is what
     * ends it. Says whether Home is the kiosk again, in which case it should open, as Home would have.
     */
    fun endLeaveOnRestart(context: Context): Boolean {
        if (!hasLeftKiosk(context)) return false
        val dpm = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
        val homeWasKiosk = prefs(context).getBoolean(KEY_HOME_WAS_KIOSK, false)
        if (!dpm.isDeviceOwnerApp(context.packageName)) {
            prefs(context).edit().remove(KEY_LEFT_KIOSK).remove(KEY_HOME_WAS_KIOSK).commit()
            return false
        }
        applyKioskPolicy(context, dpm, ComponentName(context, DeviceAdminReceiver::class.java), false)
        return homeWasKiosk
    }
}
