# Đóng góp cho FreeKiosk

Cảm ơn đã cân nhắc đóng góp cho FreeKiosk! 🎉

## Cách đóng góp

### Báo lỗi

1. Kiểm tra xem lỗi đã có trong [Issues](https://github.com/rushb/freekiosk/issues) chưa
2. Nếu chưa, hãy tạo issue mới kèm theo:
   - **Mẫu thiết bị** (ví dụ: Samsung Galaxy Tab A8)
   - **Phiên bản Android** (ví dụ: Android 12)
   - **Phiên bản FreeKiosk** (ví dụ: v1.0.1)
   - **Các bước tái hiện**
   - **Hành vi mong đợi**
   - **Hành vi thực tế**
   - **Ảnh chụp màn hình** nếu có

### Đề xuất tính năng

1. Mở một issue yêu cầu tính năng
2. Mô tả tính năng và trường hợp sử dụng
3. Giải thích vì sao tính năng này mang lại lợi ích cho người dùng
4. Sẵn sàng thảo luận và tiếp nhận phản hồi

### Đóng góp mã nguồn

1. **Fork** repository
2. **Tạo nhánh**: `git checkout -b feature/amazing-feature`
3. **Thực hiện các thay đổi**
4. **Kiểm thử** trên thiết bị Android thật
5. **Commit**: `git commit -m '✨ Add amazing feature'`
6. **Push**: `git push origin feature/amazing-feature`
7. **Mở Pull Request**

## Thiết lập môi trường phát triển

Sao chép (clone) repository
git clone https://github.com/rushb-fr/freekiosk.git
cd freekiosk

Cài đặt các thư viện phụ thuộc
npm install

Khởi động Metro bundler
npm start

Chạy trên thiết bị Android
npm run android

text

## Phong cách viết mã

- Dùng **TypeScript** cho mọi mã mới
- Tuân theo các thực hành tốt nhất của **React Native**
- Thêm **chú thích** cho logic phức tạp
- Giữ các hàm **nhỏ và tập trung**
- Dùng **tên biến có ý nghĩa**

## Kiểm thử

- Kiểm thử trên **thiết bị Android thật** (không chỉ trình giả lập)
- Kiểm thử **chế độ Device Owner** nếu thay đổi có ảnh hưởng đến chế độ này
- Xác minh trên **nhiều phiên bản Android** nếu có thể
- Kiểm tra **rò rỉ bộ nhớ** hoặc các vấn đề về hiệu năng

## Thông điệp commit

Dùng [Conventional Commits](https://www.conventionalcommits.org/):

- `✨ feat: Add new feature`
- `🐛 fix: Fix bug`
- `📝 docs: Update documentation`
- `♻️ refactor: Refactor code`
- `🎨 style: Improve styling`
- `⚡ perf: Performance improvement`
- `✅ test: Add tests`

## Hướng dẫn Pull Request

- Giữ PR **tập trung** (mỗi PR chỉ một tính năng/bản sửa lỗi)
- Cập nhật **tài liệu** nếu cần
- Thêm **ảnh chụp màn hình** cho các thay đổi giao diện
- Dẫn chiếu **số issue** nếu có
- **Phản hồi kịp thời** các góp ý

## Có câu hỏi?

Mở một [Discussion](https://github.com/rushb-fr/freekiosk/discussions) hoặc gửi email tới support@freekiosk.app

---

**Cảm ơn đã giúp FreeKiosk ngày càng tốt hơn! 🚀**

*— Đội ngũ Rushb*