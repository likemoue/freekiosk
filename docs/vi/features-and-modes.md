# Tính năng và chế độ

**Tìm hiểu các chế độ hiển thị và khả năng của FreeKiosk**

[Trang chủ tài liệu](README.md) • [Cài đặt](installation.md) • [Tích hợp](INTEGRATIONS.md)


> [!TIP]
> Hãy chọn chế độ vận hành trước, rồi tiếp tục với [Cài đặt](installation.md) và [Tích hợp](INTEGRATIONS.md).

## Mục lục

- [Chế độ hiển thị](#chế-độ-hiển-thị)
- [Bảo mật và kiểm soát](#bảo-mật-và-kiểm-soát)
- [Cấp phát và vận hành](#cấp-phát-và-vận-hành)
- [Chọn chế độ phù hợp](#chọn-chế-độ-phù-hợp)


## Chế độ hiển thị

### Chế độ WebView

**Hiển thị bất kỳ trang web nào ở chế độ kiosk toàn màn hình.**

**Khả năng:**
- Mọi URL HTTPS/HTTP
- Hỗ trợ SSL (kể cả chứng chỉ tự ký)
- Trải nghiệm toàn màn hình nhập vai (immersive)
- Rất phù hợp với bảng điều khiển Home Assistant

**Phù hợp nhất cho:**
- Bảng điều khiển Home Assistant
- Màn hình thông tin
- Ứng dụng web
- Trình phát video/ảnh
- Bảng điều khiển doanh nghiệp

### Chế độ ứng dụng ngoài

**Khóa máy tính bảng vào một ứng dụng Android cụ thể.**

**Khả năng:**
- Khóa vào bất kỳ ứng dụng Android nào đã cài
- Tự động mở lại khi thoát/crash
- Chế độ thử nghiệm để triển khai an toàn
- Cử chỉ chạm 5 lần + PIN để vào cài đặt
- Với nhiều ứng dụng, chỉ vào được cài đặt từ màn hình kiosk: khi đang mở một ứng dụng, chạm màn hình, nút cố định và nút âm lượng đều không vào được. Thoát ứng dụng bằng nút Quay lại, hoặc dùng lệnh **Dừng mọi ứng dụng** trên website

**Phù hợp nhất cho:**
- Chơi game đám mây (Steam Link, Xbox Cloud Gaming)
- Ứng dụng trình phát video/ảnh
- Ứng dụng doanh nghiệp
- Trình phát đa phương tiện
- Ứng dụng Android tùy chỉnh

### Chế độ bảng điều khiển

**Lưới ô nhiều URL để chuyển nhanh giữa nhiều bảng điều khiển.**

**Khả năng:**
- Lưới ô có thể cấu hình
- Điều hướng giữa các URL chỉ với một lần chạm
- Tự động quay về bảng điều khiển sau khi không hoạt động
- Tên và URL tùy chỉnh cho từng ô

**Phù hợp nhất cho:**
- Môi trường nhiều bảng điều khiển
- Bộ sưu tập tài nguyên
- Cổng truy cập nhanh
- Trung tâm điều khiển
- Nhiều view của Home Assistant

### Chế độ đa phương tiện

**Phát lại đa phương tiện nâng cao và hỗ trợ nhiều ứng dụng.**

**Khả năng:**
- Tích hợp trình phát đa phương tiện gốc
- Chuyển đổi giữa nhiều ứng dụng
- Lập lịch nội dung theo thời gian
- Giám sát hiệu năng

**Phù hợp nhất cho:**
- Phát video
- Phát trực tuyến âm thanh
- Thư viện đa phương tiện
- Luân phiên nội dung theo lịch

> [!NOTE]
> Xem [Lộ trình và nhật ký thay đổi](roadmap-and-changelog.md) để biết thông tin phát hành chi tiết.


## Bảo mật và kiểm soát

### Các mức khóa chặt

| Mức | Mô tả | Trường hợp sử dụng |
|-------|-------------|----------|
| **Cơ bản** | Kiosk WebView với ít hạn chế | Thử nghiệm, dùng cá nhân |
| **Tiêu chuẩn** | Ứng dụng ngoài kèm chặn điều hướng | Triển khai một ứng dụng |
| **Doanh nghiệp** | Khóa chặt hoàn toàn bằng Device Owner | Triển khai thực tế, kiosk công cộng |

### Tính năng bảo mật

- **Chế độ Device Owner** - Kiểm soát thiết bị hoàn toàn
- **Chặn điều hướng** - Vô hiệu hóa Home, ứng dụng gần đây, cài đặt
- **Ngăn chặn lớp phủ** - Chặn hộp thoại hệ thống và thông báo
- **Dịch vụ Watchdog** - Tự động phục hồi và giám sát
- **Bảo vệ bằng PIN** - Bảo vệ quyền truy cập cài đặt
- **Điều khiển trên màn hình khóa** - Các nút điều khiển tùy chọn trên màn hình nhập PIN cho Wi-Fi, Bluetooth, đầu ra âm thanh, đèn pin, độ sáng, gọi khẩn cấp và khóa xoay thiết bị (nếu được hỗ trợ)
- **Ghim màn hình** - Chính sách lock task


## Cấp phát và vận hành

### Phương thức triển khai

| Phương thức | Công cụ | Quy mô | Hướng dẫn |
|--------|-------|-------|-------|
| **Thủ công** | Giao diện cảm ứng | Một thiết bị | [Cài đặt](installation.md) |
| **Script ADB** | Dòng lệnh | Lô nhỏ | [Cấu hình ADB](adb-configuration.md) |
| **Tích hợp MDM** | Công cụ doanh nghiệp | Đội thiết bị lớn | Sắp ra mắt |

### Tính năng vận hành

- **Cấp phát thiết bị qua ADB** - Triển khai bằng script, không cần giao diện (headless)
- **Sao lưu cấu hình** - Lưu/khôi phục toàn bộ cài đặt
- **Tự khởi chạy** - Tự động khởi động khi bật máy
- **Giữ chạy nền** - Giám sát và phục hồi liên tục
- **Điều khiển từ xa** - Tự động hóa qua REST API và MQTT
- **Triển khai hàng loạt** - Cấu hình nhiều thiết bị bằng script


## Chọn chế độ phù hợp

### Hướng dẫn chọn nhanh

| Trường hợp sử dụng | Chế độ khuyên dùng | Hướng dẫn thiết lập |
|----------|------------------|-------------|
| **Bảng điều khiển Home Assistant** | Chế độ WebView | [Cài đặt](installation.md) |
| **Kiosk chơi game đám mây** | Ứng dụng ngoài + Device Owner | [Cấu hình ADB](adb-configuration.md) |
| **Kiosk doanh nghiệp** | Ứng dụng ngoài + Device Owner | [Cài đặt](installation.md) |
| **Nhiều bảng điều khiển** | Chế độ bảng điều khiển | [Cài đặt](installation.md) |
| **Màn hình đa phương tiện** | Chế độ đa phương tiện | [Cài đặt](installation.md) |
| **Ứng dụng Android tùy chỉnh** | Chế độ ứng dụng ngoài | [Cấu hình ADB](adb-configuration.md) |

### Ví dụ cấu hình

**Bảng điều khiển Home Assistant:**
```bash
adb shell am start -n com.freekiosk/.MainActivity \
    --es url "https://homeassistant.local:8123" \
    --es pin "1234"
```

**Kiosk chơi game đám mây:**
```bash
adb shell am start -n com.freekiosk/.MainActivity \
    --es lock_package "com.valvesoftware.steamlink" \
    --es pin "1234" \
    --es test_mode "false"
```

**Màn hình thông tin doanh nghiệp:**
```bash
adb shell am start -n com.freekiosk/.MainActivity \
    --es url "https://dashboard.company.com" \
    --es pin "0000" \
    --es rest_api_enabled "true"
```


## Bước tiếp theo

- **Cài đặt:** [Hướng dẫn thiết lập đầy đủ](installation.md)
- **Tích hợp:** [REST API và MQTT](INTEGRATIONS.md)
- **Cấp phát thiết bị qua ADB:** [Triển khai headless](adb-configuration.md)
- **FAQ:** [Câu hỏi thường gặp](faq.md)
