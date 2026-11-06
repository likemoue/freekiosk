# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is FreeKiosk

FreeKiosk is a free, open-source Android kiosk platform built with React Native + TypeScript, with extensive Kotlin native modules for device control. It is designed as an open alternative to Fully Kiosk Browser.

Key capabilities: WebView kiosk, external app launcher, dashboard, media player, 40+ REST API endpoints, MQTT/Home Assistant integration, Device Owner mode, ADB provisioning.

## Commands

```bash
# Development
npm start                           # Start Metro bundler
npm run android                     # Run on connected device/emulator
npm run lint                        # ESLint
npm test                            # Jest unit tests
npm test -- --testPathPattern=foo   # Run a single test file

# Android build - three variants, selected by a -P flag
cd android && ./gradlew assembleRelease                 # APK for the GitHub release
cd android && ./gradlew assembleRelease -Pcloudprovi    # APK uploaded to the cloud
cd android && ./gradlew bundleRelease   -Pplaystore     # AAB for the Play Store
```

| Build | Goes where | Self-update | AccessibilityService |
|-------|-----------|-------------|----------------------|
| `assembleRelease` | GitHub release, website download | yes | yes |
| `assembleRelease -Pcloudprovi` | uploaded as the cloud's beta APK | yes | **stripped** |
| `bundleRelease -Pplaystore` | Play Store | **no** | **stripped** |

**A release needs two APK builds, not one.** The cloud serves its uploaded APK through two
routes - the public `dpc-apk-download` the Android setup wizard fetches during QR
provisioning, and the dashboard download a signed-in tester uses - so that one has to be the
`-Pcloudprovi` build. Play Protect blocks a sideloaded install outright when the app declares
an accessibility service ("App blocked to protect your device"), which kills QR provisioning
mid-wizard with no way past it. The GitHub APK keeps the service, so anyone provisioning over
ADB still gets it, and ADB is the only way to grant the `WRITE_SECURE_SETTINGS` it needs to
turn on anyway.

The two flags are mutually exclusive and the build fails if both are set. Each strips its
service with `tools:node="remove"` in `android/app/src/<flag>/AndroidManifest.xml`, which
removes the declaration rather than disabling it - Play Protect reads the manifest, so
`android:enabled="false"` would not help.

Output APK: `android/app/build/outputs/apk/release/app-release.apk`

Requirements: Node 20+, JDK 17+, Android SDK 26+.

## Architecture

### React Native ↔ Native Bridge Pattern

Every piece of device functionality lives in a Kotlin module (`android/app/src/main/java/com/freekiosk/`) paired with a TypeScript bridge in `src/utils/`. When adding device-level features, both sides must be updated together.

Key native modules:
- **KioskModule.kt** — lock task, screen on/off, power, home button override
- **AppLauncherModule.kt** — external app lifecycle management
- **BlockingOverlayModule.kt** — draws overlay views to block UI regions
- **HttpServerModule.kt** — embedded HTTP server for REST API
- **FreeKioskAccessibilityService.kt** — accessibility service for back-button/gesture suppression
- **BackgroundAppMonitorService.kt** / **KioskWatchdogService.kt** — foreground services keeping kiosk alive

### State & Storage

`src/utils/storage.ts` is the central persistent state layer (~2000+ lines). All settings, kiosk config, and feature flags are stored via AsyncStorage abstractions here. `src/utils/secureStorage.ts` handles credentials via Keychain. Virtually every component reads settings through these utilities.

### Display Modes

`src/screens/KioskScreen.tsx` is the primary runtime screen. It conditionally renders one of:
- **WebViewComponent** — wraps `react-native-webview` with auto-reload, keyboard avoidance, cookie injection, HTTP basic auth
- **ExternalAppOverlay** — launches and monitors an external Android app
- **MediaPlayerComponent** — video/image slideshow player
- **DashboardGrid** — tile-based launcher

Mode is determined by settings read from storage at startup.

### Settings UI

`src/screens/settings/SettingsScreenNew.tsx` hosts a tabbed settings interface. Each tab is a separate component under `src/screens/settings/tabs/` and `src/components/settings/`. The settings UI uses React Native Paper (Material Design).

### Navigation

Minimal stack: `src/navigation/AppNavigator.tsx` routes between KioskScreen, PinScreen, SettingsScreenNew, and BlockingOverlaysScreen.

### REST API & MQTT

`src/utils/ApiService.ts` handles inbound REST requests (routed through `HttpServerModule`). `src/utils/MqttModule.ts` manages MQTT for Home Assistant discovery. Documentation for all endpoints is in `docs/rest-api.md` and `docs/MQTT.md`.

### Types

Shared TypeScript types for complex features live in `src/types/` — important ones: `managedApps.ts`, `dashboard.ts`, `blockingOverlay.ts`, `screenScheduler.ts`, `planner.ts`.

### Vietnamese fork

This repository is a Vietnamese fork. `src/i18n/index.ts` starts in Vietnamese (`DEFAULT_LANGUAGE`), whatever the tablet's language, until someone picks another one in Settings. A new string goes in `en.json` and every other locale: `__tests__/LocalesParity.test.ts` fails otherwise. Code outside React translates with `tr()` from `src/i18n/tr.ts`. The native layer (Kotlin notifications, toasts, `res/values/strings.xml`, `assets/pdfjs/viewer.html`) and the HTML generated by `MediaPlayerComponent.tsx` have no translation system and are written in Vietnamese directly. Translated docs live in `docs/vi/`; `docs/` stays English so upstream merges stay clean.

`android/gradle.properties` is not committed and the build needs it: copy `android/gradle.properties.example`.

### Management website (`cloud/`)

`cloud/` is a self-hosted replacement for FreeKiosk Cloud, a project of its own (npm workspaces: `apps/api` NestJS + Prisma + PostgreSQL, `apps/web` React + Vite), excluded from the app's tsconfig, Jest and Metro. See `cloud/README.md`, `cloud/docs/TRIEN-KHAI.md` (deployment) and `cloud/docs/GIAO-THUC.md` (the device contract). The default server address is `DEFAULT_CLOUD_URL`, in both `src/config/features.ts` and `MainActivity.kt`.

The contract is defined by the app (`CloudSyncService.ts`, `CloudCommandService.ts`, `SignagePlaylist.ts`), so a change there may need one in `cloud/apps/api/src/device-api/`. `__tests__/CloudServerContract.live.test.ts` runs the app's real code against a running server (skipped unless `FREEKIOSK_LIVE_URL` is set).

Each heartbeat answer carries `device_name`, and the app shows that name where it would say "FreeKiosk" on its home screens (`src/utils/DeviceDisplayName.ts`). It is kept out of `exportConfig` and backups on purpose: a profile taken from one tablet must not rename the others.

**Lấy APK về website** (`pull_apk`, one tablet at a time) has the tablet send an installed app to the APK library (`ApkExportModule.kt`: the APK, or a stored zip of `base.apk` and `split_*.apk`, in 16 MB parts through `apk-uploads`), checked by `ApkLibraryService` as an upload from the APK page and kept once per file. **Xóa ứng dụng** (`uninstall_app`, `ManagedAppInstallerModule.uninstallPackages`, Device Owner) removes apps for good; `HomeAppsService.hideAfterUninstall` takes what went off that tablet's home screen, and the grid hides a tile whose app is gone anyway. An app Android keeps (one that came with the tablet answers `DELETE_FAILED_INTERNAL_ERROR`) does not stop the others, and `recordResult` makes a result with a `failed` list a success, which the history shows as Cảnh báo naming what stayed: up to 2.1.0-beta.15 the app calls it an error. **Mở ứng dụng** runs in `CloudCommandService` rather than through the kiosk screen, which a process started in the background does not have ("Handler unavailable").

**Ảnh màn hình > Trực tiếp** shows every screen live (`LiveService`, in memory: only the last picture of each tablet) and opens one with a hand on it. A page watching says so every few seconds (`POST /api/admin/live/watch`); a tablet not sending is woken with `live` on the wake channel, and `LiveScreen.kt` (native, started by `CloudWake`) posts a JPEG each round, every 5 seconds for the grid and every second for one screen, and applies the taps that come back with the answer, through the accessibility service (`dispatchGesture` needs `canPerformGestures`, which the service config lacked until 2.1.0-beta.15). Android lets that service take one picture a second, hence the pace. Only tablets reporting `remote_view` are woken: an older app would start its headless task for nothing every ten seconds.

The tablet reports its launchable apps (`src/utils/InstalledAppsReport.ts`: a hash in each heartbeat, the list and icons when the server asks), so **Lệnh > Ứng dụng > Ứng dụng trên màn hình** (`cloud/apps/web/src/components/home-apps.tsx`, `cloud/apps/api/src/devices/home-apps.service.ts`) picks apps by icon for a device, a group or all. The server sends each tablet its own `general.managedApps`, since a push replaces the whole array, and for a group it also updates the group's profile unless other groups or devices use it. An app a tablet lacks is installed first and joins the list only when the install reports success (`showAfterInstall`). A tablet whose list already names an app it lacks, from the profile it was enrolled with say, gets it from the library once (`installMissing`, when its app list arrives and at heartbeats once that list is current, source `home_missing`, shown as Tự động): the tile leaves the list for the install and comes back with `showAfterInstall`, since the grid looks at what is installed only when its list changes. Of two files of one version, `uploads()` takes the one tablets were given before (iclass.apk rather than iclass-staging.apk, both version code 1). In this mode the grid is always home, even with one app or none: nothing opens by itself except an app with `launchOnBoot`. These changes are not commands the tablet runs, but they show in the command history as type `home_apps`, created `SENT` and turned `SUCCESS` when a heartbeat confirms the config version. **Đổi URL hiển thị** and **Đổi độ sáng** work the same way (`CONFIG_COMMANDS` in `catalog.ts`, types `set_url` and `set_brightness`): `POST /api/admin/commands` takes them, but they are not in `COMMANDS`, so they cannot be scheduled. **Dừng mọi ứng dụng** (`stop_apps`, `KioskModule.stopRunningApps`) closes the apps the kiosk opens and whatever has been on screen lately. Only system apps may force-stop another app, so it hides each one and shows it again, which makes Android kill it and takes a Device Owner (`AppStopper.kt` writes the package down first, so an app is never left hidden by a process that died halfway). **Xóa dữ liệu ứng dụng** (`clear_app_data`, `KioskModule.clearAppData`, `AppDataCleaner.kt`) takes a Device Owner and Android 9, and gives back the runtime permissions the app held, which a kiosk could not ask for again in lock task. Like `stop_apps` it stays out of `COMMAND_MAP`, so the local REST API and MQTT cannot reach it. **Mở ứng dụng** and that one pick apps with `components/app-picker.tsx`, from the same list as the home screen editor. An APK that needs split parts (`requiredSplitTypes` in its manifest, see `apk-reader.ts`) is refused at upload, and flagged if already uploaded: Android answers `INSTALL_FAILED_MISSING_SPLIT` to it. A whole set (`.apks`, `.xapk`, `.apkm` or a `.zip` of APKs) is accepted instead: `apk-bundle.ts` checks it and stores a zip of `base.apk` and `split_*.apk`, which `ManagedAppInstallerModule.kt` tells from a plain APK and writes into one session, on tablets that declare `split_install`. `scripts/cai-tablet-usb/LayApk.ps1` pulls a full set from a device over adb.

What goes to a tablet through its settings leaves a line in the command history too: `ConfigSyncService.push` takes a `PushRecord` and writes the line in the transaction of the change, since a tablet can confirm within a second. Besides `home_apps`, `set_url` and `set_brightness` that means `apply_profile` (a profile saved or applied, also through a group) and `push_config` (a device's settings page, naming the settings and never their values). Playlists are the exception: their assignment and restart go only in the activity log, since a heartbeat does not confirm them. `cloud/apps/api/test/command-history.test.ts` compares the buttons on the Commands page with what the server knows.

Commands and settings reach a tablet at once: `CloudWake.kt` (a thread started with each heartbeat, in native code because React Native stops JS timers behind another app) holds `GET /api/v1/devices/{id}/wait/` open, `DeviceWakeService` answers it whenever something queues work for that tablet (`CommandsService`, `ConfigSyncService`, the signage controller, an APK deploy), and the headless `CloudHeartbeatTaskService` then runs `CloudSyncService.handleWake`. Anything new that queues work for a tablet should call `wake.notify`, or it waits for the next heartbeat. Only the word is lost if this fails, not the work. A script writing to the database from outside the API process wakes nobody: its command is picked up within 25 seconds, when the tablet asks again. JS timers do not fire with another app in front and the screen off, even during a headless task, so nothing on the way from a wake to a command running may wait on one (hence the `whatwg-fetch` patch). Measured on real tablets, from pressing on the website to the tablet reporting back: 0.7 to 1.6 seconds. `CloudSyncService.start()` runs again whenever the kiosk screen comes back, from Settings say, so what looks for commands a dead process left unfinished keeps its hands off those running now (`underWay` in `CloudCommandService`).

Playlists play in step without screens talking to each other (`src/utils/SignageTimeline.ts`, run inside the player page, and tested by compiling that text): where to be follows from `sync_epoch_ms` in the manifest (`Playlist.syncEpochAt`), the length of each item and `ServerClock.fineOffset()`, measured against `GET /api/v1/time/`. Lengths must be the same number on every screen, hence `duration_ms` read from the file by the server (`files/media-duration.ts`), and a fixed 10 seconds for an image with none rather than each tablet's own setting. Saving content, a first assignment and **Phát lại từ đầu** move the epoch a few seconds ahead; adding a screen does not, so the others are not sent back. A rule with hours starts its playlist from the moment it begins (`activeRuleStart`). A video takes time to begin, which differs by tablet and by what played before it, so each screen learns that for each item and tells it to play that much earlier the next time (`stepLeadMs`; a tablet logs `[MediaPlayer] Item N began X ms late`). Checked with three copies of the real page in a browser (one joining late with its clock 3 seconds off): a median of 2 to 23 ms apart. On a Lenovo and a Samsung side by side, read from photos of a running counter: 34 and 35 ms, one frame, and 201 ms early in a video before the learning and the stronger correction.

A tablet playing a list reports `general.displayMode` `media_player`, put there by the list and taken back when it goes (`SignagePlaylist._enterPlayerMode`). `profileDifferences` leaves that out and `ConfigSyncService.pushProfileTo` does not send a profile's mode to such a tablet, or applying a profile would stop the list.

**Ứng dụng (APK) > Phiên bản trên thiết bị** (`fleet-versions.ts`, `components/fleet-versions.tsx`) compares what tablets report against the library, only for apps in the library or on a home screen, since what comes with a tablet differs by model and means nothing. It goes by Android's version code: an app that does not raise it (iCLASS reports 1 everywhere) cannot be told apart. The device list's **Hồ sơ** column comes from `profile-state.ts`, which only looks at what the profile sets.

**Bản đồ** (`pages/DeviceMap.tsx`, Leaflet with OpenStreetMap tiles, which want a referrer the site's `no-referrer` policy would hold back, hence `referrerPolicy` on the tile layer) shows where each tablet last placed itself. The heartbeat answer carries `location_wanted` (a switch on that page, on unless switched off, which also forgets every place kept), and only then does the app look: `DeviceLocationModule.kt` grants the location permissions to itself as Device Owner, background included, and turns location on, then answers each heartbeat at once with what is known and asks Android for a new fix when it is older than 15 minutes, never waiting on a JS timer. An SM-X210 has no GPS: Android places it from the Wi-Fi around it, which takes Google's location accuracy being on. The server dates a fix from its age by its own clock and keeps the last place only (`device-api/location.ts`). The `locate` command asks for a fix now and always reports success with what it found: the server turns a missing place into an error in words. `ACCESS_BACKGROUND_LOCATION` is stripped from the Play Store and QR provisioning builds, which then place a tablet only while FreeKiosk is in front.

This fork publishes no GitHub releases. **Check for updates** on an enrolled tablet asks its server instead (`src/utils/AppUpdateCheck.ts`, `GET devices/{id}/app-update`) and installs through `ManagedAppInstaller`, the path a push from the website takes; only a tablet that is not enrolled reaches GitHub, and gets `NO_RELEASES`.

### Returning to Settings, and staying reachable

Settings checks the PIN only as it opens (`authState`), so it must not outlive the person who typed it: `SettingsSession.ts` ends it, back to the kiosk screen, on a command that changes what is on screen (`COMMANDS_ENDING_SETTINGS`, run from `CloudCommandService`, and `launchApp` in `ApiService`), on the screen turning off (`onScreenStateChanged`, through a microtask since JS timers stop with the screen off), and after five minutes untouched. Left open, the website opened iCLASS over it and then Bật màn hình showed it with no PIN. An excursion Settings makes itself, to an Android settings page, ends nothing.

With several apps, Settings is reached from the kiosk screen only (`ExternalAppOverlay`: taps anywhere or the fixed button, as chosen). Whoever is in an app stays in it, whatever they press: `OverlayService.escapeInApp` is false, so no corner button and no counting of touches, and `VolumeChangeReceiver` ignores the volume keys while another app is in front. An admin leaves the app with Back or **Dừng mọi ứng dụng**. Single-app mode keeps all of them, since it has no kiosk screen to go back to.

`OverlayService` shows its window (a corner button, or in `tap_anywhere` a 1x1 window that counts every touch on the screen; with several apps at most a 1x1 window that counts nothing, while the inactivity countdown runs) only for a start that says an app is opening, or a restart by Android: `overlayWanted`. It also runs the native inactivity countdown of External App mode, and `updateInactivityConfig` starts it for that alone when a countdown is due, with `UPDATE_INACTIVITY`, which must never bring a window: it used to, in `tap_anywhere` whatever had been chosen, so five quick taps anywhere led to PIN with a fixed button set (seen in logcat on an SM-X210 as `WindowManagerGlobal#addView` of a `View` of 1x1). FreeKiosk's own home screen reports touches with `noteUserActivity`.

A self-update stops the process, and with it every wake lock of the app. With the screen off the whole tablet then slept within a second, in the middle of the install: Android finished it, and sent `MY_PACKAGE_REPLACED`, only when something woke the CPU, most often the power button. In logcat on an SM-X210 that is no line from anyone for 4 minutes, with 1.3 seconds of uptime in them; it hit about half the tablets updated with the screen off, so test it with the cable out and more than once. Nothing the app holds outlives the stop, so `InstallScreen.beforeSelfUpdate` lights the screen before committing an update of itself. The fix is in the process being replaced: it protects the update after the one that brings it.

Any install the website sends lights a screen that was off, for its length (`InstallScreen.kt`, from `ManagedAppInstallerModule.installFromUrl`), and turns it off again five seconds after the last one of a batch. A screen that was on stays as it was, and so does one someone touched meanwhile (`MainActivity.onUserInteraction`). An update of FreeKiosk itself cannot do that from the process it stops: it leaves a note in SharedPreferences, and `BootReceiver.handlePackageReplaced` turns the screen off ten seconds after the new version is up. Lighting the screen goes through `ScreenController.turnScreenOn`, which brings the kiosk screen to the front, since nothing less wakes an SM-X210 after `lockNow()`.

A foreground service keeps the process, not the CPU, and a `Handler` delay counts only time the CPU is awake. `KioskWatchdogService` therefore holds `FreeKiosk:WatchdogCPU` for an enrolled device and beats as soon as it starts, for a process restarted with no kiosk screen, and `sendHeartbeat` settles what the previous process left open.

### Installing tablets

`scripts/cai-tablet-usb` is a C# Windows program (`build.ps1` compiles it with the `csc.exe` every Windows has, into `release-builds/CaiTablet-USB`, with `adb` and the `assembleRelease` APK): plug in a tablet with USB debugging on and it installs the app, sets Device Owner and enrolls it. It learns how things ended from logcat, so the `[CloudSync] Queued enrollment ...` lines in `CloudSyncService.ts`, the `[BackupService] Provisioning backup ...` lines in `BackupService.ts` and the `PIN saved` line in `KioskScreen.tsx` are its contract (`__tests__/CloudSyncServiceQueuedEnrollment.test.ts` and `BackupServiceProvisioning.test.ts` pin the first two groups). A backup file chosen in the tool is pushed to `provisioning-backup.json` in the app's external files folder after enrollment, because enrolling wipes settings; the app applies and deletes it on its next start. "Lấy từ website" signs in to the admin API (`WebsiteClient.cs`) to make an enrollment code with a group and profile: that path needs TLS 1.3, so Windows 11.

On a Lenovo the tool also turns off what the tablet adds over a full-screen app (`LenovoExtras` in `Installer.cs`, each switch checked against its Settings page on a TB330XU, ZUI 17): `show_ov_top_bar` (Settings.Secure), One Vision's Full screen window button, whose three dots have a menu item that leaves the kiosk; `three_finger_double_tap_enabled` and `three_finger_spread_enabled` (Settings.System), its split screen and floating window gestures; and `pen_set_show_button` (Settings.Secure), the pen at the edge of the screen. No value counts as on, and a write takes effect at once. `MainActivity` writes the two secure ones again at each kiosk start, with the `WRITE_SECURE_SETTINGS` the tool grants; an app may not write the other two. Smart Rotate stays on, since it only changes how an app is laid out.

QR provisioning does not work on a Samsung SM-X210 on Android 16: the tablet downloads the APK, then shows "Something went wrong" without ever starting the app (checked with an instrumented build). That matches Google's approved-DPC allowlist (support.google.com/work/android/answer/16694822), which this app is not on, so it is not expected to be fixable in code. USB is the way to install until Google approves the app.

The tool updates itself (`CapNhat.cs`): each start asks `GET /api/public/usb-tool` on the server in its settings (`CapNhat.Check`) and offers a newer version in `UpdateForm.cs`, before anything touches a tablet; put off, the offer stays as a button in the band. Taken, it downloads `/usb-tool-download` (`CapNhat.Apply`), checks the archive's SHA-256, then the RSA signature of `phien-ban.json` against the public key compiled into it, then each file against that list, and swaps the files in, all or nothing. A running program can be renamed but not replaced, so the old files stay as `*.cu` until the next start, and the new copy is started with `--sau-cap-nhat` and waits for the old one's mutex. The version is the build time, `yyyy.MM.dd.HHmm`, compared as text; `build.ps1` compiles its own `PhienBan` with it and the key, in place of `PhienBan.cs`, whose copy never updates. It signs with `scripts/cai-tablet-usb/khoa-ky-cap-nhat.xml` (git-ignored, made once with `-NewSigningKey`): a build signed with another key reaches no copy already out there. The archive, `release-builds/CaiTablet-USB-<version>.zip`, is uploaded on the website (Apps, tab Công cụ cài USB, `usb-tool.controller.ts`), which checks its list and refuses a version that is not newer. The website does not check the signature: the tool does.

### Dependency Patches

`patches/` contains patch-package patches applied via `postinstall`. Do not upgrade patched dependencies without verifying the patches still apply.

Current patches:
- **`react-native-webview+13.16.0.patch`** — auto-grant camera/mic permissions in kiosk mode (and, since #219, also request the matching Android runtime permission when it is missing: auto-granting only covers the web layer, and nothing else in the app asked for `CAMERA`/`RECORD_AUDIO` outside the permission wizard. The system suppresses that dialog in lock task, so it has to be granted before Lock Mode), SSL certificate handling for same-host redirects, a native `DownloadListener` hook routing PDFs to the bundled viewer, and a guard in `RNCWebViewManagerImpl.applyUserAgentString()` that catches the `IllegalArgumentException` Chromium throws for a custom User-Agent containing illegal header characters (it crashed the app on the Fabric mount thread) and falls back to the default UA.
- **`whatwg-fetch+3.6.20.patch`** — `fetch` answers directly instead of through `setTimeout(0)`. React Native fires JS timers from a Choreographer frame, and with another app in front and the screen off those frames stop, even during a headless task, so a command fetched from the website never ran until someone lit the screen (checked on an SM-X210; `__tests__/FetchWithoutTimers.test.ts` fails without it). `patch-package whatwg-fetch` could not make this file on the test machine (its temporary `npm install` fails), so it was written with `git diff --no-index`; applying it works as usual.
- **`@react-native-community+slider+5.1.1.patch`** — re-entrancy guard in `ReactSliderManager.onProgressChanged()` to stop a `StackOverflowError` when initializing a Slider on Android 8.x (#86).
- **`@react-native-cookies+cookies+6.2.1.patch`** — build/compat fix.
- **`react-native-vision-camera+4.7.3.patch`** — three fixes: (1) guard `CameraDevicesManager` against `getCameraIdList()` returning `null` on cameraless x86 / BlissOS devices, which otherwise throws an NPE during TurboModule init and crashes the app on launch (#187); (2) `runOnUiThreadAndWait()` now routes exceptions back to the suspended coroutine via `resumeWith(Result.failure(e))` instead of letting them escape as an uncaught exception on the UI Handler thread (which crashed the app); (3) `CameraViewModule.takePhoto()` calls `findCameraView()` inside `withPromise` so a `ViewNotFoundError` (CameraView unmounted mid-capture, e.g. motion detection) rejects the promise instead of crashing — the `backgroundCoroutineScope` has no exception handler. Together (2)+(3) fix the `ViewNotFoundError` crash from `findCameraView` reported on v1.2.19.
