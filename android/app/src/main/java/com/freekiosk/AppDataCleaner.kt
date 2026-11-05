package com.freekiosk

import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.content.pm.PermissionInfo
import android.os.Build
import android.util.Log
import androidx.annotation.RequiresApi
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * Clears what an app has stored, as Settings > Apps > Clear data would: sign-ins, files and settings go,
 * the app stays installed and Android stops it. Takes a Device Owner and Android 9.
 *
 * Android also takes back the runtime permissions the app was given. A kiosk cannot get those back by
 * asking, since the system does not show its dialog in lock task, so each one the app held is granted
 * again here. What Android refuses to give back is reported, for the website to say so.
 */
object AppDataCleaner {
    private const val TAG = "AppDataCleaner"
    private const val ANSWER_SECONDS = 30L

    class Outcome(val state: State, val permissionsLost: List<String> = emptyList())

    enum class State { CLEARED, NOT_INSTALLED, FAILED }

    @RequiresApi(Build.VERSION_CODES.P)
    fun clear(context: Context, dpm: DevicePolicyManager, admin: ComponentName, packageName: String): Outcome {
        val held = try {
            grantedRuntimePermissions(context.packageManager, packageName)
        } catch (e: PackageManager.NameNotFoundException) {
            return Outcome(State.NOT_INSTALLED)
        }
        if (!clearData(dpm, admin, packageName)) return Outcome(State.FAILED)
        return Outcome(State.CLEARED, giveBack(context, dpm, admin, packageName, held))
    }

    @RequiresApi(Build.VERSION_CODES.P)
    private fun clearData(dpm: DevicePolicyManager, admin: ComponentName, packageName: String): Boolean {
        val answered = CountDownLatch(1)
        var cleared = false
        val executor = Executors.newSingleThreadExecutor()
        return try {
            dpm.clearApplicationUserData(admin, packageName, executor) { _, succeeded ->
                cleared = succeeded
                answered.countDown()
            }
            if (!answered.await(ANSWER_SECONDS, TimeUnit.SECONDS)) Log.w(TAG, "No answer about $packageName")
            cleared
        } catch (e: Exception) {
            // Android protects a few packages, and refuses them with an exception rather than an answer
            Log.w(TAG, "Could not clear $packageName: ${e.message}")
            false
        } finally {
            executor.shutdown()
        }
    }

    private fun grantedRuntimePermissions(pm: PackageManager, packageName: String): List<String> {
        val info: PackageInfo = pm.getPackageInfo(packageName, PackageManager.GET_PERMISSIONS)
        val names = info.requestedPermissions ?: return emptyList()
        val flags = info.requestedPermissionsFlags ?: return emptyList()
        return names.filterIndexed { index, name ->
            flags[index] and PackageInfo.REQUESTED_PERMISSION_GRANTED != 0 && isRuntimePermission(pm, name)
        }
    }

    private fun isRuntimePermission(pm: PackageManager, name: String): Boolean {
        return try {
            val info = pm.getPermissionInfo(name, 0)
            val base = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) info.protection else info.protectionLevel and PermissionInfo.PROTECTION_MASK_BASE
            base == PermissionInfo.PROTECTION_DANGEROUS
        } catch (e: PackageManager.NameNotFoundException) {
            false
        }
    }

    /** Back to what it held, then back in the user's hands, as it was. Returns what could not be given back */
    private fun giveBack(context: Context, dpm: DevicePolicyManager, admin: ComponentName, packageName: String, held: List<String>): List<String> {
        val pm = context.packageManager
        val lost = mutableListOf<String>()
        for (permission in held) {
            try {
                dpm.setPermissionGrantState(admin, packageName, permission, DevicePolicyManager.PERMISSION_GRANT_STATE_GRANTED)
                dpm.setPermissionGrantState(admin, packageName, permission, DevicePolicyManager.PERMISSION_GRANT_STATE_DEFAULT)
            } catch (e: Exception) {
                Log.w(TAG, "Could not give $permission back to $packageName: ${e.message}")
            }
            if (pm.checkPermission(permission, packageName) != PackageManager.PERMISSION_GRANTED) lost.add(permission)
        }
        return lost
    }
}
