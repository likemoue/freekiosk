package com.freekiosk

import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.location.LocationManager
import android.net.wifi.WifiInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.provider.Settings

/**
 * The Wi-Fi connection, as Android lets this app see it.
 *
 * WifiManager.connectionInfo is deprecated but it is the call that still gives the name. From
 * Android 12 the WifiInfo inside NetworkCapabilities always has its SSID hidden, unless it comes
 * from a network callback registered with FLAG_INCLUDE_LOCATION_INFO, so reading that one reported
 * every connected tablet as being on an unknown network.
 *
 * Either way Android hides the name unless the app has the location permission and location is on.
 */
object WifiConnection {

    @Suppress("DEPRECATION")
    fun info(context: Context): WifiInfo? {
        val wifiManager = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
        return wifiManager.connectionInfo
    }

    fun hasName(rawSsid: String?): Boolean {
        val ssid = rawSsid?.replace("\"", "")?.trim().orEmpty()
        return ssid.isNotEmpty() && ssid != "<unknown ssid>" && ssid != "0x"
    }

    /**
     * Turns location on when that is all that hides the network's name, which a kiosk nobody
     * operates would otherwise never get past. Device Owner only: anywhere else this is the user's
     * own setting. Returns whether it changed anything.
     */
    fun enableLocationIfOwner(context: Context): Boolean {
        return try {
            val dpm = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
            if (!dpm.isDeviceOwnerApp(context.packageName) || isLocationOn(context)) return false
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                dpm.setLocationEnabled(ComponentName(context, DeviceAdminReceiver::class.java), true)
            } else {
                @Suppress("DEPRECATION")
                Settings.Secure.putInt(context.contentResolver, Settings.Secure.LOCATION_MODE, Settings.Secure.LOCATION_MODE_HIGH_ACCURACY)
            }
            true
        } catch (e: Exception) {
            DebugLog.d("WifiConnection", "Could not turn location on: ${e.message}")
            false
        }
    }

    private fun isLocationOn(context: Context): Boolean {
        val locationManager = context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager ?: return false
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            locationManager.isLocationEnabled
        } else {
            @Suppress("DEPRECATION")
            locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER) || locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)
        }
    }
}
