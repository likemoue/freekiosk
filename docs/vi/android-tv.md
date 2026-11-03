# Android TV, Google TV và Fire TV

FreeKiosk cài được trên Android TV và Google TV, hiện trong hàng ứng dụng và có thể vận hành hoàn toàn chỉ bằng điều khiển từ xa. Trang này nêu những gì dùng được, những gì chưa dùng được và cách thiết lập một chiếc TV.

> **Trạng thái: chỉ mới thử trên trình giả lập.** Dùng system image Android TV và Google TV (API 36, 1080p), lệnh được gửi dưới dạng phím điều khiển từ xa qua `adb`. Chưa thử trên TV hoặc TV box thật, trên Fire TV, với HDMI-CEC hay với điều khiển hồng ngoại. Mục nào bên dưới được đánh dấu *chưa kiểm chứng* là nhận định rút ra từ việc đọc mã nguồn hoặc từ hành vi của Android, không phải kết quả thử nghiệm.

## Những gì dùng được

| | |
|---|---|
| Cài đặt và khởi động | APK cài được; FreeKiosk hiện trong hàng ứng dụng của Android TV / Google TV (`LEANBACK_LAUNCHER`) với banner riêng. |
| Chỉ dùng điều khiển từ xa | Phím OK kích hoạt nút, phím mũi tên di chuyển tiêu điểm, và **phần tử đang có tiêu điểm được viền màu hổ phách**. Phím OK bật hoặc tắt một hàng công tắc. Văn bản gõ vào đến được các ô nhập liệu, và Enter xác nhận mã PIN (đã kiểm tra bằng phím gửi qua `adb`, không phải bằng bàn phím trên màn hình của TV). |
| Mở màn hình PIN | Trên màn hình kiosk, nhấn **Quay lại 5 lần**, mỗi lần nhấn cách lần nhấn trước không quá 2 giây. Vẫn yêu cầu nhập mã PIN. |
| Thoát khỏi cài đặt | **Quay lại** sẽ hỏi *Rời khỏi cài đặt?* (ở lại, hoặc rời đi mà không lưu). Nút Lưu nằm ở cuối mỗi tab. |
| Trình phát đa phương tiện | URL video phát toàn màn hình trên trình giả lập Android TV ở độ phân giải 1080p. **Bộ nhớ đệm ngoại tuyến, mặc định bật trên TV:** mỗi video và hình ảnh được tải về thiết bị và phát từ đó, nên mất mạng không làm dừng danh sách phát (xem bên dưới). Không thể thêm video và hình ảnh từ bộ nhớ của thiết bị trên TV (không có trình chọn tệp): hãy dùng URL. |
| Ứng dụng dành cho TV | Ứng dụng chỉ khai báo launcher TV (không có launcher điện thoại) vẫn có thể được chọn làm ứng dụng ngoài, được mở, mở lại và chạy khi khởi động máy. |
| Không có pin | Thiết bị không có pin sẽ không gửi thông tin pin lên Cloud (không báo mức pin giả, không có cảnh báo pin), báo `present: false` qua REST và MQTT, và ẩn pin trên thanh trạng thái. |
| Ethernet | TV box dùng Ethernet được báo là trực tuyến: `ethernet` trong trạng thái, `network.ethernet_connected` trong tín hiệu định kỳ (heartbeat) gửi lên Cloud. |
| Những thứ TV không có | Các cài đặt độ sáng bị ẩn (đã kiểm tra trên màn hình). Các nút chỉnh nhanh độ sáng, xoay màn hình và đèn pin trên màn hình PIN, cùng các bước cấp quyền camera và tối ưu hóa pin, cũng bị ẩn (theo mã nguồn, chưa kiểm tra trên màn hình). |

Trên máy tính bảng hoặc điện thoại, mọi thứ giữ nguyên: hành vi dành riêng cho TV chỉ có khi Android báo thiết bị là TV.

## Bộ nhớ đệm ngoại tuyến của trình phát đa phương tiện

Khi bật **Cài đặt > Chung > Phát nội dung > Phát từ thiết bị (bộ nhớ đệm ngoại tuyến)**, mọi video và hình ảnh http(s) trong danh sách phát được tải về một lần vào bộ nhớ riêng của thiết bị và phát từ tệp đó. Tùy chọn này **mặc định bật trên TV và tắt ở mọi thiết bị khác**, nên máy tính bảng hoặc điện thoại vẫn phát từ URL như trước. Bên dưới công tắc, phần cài đặt hiển thị số tệp đang có trên thiết bị cùng dung lượng của chúng, và có nút **Xóa bộ nhớ đệm**.

- Tệp được ghi dưới dạng `.part` và chỉ được đổi tên khi đã đầy đủ và đúng kích thước dự kiến, nên một lần tải bị ngắt không bao giờ để lại tệp dở dang rồi bị đem ra phát.
- **Lần tải bị ngắt sẽ được tiếp tục** từ chỗ đã dừng (`Range`, có `If-Range` bảo vệ): nếu trong lúc đó tệp trên máy chủ đã thay đổi, quá trình tải bắt đầu lại từ đầu thay vì trộn lẫn hai phiên bản.
- Mỗi tệp được kiểm tra lại sau mỗi 10 phút bằng một yêu cầu có điều kiện (ETag, Last-Modified): tệp không đổi thì không tải lại, tệp đã đổi thì tải lại.
- Lần kiểm tra thất bại (ngoại tuyến, máy chủ ngừng hoạt động) giữ nguyên các tệp đang có. Thiết bị khởi động khi đang ngoại tuyến sẽ phát những gì nó đang có.
- Tệp không còn nằm trong danh sách phát sẽ bị xóa, mọi thứ khác còn sót lại trong thư mục bộ nhớ đệm cũng vậy. Tệp tải dở mà không ai hoàn tất trong một tuần cũng bị xóa.
- **Bộ nhớ đệm có giới hạn, mặc định 2 GB.** Tệp nào làm vượt giới hạn sẽ không được tải và phát từ URL của nó. Giới hạn là giá trị riêng cho từng thiết bị, `media_player_cache_limit_mb`, đặt qua ADB (xem [adb-configuration.md](adb-configuration.md)); lần tải nào khiến dung lượng trống còn dưới 100 MB đều bị từ chối, bất kể giới hạn là bao nhiêu.
- Mục mới chưa có trên thiết bị sẽ phát từ URL trong lúc đang tải, nên lần phát đầu tiên cần có mạng (và tệp bị tải hai lần trong lượt đầu đó). Các mục lấy từ bộ nhớ của chính thiết bị vốn đã nằm cục bộ nên không bị động tới.
- **Cloud nhìn thấy trạng thái của bộ nhớ đệm** (`system.media_cache` trong tín hiệu định kỳ, hiển thị thành ô *Đa phương tiện ngoại tuyến* trên trang thiết bị): các tệp mà danh sách phát cần và các tệp đang có, dung lượng của chúng, thời điểm kiểm tra gần nhất, và một mã lỗi ngắn khi lần kiểm tra gần nhất thất bại. Thông tin này được gửi từ khi bộ nhớ đệm đã được bật, và gửi lại dưới dạng "tắt" khi bộ nhớ đệm bị tắt (kể cả sau khi khởi động lại, khi các tệp của bộ nhớ đệm trước đó vẫn còn trên thiết bị); thiết bị chưa từng dùng bộ nhớ đệm thì không gửi gì. Đã kiểm tra trên trình giả lập máy tính bảng với một Cloud cục bộ: 2/2 tệp và 13.372.429 byte (tổng dung lượng các tệp trên thiết bị), 1/3 tệp khi có một tệp bị thiếu và một kết nối bị từ chối, và "tắt" sau khi khởi động lại với bộ nhớ đệm bị vô hiệu hóa.
- Tính toàn vẹn dựa vào TCP và bước kiểm tra kích thước. Hiện chưa có checksum: phần đó sẽ đi cùng danh sách phát mà Cloud sẽ gửi (URL, kích thước, checksum).

Đã kiểm tra với một máy chủ thử nghiệm cục bộ (ETag, Range, lỗi giả lập) trên trình giả lập máy tính bảng: một lần tải bị ngắt ở 3 MB sẽ tiếp tục bằng `Range: bytes=...` và `If-Range`, kết quả **giống hệt từng byte** với nguồn; tệp bị đổi trên máy chủ giữa lúc đang tiếp tục sẽ được tải lại toàn bộ, không trộn lẫn các phiên bản; một bản tải dở thực ra đã đủ (416) sẽ bắt đầu lại; tệp 12 MB bị từ chối khi giới hạn là 5 MB, còn tệp nhỏ thì được lưu vào bộ nhớ đệm; tệp không đổi nhận phản hồi 304 và không bị động tới; tệp đã đổi thì được tải lại; tệp đã bị gỡ khỏi danh sách, tệp lạ và tệp `.part` mồ côi đều bị xóa. Ngoài ra: khi tắt tùy chọn thì không có thư mục bộ nhớ đệm và không có lệnh gọi nào tới bộ nhớ đệm, phát từ bộ nhớ đệm khi mạng thực sự bị cắt, và bộ nhớ đệm mặc định bật trên trình giả lập Android TV. **Trên trình giả lập, kết nối bị máy chủ đóng sẽ mất khoảng một byte trên mỗi 8.640 byte trong ~170 KB cuối trước khi đóng** (đây là hiện tượng của mạng trình giả lập: cùng tệp đó đến nguyên vẹn khi máy chủ giữ kết nối mở); bước kiểm tra kích thước đã từ chối lần tải như vậy thay vì chấp nhận nó. Chưa thử trên thiết bị thật, với video rất lớn, hoặc khi bộ nhớ đầy.

## Phát không giám sát của trình phát đa phương tiện

**Cài đặt > Chung > Phát nội dung > Phát không giám sát** dành cho màn hình không có ai theo dõi. **Mặc định bật trên TV, tắt ở mọi thiết bị khác**, nên máy tính bảng vẫn phát đúng như trước.

- **Không hiện chữ báo lỗi trên màn hình.** Trước đây trình phát hiện `Failed to load video: <URL>` lên màn hình treo tường, kèm URL ở dạng rõ (URL đã ký chứa mã token của nó). Nay không hiện gì và chuyển sang mục kế tiếp sau 3 giây, như trước.
- **Mục không tải được, hoặc video bị đứng hình, sẽ bị bỏ qua sau 30 giây.** Cả hai trường hợp đều không phát sinh sự kiện lỗi trong trang, nên nếu không có cơ chế này thì màn hình sẽ kẹt mãi ở mục hỏng. Video được coi là đứng hình khi đã có dữ liệu nhưng vị trí phát không nhích trong 30 giây dù lẽ ra đang phát; mục được coi là không tải được khi sau 30 giây vẫn chưa có dữ liệu. Hình ảnh chỉ được theo dõi trong lúc đang tải.

Đã kiểm tra trên trình giả lập máy tính bảng với một máy chủ thử nghiệm cục bộ, lần lượt khi tắt rồi bật cài đặt: lỗi 404 hiện thông báo và URL khi tắt cài đặt, còn khi bật thì hiện màn hình đen; máy chủ nhận yêu cầu nhưng không bao giờ trả lời khiến trình phát kẹt mãi ở mục đó khi tắt cài đặt, còn khi bật thì trình phát bỏ qua mục đó và lặp lại danh sách; video đầu tiên có luồng dữ liệu dừng sau 300 KB đứng hình suốt 85 giây khi tắt cài đặt, còn khi bật thì video thứ hai trong danh sách được yêu cầu và phát sau khoảng 40 giây. Chưa kiểm tra: danh sách phát chỉ có một mục mà máy chủ giữ kết nối chết ở trạng thái mở (trình phát yêu cầu lại, nhưng trình duyệt có thể giữ yêu cầu mới phía sau yêu cầu cũ cho đến khi kết nối kết thúc), và chưa thử gì trên TV thật.

## Những gì chưa dùng được

- **Tăng âm lượng ×5 không dùng được trên TV.** Trên các trình giả lập, phím âm lượng không bao giờ đến được app. Hãy dùng Quay lại ×5. Cách thoát bằng chạm liên tiếp cũng không có (không có cảm ứng).
- **Chế độ ứng dụng ngoài không được cung cấp trên TV.** Khi một ứng dụng khác đang ở phía trước, FreeKiosk không nhận được phím nào, nên Quay lại ×5 không thể đưa màn hình PIN trở lại. Tùy chọn này bị ẩn trong Cài đặt > Chung; thiết bị đã ở chế độ đó (đặt từ Cloud hoặc `adb`) vẫn giữ nguyên chế độ, và khi đó phần cài đặt sẽ chỉ cách thoát ra: REST API, MQTT, một lệnh FreeKiosk Cloud, hoặc `adb shell am start -n com.freekiosk/.MainActivity`. Một bộ lọc phím trong dịch vụ trợ năng sẽ làm được điều này, nhưng nó thay đổi những gì dịch vụ yêu cầu ở mọi thiết bị, kể cả máy tính bảng, và không thể kiểm tra trên các trình giả lập (phím được chèn vào không đi qua nó), nên đã không đưa vào.
- **User-Agent trên TV không có thành phần `Mobile`** (cả header lẫn `navigator.userAgent`, đã kiểm tra trên các trình giả lập), nên trang web trả về giao diện cho máy tính bảng hoặc máy tính để bàn thay vì giao diện điện thoại bị kéo giãn ra toàn màn hình. User-Agent tùy chỉnh trong Cài đặt vẫn được ưu tiên.
- **Trang web thiết kế cho cảm ứng** có thể không dùng được bằng phím mũi tên và OK. Áp dụng cách di chuyển tiêu điểm riêng của Chromium; không có con trỏ ảo. Một cú nhấp chuột được tính vào chuỗi thao tác chạm (theo mã nguồn, chưa kiểm chứng).
- **Chưa kiểm chứng:** HDMI-CEC (tắt và bật TV từ Cloud), bộ hẹn giờ ngủ riêng của TV (`attentive_timeout`), âm lượng cố định hoặc do CEC điều khiển, camera USB (luồng MJPEG chỉ tìm camera trước và camera sau), Fire OS.

## Thiết lập TV

### Cài đặt

Cài APK thủ công (sideload) như trên mọi thiết bị khác (`adb install`). Trên Google TV, hãy bật *Tùy chọn cho nhà phát triển* và *Gỡ lỗi USB* (hoặc *Gỡ lỗi không dây*) trước. Sau đó FreeKiosk sẽ hiện trong hàng ứng dụng.

### Device Owner

Device Owner cho phép dùng chế độ khóa và cấp quyền im lặng. Trình hướng dẫn thiết lập của TV không hỗ trợ cấp phát thiết bị bằng mã QR, nên hãy dùng `adb`:

```bash
adb shell dpm set-device-owner com.freekiosk/.DeviceAdminReceiver
```

Lệnh này **không cần tài khoản nào trên thiết bị**, và kết quả tùy thuộc vào TV:

| Thiết bị | Kết quả |
|---|---|
| Image Google TV (trình giả lập), không có tài khoản | Hoạt động. |
| Image Android TV AOSP (trình giả lập) | **Thất bại**: image thiếu `android.software.device_admin`. Nhiều TV box giá rẻ cũng rơi vào trường hợp này; xem *ROM không khai báo `android.software.device_admin`* trong [adb-configuration.md](adb-configuration.md) và `scripts/set-device-owner.ps1`. |
| Google TV thật có tài khoản Google | Chưa kiểm chứng. Hãy gỡ tài khoản trước, hoặc dùng FreeKiosk không có Device Owner. |

Không có Device Owner thì không có chế độ khóa: phím Home sẽ thoát khỏi FreeKiosk, như trên mọi thiết bị.

### Quyền đặc biệt

Ứng dụng Cài đặt của TV thiếu một số màn hình mà FreeKiosk mở trên máy tính bảng (tối ưu hóa pin, ghi cài đặt hệ thống, hiển thị, Bluetooth và trình chọn tài liệu; đã kiểm tra trên cả hai image). Những màn hình có sẵn: hiển thị trên ứng dụng khác, quyền truy cập dữ liệu sử dụng, trợ năng, launcher mặc định, nguồn không xác định. Với các màn hình còn lại, hoặc để bỏ qua các màn hình đó, hãy cấp quyền qua `adb`:

```bash
adb shell appops set com.freekiosk SYSTEM_ALERT_WINDOW allow   # display over other apps
adb shell appops set com.freekiosk GET_USAGE_STATS allow       # usage access (External App mode)
```

**Hãy cấp quyền hiển thị trên ứng dụng khác trên TV không có Device Owner.** Nếu thiếu quyền này, sau khi cấu hình qua ADB, ứng dụng dừng lại và Android chặn việc mở lại (*Background activity launch blocked*); có quyền này thì việc mở lại hoạt động bình thường. Đã kiểm tra trên trình giả lập Android TV.

**Tự khởi động khi bật máy và sau khi mất điện.** Cài đặt > Bảo mật > Khởi chạy khi khởi động máy là chưa đủ trên TV không có Device Owner. Đã kiểm tra trên trình giả lập Android TV (API 36) với một lần khởi động lại thật (`adb reboot`):

| Trạng thái thiết bị | Sau khi khởi động lại |
|---|---|
| Khởi chạy khi khởi động máy đang bật, đã cấp quyền *hiển thị trên ứng dụng khác* | FreeKiosk hiện ở phía trước trong vòng 10 giây và tải trang của nó. |
| Khởi chạy khi khởi động máy đang bật, **chưa** cấp quyền *hiển thị trên ứng dụng khác* | **FreeKiosk không khởi động**: màn hình chính của TV vẫn giữ nguyên, không có yêu cầu nào đến máy chủ sau 70 giây. |
| Khởi chạy khi khởi động máy đang bật, chưa cấp quyền, FreeKiosk được đặt làm ứng dụng Home (`adb shell cmd package set-home-activity com.freekiosk/.MainActivity`) | FreeKiosk hiện ở phía trước và tải trang của nó. |

Vì vậy, trên TV hãy cấp quyền này một lần (lệnh ở trên) hoặc đặt FreeKiosk làm ứng dụng Home. Bên dưới mục Khởi chạy khi khởi động máy, phần cài đặt giờ cho biết TV đang ở trường hợp nào: một cảnh báo kèm lệnh khi thiếu quyền, một lời xác nhận khi đã cấp quyền. Chưa kiểm tra: Device Owner trên image TV (hạn chế này có thể không áp dụng cho nó), nút *Đặt FreeKiosk làm launcher mặc định* trong app trên TV (chỉ dùng lệnh ở trên), mất điện trên TV box thật (lần khởi động lại trên trình giả lập là khởi động êm), và TV box có ứng dụng Home không thể thay đổi.

### Cấu hình qua ADB

Điều khiển từ xa khiến việc nhập giá trị dài rất chậm. Hãy đặt URL khởi động và mã PIN một lần qua `adb`, rồi mở màn hình PIN bằng Quay lại ×5 để cấu hình phần còn lại:

```bash
adb shell am start -n com.freekiosk/.MainActivity \
  --es url "https://example.com" --es pin "1234"
```

Xem [adb-configuration.md](adb-configuration.md) để biết đầy đủ các khóa.

### FreeKiosk Cloud

Không có camera để quét mã QR, nên hãy đăng ký thiết bị bằng cách nhập URL của Cloud và mã token đăng ký tại Cài đặt > Nâng cao > Cloud, bằng điều khiển từ xa và bàn phím của TV. TV không gửi thông tin pin, và trang quản lý để trống ô pin của thiết bị này.

## Báo cáo sự cố

Hãy cho chúng tôi biết kiểu máy của TV hoặc TV box, phiên bản Android, và Device Owner đã được đặt hay chưa. Nếu có gì không hoạt động với điều khiển từ xa, hãy nêu phím đã nhấn và điều đã xảy ra.
