# FreeKiosk Cloud

> [!NOTE]
> **Bản Việt hóa này dùng máy chủ tự vận hành.** Trang này mô tả dịch vụ FreeKiosk Cloud chính thức. Ứng dụng trong repo mặc định
> kết nối tới website trong thư mục [`cloud/`](../../cloud/README.md), có các tính năng tương tự và chạy trên máy chủ của bạn.
> Xem [hướng dẫn triển khai](../../cloud/docs/TRIEN-KHAI.md). Giá và thanh toán bên dưới không áp dụng.

FreeKiosk Cloud là dịch vụ tùy chọn để quản lý đội thiết bị FreeKiosk từ một trang quản lý
web. **App không cần đến nó**: mọi tính năng kiosk, REST API và tích hợp MQTT
đều hoạt động mà không cần tài khoản, và không có gì rời khỏi thiết bị cho đến khi thiết bị được đăng ký.

- Trạng thái: **beta mở**, tự đăng ký tài khoản tại [cloud.freekiosk.app](https://cloud.freekiosk.app).
- Bản thân app (`v2.0.0`) đã ổn định.
- Giá và công cụ tính phí: [freekiosk.app/cloud](https://freekiosk.app/cloud).

## Cloud làm được gì

- **Trang quản lý đội thiết bị**: pin, mạng, màn hình và bộ nhớ của mọi thiết bị, cập nhật trực tiếp, kèm
  nhật ký hoạt động có thể xuất ra CSV.
- **Lệnh từ xa** cho một thiết bị, một nhóm hoặc cả đội thiết bị.
- **Nhóm và hồ sơ cấu hình**: áp dụng cùng một bộ cài đặt cho nhiều thiết bị.
- **Cảnh báo và thông báo** khi thiết bị đổi trạng thái.
- **Ảnh chụp màn hình từ xa** và **phân phối APK** (giấy phép trả phí, xem [Giá và thanh toán](#giá-và-thanh-toán)).
- **Trình phát video/ảnh** (beta): danh sách phát gồm video, hình ảnh, trang web và video YouTube được phát bởi một
  màn hình, kèm lịch, xem [Trình phát video/ảnh](digital-signage.md). Cần app `2.1.0-beta.1`
  trở lên, có dưới dạng [bản pre-release trên GitHub](https://github.com/RushB-fr/freekiosk/releases)
  (Google Play hiện vẫn là `2.0.0`).

## Đăng ký thiết bị

Có ba cách, đều bắt đầu từ trang quản lý (*Thêm thiết bị*):

1. **Mã token, trên máy tính bảng.** Trên trang quản lý, tạo một mã token đăng ký dùng một lần. Trên máy tính bảng,
   mở FreeKiosk, rồi vào *Cài đặt > Nâng cao > Quản lý Cloud*, và nhập địa chỉ máy chủ cùng
   mã token. Mã token có hiệu lực trong 24 giờ.
2. **ADB**, cho nhiều máy tính bảng: `--es cloud_token "TOKEN"`, xem
   [Cấu hình ADB](adb-configuration.md#đăng-ký-thiết-bị-với-cloud).
3. **QR cấp phát thiết bị, trên máy tính bảng mới hoặc vừa đặt lại về cài đặt gốc.** Trang quản lý hiển thị một mã QR. Quét mã từ
   trình hướng dẫn thiết lập Android (chạm sáu lần vào màn hình chào mừng để mở trình đọc QR): FreeKiosk được
   cài đặt làm **Device Owner** và tự đăng ký, không cần nhập mã nào.

Để gỡ một máy tính bảng khỏi Cloud, hãy hủy đăng ký trong *Cài đặt > Nâng cao > Cloud*.

## Máy tính bảng gửi những gì

Sau khi đăng ký, app gửi một báo cáo trạng thái mỗi 30 giây (trong mã nguồn:
`src/utils/CloudSyncService.ts`). Báo cáo gồm:

- mức pin và trạng thái sạc (chỉ trên thiết bị có pin);
- mạng: tên và cường độ tín hiệu Wi-Fi, địa chỉ IP, Ethernet, và trạng thái kết nối di động;
- màn hình bật hay tắt và độ sáng;
- trang đang hiển thị, chế độ kiosk, FreeKiosk có phải Device Owner hay không, và danh sách những việc app
  được phép làm trên thiết bị này (capabilities);
- kiểu máy, nhà sản xuất, phiên bản Android và app, dạng thiết bị (máy tính bảng hoặc TV), dung lượng lưu trữ trống và
  bộ nhớ, thời gian hoạt động và múi giờ;
- khi áp dụng, trạng thái của bộ nhớ đệm đa phương tiện ngoại tuyến và phiên bản của danh sách phát trình phát video/ảnh.

Cùng yêu cầu này còn mang theo **cấu hình của app**, để trang quản lý có thể sao lưu và
áp dụng thay đổi. Cấu hình gồm cả các bí mật lưu trong app, **mật khẩu MQTT, khóa REST API và
mật khẩu HTTP Basic Auth**, được máy chủ lưu ở dạng **mã hóa**. Mã PIN không bao giờ được gửi từ
máy tính bảng.

Báo cáo **không** chứa vị trí GPS của thiết bị.

Theo chiều ngược lại, Cloud gửi các thay đổi cấu hình và lệnh. Cập nhật app qua mạng (OTA)
chỉ có ở các bản build không phải bản Google Play (bản Play không có tự cập nhật).

## Giá và thanh toán

Các điều khoản áp dụng là [Điều khoản bán hàng](https://cloud.freekiosk.app/terms/) của dịch vụ;
đây chỉ là bản tóm tắt.

- **Thiết bị đầu tiên miễn phí**, không cần phương thức thanh toán. Thiết bị này dùng được toàn bộ dịch vụ, trừ
  phân phối APK, ảnh chụp màn hình từ xa, lịch hẹn giờ, đổi tên tổ chức và thêm thành viên nhóm,
  những tính năng đi kèm giấy phép trả phí đầu tiên.
- **Một phương án duy nhất, không chia gói**: mọi tính năng đều có từ giấy phép trả phí đầu tiên, bất kể số
  thiết bị. Một giấy phép tương ứng với một thiết bị được đăng ký tại một thời điểm.
- **Mức giá** theo giấy phép và theo tháng, chưa gồm VAT: xem [freekiosk.app/cloud](https://freekiosk.app/cloud).
- **Không dùng thử miễn phí**: đăng ký thêm thiết bị vượt quá thiết bị miễn phí sẽ bị tính phí ngay, từ ngày đầu tiên.
- **Thanh toán trước**, theo tháng hoặc theo năm. Thuê bao năm được thanh toán một lần cho mười hai
  tháng tiếp theo và được giảm 10% so với mức giá theo tháng.
- **Thêm giấy phép giữa kỳ thanh toán** được tính phí ngay, theo tỷ lệ với thời gian còn lại
  đến ngày đến hạn kế tiếp. Không áp dụng mức tối thiểu.
- **Đa phương tiện cho trình phát video/ảnh**: thư viện đa phương tiện có hạn mức lưu trữ 100 MiB cho tổ chức chỉ
  dùng phần miễn phí, và 1 GiB cho mỗi giấy phép đang có khi đã trả phí cho một giấy phép.

## Khi Cloud không khả dụng

App chạy độc lập. Việc dịch vụ bị gián đoạn không làm dừng thiết bị đã được cấu hình:
chỉ việc quản lý từ xa bị ảnh hưởng trong thời gian gián đoạn.

## Khi hủy thuê bao

Thuê bao có hiệu lực đến ngày kết thúc và không có gì thay đổi cho đến lúc đó. Sau đó tổ chức
quay về phần miễn phí: các thiết bị đã đăng ký vẫn chạy và vẫn báo cáo, còn đăng ký thiết bị mới
cần có giấy phép. Có thể tiếp tục thuê bao cho đến ngày kết thúc mà không phải trả tiền lại.

## Bảo mật

Tài khoản hỗ trợ xác thực hai yếu tố (TOTP). Mỗi thiết bị xác thực bằng khóa API riêng của nó,
được lưu dưới dạng mã băm SHA-256 trên máy chủ, và dữ liệu của mỗi tổ chức được cách ly với các tổ chức khác.

## Tự lưu trữ (self-hosting)

Máy chủ quản lý dự kiến sẽ được phát hành mã nguồn mở vào năm 2027. Cho đến lúc đó, Cloud là
dịch vụ được vận hành sẵn (hosted) nêu ở trên; app có thể trỏ tới một địa chỉ khác bằng `cloud_url`
([Cấu hình ADB](adb-configuration.md#đăng-ký-thiết-bị-với-cloud)).
