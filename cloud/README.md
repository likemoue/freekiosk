# FreeKiosk Manager

Website tự vận hành để quản lý các thiết bị chạy FreeKiosk, giao diện tiếng Việt. Ứng dụng trên tablet nói
chuyện với website này đúng như với FreeKiosk Cloud chính thức, nhưng dữ liệu nằm trên máy chủ của bạn.

Máy chủ FreeKiosk Cloud chính thức chưa công bố mã nguồn. Phần này được viết mới dựa trên giao thức trong mã nguồn
của ứng dụng (`src/utils/CloudSyncService.ts`, `CloudCommandService.ts`, `SignagePlaylist.ts`). Xem
[giao thức](docs/GIAO-THUC.md).

**Triển khai:** [docs/TRIEN-KHAI.md](docs/TRIEN-KHAI.md) (VM Ubuntu, Nginx Proxy Manager, Cloudflare Tunnel).

<p align="center">
  <img src="docs/screenshots/tong-quan.jpg" alt="Trang tổng quan: số thiết bị, trực tuyến, ngoại tuyến, pin trung bình (dữ liệu giả lập)" width="49%">
  <img src="docs/screenshots/chi-tiet-thiet-bi.jpg" alt="Trang chi tiết thiết bị: trạng thái trực tiếp và bảng gửi lệnh (dữ liệu giả lập)" width="49%">
</p>

Xem thử trên máy cá nhân, không cần Ubuntu hay Cloudflare. Lệnh tạo `.env` sẽ in ra mật khẩu đăng nhập:

```bash
sh deploy/init-env.sh http://localhost:8090 127.0.0.1 admin@example.com
```

```bash
docker compose up -d --build
```

Mở <http://localhost:8090>. Khi xong, xóa toàn bộ dữ liệu thử rồi xóa tệp `.env`:

```bash
docker compose down -v
```

## Tính năng

| Mục | Làm được gì |
|---|---|
| Tổng quan | Số thiết bị, trực tuyến, ngoại tuyến, pin trung bình, cảnh báo, hoạt động gần đây |
| Thiết bị | Tìm, lọc, sắp xếp, thao tác hàng loạt. Trang riêng từng máy: trạng thái trực tiếp, lệnh, cấu hình, bảng hiệu, ảnh màn hình, nhật ký |
| Thêm thiết bị | Mã 8 ký tự, QR cho ứng dụng, lệnh ADB, QR cấp phát Device Owner có thể kèm Wi-Fi |
| Nhóm | Gắn hồ sơ và danh sách phát theo nhóm, tải lại, bật tắt, đổi URL cả nhóm |
| Lệnh | Một máy, một nhóm hoặc tất cả. Bật tắt màn hình, tải lại, khởi động lại, chụp màn hình, thông báo, đọc văn bản, âm thanh, mở ứng dụng, Wi-Fi, JavaScript |
| Lịch hẹn giờ | Tự gửi lệnh theo ngày và giờ |
| Bảng hiệu số | Danh sách phát gồm video, ảnh, trang web, YouTube; thư viện tệp; lịch theo ngày giờ; theo dõi màn hình đã cập nhật chưa |
| Hồ sơ cấu hình | Lưu cấu hình, áp dụng cho máy hoặc nhóm, sửa là tự cập nhật |
| Ứng dụng (APK) | Tải lên, đọc gói và phiên bản, cài im lặng, chọn APK cấp phát |
| Nhật ký hoạt động | Lọc theo nhiều tiêu chí, xuất CSV đọc được bằng Excel |
| Ảnh màn hình | Thư viện theo từng máy, giữ 30 ngày |
| Cảnh báo | Ngoại tuyến, pin yếu, pin rất yếu, sắp hết bộ nhớ; gửi qua email, webhook có chữ ký, Slack, Discord, ntfy |
| Tài khoản | Ba vai trò, xác thực hai lớp TOTP, mã khôi phục, khóa sau 5 lần sai |

**Chưa có so với FreeKiosk Cloud:** đăng nhập Google và passkey, bản đồ thiết bị, khóa API cho tổ chức, nhiều tổ chức trên
một máy chủ (ở đây là một tổ chức nhiều người dùng), thanh toán (không cần). Giao diện web chỉ có tiếng Việt.

## Bảo mật

- Khóa API của từng thiết bị chỉ lưu dạng băm SHA-256.
- Mã PIN, mật khẩu MQTT, khóa REST, mật khẩu Wi-Fi trong lệnh, khóa webhook: mã hóa AES-256-GCM, không bao giờ trả lại trình duyệt.
- Mật khẩu người dùng băm bằng scrypt. Phiên đăng nhập bằng cookie `HttpOnly`, `SameSite=Lax`, chống CSRF bằng tiêu đề riêng.
- Lệnh `execute_js` và thêm Wi-Fi chỉ dành cho quản trị viên và không hẹn giờ được.

## Cấu trúc

```text
cloud/
├── apps/api      NestJS + Prisma + PostgreSQL
├── apps/web      React + Vite + Tailwind, giao diện
├── deploy/       Dockerfile, nginx, sao lưu, khôi phục
├── docs/         Triển khai, giao thức, openapi.json
└── compose.yaml
```

## Phát triển

Cần Node 24 và Docker.

```bash
npm install
docker run -d --name freekiosk-manager-test-db -e POSTGRES_USER=kiosk -e POSTGRES_PASSWORD=kiosk_test_only -e POSTGRES_DB=kiosk_test -p 127.0.0.1:5448:5432 postgres:17-alpine
cp .env.test.example .env.test
```

Tạo bảng cho cơ sở dữ liệu kiểm thử, rồi chạy kiểm thử API. Các bài này chạy với PostgreSQL thật và mô phỏng đúng
giao thức của ứng dụng:

```bash
cd apps/api && DATABASE_URL=postgresql://kiosk:kiosk_test_only@127.0.0.1:5448/kiosk_test npx prisma migrate deploy
```

```bash
npm test
```

Chạy thử ở máy cá nhân, API ở cổng 3000 và giao diện ở cổng 5173:

```bash
npm run dev
```

Sửa API thì xuất lại tài liệu OpenAPI ở [docs/openapi.json](docs/openapi.json):

```bash
npm run build --workspace @freekiosk-manager/api && npm run openapi
```

### Kiểm thử với mã thật của ứng dụng

`__tests__/CloudServerContract.live.test.ts` ở gốc repo chạy đúng `CloudSyncService`, `CloudCommandService` và
`SignagePlaylist` của ứng dụng với một máy chủ đang chạy, chỉ thay lớp native. Trong thư mục gốc của repo:

```bash
FREEKIOSK_LIVE_URL=http://localhost:8090 FREEKIOSK_LIVE_EMAIL=admin@example.com FREEKIOSK_LIVE_PASSWORD=... npx jest __tests__/CloudServerContract.live.test.ts
```
