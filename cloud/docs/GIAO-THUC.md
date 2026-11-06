# Giao thức giữa ứng dụng và máy chủ

Rút ra từ mã nguồn ứng dụng, vì máy chủ chính thức chưa công bố. Đường dẫn và tên trường là của ứng dụng, không đổi
được ở phía máy chủ. Đầy đủ các route, gồm cả API quản trị, ở [openapi.json](openapi.json).

Mọi lời gọi trừ đăng ký đều gửi `Authorization: Bearer <api_key>`. Ứng dụng gọi đường dẫn có dấu `/` ở cuối.

| Lời gọi | Dùng khi | Mã nguồn ứng dụng |
|---|---|---|
| `POST /api/v1/devices/enroll/` | Đăng ký bằng mã | `CloudSyncService.enroll` |
| `POST /api/v1/devices/{id}/heartbeat/` | 30 giây một lần | `CloudSyncService.sendHeartbeat` |
| `POST /api/v1/devices/{id}/unenroll/` | Tự hủy đăng ký | `CloudSyncService._tellCloudWeLeft` |
| `GET /api/v1/devices/{id}/commands/` | Khi `pending_commands > 0` | `CloudCommandService.pollCommands` |
| `GET /api/v1/devices/{id}/updates/` | Khi `pending_commands > 0` | `CloudCommandService.pollUpdates` |
| `GET /api/v1/devices/{id}/app-update/` | Nhấn **Kiểm tra cập nhật** trong ứng dụng | `AppUpdateCheck.findLatestUpdate` |
| `POST /api/v1/devices/{id}/apps/` | Khi tín hiệu trả `installed_apps_wanted` | `InstalledAppsReport.answer` |
| `POST /api/v1/devices/{id}/app-icons/` | Khi máy chủ còn thiếu icon | `InstalledAppsReport.answer` |
| `POST /api/v1/commands/{id}/result/` | Báo kết quả lệnh | `CloudCommandService.postResult` |
| `POST /api/v1/devices/{id}/screenshot/` | Lệnh chụp màn hình, multipart | `CloudCommandService.captureAndUploadScreenshot` |
| `GET /api/v1/devices/{id}/playlist/` | Khi `playlist_version` đổi | `SignagePlaylist.sync` |
| `GET /player/youtube/?v=<id>` | Trình phát nhúng video YouTube | `MediaPlayerComponent.loadYoutube` |
| `POST /api/v1/devices/{id}/apk-uploads/`, `PUT .../{upload}/part/?offset=`, `POST .../{upload}/finish/` | Lệnh `pull_apk` | `ApkExportModule.kt` |
| `POST /api/v1/devices/{id}/live/frame/?w=&h=&control=&problem=` | Khi đánh thức có `live` | `LiveScreen.kt` |

## Đăng ký

Gửi `{ token, device_info: { model, manufacturer, android_version, app_version, serial_number, capabilities, form_factor } }`.
Trả về `{ device_id, api_key, organization_name }`, hoặc `{ error }` với mã 4xx và ứng dụng hiện nguyên văn.

## Tín hiệu định kỳ

Ứng dụng gửi trạng thái (`battery`, `network`, `display`, `app`, `system`), toàn bộ cấu hình (`config`,
`config_version`, `config_updated_at`) và thông tin bí mật (`sensitive_config`, không bao giờ có PIN).
Từ 2.1.0-beta.16 `system` có thêm `android_build` (`Build.DISPLAY`, như `BP2A.250605.031.A3.X210XXSBEZBA`) và
`security_patch` (`YYYY-MM-DD`): bản Android của hãng, trang thiết bị ghi lại.

Máy chủ trả:

```json
{
  "status": "ok",
  "pending_commands": 0,
  "server_time": "2026-11-03T04:00:00.000Z",
  "sync_action": "none",
  "config": null,
  "sensitive_config": null,
  "config_version": 3,
  "force_unenroll": false,
  "playlist_version": null,
  "device_name": "samsung SM-X210",
  "installed_apps_wanted": false,
  "app_icons_wanted": [],
  "location_wanted": true
}
```

Không có khóa `battery` nghĩa là TV hoặc hộp không có pin. Ứng dụng chịu được tín hiệu không có trạng thái.

`device_name` do bản fork này đặt ra: là tên máy trên trang quản lý, ứng dụng hiện thay cho chữ FreeKiosk ở màn hình chính
(`DeviceDisplayName.ts`). Tên chỉ thuộc về một máy nên không nằm trong `config`: hồ sơ lấy từ máy này không đổi tên máy khác.
Máy chủ không gửi khóa này thì ứng dụng giữ nguyên.

## Ứng dụng trên máy

Cũng do bản fork này đặt ra, để trang quản lý chọn ứng dụng bằng tên và icon thay vì tên gói (`InstalledAppsReport.ts`).

- Tín hiệu định kỳ gửi `installed_apps_hash`. Mã này khác với mã máy chủ đang giữ thì câu trả lời có `installed_apps_wanted: true`.
- Ứng dụng gửi `POST apps` với `{ hash, apps: [{ package, label, version_code }] }`. Câu trả lời `{ icons_wanted: [...] }` là tối đa 8 gói còn thiếu icon.
- Ứng dụng gửi `POST app-icons` với `{ icons: [{ package, png_base64 }] }`, `png_base64` là `null` nếu không đọc được, và làm tiếp theo `icons_wanted` đến khi hết.
- Nếu đứt giữa chừng, tín hiệu kế tiếp trả `app_icons_wanted` để làm tiếp. Mỗi icon chỉ cần một máy gửi, và chỉ gửi lại khi có `version_code` mới hơn.

Trang quản lý đổi danh sách bằng kênh cấu hình như mọi thiết lập khác: `general.managedApps` được thay nguyên cả mảng, tính riêng cho từng máy. Ứng dụng máy chưa có được gửi qua `install_apk` trước, và chỉ vào danh sách sau khi máy báo cài thành công. Lịch sử lệnh ghi các thay đổi này với loại `home_apps`, nhưng thiết bị không nhận loại lệnh đó.

Danh sách của một máy (thường do hồ sơ đặt lúc đăng ký) có ứng dụng máy chưa cài, mà thư viện APK có tệp cài được, thì máy chủ tự gửi `install_apk` cho ứng dụng đó, một lần (`HomeAppsService.installMissing`, nguồn `home_missing`, lịch sử ghi người gửi là Tự động). Máy chủ xét lúc nhận `POST apps`, và ở tín hiệu định kỳ khi `installed_apps_hash` khớp danh sách đang giữ. Lưới màn hình chính ẩn ô của ứng dụng chưa cài và chỉ xét lại khi danh sách đổi, nên trong lúc cài ứng dụng được đặt `showOnHomeScreen: false` (dòng `home_apps` có `wait_install`), rồi hiện lại khi máy báo cài xong như trên. Lần cài lỗi không tự gửi lại, trừ lần bị FreeKiosk khởi động lại cắt ngang (lỗi `Device restarted before the command result could be reported`), được gửi lại tối đa ba lần và ghi `Cut short by a restart of FreeKiosk, sent again`. Máy chủ không tự cài trong 90 giây đầu sau khi máy đăng ký: công cụ USB gửi lại PIN ngay sau đó, và FreeKiosk nhận thiết lập qua ADB bằng cách tự khởi động lại tiến trình. Lệnh tự cài đã giao quá 10 phút mà không có kết quả cũng được coi là bị cắt ngang, vì máy chết giữa câu trả lời của máy chủ và lúc tự ghi lại lệnh thì không bao giờ báo. Hai tệp cùng `versionCode` của một gói thì chọn tệp đã cài thành công lên máy nhiều hơn, rồi tệp tải lên sau.

## Vị trí

Cũng do bản fork này đặt ra, cho trang **Bản đồ** (`DeviceLocation.ts`, `DeviceLocationModule.kt`).

- Câu trả lời tín hiệu có `location_wanted`, theo công tắc trên trang Bản đồ (bật nếu chưa ai tắt). Ứng dụng nhớ giá trị này qua các lần khởi động, và chỉ khi được hỏi mới lấy vị trí: Device Owner khi đó tự cấp quyền vị trí (cả chạy nền) và tự bật dịch vụ vị trí.
- Từ tín hiệu sau, ứng dụng gửi `location`: `{ state: "ok", latitude, longitude, accuracy_m, age_ms, provider }`, hoặc chỉ `{ state }` khi không có vị trí (`locating`, `no_fix`, `disabled`, `no_permission`, `no_provider`, `error`). Tín hiệu không bao giờ chờ định vị: vị trí cũ hơn 15 phút thì ứng dụng xin vị trí mới, tín hiệu kế tiếp mang theo.
- Máy chủ ghi thời điểm theo đồng hồ của nó, bằng `age_ms`, vì đồng hồ tablet có thể lệch. Vị trí cũ hơn vị trí đang giữ không thay nó. Máy chủ chỉ giữ vị trí cuối cùng, không giữ đường đi. Tắt công tắc thì máy chủ xóa mọi vị trí đã lưu và bỏ qua `location` gửi lên.
- Lệnh `locate` (khả năng `locate`) xin vị trí mới ngay, chờ tối đa 40 giây. Kết quả luôn là `success` với `{ location }`; máy chủ đổi thành lỗi kèm lý do bằng lời khi `state` khác `ok`.

## Lấy APK từ thiết bị

Lệnh `pull_apk` `{ package_name, label }`, chỉ gửi cho một thiết bị mỗi lần. Ứng dụng đọc APK của ứng dụng đã cài: một tệp `.apk`, hoặc khi có nhiều phần thì một zip `base.apk` và `split_*.apk`. Gửi lên theo phần như trang APK: `POST apk-uploads/` `{ command_id, file_name, size_bytes }` trả `{ upload_id, part_bytes }`, mỗi phần là `PUT .../part/?offset=` thân nhị phân, trả `{ received }`, rồi `POST .../finish/` trả `{ apk_id, file_name, version_name, package_name, already_in_library }`. Máy chủ chỉ nhận tệp cho lệnh `pull_apk` đang chờ của chính thiết bị đó, kiểm tra như tệp tải lên ở trang APK, và tệp giống hệt một tệp đã có thì không lưu thêm. Kết quả lệnh là câu trả lời của `finish`.

## Xóa ứng dụng

Lệnh `uninstall_app` `{ packages, labels }` gỡ ứng dụng không hỏi (cần Device Owner), không bao giờ gỡ FreeKiosk. Kết quả `{ removed, missing, failed }`, mỗi dòng `failed` là `gói: điều Android trả lời` (ứng dụng có sẵn theo máy trả `DELETE_FAILED_INTERNAL_ERROR`). Máy vẫn gỡ tiếp các ứng dụng khác khi một ứng dụng không gỡ được. Đến 2.1.0-beta.15 có `failed` thì ứng dụng báo `error`; máy chủ coi kết quả có danh sách `failed` là thành công kèm cảnh báo (trang Lệnh ghi Cảnh báo và tên ứng dụng không gỡ được), chỉ câu trả lời không có danh sách (không phải Device Owner, bản không gỡ được) mới là lỗi. Máy chủ bỏ các ứng dụng trong `removed` khỏi `general.managedApps` của máy đó (dòng lịch sử `home_apps`, nguồn `after_uninstall`), không đổi hồ sơ của nhóm.

## Cập nhật Android

Lệnh `system_update` không có tham số, khả năng `system_update` (máy Samsung hoặc Lenovo, Device Owner, dịch vụ trợ năng của FreeKiosk đang bật), sống 6 giờ. Ứng dụng (`SystemUpdater.kt`) không báo kết quả ngay: nó mở Cập nhật phần mềm của Samsung hoặc System update của Lenovo, tự bấm qua các bước, và gửi tiến độ bằng `POST /api/v1/commands/{id}/progress/` với `{ stage, percent, message }` (`message` là ghi chú tiếng Việt, như khi Lenovo cần tắt màn hình để cài), `stage` là `checking`, `downloading` hoặc `installing`. Máy chủ giữ tiến độ trong `result.progress` khi lệnh còn ở trạng thái đã gửi, và trả `{ status: "finished" }` khi lệnh đã xong. Kết quả gửi sau lần khởi động lại để cài, ở tín hiệu đầu tiên: `{ from, to, security_patch }` khi bản Android đã đổi, `{ up_to_date: true, build, security_patch }` khi máy đã ở bản mới nhất, hoặc `error` với lý do (`System update needs Wi-Fi`, `Battery too low for a system update`, `Download stopped`, `Restarted on the same build`, hay `Samsung: ` và lời của Samsung).

## Màn hình trực tiếp

Khi có người xem màn hình trên trang Ảnh màn hình, câu trả lời của `wait` có `live: true`. Ứng dụng (khả năng `remote_view`) gửi `POST live/frame/` với thân là ảnh JPEG, hoặc thân rỗng và `problem` (`screen_off`, `starting`, hoặc lỗi chụp), kèm kích thước màn hình `w`, `h` và `control=1` khi dịch vụ trợ năng có quyền thao tác. Câu trả lời `{ active, interval_ms, max_width, quality, inputs }`: `active: false` là không còn ai xem, thì dừng. `inputs` là thao tác cần làm, tọa độ theo tỉ lệ ảnh từ 0 đến 1: `{ type: "tap" | "long_press", x, y }`, `{ type: "swipe", x, y, x2, y2, ms }`, `{ type: "key", key: "back" | "home" | "recents" | "enter" | "backspace" }`, `{ type: "text", text }`. Lưới các màn hình nhận ảnh 5 giây một lần, rộng 480; một màn hình mở lớn nhận 1 giây một lần, rộng 1280. Máy chủ chỉ giữ ảnh cuối cùng trong bộ nhớ.

## Đồng bộ cấu hình

- Máy chủ giữ `configVersion` và phần chờ gửi `pendingConfig`. Sửa trên trang quản lý thì tăng phiên bản và gộp vào phần chờ.
- Khi `config_version` của thiết bị nhỏ hơn, máy chủ trả `sync_action: "apply"` kèm phần chờ. Ứng dụng áp dụng rồi lưu phiên bản mới.
- Ở lần báo cáo sau, phiên bản khớp nên máy chủ xóa phần chờ và coi cấu hình thiết bị gửi lên là mới nhất.
- **Chỉ gửi khóa đã đổi, không gửi toàn bộ:** `StorageService.importConfig` bỏ qua khóa không có, nên cài đặt vừa đổi trên máy không bị bản cũ ghi đè.

## Lệnh

`GET commands` trả `{ commands: [{ id, type, params, created_at, expires_at }] }` và chuyển lệnh sang trạng thái đã gửi, nên
mỗi lệnh chỉ giao một lần. `install_apk` đi riêng qua `GET updates`:
`[{ command_id, package_name, version_name, download_url }]`, tải bằng cùng khóa Bearer.
Tệp tải về là một APK, hoặc khi ứng dụng gồm nhiều tệp (App Bundle) là một zip chứa `base.apk` và các `split_*.apk`. Ứng dụng phân biệt bằng `AndroidManifest.xml` ở gốc tệp, và ghi mọi tệp vào cùng một phiên cài. Máy chủ chỉ gửi zip cho thiết bị khai báo khả năng `split_install`.

`GET app-update` do bản fork này đặt ra, nên máy chủ khác không có: nhận 404 thì ứng dụng hỏi GitHub. Lời gọi trả bản FreeKiosk có
`versionCode` cao nhất đã tải lên, `{ update: { version, version_code, notes, published_at, download_url } }`, hoặc `{ update: null }`.
Một phiên bản có cả hai bản dựng thì trả bản không có `cloudprovi` trong tên tệp. Ứng dụng tự so mã phiên bản và cài bằng cùng đường với `install_apk`.

Kết quả: `{ status: "success" | "error", result, error_message }`. Mã 4xx báo cho ứng dụng thôi gửi lại.

Các lệnh được hỗ trợ ở `COMMAND_MAP` trong `CloudCommandService.ts`, cộng `screenshot`, `add_wifi_network`, `stop_apps`, `set_screen_timeout`, `set_volume`, `clear_app_data`, `locate`, `uninstall_app`, `pull_apk`, `system_update` và `launch_app` (chạy được cả khi FreeKiosk chạy nền, không có màn hình kiosk). URL, độ sáng, âm lượng
không phải lệnh: chúng đi qua kênh cấu hình.

`clear_app_data` nhận `{ packages: ["..."], labels: ["..."] }`, `labels` chỉ để hiện trong lịch sử. Kết quả là `{ cleared, missing, failed, permissionsLost }`: `missing` là ứng dụng máy không có, không tính là lỗi; `permissionsLost` ghi `gói/quyền` Android không cho cấp lại. Có `failed` thì trạng thái là `error`, `result` vẫn kèm theo.

## Khả năng của thiết bị

Danh sách ở `src/utils/capabilities.ts`, gửi lúc đăng ký và mỗi tín hiệu. Thiết bị thiếu khả năng thì bị bỏ qua khi gửi lệnh cần
khả năng đó. Danh sách rỗng là ứng dụng cũ: coi như làm được mọi thứ.

## Nhận lệnh ngay

`GET /api/v1/devices/{id}/wait/` giữ kết nối tối đa 25 giây (`?hold=` để giữ ngắn hơn, dùng cho kiểm thử) và trả lời ngay khi có việc cho thiết bị:

```json
{ "wake": true, "commands": true, "config": false }
```

- `commands`: có lệnh hoặc APK đang chờ, ứng dụng gọi `commands/` và `updates/`.
- `config`: có cấu hình, danh sách phát hoặc tên mới, ứng dụng gửi một tín hiệu định kỳ ngay, câu trả lời của tín hiệu đó mang thay đổi. Áp dụng xong, ứng dụng gửi thêm một tín hiệu để máy chủ biết.
- `wake: false`: hết thời gian giữ, không có gì. Ứng dụng hỏi lại ngay.

Đây chỉ là lời báo: mọi thứ vẫn đi qua các đường cũ, nên mất lời báo chỉ khiến thiết bị nhận chậm hơn, tối đa tới tín hiệu định kỳ kế tiếp. Máy chủ không có đường này thì trả 404 và ứng dụng thử lại sau 10 phút. Ứng dụng giữ kết nối từ `CloudWake.kt` chứ không từ JS, vì React Native dừng bộ đếm giờ của JS khi có ứng dụng khác ở trên.

`GET /api/v1/time/` không cần đăng nhập, trả `{ "now": <mili giây> }`. Ứng dụng dùng nó để đo chênh lệch đồng hồ khi phát đồng bộ.

## Trình phát video/ảnh

`playlist_version` là mã băm nội dung, `null` khi không có gì để phát. Khi đổi, ứng dụng tải:

```json
{
  "version": "abc123",
  "playlist": { "id": "...", "name": "Sảnh" },
  "items": [{ "id": "...", "kind": "video", "url": "https://...", "title": "...", "duration_seconds": 12, "duration_ms": 7500, "video_id": "..." }],
  "sync_epoch_ms": 1793850000000,
  "schedule": {
    "default_playlist": "...",
    "playlists": { "<id>": { "name": "...", "items": [], "sync_epoch_ms": 1793850000000 } },
    "rules": [{ "playlist": "<id>", "days": [1, 2], "start": "18:00", "end": "22:00", "from": null, "to": null, "priority": 0 }]
  }
}
```

- `kind` là `video`, `image`, `web` hoặc `youtube`. Mục YouTube có `url` trỏ về `/player/youtube/?v=<video_id>` của chính máy chủ.
- `days` theo ISO, thứ Hai là 1. Luật xếp theo độ ưu tiên: **ứng dụng lấy luật đầu tiên khớp**, nên thứ tự do máy chủ quyết định.
- Ứng dụng báo lại phiên bản đang phát ở `system.signage_playlist_version`.
- `sync_epoch_ms` là lúc danh sách bắt đầu, `duration_ms` là độ dài của video trong thư viện, máy chủ đọc từ tệp. Mọi màn hình tự tính mình phải ở đâu từ hai số này và đồng hồ của máy chủ, nên phát cùng một khung hình mà không cần nói chuyện với nhau. Ứng dụng khai báo `signage_sync` trong khả năng của thiết bị.

Trang `/player/youtube/` chuyển sự kiện của trình phát YouTube lên trang cha bằng `postMessage`, dạng
`{ event: "onStateChange", info }` và `{ event: "onError", info }`. Trang này không được cấm nhúng khung.

Tệp thư viện có địa chỉ cố định `/media/<id>/<mã>/<tên>.<đuôi>`, không dùng tham số truy vấn. Bộ nhớ đệm ngoại tuyến đặt tên tệp theo URL
(chỉ bỏ tham số `X-Amz-*`) và đòi hỏi hỗ trợ `Range`, `If-Range`, `ETag`.

## Cấp phát bằng QR

Mã QR là JSON chuẩn của Android, `DeviceAdminReceiver` đọc phần extras:

```json
{
  "android.app.extra.PROVISIONING_DEVICE_ADMIN_COMPONENT_NAME": "com.freekiosk/.DeviceAdminReceiver",
  "android.app.extra.PROVISIONING_DEVICE_ADMIN_PACKAGE_DOWNLOAD_LOCATION": "https://.../dpc-apk-download/",
  "android.app.extra.PROVISIONING_DEVICE_ADMIN_PACKAGE_CHECKSUM": "<SHA-256 của APK, base64 URL-safe, không padding>",
  "android.app.extra.PROVISIONING_LEAVE_ALL_SYSTEM_APPS_ENABLED": true,
  "android.app.extra.PROVISIONING_SKIP_ENCRYPTION": true,
  "android.app.extra.PROVISIONING_ADMIN_EXTRAS_BUNDLE": { "enroll_token": "...", "cloud_url": "https://...", "org_id": "..." }
}
```

## Từ chối thiết bị

Ứng dụng coi 401 hoặc 403 kéo dài là "đã bị xóa", và sau ít nhất 5 lần trong 30 phút sẽ **xóa toàn bộ cài đặt và đăng ký**. Vì vậy
máy chủ chỉ trả các mã này khi khóa thật sự sai. Lỗi cơ sở dữ liệu trả 5xx. Bản ứng dụng này không tính trang HTML của proxy vào số lần đó.
