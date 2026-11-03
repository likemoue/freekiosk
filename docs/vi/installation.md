# Hướng dẫn cài đặt

**Thiết lập đầy đủ, từ chế độ cơ bản đến khóa chặt hoàn toàn bằng Device Owner**

[Trang chủ tài liệu](README.md) • [Tính năng](features-and-modes.md) • [Cấu hình ADB](adb-configuration.md)


> [!TIP]
> Với triển khai thực tế hoặc máy tính bảng đặt ở nơi công cộng, hãy chuyển thẳng tới [Chế độ Device Owner](#chế-độ-device-owner-nâng-cao).

## Mục lục

- [Chế độ cơ bản (không cần PC)](#chế-độ-cơ-bản-không-cần-pc)
- [Chế độ Device Owner (nâng cao)](#chế-độ-device-owner-nâng-cao)
- [Khác biệt là gì?](#khác-biệt-là-gì)
- [Khắc phục sự cố](#khắc-phục-sự-cố)
- [Gỡ Device Owner](#gỡ-device-owner)
- [Gỡ cài đặt](#gỡ-cài-đặt)


## Chế độ cơ bản (không cần PC)

**Phù hợp cho:** Thử nghiệm, dùng cá nhân, hoặc khi không có sẵn PC.

### Yêu cầu

- Máy tính bảng Android (phiên bản 8.0+)
- Tệp APK từ [Releases](https://github.com/rushb-fr/freekiosk/releases)
- Mã PIN (4-6 chữ số)

### Các bước cài đặt

**1. Tải APK**
- Truy cập [GitHub Releases](https://github.com/rushb-fr/freekiosk/releases)
- Tải tệp `FreeKiosk-vX.X.X.apk` mới nhất
- Chuyển sang máy tính bảng (qua USB, email hoặc tải trực tiếp)

**2. Cài đặt**
- Mở tệp APK trên máy tính bảng
- Cho phép "Cài đặt từ nguồn không xác định" nếu được hỏi
- Hoàn tất cài đặt

**3. Cấu hình**
- Mở ứng dụng FreeKiosk
- Chạm **5 lần** vào nút bí mật (góc dưới bên phải)
- Nhập mã PIN
- Đặt URL hoặc ứng dụng đích
- Cấu hình thêm các cài đặt khác nếu cần

**4. Bắt đầu chế độ kiosk**
- Chạm "Bắt đầu chế độ kiosk"
- Máy tính bảng giờ đã được khóa ở chế độ kiosk cơ bản!

> [!WARNING]
> Chế độ cơ bản vẫn cho phép một số tương tác với hệ thống (thông báo, nút Quay lại). Để khóa chặt hoàn toàn, hãy dùng chế độ Device Owner bên dưới.


## Chế độ Device Owner (nâng cao)

**Phù hợp cho:** Triển khai thực tế, màn hình công cộng, kiosk doanh nghiệp, khóa chặt hoàn toàn.

### Yêu cầu

- Máy tính bảng Android (phiên bản 8.0+)
- Máy tính (Windows, Mac hoặc Linux)
- Cáp USB
- Công cụ ADB (Android Debug Bridge)

### Bước 1: Cài đặt ADB

#### Windows

1. Tải [SDK Platform Tools](https://dl.google.com/android/repository/platform-tools-latest-windows.zip) (~15 MB)
2. Giải nén vào `C:\platform-tools\`
3. Mở Command Prompt trong thư mục đó

#### Mac

**Cách A: Homebrew** (khuyến nghị)
```bash
brew install android-platform-tools
```

**Cách B: Thủ công**
1. Tải [SDK Platform Tools](https://dl.google.com/android/repository/platform-tools-latest-darwin.zip)
2. Giải nén và thêm vào PATH

#### Linux

**Ubuntu/Debian:**
```bash
sudo apt install adb
```

**Fedora:**
```bash
sudo dnf install android-tools
```
### Bước 2: Chuẩn bị máy tính bảng

#### 1. Xóa tất cả tài khoản

Device Owner yêu cầu **không có tài khoản người dùng nào đang hoạt động**. **Không** cần khôi phục cài đặt gốc.

**Xóa các tài khoản sau:**
- Tài khoản Google (Cài đặt → Tài khoản → Google → Xóa)
- Tài khoản Samsung (Cài đặt → Tài khoản → Samsung → Xóa)
- Tài khoản công việc/Microsoft 365
- Thẻ SIM (tháo ra hoặc tắt hồ sơ SIM)

**Kiểm tra:** Cài đặt → Tài khoản phải hiển thị "Không có tài khoản"

> [!IMPORTANT]
> Có thể đăng nhập lại **sau khi** đã kích hoạt Device Owner.

> [!NOTE]
> **Phương án dự phòng:** Nếu lệnh `dpm` thất bại sau khi đã xóa tài khoản, hãy khôi phục cài đặt gốc (Cài đặt → Hệ thống → Đặt lại → Khôi phục cài đặt gốc). **Không** thêm bất kỳ tài khoản nào trước khi kích hoạt Device Owner.

#### 2. Bật gỡ lỗi USB

1. **Bật chế độ nhà phát triển:** Cài đặt → Giới thiệu về máy tính bảng → Chạm vào "Số bản dựng" 7 lần
2. **Bật gỡ lỗi USB:** Cài đặt → Hệ thống → Tùy chọn nhà phát triển → Bật "Gỡ lỗi USB"

#### 3. Cài đặt FreeKiosk

1. Chuyển tệp APK sang máy tính bảng
2. Cài đặt APK
3. **KHÔNG mở ngay** - hãy chờ kích hoạt Device Owner xong
### Bước 3: Kích hoạt Device Owner

#### 1. Kết nối máy tính bảng với PC

- Kết nối máy tính bảng với PC bằng cáp USB
- Trên máy tính bảng, chọn "Luôn cho phép từ máy tính này"
- Chạm "Cho phép" trên cửa sổ bật lên gỡ lỗi USB

#### 2. Kiểm tra kết nối

**Windows:**
```bash
cd C:\platform-tools
adb devices
```

**Mac/Linux:**
```bash
adb devices
```

**Kết quả mong đợi:**
```
List of devices attached
ABC123XYZ    device
```

> [!NOTE]
> Nếu thấy "unauthorized", hãy kiểm tra màn hình máy tính bảng để xem cửa sổ xin cấp quyền.

#### 3. Đặt Device Owner

Chạy lệnh sau:

```bash
adb shell dpm set-device-owner com.freekiosk/.DeviceAdminReceiver
```

**Kết quả mong đợi:**
```
Success: Device owner set to package com.freekiosk
Active admin set to component {com.freekiosk/com.freekiosk.DeviceAdminReceiver}
```

> [!TIP]
> **Thành công!** Máy tính bảng đã ở chế độ Device Owner.

#### 4. Khởi động lại (tùy chọn)

```bash
adb reboot
```

### Bước 4: Cấu hình và khởi chạy

1. Mở FreeKiosk từ ngăn ứng dụng
2. Cấu hình URL/ứng dụng và mã PIN trong cài đặt
3. Chạm "Bắt đầu chế độ kiosk"
4. Khóa chặt hoàn toàn đã được kích hoạt!


## Khác biệt là gì?

| Tính năng | Chế độ cơ bản | Chế độ Device Owner |
|---------|:----------:|:-----------------:|
| **Khóa chặt kiosk** | Một phần | Hoàn toàn |
| **Thông báo hệ thống** | Hiển thị | Bị chặn |
| **Thanh trạng thái** | Có thể xuất hiện | Ẩn |
| **Nút điều hướng** | Dùng được | Bị vô hiệu hóa |
| **Nút Home** | Có thể hoạt động | Bị vô hiệu hóa |
| **Ứng dụng gần đây** | Dùng được | Bị vô hiệu hóa |
| **Cửa sổ bật lên của Samsung** | Có thể xuất hiện | Bị chặn |
| **Thoát không cần PIN** | Có thể | Không thể |
| **Tự khởi chạy khi khởi động máy** | Có | Có |
| **Khuyên dùng cho** | Thử nghiệm, cá nhân | Triển khai thực tế, nơi công cộng |


## Khắc phục sự cố

### "adb: command not found" (Windows)

**Nguyên nhân:** Không đang ở trong thư mục platform-tools

**Cách khắc phục:**
```bash
cd C:\platform-tools
adb devices
```

### "Not allowed to set the device owner"

**Nguyên nhân và cách khắc phục:**

| Nguyên nhân | Cách khắc phục |
|-------|----------|
| Còn tài khoản người dùng | Xóa TẤT CẢ tài khoản (Google, Samsung, Microsoft) |
| Tài khoản SIM ẩn | Tháo thẻ SIM hoặc tắt hồ sơ SIM |
| Tài khoản riêng của thiết bị | Khôi phục cài đặt gốc rồi thử lại (không thêm tài khoản nào) |

### "No devices/emulators found"

**Nguyên nhân và cách khắc phục:**

| Nguyên nhân | Cách khắc phục |
|-------|----------|
| Chưa kết nối USB | Kiểm tra kết nối cáp USB |
| Gỡ lỗi USB đang tắt | Bật trong Tùy chọn nhà phát triển |
| Lỗi driver (Windows) | Cài [driver USB](https://developer.android.com/studio/run/oem-usb) |
| Chưa chấp nhận cửa sổ bật lên | Kiểm tra máy tính bảng xem có cửa sổ "Cho phép gỡ lỗi USB" không |

### Máy tính bảng không được nhận diện (Windows)

Cài driver USB của nhà sản xuất:

- **Samsung:** [Samsung USB Driver](https://developer.samsung.com/android-usb-driver)
- **Hãng khác:** Tìm kiếm "[Tên hãng] USB driver for Windows"

### "Error: Not enough permissions" (Linux)

**Cách khắc phục nhanh:**
```bash
sudo adb kill-server
sudo adb start-server
adb devices
```

**Cách khắc phục lâu dài:**
```bash
sudo nano /etc/udev/rules.d/51-android.rules
```
Thêm: `SUBSYSTEM=="usb", ATTR{idVendor}=="[vendor_id]", MODE="0666", GROUP="plugdev"`
```bash
sudo udevadm control --reload-rules
```

### Đã đặt Device Owner nhưng kiosk không khóa hoàn toàn

1. Khởi động lại máy tính bảng
2. Thoát rồi khởi động lại chế độ kiosk
3. Kiểm tra Device Owner đang hoạt động


## Gỡ Device Owner

### Cách 1: Qua ứng dụng FreeKiosk

1. Chạm 5 lần vào nút bí mật (góc dưới bên phải)
2. Nhập mã PIN
3. Chạm nút "⚠️ Gỡ Device Owner"
4. Xác nhận thao tác
5. Device Owner đã được gỡ và cài đặt được đặt lại

> [!WARNING]
> "Thoát chế độ kiosk" chỉ đóng ứng dụng nhưng vẫn giữ Device Owner đang hoạt động. Hãy dùng "Gỡ Device Owner" để vô hiệu hóa hoàn toàn.

### Cách 2: Qua ADB

```bash
adb shell dpm remove-active-admin com.freekiosk/.DeviceAdminReceiver
```


## Gỡ cài đặt

### Nếu Device Owner đang hoạt động

1. Gỡ Device Owner (xem phần trên)
2. Gỡ cài đặt ứng dụng như bình thường

### Gỡ cài đặt thông thường

Cài đặt → Ứng dụng → FreeKiosk → Gỡ cài đặt


## FAQ nhanh

**Có cần root máy tính bảng không?**
Không! FreeKiosk dùng API Device Owner chính thức của Android.

**Có thể dùng FreeKiosk mà không có Device Owner không?**
Có! Chế độ cơ bản vẫn hoạt động, nhưng khóa chặt chưa hoàn toàn.

**Device Owner có làm mất bảo hành không?**
Không. Đây là tính năng chính thức của Android, không sửa đổi hệ thống.

**Có thể có nhiều ứng dụng Device Owner không?**
Không. Android chỉ cho phép MỘT Device Owner trên mỗi thiết bị.

**Sau khi gỡ Device Owner, có dùng máy tính bảng bình thường được không?**
Được! Chỉ cần gỡ Device Owner rồi gỡ cài đặt.

**Có chạy được trên máy tính bảng Fire (Amazon) không?**
Dự kiến chạy được, nhưng chưa được kiểm thử chính thức.


## Cần trợ giúp?

- **FAQ:** [FAQ đầy đủ](faq.md)
- **Cộng đồng:** [GitHub Discussions](https://github.com/rushb-fr/freekiosk/discussions)
- **Báo cáo lỗi:** [GitHub Issues](https://github.com/rushb-fr/freekiosk/issues)
- **Email:** support@freekiosk.app
