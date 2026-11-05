<div align="center">

# Tài liệu FreeKiosk

**Chế độ kiosk mã nguồn mở, miễn phí cho máy tính bảng Android**

_Hướng dẫn đầy đủ về triển khai, tự động hóa và tích hợp_

<p>
  <img src="https://img.shields.io/badge/Version-1.2.17-blue.svg" alt="Phiên bản 1.2.17">
  <a href="https://github.com/rushb-fr/freekiosk/releases"><img src="https://img.shields.io/github/downloads/rushb-fr/freekiosk/total.svg" alt="Lượt tải xuống"></a>
  <img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="Giấy phép: MIT">
  <img src="https://img.shields.io/badge/Android-8.0%2B-green.svg" alt="Android 8.0+">
</p>

</div>


> [!NOTE]
> Đây là bản dịch tiếng Việt. Website quản lý tự vận hành nằm ở [`cloud/`](../../cloud/README.md), xem [hướng dẫn triển khai](../../cloud/docs/TRIEN-KHAI.md).

## FreeKiosk là gì?

FreeKiosk là **nền tảng kiosk mã nguồn mở, miễn phí** dành cho máy tính bảng Android. FreeKiosk được thiết kế cho các nhóm và cá nhân cần **toàn quyền kiểm soát thiết bị mà không tốn phí bản quyền**.

**Phù hợp cho:**
- Bảng điều khiển Home Assistant
- Màn hình thông tin doanh nghiệp
- Kiosk chơi game đám mây (Steam Link, Xbox Cloud Gaming)
- Trình phát video/ảnh
- Máy tính bảng cho khách sạn/nhà hàng
- Bảng điều khiển công nghiệp

### Vì sao nên chọn FreeKiosk?

- **Miễn phí 100%** - Không tính phí theo thiết bị, không thuê bao, giấy phép MIT
- **Khóa chặt hoàn toàn** - Chế độ Device Owner cho mức bảo mật cấp doanh nghiệp
- **Nhiều chế độ** - WebView, Ứng dụng ngoài, Bảng điều khiển, Trình phát đa phương tiện
- **Tự động hóa phong phú** - 40+ endpoint REST API + MQTT với tính năng tự động phát hiện (auto-discovery) của Home Assistant
- **Triển khai hàng loạt** - Cấp phát thiết bị qua ADB, không cần giao diện (headless)
- **Ưu tiên quyền riêng tư** - Không theo dõi; Cloud là tùy chọn và tắt cho đến khi đăng ký thiết bị

### FreeKiosk so với Fully Kiosk Browser

Bản so sánh có dẫn nguồn (giá và tính năng được trích từ chính các trang của nhà cung cấp, kèm ngày tháng) có trên
trang web: [freekiosk.app/vs-fully-kiosk](https://freekiosk.app/vs-fully-kiosk/).


## Bắt đầu nhanh

### Cài đặt cơ bản (5 phút)

1. Tải APK mới nhất từ [**Releases**](https://github.com/rushb-fr/freekiosk/releases)
2. Cài lên máy tính bảng Android 8.0+
3. Cấu hình URL và mã PIN
4. Bắt đầu chế độ kiosk

### Triển khai thực tế (Device Owner)

Để khóa chặt hoàn toàn, không bị hệ thống làm gián đoạn:

```bash
adb shell dpm set-device-owner com.freekiosk/.DeviceAdminReceiver
```

> [!TIP]
> Xem [Hướng dẫn cài đặt](installation.md) đầy đủ để biết các bước thiết lập chi tiết.


## Danh mục tài liệu

### Bắt đầu

| Hướng dẫn | Mô tả | Liên kết |
|-------|-------------|------|
| **Cài đặt** | Hướng dẫn thiết lập đầy đủ, từ chế độ cơ bản đến chế độ Device Owner | [Đọc →](installation.md) |
| **Tính năng và chế độ** | Tìm hiểu các chế độ WebView, Ứng dụng ngoài, Bảng điều khiển | [Đọc →](features-and-modes.md) |
| **In im lặng** | In im lặng từ trang web tới máy in ESC/POS | [Đọc →](silent-printing.md) |
| **FAQ** | Câu hỏi thường gặp và cách khắc phục sự cố | [Đọc →](faq.md) |

### Tích hợp và tự động hóa

| Hướng dẫn | Mô tả | Liên kết |
|-------|-------------|------|
| **Tổng quan về tích hợp** | Chọn giữa REST API và MQTT | [Đọc →](INTEGRATIONS.md) |
| **REST API** | 40+ endpoint HTTP để điều khiển thiết bị | [Đọc →](rest-api.md) |
| **MQTT** | Telemetry thời gian thực và tính năng tự động phát hiện (discovery) của Home Assistant | [Đọc →](MQTT.md) |
| **Cấu hình ADB** | Cấp phát thiết bị headless và viết script | [Đọc →](adb-configuration.md) |
| **Android TV** | Android TV, Google TV và Fire TV: những gì hoạt động được, cách thiết lập, giới hạn | [Đọc →](android-tv.md) |
| **FreeKiosk Cloud** | Quản lý đội thiết bị tùy chọn (beta mở): chức năng, cách đăng ký, dữ liệu máy tính bảng gửi đi, giá | [Đọc →](cloud.md) |
| **Trình phát video/ảnh** | Danh sách phát được tạo trong FreeKiosk Cloud và phát trên màn hình | [Đọc →](digital-signage.md) |

### Chủ đề nâng cao

| Hướng dẫn | Mô tả | Liên kết |
|-------|-------------|------|
| **Phát triển** | Build và đóng góp cho FreeKiosk | [Đọc →](development.md) |
| **Lộ trình và nhật ký thay đổi** | Ghi chú phát hành và kế hoạch sắp tới | [Đọc →](roadmap-and-changelog.md) |
| **Đồng bộ Wiki** | Cách tài liệu được xuất bản | [Đọc →](pipeline-and-wiki-sync.md) |


## Các trường hợp sử dụng phổ biến

### Bảng điều khiển Home Assistant
```bash
# Configure via ADB
adb shell am start -n com.freekiosk/.MainActivity \
    --es url "https://homeassistant.local:8123" \
    --es pin "1234" \
    --es mqtt_enabled "true" \
    --es mqtt_broker_url "192.168.1.100"
```

### Kiosk chơi game đám mây
```bash
# Lock to Steam Link with auto-relaunch
adb shell am start -n com.freekiosk/.MainActivity \
    --es lock_package "com.valvesoftware.steamlink" \
    --es pin "1234" \
    --es test_mode "false" \
    --ez auto_start true
```

### Màn hình thông tin
```bash
# Simple URL kiosk with REST API
adb shell am start -n com.freekiosk/.MainActivity \
    --es url "https://dashboard.company.com" \
    --es pin "0000" \
    --es rest_api_enabled "true" \
    --es rest_api_port "8080"
```


## Tài nguyên

- **Trang web:** [freekiosk.app](https://freekiosk.app)
- **Bản phát hành:** [GitHub Releases](https://github.com/rushb-fr/freekiosk/releases)
- **Issues:** [Báo lỗi](https://github.com/rushb-fr/freekiosk/issues)
- **Discussions:** [Diễn đàn cộng đồng](https://github.com/rushb-fr/freekiosk/discussions)
- **Hỗ trợ:** support@freekiosk.app


## Đóng góp

FreeKiosk là mã nguồn mở và luôn chào đón đóng góp!

- **Mã nguồn:** [Hướng dẫn đóng góp](https://github.com/rushb-fr/freekiosk/blob/main/CONTRIBUTING.md)
- **Tài liệu:** Gửi PR để cải thiện các tài liệu này
- **Phản hồi:** Chia sẻ trường hợp sử dụng trong [Discussions](https://github.com/rushb-fr/freekiosk/discussions)


<div align="center">

**Được thực hiện với ❤️ bởi [Rushb](https://rushb.fr)**

</div>
