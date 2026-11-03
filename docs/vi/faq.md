# Câu hỏi thường gặp

**Các câu hỏi thường gặp và cách khắc phục sự cố của FreeKiosk**

[Trang chủ tài liệu](README.md) • [Cài đặt](installation.md) • [Tích hợp](INTEGRATIONS.md)

> [!TIP]
> Hãy bắt đầu từ [Hướng dẫn cài đặt](installation.md) cho lần triển khai đầu tiên, rồi dùng trang này cho các trường hợp đặc biệt.

## Cài đặt

**Hỏi: Có cần root máy tính bảng không?**
- **Đáp:** Không! FreeKiosk dùng API Device Owner chính thức của Android. **Không cần root**.

**Hỏi: Có cần Android Studio không?**
- **Đáp:** Không! Chỉ cần công cụ ADB (tải về 15 MB). Xem [Hướng dẫn cài đặt](installation.md).

**Hỏi: Có cài được từ Play Store không?**
- **Đáp:** Có! Tìm "FreeKiosk" trên Google Play Store, hoặc tải APK từ [Releases](https://github.com/rushb-fr/freekiosk/releases).

**Hỏi: Hỗ trợ những phiên bản Android nào?**
- **Đáp:** Android 8.0+ (API 26 trở lên).

## Device Owner

**Hỏi: Chế độ Device Owner là gì?**
- **Đáp:** Device Owner là tính năng doanh nghiệp chính thức của Android, giúp FreeKiosk kiểm soát hoàn toàn thiết bị để khóa chặt kiosk. Tính năng này giống MDM (quản lý thiết bị di động) nhưng được tích hợp sẵn trong Android.

**Hỏi: Device Owner có bắt buộc không?**
- **Đáp:** Không, nhưng **rất khuyến nghị** khi dùng trong triển khai thực tế. Nếu không có Device Owner, kiosk chỉ bị khóa một phần (người dùng có thể thoát bằng nút Quay lại, xem được thông báo, v.v.).

**Hỏi: Có thể kích hoạt Device Owner sau khi đã cài FreeKiosk không?**
- **Đáp:** Có! Chỉ cần xóa **tất cả tài khoản** khỏi thiết bị trước (Cài đặt → Tài khoản). Khi lệnh `dpm` chạy thành công, có thể đăng nhập lại các tài khoản. **Không** cần khôi phục cài đặt gốc — chỉ cần không còn tài khoản nào đang hoạt động.

**Hỏi: Có bắt buộc phải khôi phục cài đặt gốc không?**
- **Đáp:** Không! Yêu cầu thực sự của Android là **không có tài khoản người dùng** nào đang hoạt động trên thiết bị. Chỉ cần xóa mọi tài khoản (Google, Samsung, Microsoft, hồ sơ SIM), chạy lệnh `dpm`, rồi đăng nhập lại. Chỉ cần khôi phục cài đặt gốc như một phương án dự phòng khi việc xóa tài khoản vẫn chưa đủ (một số thiết bị còn giữ lại tài khoản ẩn).

**Hỏi: Có thể gỡ Device Owner không?**
- **Đáp:** Có! Trong cài đặt FreeKiosk, dùng nút "⚠️ Gỡ Device Owner" (KHÔNG phải "Thoát chế độ kiosk"). Hoặc qua ADB:
  ```bash
  adb shell dpm remove-active-admin com.freekiosk/.DeviceAdminReceiver
  ```

**Hỏi: Device Owner có làm mất bảo hành không?**
- **Đáp:** Không. Device Owner là tính năng chính thức của Android, không sửa đổi hệ thống.

## Sử dụng

**Hỏi: Làm sao để vào cài đặt khi đang ở chế độ kiosk?**
- **Đáp:** Chạm 5 lần vào nút bí mật (mặc định: góc dưới bên phải), rồi nhập mã PIN.

**Hỏi: Có dùng được URL tùy chỉnh không?**
- **Đáp:** Có! Mọi URL HTTPS/HTTP đều dùng được (Home Assistant, bảng điều khiển, trang web, ứng dụng web, v.v.).

**Hỏi: Có dùng được với Home Assistant không?**
- **Đáp:** Hoạt động hoàn hảo! Nhiều người dùng triển khai FreeKiosk cho bảng điều khiển Home Assistant.

**Hỏi: Có hiển thị được tệp HTML cục bộ không?**
- **Đáp:** Có. Nhập một URL `file://` ở chế độ Trang web, ví dụ
  `file:///storage/emulated/0/Android/data/com.freekiosk/files/dashboard/index.html`.
  Phải bật **Chung > Trình xem PDF > Trình xem PDF tích hợp** trước (màn hình cài đặt
  sẽ từ chối URL `file://` cho đến khi bật): chính cài đặt đó cấp cho
  WebView quyền truy cập tệp (`allowFileAccess`, `allowFileAccessFromFileURLs`,
  `allowUniversalAccessFromFileURLs` và nguồn gốc `file://`). Nếu không bật, trang sẽ lỗi
  với `net::ERR_ACCESS_DENIED`.

**Hỏi: Làm sao để đổi URL?**
- **Đáp:** Chạm 5 lần ở góc dưới bên phải → Nhập mã PIN → Cài đặt → Đổi URL.

**Hỏi: Tôi quên mã PIN. Phải làm sao?**
- **Đáp:** Nếu Device Owner đang hoạt động: cần khôi phục cài đặt gốc (hoặc dùng ADB để gỡ Device Owner trước). Đây là thiết kế có chủ đích để bảo mật.

**Hỏi: Có xoay vòng giữa nhiều URL được không?**
- **Đáp:** Chưa, nhưng đã có kế hoạch cho v1.1! Có thể dùng một URL duy nhất trỏ tới trang tự xoay vòng nội dung.

## Tương thích

**Hỏi: Hỗ trợ những máy tính bảng nào?**
- **Đáp:** Mọi máy tính bảng Android 8.0+. Đã thử nghiệm trên:
  | Hãng | Mẫu máy |
  |---|---|
  | **Samsung** | Galaxy Tab A8, A9+, S6 Lite |
  | **Lenovo** | Tab M10, M11 |
  | **Xiaomi** | Redmi Pad SE |
  | **Hãng khác** | Hầu hết máy tính bảng Android |

**Hỏi: Có chạy trên máy tính bảng Samsung không?**
- **Đáp:** Có! Chế độ Device Owner chặn riêng các cửa sổ bật lên cập nhật và ứng dụng cài sẵn (bloatware) của Samsung.

**Hỏi: Có chạy trên máy tính bảng Fire (Amazon) không?**
- **Đáp:** Dự kiến chạy được, nhưng chưa được kiểm thử chính thức. Cách thiết lập Device Owner có thể khác trên Fire OS.

**Hỏi: Có chạy trên điện thoại thông minh không?**
- **Đáp:** Về mặt kỹ thuật là có, nhưng FreeKiosk được tối ưu cho máy tính bảng. Màn hình điện thoại quá nhỏ để làm màn hình kiosk.

**Hỏi: Có chạy trên Chromebook không?**
- **Đáp:** Không. FreeKiosk chỉ dành cho Android.

## Khắc phục sự cố

**Hỏi: Chế độ kiosk không khóa hoàn toàn**
- **Đáp:** Hãy bảo đảm Device Owner đã được kích hoạt. Không có Device Owner thì chỉ khóa một phần. Xem [Hướng dẫn cài đặt](installation.md#chế-độ-device-owner-nâng-cao).

**Hỏi: Thông báo hệ thống vẫn xuất hiện**
- **Đáp:** Chế độ Device Owner chặn mọi thông báo. Nếu vẫn xuất hiện:
  1. Kiểm tra Device Owner đang hoạt động: `adb shell dpm list-owners`
  2. Khởi động lại máy tính bảng
  3. Khởi động lại chế độ kiosk

**Hỏi: Cửa sổ bật lên cập nhật của Samsung xuất hiện**
- **Đáp:** Chế độ Device Owner sẽ chặn các cửa sổ bật lên của Samsung. Nếu vẫn xuất hiện, hãy thử:
  1. Tạm ngưng các ứng dụng hệ thống của Samsung trong cài đặt FreeKiosk (sẽ có trong v1.1)
  2. Kiểm tra Device Owner: `adb shell dpm list-owners`

**Hỏi: WebView không tải được URL của tôi**
- **Nguyên nhân:**
  - URL không phải HTTPS/HTTP
  - Không có kết nối Internet
  - Chứng chỉ SSL tự ký (không được tin cậy)
- **Cách khắc phục:**
  - Dùng URL HTTPS hợp lệ
  - Kiểm tra kết nối Wi-Fi
  - Dùng chứng chỉ SSL đáng tin cậy

**Hỏi: Ứng dụng bị crash khi khởi động**
- **Đáp:** Hãy báo lỗi kèm theo:
  - Mẫu thiết bị
  - Phiên bản Android
  - Nhật ký crash (nếu có thể)

**Hỏi: FreeKiosk không tự khởi chạy sau khi khởi động lại cứng (hard restart)**
- **Đáp:** Khởi động lại cứng (giữ nút nguồn + nút âm lượng trong 10 giây) có thể đưa ứng dụng về trạng thái ban đầu. Hãy bảo đảm đã bật "Khởi chạy khi khởi động máy" trong Cài đặt → tab Bảo mật. Từ v1.3.0, ứng dụng kiểm tra cài đặt đã lưu trước khi khởi chạy, giúp hành vi nhất quán.

**Hỏi: Nút nguồn không hoạt động trong chế độ kiosk**
- **Đáp:** Theo mặc định, chế độ khóa chặn mọi tính năng hệ thống, kể cả menu nguồn. Từ v1.3.0, có thể bật "Cho phép nút nguồn" trong Cài đặt → tab Bảo mật → mục Chế độ khóa. Tùy chọn này cho phép tắt nguồn thiết bị mà không cần thoát chế độ kiosk.

**Hỏi: Cài đặt có được giữ lại sau khi cập nhật FreeKiosk không?**
- **Đáp:** **Có!** Toàn bộ cài đặt (URL, mã PIN, chế độ hiển thị, v.v.) được lưu cục bộ trên thiết bị và được giữ nguyên khi cập nhật FreeKiosk. Không cần cấu hình lại gì sau khi cập nhật.

## Chế độ bảng điều khiển

**Hỏi: Chế độ bảng điều khiển là gì?**
- **Đáp:** Chế độ bảng điều khiển thay thế WebView một URL duy nhất bằng lưới các ô URL có thể cấu hình. Mỗi ô có một tên và một URL — chạm vào ô để mở trang. Thanh điều hướng cho phép quay lại, tiến tới, làm mới hoặc trở về lưới.

**Hỏi: Làm sao để bật chế độ bảng điều khiển?**
- **Đáp:** Vào Cài đặt → tab Bảng điều khiển → bật "Chế độ bảng điều khiển". Sau đó thêm các ô, mỗi ô gồm tên và URL.

**Hỏi: Có dùng chế độ bảng điều khiển cùng với Quay về khi không hoạt động được không?**
- **Đáp:** Có! Bật "Quay về khi không hoạt động" trong Cài đặt → Chung. Sau khoảng thời gian chờ đã cấu hình mà không có thao tác chạm, ứng dụng sẽ tự động quay về lưới bảng điều khiển.

**Hỏi: Lập lịch URL hoạt động thế nào trong chế độ bảng điều khiển?**
- **Đáp:** Các sự kiện đã lên lịch trong Lập lịch URL được ưu tiên — chúng chuyển từ lưới sang URL theo lịch. Khi sự kiện kết thúc, ứng dụng tự động quay về lưới bảng điều khiển.

**Hỏi: Tạo được bao nhiêu ô?**
- **Đáp:** Không có giới hạn cứng. Lưới tự điều chỉnh theo số lượng ô.

## Tính năng

**Hỏi: Có tùy chỉnh được độ dài mã PIN không?**
- **Đáp:** Chưa, nhưng đã có kế hoạch. Hiện tại: 4-6 chữ số.

**Hỏi: Có ẩn được nút "Thoát chế độ kiosk" không?**
- **Đáp:** Chưa, nhưng đã có kế hoạch cho v1.1 (cấu hình được trong cài đặt).

**Hỏi: Có lên lịch bật/tắt chế độ kiosk được không?**
- **Đáp:** Chưa, dự kiến có ở v1.2.

**Hỏi: FreeKiosk có thu thập dữ liệu không?**
- **Đáp:** **Không!** FreeKiosk hoạt động ngoại tuyến 100%. Không phân tích, không theo dõi, không thu thập dữ liệu. Quyền riêng tư của người dùng được tôn trọng.

**Hỏi: Có dùng FreeKiosk ngoại tuyến được không?**
- **Đáp:** Có! Sau khi cấu hình xong, FreeKiosk hoạt động ngoại tuyến (URL cũng phải truy cập được khi ngoại tuyến).

## So sánh

**Hỏi: FreeKiosk so với Fully Kiosk Browser thế nào?**
| Tính năng | FreeKiosk | Fully Kiosk |
|---------|-----------|-------------|
| **Giá** | Miễn phí | €7.90/thiết bị |
| **Mã nguồn mở** | Có (MIT) | Không |
| **Device Owner** | Có | Có |
| **Kiosk cơ bản** | Có | Có |
| **Tính năng nâng cao** | Trong lộ trình | Có |
| **Hỗ trợ** | Cộng đồng | Thương mại |

**Hỏi: Vì sao Fully Kiosk đắt hơn?**
- **Đáp:** Fully Kiosk là sản phẩm thương mại đã trưởng thành với nhiều tính năng nâng cao. FreeKiosk còn mới và do cộng đồng phát triển. Chúng tôi đang bắt kịp!

**Hỏi: FreeKiosk có luôn miễn phí không?**
- **Đáp:** Có! Ứng dụng sẽ luôn miễn phí 100% và là mã nguồn mở. Trong tương lai, chúng tôi có thể cung cấp các dịch vụ cloud trả phí tùy chọn (FreeKiosk Cloud), nhưng ứng dụng cốt lõi sẽ miễn phí mãi mãi.

## Phát triển

**Hỏi: Tôi có thể đóng góp không?**
- **Đáp:** Chắc chắn rồi! Xem [Hướng dẫn đóng góp](CONTRIBUTING.md).

**Hỏi: FreeKiosk có thật sự là mã nguồn mở không?**
- **Đáp:** Có! Giấy phép MIT. Xem mã nguồn trên [GitHub](https://github.com/rushb-fr/freekiosk).

**Hỏi: Ai phát triển FreeKiosk?**
- **Đáp:** FreeKiosk được phát triển bởi [Rushb](https://rushb.io), một công ty công nghệ Pháp đam mê mã nguồn mở.

**Hỏi: Có tự lưu trữ (self-host) FreeKiosk được không?**
- **Đáp:** Ứng dụng hoạt động độc lập (không cần máy chủ). Các tính năng cloud trong tương lai sẽ có tùy chọn tự lưu trữ.

## Lộ trình

**Hỏi: v1.1 sẽ có gì?**
| Tính năng | Mô tả |
|---|---|
| **Đa ngôn ngữ** | Hỗ trợ FR, DE, ES |
| **Xoay vòng URL** | Luân phiên nhiều URL |
| **Phát hiện chuyển động** | Kích hoạt dựa trên hoạt động |
| **Tự động điều chỉnh độ sáng** | Độ sáng theo lịch |

**Hỏi: Còn v2.0 thì sao?**
| Tính năng | Mô tả |
|---|---|
| **FreeKiosk Cloud** | Trang quản lý MDM |
| **Cấu hình từ xa** | Quản lý tập trung |
| **Nhiều thiết bị** | Quản lý đội thiết bị |
| **Phân tích** | Thông tin chi tiết về mức sử dụng |

> Xem [Lộ trình](../../README.md) đầy đủ.

## Hỗ trợ

**Hỏi: Tôi có thể nhận trợ giúp ở đâu?**
| Tài nguyên | Liên kết |
|---|---|
| **Hướng dẫn cài đặt** | [Cài đặt](installation.md) |
| **GitHub Discussions** | [Discussions](https://github.com/rushb-fr/freekiosk/discussions) |
| **Báo lỗi** | [Issues](https://github.com/rushb-fr/freekiosk/issues) |
| **Hỗ trợ qua email** | support@freekiosk.app |

**Hỏi: Làm sao để ủng hộ FreeKiosk?**
| Hành động | Cách thực hiện |
|---|---|
| **Gắn sao trên GitHub** | [Gắn sao cho repository](https://github.com/rushb-fr/freekiosk) |
| **Lan tỏa** | Chia sẻ với bạn bè và đồng nghiệp |
| **Báo lỗi** | [Mở issue](https://github.com/rushb-fr/freekiosk/issues) |
| **Đóng góp mã nguồn** | [Hướng dẫn đóng góp](CONTRIBUTING.md) |
| **Mời chúng tôi một ly cà phê** | [Ko-fi](https://ko-fi.com/rushb) (sắp ra mắt) |

**Chưa tìm thấy câu trả lời? Hãy hỏi trong [Discussions](https://github.com/rushb-fr/freekiosk/discussions)!**
