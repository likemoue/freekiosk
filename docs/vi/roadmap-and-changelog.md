

# Lộ trình và nhật ký thay đổi của FreeKiosk

**Điểm nổi bật của các bản phát hành gần đây và định hướng sản phẩm trung hạn**

<p>
  <a href="README.md">Trang chủ tài liệu</a> •
  <a href="features-and-modes.md">Tính năng</a> •
  <a href="development.md">Phát triển</a>
</p>

## Mục lục

- [Tổng quan](#tổng-quan)
- [Cấu hình](#cấu-hình)
- [Bắt đầu](#bắt-đầu)
- [Tính năng](#tính-năng)
- [Khắc phục sự cố](#khắc-phục-sự-cố)
- [Tài nguyên liên quan](#tài-nguyên-liên-quan)




> [!IMPORTANT]
> Các ưu tiên trong lộ trình có thể thay đổi; hãy xem issue và thảo luận để nắm thông tin lập kế hoạch mới nhất.

## Các bản phát hành ổn định mới nhất

### v1.2.17 (tháng 3/2026)



| Tính năng | Mô tả |
|---|---|
| **Chế độ trình phát đa phương tiện** | Tích hợp trình phát đa phương tiện gốc (native) |
| **Chế độ bảng điều khiển** | Cải thiện lưới ô và điều hướng |
| **Chế độ nhiều ứng dụng** | Activity khóa khi khởi động cho các ứng dụng ngoài |
| **Kiosk Watchdog** | Tăng cường độ tin cậy và tự phục hồi |
| **Duy trì kết nối MQTT** | Củng cố cách xử lý kết nối |



### v1.2.16 (tháng 3/2026)



| Tính năng | Mô tả |
|---|---|
| **Giữ màn hình luôn bật** | Tinh chỉnh hành vi và cài đặt |
| **Kết nối lại MQTT** | Sửa lỗi khi chạy nền và tăng độ ổn định |
| **Dự phòng Camera2** | Cải thiện độ tin cậy của camera |
| **Thông tin thiết bị** | Bổ sung dữ liệu API/MQTT phong phú hơn |



### v1.2.15 (tháng 2/2026)



| Tính năng | Mô tả |
|---|---|
| **Điều khiển độ sáng** | Công tắc để app quản lý độ sáng |
| **Kênh beta** | Cập nhật beta tùy chọn |
| **Mật khẩu MQTT** | Cải thiện trải nghiệm người dùng và sửa lỗi |
| **Phát hiện chuyển động** | Sửa lỗi độ tin cậy của camera key |



> [!NOTE]
> Để xem lịch sử phát hành đầy đủ và ghi chú chi tiết, hãy tham khảo các bản phát hành trên GitHub:
>
> - [Tất cả bản phát hành](https://github.com/rushb-fr/freekiosk/releases)

## Lộ trình sản phẩm

> [!NOTE]
> Không có `v1.3.x`. Phần việc về độ tin cậy và triển khai từng dự kiến dưới mục đó
> đã được đưa vào qua các bản beta `v1.2.20`, và việc bật Cloud đã nâng bản phát hành
> kế tiếp lên `2.0.0`. Các mục bên dưới mang tiếp những gì vẫn còn mở.

### v1.2.x - Vận hành xuất sắc (đã phát hành)



| Lĩnh vực trọng tâm | Trạng thái |
|---|---|
| **Độ tin cậy** | Độ ổn định của kiosk và khả năng phục hồi lỗi, được củng cố qua các bản beta 1.2.20 |
| **Triển khai** | Mở rộng công cụ điều khiển từ xa và cấp phát thiết bị |
| **Quy trình đa phương tiện** | Cải thiện tích hợp giữa trình phát đa phương tiện và bảng điều khiển |
| **Giám sát** | Chỉ số sức khỏe thiết bị, nay cũng được báo lên Cloud |
| **Cấu hình** | Đơn giản hóa giao diện thiết lập và quản lý |



### v2.0.0-beta.x - Cloud, đang trong beta mở



Đã phát hành và đang được dùng hằng ngày, cho phép tự đăng ký trong lúc được kiểm chứng trên các
đội thiết bị thực tế. App vẫn miễn phí, theo giấy phép MIT và dùng đầy đủ được mà không cần tài khoản Cloud nào.

| Lĩnh vực | Trạng thái |
|---|---|
| **Đăng ký thiết bị** | Mã token từ trang quản lý, hoặc zero-touch qua mã QR của trình hướng dẫn thiết lập (Device Owner) |
| **Telemetry** | Pin, mạng, màn hình, dung lượng lưu trữ, bộ nhớ, thời gian hoạt động và capabilities, mỗi 30 giây |
| **Cấu hình** | Đồng bộ hai chiều, đẩy theo từng thiết bị hoặc từng nhóm, áp dụng không cần khởi động lại |
| **Lệnh** | Tải lại, bảo vệ màn hình, TTS, âm thanh, toast, JS, mở ứng dụng, khởi động lại, ảnh chụp màn hình |
| **Cập nhật app** | Cài OTA có chữ ký, im lặng khi là Device Owner |

Chưa được kiểm chứng, và là lý do 2.0.0 vẫn là bản pre-release: luồng cập nhật OTA,
mã QR cấp phát thực tế và hành vi của chế độ khóa còn ít được thử trên
các phần cứng đa dạng.

### v2.0.0 - Cloud ra khỏi beta



| Lĩnh vực trọng tâm | Dự kiến |
|---|---|
| **Kiểm chứng** | Cập nhật OTA, cấp phát thiết bị bằng QR và chế độ khóa được chứng minh trên các đội thiết bị thực tế |
| **API** | REST API có tài liệu để hệ thống riêng của khách hàng có thể điều khiển đội thiết bị của họ |
| **Phân tích** | Thông tin chi tiết về mức sử dụng và giám sát hiệu năng |
| **Bảo mật** | Xác thực và kiểm soát truy cập nâng cao |

### Về sau - Tự lưu trữ (self-hosting)



Máy chủ quản lý dự định sẽ được **phát hành mã nguồn mở để có thể tự lưu trữ
(self-host)**. Một nền tảng kiosk mà người dùng không thể tự lưu trữ thì chỉ miễn phí một nửa, nên
đây là đích đến chứ không phải việc tính sau. Việc này đang được hoãn lại cho đến khi
máy chủ ổn định và đầy đủ tính năng, và **chưa đặt ngày**.



> [!NOTE]
> Các mục trong lộ trình thay đổi theo thời gian; hãy xem issue/thảo luận để biết thứ tự ưu tiên hiện tại:
> - [Issues](https://github.com/rushb-fr/freekiosk/issues)
> - [Discussions](https://github.com/rushb-fr/freekiosk/discussions)


## Tiến độ tính năng chi tiết

### Trạng thái hiện tại (v1.2.x)



| Tính năng | Trạng thái | Ghi chú |
|---|---|---|
| **Chế độ WebView** | Hoàn tất | Đầy đủ chức năng trình duyệt kiosk |
| **Chế độ ứng dụng ngoài** | Hoàn tất | Khóa vào bất kỳ ứng dụng Android nào |
| **Chế độ bảng điều khiển** | Hoàn tất | Lưới ô nhiều URL |
| **Chế độ trình phát đa phương tiện** | Hoàn tất | Tích hợp đa phương tiện gốc (native) |
| **Device Owner** | Hoàn tất | Khóa chặt toàn bộ thiết bị |
| **REST API** | Hoàn tất | Hơn 40 endpoint |
| **Tích hợp MQTT** | Hoàn tất | HA tự động phát hiện (auto-discovery) |
| **Cấp phát thiết bị qua ADB** | Hoàn tất | Triển khai headless (không cần giao diện) |
| **Phát hiện chuyển động** | Hoàn tất | Cảm biến dựa trên camera |
| **Bảo vệ bằng mã PIN** | Hoàn tất | Truy cập cài đặt an toàn |
| **Tự khởi chạy** | Hoàn tất | Khởi động cùng thiết bị |
| **Điều khiển từ xa** | Hoàn tất | D-pad và bàn phím |
| **Chụp ảnh màn hình** | Hoàn tất | API chụp màn hình |
| **Truy cập camera** | Hoàn tất | Chụp ảnh |
| **Điều khiển âm thanh** | Hoàn tất | Âm lượng và phát |
| **Điều khiển độ sáng** | Hoàn tất | Thủ công và tự động |
| **Giám sát Wi-Fi** | Hoàn tất | Trạng thái mạng |
| **Giám sát pin** | Hoàn tất | Trạng thái nguồn |
| **Thông tin dung lượng lưu trữ** | Hoàn tất | Mức sử dụng đĩa |
| **Thông tin bộ nhớ** | Hoàn tất | Mức sử dụng RAM |
| **Dịch vụ vị trí** | Hoàn tất | Tọa độ GPS |
| **Chuyển văn bản thành giọng nói** | Hoàn tất | TTS gốc (native) |
| **Thông báo toast** | Hoàn tất | Thông báo hệ thống |
| **Giả lập bàn phím** | Hoàn tất | Nhập liệu xuyên ứng dụng |
| **Tự động kết nối lại** | Hoàn tất | Khả năng chống chịu lỗi mạng |
| **Dịch vụ trợ năng** | Hoàn tất | Kiểm soát nâng cao |
| **Giao diện cài đặt** | Hoàn tất | Giao diện cấu hình |
| **Giám sát tình trạng** | Hoàn tất | Tình trạng hệ thống |
| **Công cụ gỡ lỗi** | Hoàn tất | Hỗ trợ khắc phục sự cố |



### Trạng thái tính năng



| Tính năng | Trạng thái | Mô tả |
|---|---|---|
| **Xoay vòng URL** | Đã phát hành | Luân phiên qua một danh sách URL |
| **Đa phương tiện nâng cao** | Đã phát hành | Trình phát đa phương tiện với danh sách phát và các điều khiển phát |
| **Tự động chỉnh độ sáng** | Đã phát hành | Điều chỉnh dựa trên cảm biến |
| **Quản lý ứng dụng** | Đã phát hành | Điều khiển ứng dụng ngoài, chế độ một ứng dụng và nhiều ứng dụng |
| **Cấu hình từ xa** | Đã phát hành (beta mở) | Đẩy từ FreeKiosk Cloud, theo từng thiết bị hoặc nhóm |
| **Đa ngôn ngữ** | Đã phát hành | Tiếng Anh, Pháp, Đức, Ý, Hà Lan, Tây Ban Nha và Bồ Đào Nha (Brazil); theo ngôn ngữ của thiết bị trừ khi chọn ngôn ngữ khác trong Cài đặt |
| **Lọc nội dung** | Dự kiến | Danh sách cho phép và danh sách chặn URL |
| **Phân tích nâng cao** | Dự kiến | Số liệu sử dụng vượt ra ngoài telemetry trực tiếp hiện có |
| **Thông báo nâng cao** | Dự kiến | Cảnh báo tùy chỉnh |
| **Giám sát mạng** | Dự kiến | Thống kê mạng nâng cao |
| **Bảo mật nâng cao** | Dự kiến | Kiểm soát truy cập |
| **Hỗ trợ chủ đề giao diện** | Dự kiến | Chủ đề giao diện tùy chỉnh |
| **Chỉ số hiệu năng** | Dự kiến | Hiệu năng thiết bị |
| **Sao lưu/Khôi phục** | Dự kiến | Đồng bộ cấu hình |
| **Tác vụ theo lịch** | Dự kiến | Tự động hóa theo thời gian |
| **Nhóm thiết bị** | Dự kiến | Quản lý đội thiết bị |
| **Console gỡ lỗi** | Dự kiến | Gỡ lỗi nâng cao |
| **Nhật ký thời gian thực** | Dự kiến | Truyền trực tiếp nhật ký |
| **Chế độ game** | Dự kiến | Tối ưu hóa cho game |
| **Phát video trực tuyến** | Dự kiến | Đa phương tiện nâng cao |
| **Báo cáo sử dụng** | Dự kiến | Bảng phân tích (dashboard) |
| **Hệ thống plugin** | Dự kiến | Kiến trúc có thể mở rộng |



### Tầm nhìn tương lai (v2.x)



| Tính năng | Trạng thái | Mô tả |
|---|---|---|
| **Quản lý Cloud** | Dự kiến | Điều khiển đội thiết bị trên nền web |
| **Tính năng doanh nghiệp** | Dự kiến | Công cụ triển khai cho doanh nghiệp |
| **Tích hợp nâng cao** | Dự kiến | Hỗ trợ nền tảng bên thứ ba |
| **Bản địa hóa** | Dự kiến | Quốc tế hóa đầy đủ |
| **Nền tảng phân tích** | Dự kiến | Thông tin chi tiết toàn diện |
| **Bảo mật doanh nghiệp** | Dự kiến | Xác thực nâng cao |
| **Tính năng AI** | Dự kiến | Tự động hóa thông minh |
| **Đa nền tảng** | Dự kiến | Nghiên cứu hỗ trợ iOS |
| **API cho nhà phát triển** | Dự kiến | Phát triển có thể mở rộng |
| **Trí tuệ kinh doanh (BI)** | Dự kiến | Phân tích mức sử dụng |
| **Trang quản lý web** | Dự kiến | Giao diện quản lý |
| **Công cụ tự động hóa** | Dự kiến | Tự động hóa dựa trên quy tắc |
| **Mẫu thiết bị** | Dự kiến | Mẫu cấu hình |
| **Chế độ bảo trì** | Dự kiến | Quản lý dịch vụ |
| **Tối ưu hóa hiệu năng** | Dự kiến | Cải tiến hệ thống |
| **Quy trình tùy chỉnh** | Dự kiến | Quy trình do người dùng định nghĩa |
| **API Gateway** | Dự kiến | Truy cập API hợp nhất |
| **Bộ công cụ giám sát** | Dự kiến | Giám sát toàn diện |
| **Gỡ lỗi nâng cao** | Dự kiến | Công cụ cho nhà phát triển |
| **Logic nghiệp vụ** | Dự kiến | Tính năng doanh nghiệp |
| **Triển khai toàn cầu** | Dự kiến | Hỗ trợ trên toàn thế giới |




## Tiến độ phát triển



| Chỉ số | Hiện tại | Mục tiêu | Trạng thái |
|---|---|---|---|
| **Endpoint API** | 40+ | 50+ | Đúng tiến độ |
| **Entity MQTT** | 42 | 50+ | Đúng tiến độ |
| **Nền tảng hỗ trợ** | Android 8+ | Android 7+ | Đang nghiên cứu |
| **Ngôn ngữ** | EN | EN, FR, DE, ES | Đang thực hiện |
| **Kiểu máy thiết bị** | 20+ | 50+ | Đúng tiến độ |
| **Độ bao phủ kiểm thử** | 70% | 85% | Dự kiến |
| **Tài liệu** | 95% | 100% | Hoàn tất |
| **Mức hoàn thiện tính năng** | 85% | 95% | Đúng tiến độ |




## Cách tác động đến lộ trình



| Phương thức | Cách tham gia | Tác động |
|---|---|---|
| **Báo cáo sự cố** | [GitHub Issues](https://github.com/rushb-fr/freekiosk/issues) | Sửa lỗi và cải tiến |
| **Tham gia thảo luận** | [GitHub Discussions](https://github.com/rushb-fr/freekiosk/discussions) | Ý tưởng tính năng và phản hồi |
| **Yêu cầu tính năng** | Tạo issue chi tiết kèm tình huống sử dụng | Được cân nhắc khi xếp thứ tự ưu tiên |
| **Thử nghiệm bản beta** | Tham gia kênh beta | Phản hồi và thử nghiệm sớm |
| **Chia sẻ tình huống sử dụng** | Ghi lại các kịch bản triển khai | Định hướng phát triển tính năng |
| **Đóng góp mã** | [Hướng dẫn phát triển](development.md) | Trực tiếp triển khai tính năng |
| **Cung cấp số liệu** | Chia sẻ dữ liệu hiệu năng và mức sử dụng | Cải thiện hiệu năng |




## Tài nguyên liên quan



| Tài nguyên | Liên kết | Mục đích |
|---|---|---|
| **GitHub Releases** | [Tất cả bản phát hành](https://github.com/rushb-fr/freekiosk/releases) | Tải phiên bản mới nhất |
| **Trình theo dõi issue** | [GitHub Issues](https://github.com/rushb-fr/freekiosk/issues) | Báo lỗi và yêu cầu tính năng |
| **Thảo luận** | [GitHub Discussions](https://github.com/rushb-fr/freekiosk/discussions) | Phản hồi từ cộng đồng |
| **Đóng góp** | [Hướng dẫn đóng góp](../../CONTRIBUTING.md) | Cách đóng góp mã |
| **Phát triển** | [Hướng dẫn phát triển](development.md) | Thiết lập và đóng góp |
| **Tài liệu** | [Trang chủ tài liệu](README.md) | Tài liệu đầy đủ |








