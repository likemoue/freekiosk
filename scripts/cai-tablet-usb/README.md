Cài tablet FreeKiosk qua USB
============================

Mở CaiTablet.exe, bật Gỡ lỗi USB trên tablet rồi cắm cáp. Công cụ tự làm phần còn lại:
cài FreeKiosk, đặt Device Owner, cấp quyền, nối Wi-Fi nếu cần, đăng ký tablet lên website,
áp cấu hình, đặt PIN, rồi tắt Gỡ lỗi USB. Không cần cài thêm gì trên máy tính, trừ khi Windows
không nhận tablet (xem mục Khi có lỗi).


LẦN ĐẦU MỞ
----------
Công cụ hỏi vài thông tin và nhớ cho những lần sau:

- Mã đăng ký: bấm Lấy từ website, đăng nhập bằng tài khoản quản trị, chọn nhóm và hồ sơ cấu hình
  rồi bấm Tạo mã. Mật khẩu chỉ dùng cho lần đó và không được lưu. Cách này cần Windows 11, vì
  website yêu cầu TLS 1.3. Trên Windows cũ hơn, hãy tạo mã trên website (Thêm thiết bị, Tiêu chuẩn)
  rồi dán mã hoặc cả dòng lệnh ADB vào ô này. Mọi tablet dùng mã này sẽ vào nhóm và nhận hồ sơ đã chọn.
- Tệp cấu hình (không bắt buộc): tệp xuất từ Cài đặt, Nâng cao, Sao lưu và khôi phục trên một tablet
  đã làm sẵn. Công cụ áp tệp này lên từng tablet ngay sau khi đăng ký, nên nếu có cả hồ sơ thì các mục
  trong tệp được ưu tiên. Tệp không chứa PIN, PIN lấy từ ô bên dưới.
- PIN trên tablet: 4 đến 6 chữ số, dùng để vào Cài đặt của FreeKiosk.
- Tên và mật khẩu Wi-Fi: nên nhập, để công cụ tự nối mạng cho từng tablet. Để trống thì
  công cụ mở màn hình Wi-Fi trên tablet và chờ bạn nối tay. Nhập sai thì bấm Thiết lập để sửa,
  công cụ tự nối lại.

Những thông tin này được mã hóa theo tài khoản Windows đang dùng và nằm ngoài thư mục công cụ,
nên có thể nén cả thư mục gửi cho người khác. Người nhận phải tự nhập mã của họ. Công cụ chưa
có chữ ký số nên Windows có thể cảnh báo ở máy khác: chọn Thông tin thêm rồi Vẫn chạy.


CÀI TỪNG TABLET
---------------
1. Khôi phục cài đặt gốc nếu máy đã dùng.
2. Đi hết các bước thiết lập, bỏ qua Wi-Fi, không đăng nhập tài khoản nào.
3. Vào Cài đặt, Thông tin máy tính bảng, Thông tin phần mềm. Chạm 7 lần vào Số hiệu bản tạo.
4. Quay lại Cài đặt, vào Tùy chọn cho nhà phát triển, bật Gỡ lỗi USB.
5. Cắm cáp vào máy tính, bấm Cho phép trên tablet.

Trên máy Lenovo, công cụ tự tắt nút ba chấm và các cử chỉ ba ngón của One Vision, vì học sinh có thể
thoát khỏi kiosk từ nút ba chấm, và tắt cả nút bút ở mép phải màn hình. Smart Rotate vẫn để nguyên.

Khi công cụ báo Xong, rút cáp và cắm tablet tiếp theo. Có thể cắm nhiều tablet qua hub,
công cụ cài lần lượt từng máy.

Công cụ sẽ đặt Device Owner cho bất kỳ máy nào đủ điều kiện được cắm vào. Muốn gỡ thì phải
khôi phục cài đặt gốc, nên đừng cắm máy khác vào khi công cụ đang mở.


KHI CÓ LỖI
----------
Công cụ nói rõ cần làm gì. Sửa xong thì bấm Thử lại, hoặc rút cáp cắm lại.

- Không thấy tablet: đổi cáp khác (cáp chỉ sạc không truyền dữ liệu). Nếu vẫn không thấy,
  cài driver USB của Samsung: https://developer.samsung.com/android-usb-driver
- Website từ chối mã: mã hết hạn hoặc hết lượt. Tạo mã mới, bấm Thiết lập để dán.
- Lịch sử cài nằm ở nút Lịch sử. Nhật ký chi tiết nằm ở
  %LOCALAPPDATA%\FreeKioskCaiTablet\nhat-ky.txt, không chứa mã, PIN hay mật khẩu.


LẤY ĐỦ BỘ APK TỪ MÁY ĐÃ CÀI ỨNG DỤNG
------------------------------------
Ứng dụng cài từ CH Play thường gồm nhiều tệp, và công cụ trích xuất APK trên điện thoại chỉ lấy
phần gốc, Android không cài được một mình. Cách lấy đủ bộ:

1. Bật Gỡ lỗi USB trên máy đã cài ứng dụng, cắm cáp, bấm Cho phép trên máy.
2. Mở LayApk.bat, chọn ứng dụng trong danh sách.
3. Tải tệp .zip vừa tạo lên mục Ứng dụng (APK) trên website.

Máy lấy nên cùng loại CPU với các tablet. Tablet cần FreeKiosk từ 2.1.0-beta.5 trở lên để cài được
bộ nhiều tệp.


TỰ CẬP NHẬT
-----------
Mỗi lần mở, công cụ hỏi website (địa chỉ trong Thiết lập) xem có bản mới hơn không. Có thì công cụ
tự tải về, kiểm tra chữ ký, thay các tệp trong thư mục này rồi tự mở lại; tablet cài sau đó nhận bản
FreeKiosk đi kèm bản mới. Không có mạng, hoặc Windows 10 (website yêu cầu TLS 1.3), thì công cụ chạy
tiếp bằng bản đang có. Bản đang dùng ghi trên thanh tiêu đề cửa sổ.

Thư mục công cụ phải ghi được: đừng để trong Program Files. Bản mới chỉ được nhận khi có chữ ký bằng
khóa của người build công cụ, nên dù website bị chiếm cũng không phát được chương trình lạ.


CẬP NHẬT PHIÊN BẢN FREEKIOSK
----------------------------
Người quản trị: chạy build.ps1 để có bản mới, rồi tải tệp release-builds/CaiTablet-USB-<phiên bản>.zip
lên website, mục Ứng dụng (APK), thẻ Công cụ cài USB. Các máy tính đang dùng công cụ tự nhận bản mới
ở lần mở sau.

Muốn đổi tay trên một máy: thay tệp FreeKiosk.apk trong thư mục này bằng bản mới, giữ nguyên tên tệp.
Phải dùng bản build thường (assembleRelease), không dùng bản -Pcloudprovi. Lần tự cập nhật sau sẽ
đưa tệp này về bản trên website.


DÀNH CHO NGƯỜI SỬA MÃ NGUỒN
---------------------------
Mã nguồn nằm ở scripts/cai-tablet-usb. Chạy build.ps1 để tạo lại thư mục
release-builds/CaiTablet-USB và tệp .zip để tải lên website. Không cần cài thêm trình biên dịch:
dùng csc.exe có sẵn trong Windows.

build.ps1 ký tệp .zip bằng khóa scripts/cai-tablet-usb/khoa-ky-cap-nhat.xml (không đưa lên git).
Lần đầu tạo khóa bằng: build.ps1 -NewSigningKey. Hãy sao lưu khóa này cùng khóa ký APK: build bằng
khóa khác thì các công cụ đã phát hành từ chối bản đó, và phải chép công cụ mới bằng tay lên từng máy.
