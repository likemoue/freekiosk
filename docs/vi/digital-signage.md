# Trình phát video/ảnh

Màn hình phát một danh sách phát gồm video, hình ảnh, trang web và video YouTube, được tạo trên trang quản lý FreeKiosk Cloud
(**Trình phát video/ảnh**) thay vì nhập danh sách trên thiết bị. Tính năng này chạy được trên máy tính bảng cũng
như trên Android TV, và mở cho mọi tài khoản FreeKiosk Cloud: một thiết bị là một màn hình.

## Cách hoạt động

1. Trên trang quản lý, tạo một danh sách phát và thêm địa chỉ (URL) của từng video hoặc hình ảnh.
   Hình ảnh có thể có thời lượng riêng; video phát đến hết.
2. Chọn các thiết bị, hoặc một nhóm thiết bị, sẽ phát danh sách này. Danh sách phát riêng của
   thiết bị được ưu tiên hơn danh sách của nhóm.
3. Thiết bị biết về danh sách này ở tín hiệu định kỳ (heartbeat) kế tiếp (mỗi 30 giây), tải danh
   sách về, chuyển sang chế độ trình phát đa phương tiện và phát. Thiết bị giữ các tệp trên máy (xem bộ nhớ đệm
   ngoại tuyến trong [android-tv.md](android-tv.md)), nên vẫn tiếp tục phát khi mất mạng.
4. Trang quản lý hiển thị, với từng màn hình, trạng thái **đã cập nhật**, **đang chờ** màn hình,
   hoặc **chưa báo cáo** (ứng dụng ra đời trước tính năng này).

Khi thay đổi danh sách phát (thêm, xóa, sắp xếp lại, đổi thời lượng), các màn hình sẽ cập nhật theo trong vòng
một phút. Khi gỡ một màn hình khỏi danh sách phát, màn hình quay về chế độ trước đó
(ví dụ trang web).

## Tệp từ thư viện đa phương tiện

Một mục trong danh sách phát có thể là tệp mà khách hàng đã tải lên **thư viện đa phương tiện** của Cloud, thay vì
một địa chỉ do họ tự lưu trữ. Với thiết bị, manifest trông giống nhau: nó cung cấp địa chỉ `https`
của tệp, và bộ nhớ đệm ngoại tuyến tải về rồi giữ tệp như mọi mục khác. Các tệp ở chế độ riêng tư, nên
địa chỉ đó được **ký** và có hiệu lực trong 7 ngày. Đường dẫn của nó **ổn định và không bao giờ dùng lại** (tệp trong
thư viện không bao giờ bị ghi đè), nên tệp giữ trên thiết bị mãi mãi là đúng bản, và lần tải được tiếp
tục không thể trộn lẫn hai phiên bản. Khi đặt tên cho tệp, bộ nhớ đệm bỏ chữ ký (các tham số `X-Amz-*`),
nên manifest được gia hạn, vốn mang chữ ký mới, không khiến phải tải lại gì; Cloud
gia hạn nó mỗi 3 ngày.

Đã kiểm tra trên trình giả lập máy tính bảng, với một thư viện thật: một danh sách phát gồm hai hình ảnh và một video, tạo từ
trang quản lý, đã được phát lần lượt từ kho lưu trữ của Cloud, và cả ba tệp đều nằm trong bộ nhớ đệm của thiết bị
với kích thước đúng bằng các tệp trong thư viện. Chưa kiểm tra: video lớn (bộ nhớ đệm đã được thử riêng
trên các tệp lớn), thiết bị ngoại tuyến ngay từ đầu với danh sách phát từ thư viện, và
thiết bị thật.

## Lịch

Một danh sách phát có thể phát vào những thời điểm nhất định thay cho danh sách mặc định của màn hình: vào các **ngày
trong tuần** đã chọn, giữa hai **mốc giờ**, trong một **khoảng ngày**, kèm một **độ ưu tiên**. Thêm các lịch này
ở trang của danh sách phát trên trang quản lý (**Lịch**).

- **Màn hình tự quyết định, không phải Cloud.** Cloud giao cho thiết bị mọi danh sách phát có thể phát cùng
  các quy tắc, và thiết bị tự chọn danh sách phù hợp, theo múi giờ cục bộ của nó. Thiết bị đổi danh sách phát
  đúng giờ ngay cả khi ngoại tuyến, và để làm được điều đó nó giữ tệp của tất cả các danh sách phát này trong
  bộ nhớ đệm ngoại tuyến.
- **Đồng hồ bị lệch.** TV box thường không có đồng hồ chạy bằng pin và không có giờ mạng, nên có thể sai
  nhiều giờ. Mỗi phản hồi cho tín hiệu định kỳ đều mang giờ của Cloud (`server_time`): app giữ độ chênh
  và đọc lịch bằng đồng hồ của thiết bị đã hiệu chỉnh theo độ chênh đó (`src/utils/ServerClock.ts`). Độ chênh
  dưới một phút bị bỏ qua, một lần trao đổi chậm hơn 15 giây không được dùng để đo, và độ chênh
  được giữ qua các lần khởi động lại: màn hình khởi động mà không có mạng vẫn đúng như lần đo gần nhất, và đo
  lại ở tín hiệu định kỳ đầu tiên. Chỉ lịch dùng giá trị này; các bộ hẹn giờ riêng của thiết bị vẫn dùng đồng hồ của nó. Đã kiểm tra
  trên trình giả lập Android TV có đồng hồ chậm mười giờ: với quy tắc lúc 16:03 UTC, thiết bị đã chuyển sang
  danh sách phát theo lịch lúc 16:03 UTC (trước khi sửa, nó theo giờ sai của chính mình và không bao giờ chuyển).
- **Thứ tự ưu tiên.** Khi nhiều quy tắc cùng khớp, quy tắc có độ ưu tiên cao nhất thắng; nếu độ ưu tiên bằng nhau thì quy tắc đặt
  trên chính màn hình thắng quy tắc đặt trên nhóm của nó, rồi đến quy tắc mới nhất. Khi không có quy tắc nào khớp,
  danh sách phát mặc định được phát, hoặc **màn hình trống** nếu không có danh sách mặc định (ví dụ ngoài
  giờ mở cửa).
- **Giờ.** Giờ bắt đầu được tính, giờ kết thúc không tính. Giờ kết thúc sớm hơn giờ bắt đầu nghĩa là khoảng giờ kéo
  qua nửa đêm (22:00 đến 02:00): buổi tối thuộc về ngày đã đánh dấu, các giờ sau nửa đêm thuộc về ngày hôm sau.
  Để trống giờ nghĩa là cả ngày, để trống ngày nghĩa là không giới hạn.
- **Độ trễ.** Màn hình xem đồng hồ của nó mỗi 30 giây, nên danh sách phát thay đổi trong vòng khoảng
  30 giây kể từ giờ đã đặt.

Đã kiểm tra trên trình giả lập máy tính bảng với một Cloud cục bộ, dùng đồng hồ của thiết bị: một danh sách phát mặc định
(hình ảnh màu đỏ) và một quy tắc cho danh sách khác (hình ảnh màu xanh dương) từ 10:18 đến 10:22. Màn hình hiện hình
đỏ, chuyển sang xanh 26 giây sau khi khung giờ bắt đầu, và **quay lại hình đỏ khi khung giờ kết thúc dù
mạng đã bị cắt** (mạng đã bị cắt trong lúc khung giờ đang chạy). Bản thân các quy tắc (thứ tự ưu tiên,
các mốc biên, nửa đêm, ngày tháng, quy tắc sai định dạng) được phủ bởi 32 unit test trên thiết bị và 53 unit test trên
Cloud (thứ tự ưu tiên, phiên bản, manifest, kiểm tra hợp lệ, quyền). Chưa kiểm tra: thiết bị thật, đổi múi giờ hoặc chỉnh đồng hồ bằng tay trong lúc một quy tắc đang
chạy, và chuyển giờ mùa hè.

## Trên thiết bị

- **Cài đặt > Chung > Danh sách phát đa phương tiện** cho biết danh sách phát đến từ FreeKiosk Cloud
  khi có một danh sách được gán. Danh sách hiển thị ở đó khi ấy không phải danh sách đang phát, và nó được
  giữ lại cho ngày danh sách phát bị gỡ.
- Chế độ: gán một danh sách phát sẽ đưa thiết bị vào chế độ trình phát đa phương tiện và ghi nhớ chế độ
  trước đó. Gỡ danh sách phát sẽ trả lại chế độ đó, trừ khi chế độ đã được đổi thủ công trong khoảng thời
  gian này.
- Lần tải thất bại (không có mạng, máy chủ ngừng hoạt động) không làm thay đổi gì và được thử lại ở tín hiệu
  định kỳ kế tiếp. Thiết bị giữ danh sách phát nó đang có.
- Mục không phải video hoặc hình ảnh `http` hay `https` đúng định dạng sẽ bị bỏ qua; phần còn lại của
  danh sách phát vẫn phát.

## Những gì đã kiểm tra và chưa kiểm tra

Đã kiểm tra trên trình giả lập máy tính bảng với FreeKiosk Cloud cục bộ: một danh sách phát gồm hai video, được gán
cho thiết bị đang ở chế độ trang web, được tải về, thiết bị chuyển sang chế độ trình phát đa phương tiện và phát nó
(màn hình thay đổi, các tệp được bộ nhớ đệm ngoại tuyến kiểm tra lại), trang quản lý hiển thị trạng thái
đã cập nhật; gỡ một mục khỏi danh sách phát sẽ đưa thiết bị lên phiên bản mới; gỡ
việc gán sẽ đưa thiết bị về chế độ trang web và thiết bị báo không còn danh sách nào.

Hình ảnh trong danh sách phát từ Cloud đã được kiểm tra trong bài kiểm tra lịch bên dưới. Chưa kiểm tra: thiết bị
thật hoặc Android TV với một danh sách phát, danh sách phát dài, và mất mạng trong lúc danh sách phát đang phát lần đầu
(bộ nhớ đệm ngoại tuyến được kiểm tra riêng, trong [android-tv.md](android-tv.md)).

## Bảo vệ màn hình và chế độ ngủ theo lịch

Màn hình đang phát danh sách phát từ Cloud không chịu tác động của tính năng bảo vệ màn hình (bộ hẹn giờ không thao tác): tính năng
này sẽ che danh sách phát mãi mãi. Chế độ ngủ theo lịch (Lịch ngủ màn hình) vẫn áp dụng: màn hình tối đen trong
khung giờ đó và danh sách phát tiếp tục sau khung giờ. Đã kiểm tra trên trình giả lập máy tính bảng với Cloud.

## Trang web và video YouTube

Một mục trong danh sách phát cũng có thể là **trang web** (hiển thị toàn màn hình trong một khoảng thời gian, 30 giây nếu không
đặt, không bao giờ ít hơn 5 giây) hoặc **video YouTube** (phát đến hết, có thể đặt giới hạn tùy chọn). Cả hai đều cần
mạng và **không bao giờ được lưu trong bộ nhớ đệm ngoại tuyến**: màn hình đang ngoại tuyến sẽ bỏ qua chúng, không
hiện lỗi trên màn hình, và phát phần còn lại.

- **Trang web** được hiển thị trong một frame của trang trình phát; frame này không nhận thao tác chạm và không thể điều hướng
  ra khỏi trình phát (`sandbox`, không điều hướng cấp cao nhất, không popup). Trang web cấm hiển thị bên trong
  một trang khác (`X-Frame-Options`, hoặc CSP `frame-ancestors`) sẽ hiện trang lỗi ở đúng chỗ của nó,
  và app không thể biết được: trang quản lý đọc header của trang web khi thêm trang và đưa ra cảnh báo.
- **Video YouTube** được phát bởi một trang của Cloud (`/player/youtube/?v=<id>`), không phải bởi chính trình
  phát: YouTube từ chối phát cho trang không có origin (lỗi 153), đúng là trường hợp của trang
  trình phát trong app. Trang của Cloud chứa trình phát YouTube và báo cho trình phát biết khi video
  đã kết thúc hoặc không phát được; trình phát chỉ lắng nghe thông điệp đến từ origin của trang đó.
- **App phiên bản cũ** bỏ những gì nó không biết và phát phần còn lại; trang quản lý hiển thị "Ứng dụng quá cũ" cho
  màn hình như vậy (app báo `signage_web` và `signage_youtube` trong capabilities của nó).

Đã kiểm tra trên trình giả lập Android TV với một Cloud cục bộ: một danh sách phát gồm một trang web, một video YouTube
dài 19 giây và một trang cấm nhúng frame đã phát lần lượt và lặp lại; mục video kết thúc cùng lúc video kết thúc,
và một video dài (Big Buck Bunny) cũng phát được; trang từ chối nhúng frame hiện một khung trống. Chưa
kiểm tra: giới hạn tùy chọn của video YouTube, thiết bị hoặc TV box thật, chạy liên tục lâu dài, video không thể
nhúng, luồng phát trực tiếp, và điều khoản của YouTube về việc dùng trên màn hình công cộng của doanh nghiệp (hãy đọc kỹ trước khi dựa vào tính năng này).

## Chưa có trong phiên bản này

Checksum của từng tệp, nhiều vùng trên một màn hình, và báo cáo phát. Hợp đồng giao tiếp giữa
app và Cloud nằm trong repository của Cloud (`ANDROID_INTEGRATION.md`, mục 1d).
