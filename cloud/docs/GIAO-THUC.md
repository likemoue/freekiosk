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
| `POST /api/v1/commands/{id}/result/` | Báo kết quả lệnh | `CloudCommandService.postResult` |
| `POST /api/v1/devices/{id}/screenshot/` | Lệnh chụp màn hình, multipart | `CloudCommandService.captureAndUploadScreenshot` |
| `GET /api/v1/devices/{id}/playlist/` | Khi `playlist_version` đổi | `SignagePlaylist.sync` |
| `GET /player/youtube/?v=<id>` | Trình phát nhúng video YouTube | `MediaPlayerComponent.loadYoutube` |

## Đăng ký

Gửi `{ token, device_info: { model, manufacturer, android_version, app_version, serial_number, capabilities, form_factor } }`.
Trả về `{ device_id, api_key, organization_name }`, hoặc `{ error }` với mã 4xx và ứng dụng hiện nguyên văn.

## Tín hiệu định kỳ

Ứng dụng gửi trạng thái (`battery`, `network`, `display`, `app`, `system`), toàn bộ cấu hình (`config`,
`config_version`, `config_updated_at`) và thông tin bí mật (`sensitive_config`, không bao giờ có PIN).

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
  "device_name": "samsung SM-X210"
}
```

Không có khóa `battery` nghĩa là TV hoặc hộp không có pin. Ứng dụng chịu được tín hiệu không có trạng thái.

`device_name` do bản fork này đặt ra: là tên máy trên trang quản lý, ứng dụng hiện thay cho chữ FreeKiosk ở màn hình chính
(`DeviceDisplayName.ts`). Tên chỉ thuộc về một máy nên không nằm trong `config`: hồ sơ lấy từ máy này không đổi tên máy khác.
Máy chủ không gửi khóa này thì ứng dụng giữ nguyên.

## Đồng bộ cấu hình

- Máy chủ giữ `configVersion` và phần chờ gửi `pendingConfig`. Sửa trên trang quản lý thì tăng phiên bản và gộp vào phần chờ.
- Khi `config_version` của thiết bị nhỏ hơn, máy chủ trả `sync_action: "apply"` kèm phần chờ. Ứng dụng áp dụng rồi lưu phiên bản mới.
- Ở lần báo cáo sau, phiên bản khớp nên máy chủ xóa phần chờ và coi cấu hình thiết bị gửi lên là mới nhất.
- **Chỉ gửi khóa đã đổi, không gửi toàn bộ:** `StorageService.importConfig` bỏ qua khóa không có, nên cài đặt vừa đổi trên máy không bị bản cũ ghi đè.

## Lệnh

`GET commands` trả `{ commands: [{ id, type, params, created_at, expires_at }] }` và chuyển lệnh sang trạng thái đã gửi, nên
mỗi lệnh chỉ giao một lần. `install_apk` đi riêng qua `GET updates`:
`[{ command_id, package_name, version_name, download_url }]`, tải bằng cùng khóa Bearer.

`GET app-update` do bản fork này đặt ra, nên máy chủ khác không có: nhận 404 thì ứng dụng hỏi GitHub. Lời gọi trả bản FreeKiosk có
`versionCode` cao nhất đã tải lên, `{ update: { version, version_code, notes, published_at, download_url } }`, hoặc `{ update: null }`.
Một phiên bản có cả hai bản dựng thì trả bản không có `cloudprovi` trong tên tệp. Ứng dụng tự so mã phiên bản và cài bằng cùng đường với `install_apk`.

Kết quả: `{ status: "success" | "error", result, error_message }`. Mã 4xx báo cho ứng dụng thôi gửi lại.

Các lệnh được hỗ trợ ở `COMMAND_MAP` trong `CloudCommandService.ts`, cộng `screenshot` và `add_wifi_network`. URL, độ sáng, âm lượng
không phải lệnh: chúng đi qua kênh cấu hình.

## Khả năng của thiết bị

Danh sách ở `src/utils/capabilities.ts`, gửi lúc đăng ký và mỗi tín hiệu. Thiết bị thiếu khả năng thì bị bỏ qua khi gửi lệnh cần
khả năng đó. Danh sách rỗng là ứng dụng cũ: coi như làm được mọi thứ.

## Bảng hiệu số

`playlist_version` là mã băm nội dung, `null` khi không có gì để phát. Khi đổi, ứng dụng tải:

```json
{
  "version": "abc123",
  "playlist": { "id": "...", "name": "Sảnh" },
  "items": [{ "id": "...", "kind": "video", "url": "https://...", "title": "...", "duration_seconds": 12, "video_id": "..." }],
  "schedule": {
    "default_playlist": "...",
    "playlists": { "<id>": { "name": "...", "items": [] } },
    "rules": [{ "playlist": "<id>", "days": [1, 2], "start": "18:00", "end": "22:00", "from": null, "to": null, "priority": 0 }]
  }
}
```

- `kind` là `video`, `image`, `web` hoặc `youtube`. Mục YouTube có `url` trỏ về `/player/youtube/?v=<video_id>` của chính máy chủ.
- `days` theo ISO, thứ Hai là 1. Luật xếp theo độ ưu tiên: **ứng dụng lấy luật đầu tiên khớp**, nên thứ tự do máy chủ quyết định.
- Ứng dụng báo lại phiên bản đang phát ở `system.signage_playlist_version`.

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
