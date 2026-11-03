# Script triển khai FreeKiosk

| Script | Nền tảng | Mục đích |
| --- | --- | --- |
| [`deploy_mac.zsh`](../../scripts/deploy_mac.zsh) | macOS | Cài APK và đặt Device Owner trong một lần chạy có hướng dẫn |
| [`set-device-owner.ps1`](../../scripts/set-device-owner.ps1) | Windows | Chẩn đoán *vì sao* việc cấp phát Device Owner thất bại, rồi đặt Device Owner |
| [`install-boot-autostart.ps1`](../../scripts/install-boot-autostart.ps1) | Windows | Giúp FreeKiosk tự khởi chạy khi bật máy trên các ROM không phát `BOOT_COMPLETED` |
| [`device/`](../../scripts/device/) | — | Các tệp mà trình cài đặt sao chép vào `/system` trên thiết bị |

## `set-device-owner.ps1`

`adb shell dpm set-device-owner` báo mọi lỗi bằng cùng một `RuntimeException`
khó hiểu. Script này kiểm tra riêng từng điều kiện tiên quyết — đã cài
ứng dụng, chưa có owner nào, chỉ có một người dùng, không có tài khoản, và
tính năng hệ thống `android.software.device_admin` — rồi chỉ ra điều kiện
nào thực sự đang gây chặn.

```powershell
.\set-device-owner.ps1                      # diagnose + provision
.\set-device-owner.ps1 -Serial <serial>   # pick a device when several are attached
.\set-device-owner.ps1 -Remove              # remove Device Owner (testOnly builds only)
.\set-device-owner.ps1 -Fix                 # also patch a ROM that omits device_admin (reboots)
.\set-device-owner.ps1 -Yes                 # skip the confirmation prompt (unattended runs)
```

Script xác nhận trước khi cấp phát: với APK bản release, Device Owner chỉ có thể bị xóa bằng cách
khôi phục cài đặt gốc, nên đặt nhầm lên thiết bị đang cắm sẽ không thể hoàn tác.

`-Fix` dành cho các Android TV box giá rẻ (MXQ, X96, H96…) có ROM đã lược bỏ tính năng
`android.software.device_admin`, khiến `DevicePolicyManagerService` bị vô hiệu hóa
hoàn toàn. Tùy chọn này khai báo tính năng đó trong `/system/etc/permissions` rồi khởi động lại, và
cần bản dựng `userdebug`/`eng` có cấp `adb root`. Xem
[Cấu hình ADB → Khắc phục sự cố](adb-configuration.md#lỗi-cant-set-package--as-device-owner)
để biết cách làm thủ công tương đương và các lưu ý.

## `install-boot-autostart.ps1`

Dành cho các ROM mà FreeKiosk không bao giờ khởi chạy sau khi khởi động lại, kể cả khi đã có Device Owner và đã bật cả
"Khởi chạy khi khởi động máy" lẫn "Đặt FreeKiosk làm launcher mặc định". Nguyên nhân là hai
hành vi ROM độc lập (xem
[Cấu hình ADB → FreeKiosk không khởi động sau khi khởi động lại](adb-configuration.md#freekiosk-không-khởi-chạy-sau-khi-khởi-động-lại)):
`BOOT_COMPLETED` không bao giờ được gửi tới các receiver của bên thứ ba, và Home intent được
phân giải khi user 0 vẫn đang bị khóa, nên `MainActivity` bị loại ra.

```powershell
.\install-boot-autostart.ps1              # install, reboot, verify
.\install-boot-autostart.ps1 -NoReboot    # install only
.\install-boot-autostart.ps1 -Uninstall   # remove (reboot to take effect)
```

Cần ROM `userdebug`/`eng` có cấp `adb root`. Chạy `set-device-owner.ps1` trước.

## `deploy_mac.zsh`

### Điều kiện tiên quyết

- **adb (Android Debug Bridge)** - Tải từ [Android Platform Tools](https://developer.android.com/studio/releases/platform-tools)
hoặc cài bằng lệnh
```bash
brew install android-platform-tools
```
- Một **máy tính bảng Android đã khôi phục cài đặt gốc** với:
  - Đã bật Gỡ lỗi USB
  - Chưa thêm tài khoản Google hay tài khoản nào khác
  - Chưa đặt mật khẩu khóa màn hình

### Hướng dẫn thiết lập

#### 1. Chuẩn bị APK

Đặt tệp APK FreeKiosk vào thư mục [`scripts/`](../../scripts/). Tệp APK cần được đặt tên theo định dạng:
```
freekiosk-v*.apk
```

Ví dụ: `freekiosk-v1.0.0.apk`

#### 2. Cấp quyền thực thi cho script

Trước khi chạy script lần đầu, hãy cấp quyền thực thi cho script:

```bash
chmod +x deploy_mac.zsh
```

#### 3. Kết nối máy tính bảng

1. Bật **Tùy chọn nhà phát triển** trên máy tính bảng Android:
   - Vào Cài đặt > Giới thiệu về máy tính bảng
   - Chạm vào "Số bản dựng" 7 lần

2. Bật **Gỡ lỗi USB**:
   - Vào Cài đặt > Tùy chọn nhà phát triển
   - Bật "Gỡ lỗi USB"

3. Kết nối máy tính bảng với máy Mac bằng cáp USB

#### 4. Chạy script

```bash
./deploy_mac.zsh
```

Script sẽ hướng dẫn qua các bước sau:
- Kiểm tra adb đã được cài đặt chưa
- Tìm tệp APK của FreeKiosk
- Xác minh kết nối thiết bị
- Cài đặt APK
- Đặt FreeKiosk làm Device Owner
- Khởi động lại thiết bị (tùy chọn)

## Khắc phục sự cố

### "No devices found"
- Bảo đảm đã bật gỡ lỗi USB
- Kiểm tra kết nối cáp USB
- Xem trên máy tính bảng có cửa sổ bật lên yêu cầu cho phép gỡ lỗi USB hay không

### "Device is unauthorized"
- Kiểm tra màn hình máy tính bảng xem có cửa sổ bật lên xin cấp quyền gỡ lỗi USB không
- Chạm "Cho phép" rồi thử lại

### "Failed to set device owner"
Các nguyên nhân thường gặp:
- **Còn tài khoản**: Xóa mọi tài khoản Google và các tài khoản khác khỏi máy tính bảng
- **Khóa màn hình**: Gỡ mọi khóa PIN, hình vẽ (pattern) hoặc mật khẩu
- **Owner trước đó**: Khôi phục cài đặt gốc thiết bị để loại bỏ device owner hiện có
- **ROM không hỗ trợ device admin**: thường gặp trên Android TV box — kiểm tra bằng
  `adb shell pm list features | grep device_admin`, rồi xem
  [`set-device-owner.ps1 -Fix`](#set-device-ownerps1)

Chạy `set-device-owner.ps1` để biết nguyên nhân thực sự là cái nào trong số này.

### "adb not found"
- Cài Android Platform Tools
- Thêm thư mục platform-tools vào PATH
- Hoặc dùng đường dẫn đầy đủ tới adb

## Điều gì xảy ra sau khi thiết lập?

Khi script chạy xong thành công:
- FreeKiosk sẽ được đặt làm Device Owner
- Ứng dụng sẽ có các quyền đặc biệt để quản lý thiết bị
- Có thể cấu hình cài đặt kiosk ngay trong ứng dụng FreeKiosk
- Máy tính bảng sẽ bị khóa chặt theo cấu hình kiosk đã đặt

## Lưu ý quan trọng

⚠️ **Chế độ Device Owner chỉ có thể được đặt trên thiết bị không có tài khoản nào**. Nếu gặp sự cố, hãy khôi phục cài đặt gốc máy tính bảng rồi thử lại trước khi thêm bất kỳ tài khoản nào.

⚠️ **Gỡ Device Owner** yêu cầu khôi phục cài đặt gốc thiết bị.

## Hỗ trợ

Nếu gặp sự cố hoặc có câu hỏi, hãy tham khảo:

- [Trung tâm tài liệu](README.md)
- [Hướng dẫn cài đặt](installation.md)
