package com.freekiosk

import android.Manifest
import android.annotation.SuppressLint
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.os.CancellationSignal
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import android.util.Log
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Where the tablet is, for the map of the management website. A tablet without GPS is placed by Android
 * from the Wi-Fi networks around it, to some tens of meters.
 *
 * Nothing here waits on a JS timer, which stops with the screen off: the heartbeat takes what is known at
 * once, and a fix older than it wants starts a new one, which the next heartbeat carries.
 *
 * The website asks for this, and only then does the tablet grant itself the permissions and turn location
 * on, as a Device Owner can.
 */
class DeviceLocationModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "DeviceLocation"

    companion object {
        private const val TAG = "DeviceLocation"
        /** Android itself gives up on a fix after about this long */
        private const val FIX_TIMEOUT_MS = 30_000L
        private val main = Handler(Looper.getMainLooper())
        private val waiting = mutableListOf<(Location?) -> Unit>()
        private var locating = false
        @Volatile private var lastFix: Location? = null
        /** Why the last attempt brought nothing, when it did not */
        @Volatile private var lastMiss: String? = null
    }

    /** At once: what is known. Starts a new fix when the known one is older than [maxAgeMs], or none is */
    @ReactMethod
    fun latest(maxAgeMs: Double, promise: Promise) {
        try {
            val blocked = blocker()
            if (blocked != null) {
                promise.resolve(stateOnly(blocked))
                return
            }
            val manager = manager()
            val known = bestKnown(manager)
            if (known == null || ageMs(known) > maxAgeMs) locate(manager) { }
            promise.resolve(known?.let { report(it) } ?: stateOnly(if (isLocating()) "locating" else lastMiss ?: "locating"))
        } catch (e: Exception) {
            promise.resolve(stateOnly("error", e.message))
        }
    }

    /** A new fix, waiting up to [timeoutMs]. Without one, what was known before, with its age */
    @ReactMethod
    fun locateNow(timeoutMs: Double, promise: Promise) {
        try {
            val blocked = blocker()
            if (blocked != null) {
                promise.resolve(stateOnly(blocked))
                return
            }
            val manager = manager()
            val settled = AtomicBoolean(false)
            val giveUp = Runnable { if (settled.compareAndSet(false, true)) promise.resolve(fallback(manager)) }
            main.postDelayed(giveUp, timeoutMs.toLong().coerceIn(5_000L, 120_000L))
            locate(manager) { fix ->
                if (settled.compareAndSet(false, true)) {
                    main.removeCallbacks(giveUp)
                    promise.resolve(fix?.let { report(it) } ?: fallback(manager))
                }
            }
        } catch (e: Exception) {
            promise.resolve(stateOnly("error", e.message))
        }
    }

    private fun manager() = reactApplicationContext.getSystemService(Context.LOCATION_SERVICE) as LocationManager

    /** Why the tablet cannot be placed, or null when it can. A Device Owner gives itself what it lacks */
    private fun blocker(): String? {
        val context = reactApplicationContext
        grantAsOwner(context)
        if (!hasPermission(context)) return "no_permission"
        val manager = manager()
        if (!isOn(context, manager)) {
            turnOnAsOwner(context)
            if (!isOn(context, manager)) return "disabled"
        }
        if (providerOf(manager) == null) return "no_provider"
        return null
    }

    private fun hasPermission(context: Context) =
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

    /** Background too: the heartbeat runs behind other apps and with the screen off */
    private fun grantAsOwner(context: Context) {
        val dpm = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
        if (!dpm.isDeviceOwnerApp(context.packageName)) return
        val admin = ComponentName(context, DeviceAdminReceiver::class.java)
        val wanted = mutableListOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
        // Declared only in the builds that are not for the Play Store or QR provisioning
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && declares(context, Manifest.permission.ACCESS_BACKGROUND_LOCATION)) {
            wanted.add(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
        }
        for (permission in wanted) {
            if (ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED) continue
            try {
                dpm.setPermissionGrantState(admin, context.packageName, permission, DevicePolicyManager.PERMISSION_GRANT_STATE_GRANTED)
                Log.i(TAG, "Granted $permission")
            } catch (e: Exception) {
                Log.w(TAG, "Could not grant $permission: ${e.message}")
            }
        }
    }

    private fun declares(context: Context, permission: String): Boolean =
        try {
            @Suppress("DEPRECATION")
            val info = context.packageManager.getPackageInfo(context.packageName, PackageManager.GET_PERMISSIONS)
            info.requestedPermissions?.contains(permission) == true
        } catch (_: Exception) {
            false
        }

    private fun isOn(context: Context, manager: LocationManager): Boolean {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) return manager.isLocationEnabled
        @Suppress("DEPRECATION")
        val mode = Settings.Secure.getInt(context.contentResolver, Settings.Secure.LOCATION_MODE, 0)
        return mode != 0
    }

    private fun turnOnAsOwner(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return
        val dpm = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
        if (!dpm.isDeviceOwnerApp(context.packageName)) return
        try {
            dpm.setLocationEnabled(ComponentName(context, DeviceAdminReceiver::class.java), true)
            Log.i(TAG, "Turned location on")
        } catch (e: Exception) {
            Log.w(TAG, "Could not turn location on: ${e.message}")
        }
    }

    /** Fused where there is one, which takes in Wi-Fi and GPS, then the network, then GPS alone */
    private fun providerOf(manager: LocationManager): String? {
        val enabled = try { manager.getProviders(true) } catch (_: Exception) { emptyList<String>() }
        val order = mutableListOf<String>()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) order.add(LocationManager.FUSED_PROVIDER)
        order.add(LocationManager.NETWORK_PROVIDER)
        order.add(LocationManager.GPS_PROVIDER)
        return order.firstOrNull { it in enabled }
    }

    /** The newest fix any provider, or any app, got; of two in the same minute, the more precise */
    @SuppressLint("MissingPermission")
    private fun bestKnown(manager: LocationManager): Location? {
        val found = mutableListOf<Location>()
        lastFix?.let { found.add(it) }
        val providers = try { manager.getProviders(true) } catch (_: Exception) { emptyList<String>() }
        for (provider in providers) {
            try {
                manager.getLastKnownLocation(provider)?.let { found.add(it) }
            } catch (_: Exception) { /* a provider that refuses: the others may know */ }
        }
        return found.minWithOrNull(
            compareBy<Location> { ageMs(it) / 60_000 }.thenBy { if (it.hasAccuracy()) it.accuracy else Float.MAX_VALUE },
        )
    }

    private fun ageMs(location: Location): Long {
        val nanos = location.elapsedRealtimeNanos
        val age = if (nanos > 0) (SystemClock.elapsedRealtimeNanos() - nanos) / 1_000_000 else System.currentTimeMillis() - location.time
        return age.coerceAtLeast(0)
    }

    private fun isLocating() = synchronized(waiting) { locating }

    @SuppressLint("MissingPermission")
    private fun locate(manager: LocationManager, done: (Location?) -> Unit) {
        synchronized(waiting) {
            waiting.add(done)
            if (locating) return
            locating = true
        }
        val provider = providerOf(manager)
        if (provider == null) {
            finish(null, "no_provider")
            return
        }
        val finished = AtomicBoolean(false)
        val complete: (Location?) -> Unit = { fix ->
            if (finished.compareAndSet(false, true)) finish(fix, if (fix == null) "no_fix" else null)
        }
        main.post {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    val cancel = CancellationSignal()
                    manager.getCurrentLocation(provider, cancel, ContextCompat.getMainExecutor(reactApplicationContext)) { complete(it) }
                    main.postDelayed({
                        if (!finished.get()) {
                            cancel.cancel()
                            complete(null)
                        }
                    }, FIX_TIMEOUT_MS + 5_000L)
                } else {
                    val listener = object : LocationListener {
                        override fun onLocationChanged(location: Location) {
                            manager.removeUpdates(this)
                            complete(location)
                        }
                        // Abstract before Android 11: left out, Android calling them would crash the app
                        @Deprecated("Deprecated in Java")
                        override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
                        override fun onProviderEnabled(provider: String) {}
                        override fun onProviderDisabled(provider: String) {}
                    }
                    @Suppress("DEPRECATION")
                    manager.requestSingleUpdate(provider, listener, Looper.getMainLooper())
                    main.postDelayed({
                        if (!finished.get()) {
                            manager.removeUpdates(listener)
                            complete(null)
                        }
                    }, FIX_TIMEOUT_MS)
                }
            } catch (e: Exception) {
                Log.w(TAG, "Could not ask for a fix: ${e.message}")
                complete(null)
            }
        }
    }

    private fun finish(fix: Location?, miss: String?) {
        if (fix != null) {
            lastFix = fix
            lastMiss = null
        } else {
            lastMiss = miss
        }
        val callbacks = synchronized(waiting) {
            locating = false
            waiting.toList().also { waiting.clear() }
        }
        if (fix != null) {
            Log.i(TAG, "Fix from ${fix.provider}, accuracy ${if (fix.hasAccuracy()) "${fix.accuracy.toInt()} m" else "unknown"}")
        } else {
            Log.i(TAG, "No fix: $miss")
        }
        callbacks.forEach { callback ->
            try { callback(fix) } catch (_: Exception) { /* one caller failing leaves the others their answer */ }
        }
    }

    private fun fallback(manager: LocationManager): WritableMap =
        bestKnown(manager)?.let { report(it) } ?: stateOnly(lastMiss ?: "no_fix")

    private fun report(location: Location): WritableMap = Arguments.createMap().apply {
        putString("state", "ok")
        putDouble("latitude", location.latitude)
        putDouble("longitude", location.longitude)
        if (location.hasAccuracy()) putDouble("accuracy_m", location.accuracy.toDouble())
        // The age rather than the time: the server dates it by its own clock
        putDouble("age_ms", ageMs(location).toDouble())
        putString("provider", location.provider ?: "")
    }

    private fun stateOnly(state: String, message: String? = null): WritableMap = Arguments.createMap().apply {
        putString("state", state)
        if (message != null) putString("message", message)
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
