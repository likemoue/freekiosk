<div align="center">
  <h1>FreeKiosk</h1>
  <p><strong>Chế độ kiosk mã nguồn mở, miễn phí cho máy tính bảng Android</strong></p>
  <p>Bản Việt hóa, kèm website quản lý tự vận hành</p>

  <p>
    <a href="#-cài-đặt-trong-60-giây">Cài đặt</a> •
    <a href="cloud/README.md">Website quản lý</a> •
    <a href="docs/vi/README.md">Tài liệu</a> •
    <a href="README.en.md">English</a>
  </p>

  <p>
    <img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="Giấy phép: MIT">
    <img src="https://img.shields.io/badge/Android-8.0%2B-green.svg" alt="Android 8.0+">
    <img src="https://img.shields.io/badge/Device%20Owner-H%E1%BB%97%20tr%E1%BB%A3-brightgreen" alt="Hỗ trợ Device Owner">
    <img src="https://img.shields.io/badge/REST%20API-40%2B%20endpoint-orange" alt="REST API hơn 40 endpoint">
    <img src="https://img.shields.io/badge/MQTT-Home%20Assistant-41BDF5" alt="MQTT, Home Assistant">
  </p>
</div>

Đây là bản fork của [FreeKiosk](https://github.com/RushB-fr/freekiosk) do [Rushb](https://rushb.fr) phát triển, giấy phép MIT. So với bản gốc:

- **Tiếng Việt là ngôn ngữ mặc định**, trên toàn bộ giao diện ứng dụng, thông báo hệ thống và tài liệu. Vẫn đổi được sang ngôn ngữ khác trong Cài đặt.
- **Có website quản lý tự vận hành** ở thư mục [`cloud/`](cloud/README.md), thay cho dịch vụ FreeKiosk Cloud trả phí, cùng giao thức nên ứng dụng dùng được ngay.
- **Cập nhật ứng dụng** lấy từ các bản phát hành của repo này, không phải repo gốc.
- **An toàn hơn khi có proxy phía trước:** trang chặn của Cloudflare hoặc Nginx Proxy Manager không còn khiến máy tự xóa đăng ký.

<p align="center">
  <img src="docs/screenshots/any-web-page-full-screen.png" alt="FreeKiosk hiển thị trang web toàn màn hình trên máy tính bảng (trang minh họa)" width="49%">
  <img src="docs/screenshots/lock-it-down.png" alt="Cài đặt bảo mật của FreeKiosk với chế độ khóa đang bật (minh họa)" width="49%">
</p>

## ✨ Khả năng chính

| Lĩnh vực | Có gì | Tìm hiểu thêm |
|---|---|---|
| Chế độ kiosk | Trang web (WebView), ứng dụng ngoài, bảng điều khiển nhiều trang, trình phát video và ảnh | [Tính năng và chế độ](docs/vi/features-and-modes.md) |
| Điều khiển thiết bị | Lock task, hành vi khi khởi động, thanh trạng thái, mã PIN | [Hướng dẫn cài đặt](docs/vi/installation.md) |
| Tự động hóa | Hơn 40 endpoint REST, MQTT tự khám phá cho Home Assistant | [Tích hợp](docs/vi/INTEGRATIONS.md) |
| Cấp phát | Cấu hình bằng lệnh ADB và script | [Cấu hình ADB](docs/vi/adb-configuration.md) |
| Quản lý cả đội máy | Website tự vận hành: cấu hình từ xa, lệnh, nhóm, cảnh báo, đăng ký bằng QR | [Website quản lý](cloud/README.md) |
| Trình phát video/ảnh (beta) | Danh sách phát video, ảnh, trang web, YouTube, phát đồng bộ trên mọi màn hình, có lịch và phát ngoại tuyến; chạy cả trên Android TV, Google TV, Fire TV | [Trình phát video/ảnh](docs/vi/digital-signage.md), [Android TV](docs/vi/android-tv.md) |

## 📦 Cài đặt trong 60 giây

1. Build APK theo [hướng dẫn](cloud/docs/TRIEN-KHAI.md#6-build-ứng-dụng-android), hoặc tải về từ website quản lý của bạn.
2. Cài lên máy tính bảng Android 8.0 trở lên.
3. Đặt URL hoặc ứng dụng, và mã PIN.
4. Bật chế độ kiosk.

Khi triển khai thật, hãy dùng chế độ Device Owner:

```bash
adb shell dpm set-device-owner com.freekiosk/.DeviceAdminReceiver
```

👉 Hướng dẫn đầy đủ: [docs/vi/installation.md](docs/vi/installation.md)

## 🖥️ Website quản lý

Trang quản lý theo dõi và điều khiển mọi thiết bị từ một nơi: trạng thái trực tiếp, cấu hình đẩy xuống máy hoặc nhóm, lệnh từ xa, ảnh màn hình, phân phối APK, trình phát video/ảnh, cảnh báo qua email, webhook và ntfy, nhiều tài khoản với xác thực hai lớp.

Chạy bằng Docker Compose. Triển khai qua Nginx Proxy Manager và Cloudflare Tunnel: [cloud/docs/TRIEN-KHAI.md](cloud/docs/TRIEN-KHAI.md).

Ứng dụng vẫn chạy độc lập: mọi tính năng kiosk, REST API và MQTT hoạt động không cần website, và không dữ liệu nào rời khỏi máy cho tới khi bạn đăng ký.

## 🧩 Bản đồ tài liệu

| Tôi muốn... | Xem |
|---|---|
| Triển khai máy tính bảng đúng cách | [Hướng dẫn cài đặt](docs/vi/installation.md) |
| Hiểu các chế độ hiển thị và kiosk | [Tính năng và chế độ](docs/vi/features-and-modes.md) |
| Tích hợp Home Assistant | [Tổng quan tích hợp](docs/vi/INTEGRATIONS.md) |
| Dựng website quản lý | [Triển khai](cloud/docs/TRIEN-KHAI.md) |
| Dùng API trên thiết bị | [REST API](docs/vi/rest-api.md) |
| Cấu hình topic MQTT | [MQTT](docs/vi/MQTT.md) |
| Cấp phát bằng script | [Cấu hình ADB](docs/vi/adb-configuration.md) |
| Câu hỏi thường gặp | [FAQ](docs/vi/faq.md) |
| Đóng góp mã nguồn | [Hướng dẫn phát triển](docs/vi/development.md) |

Tài liệu tiếng Anh gốc vẫn ở [docs/](docs/README.md). Nhật ký thay đổi [CHANGELOG.md](CHANGELOG.md) giữ nguyên tiếng Anh.

## 🛠️ Công nghệ

- React Native và TypeScript
- Module native Kotlin (chính sách Android và điều khiển hệ thống)
- Android SDK 26 trở lên (Android 8 trở lên)
- Website quản lý: NestJS, Prisma, PostgreSQL, React, Vite

## 🔄 Cập nhật từ bản gốc

Repo có remote `upstream` trỏ về bản gốc. Tiếng Việt nằm ở các tệp riêng để việc gộp ít xung đột:

```bash
git fetch upstream && git merge upstream/main
```

Khi bản gốc thêm chuỗi mới, kiểm thử `LocalesParity` sẽ báo khóa còn thiếu trong `src/i18n/locales/vi.json`.

## 📄 Giấy phép

MIT. Xem [LICENSE](LICENSE). Giữ nguyên ghi nhận tác giả gốc khi phân phối lại.

<div align="center">
  <p>Dựa trên <a href="https://github.com/RushB-fr/freekiosk">FreeKiosk</a> của <a href="https://rushb.fr">Rushb</a></p>
</div>
