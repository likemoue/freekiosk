

# Hướng dẫn cấu hình ADB cho FreeKiosk

**Cấp phát thiết bị không cần giao diện (headless) và triển khai bằng script, kiểm soát an toàn bằng mã PIN**

<p>
  <a href="README.md">Trang chủ tài liệu</a> •
  <a href="installation.md">Hướng dẫn cài đặt</a> •
  <a href="rest-api.md">REST API</a> •
  <a href="MQTT.md">MQTT</a>
</p>

## Mục lục

- [Tổng quan](#tổng-quan)
- [Mô hình bảo mật](#mô-hình-bảo-mật)
- [Bắt đầu nhanh](#bắt-đầu-nhanh)
- [Tham số cấu hình](#tham-số-cấu-hình)
- [Trạng thái thiết bị](#trạng-thái-thiết-bị)
- [Lệnh thường dùng](#lệnh-thường-dùng)
- [Tham chiếu lệnh](#tham-chiếu-lệnh)
- [Kịch bản nâng cao](#kịch-bản-nâng-cao)
- [Khắc phục sự cố](#khắc-phục-sự-cố)
- [Tài nguyên liên quan](#tài-nguyên-liên-quan)



> [!IMPORTANT]
> Để khóa ứng dụng đủ tin cậy cho môi trường vận hành thực tế, hãy kết hợp cấp phát qua ADB với **chế độ Device Owner**.

## Tổng quan

FreeKiosk hỗ trợ cấu hình qua intent extra của Android Debug Bridge (ADB), cho phép:

| Khả năng | Mô tả |
|---|---|
| **Cấp phát thiết bị tự động** | Cấu hình mà không cần thao tác trên giao diện |
| **Triển khai hàng loạt** | Mở rộng quy mô trên nhiều thiết bị |
| **Cấu hình động** | Thay đổi cài đặt bằng script |
| **Tích hợp CI/CD** | Quy trình kiểm thử tự động |

## Mô hình bảo mật



| Trạng thái thiết bị | Yêu cầu |
|--------------|-------------|
| **Thiết lập lần đầu** (chưa cấu hình PIN) | **Phải cung cấp** PIN trong lệnh |
| **Đã được cấu hình** | **Bắt buộc** nhập PIN hiện có để thay đổi |



Mô hình bảo mật này bảo đảm:



✅ **Có thể thiết lập lần đầu bằng script**, được bảo vệ bằng PIN  
✅ **Thiết bị đã cấu hình không thể bị chiếm quyền điều khiển** qua ADB  
✅ **Khôi phục cài đặt gốc sẽ bật lại** tính năng cấp phát qua ADB  




## Đặt dấu nháy cho giá trị JSON

`adb shell` nối các đối số lại và shell **trên thiết bị** phân tích chúng thêm một lần nữa, làm mất
dấu ngoặc kép của giá trị JSON: lệnh `--es dashboard_tiles '[{"label":"A"}]'` gõ nguyên như vậy
sẽ đến FreeKiosk dưới dạng `[{label:A}]`, và ứng dụng ghi log `Invalid dashboard tiles JSON` (hoặc
hiện toast "Invalid ... JSON"). Hãy đặt cả lệnh `am start ...` trong dấu ngoặc kép, giữ phần
JSON trong dấu nháy đơn bên trong đó, và thêm dấu gạch chéo ngược trước mỗi dấu ngoặc kép của JSON:

```
adb shell "am start -n com.freekiosk/.MainActivity --es pin 1234 --es config '{\"lock_package\":\"com.app\"}'"
```

Cùng một dòng lệnh dùng được trong bash, zsh, PowerShell và cmd.exe. Trong PowerShell, cách dễ hơn là để
JSON trong một biến đã chứa sẵn các dấu gạch chéo ngược:
`$tiles = '[{\"label\":\"A\",\"url\":\"https://a.eu\"}]'` rồi
`adb shell "am start -n com.freekiosk/.MainActivity --es dashboard_tiles '$tiles'"`.

Đã kiểm tra với Android SDK platform-tools trên Windows (Git Bash, PowerShell 5.1, cmd.exe);
Linux và macOS đi qua cùng cơ chế nhưng chưa được thử. Cũng cần chú ý dấu nháy cong
(`’` thay vì `'`) khi sao chép lệnh từ email hoặc trình soạn thảo văn bản: shell không
hiểu chúng là dấu nháy. Các giá trị đơn giản (`--es url "https://..."`) không cần bước nào trong số này.

## Bắt đầu nhanh

### Thiết lập lần đầu (thiết bị mới)



```bash
# Set Device Owner (one-time, requires no user accounts on the device)
adb shell dpm set-device-owner com.freekiosk/.DeviceAdminReceiver

# Configure and lock to external app
adb shell am start -n com.freekiosk/.MainActivity \
    --es lock_package "com.example.myapp" \
    --es pin "1234"
```



> [!NOTE]
> Việc thiết lập Device Owner được **khuyến nghị mạnh mẽ** khi khóa ứng dụng ngoài, vì nó cho phép FreeKiosk tự động quản lý mọi quyền cần thiết, kể cả "Hiển thị trên ứng dụng khác". Nếu không có Device Owner, quyền này phải được cấp thủ công trong Cài đặt.

### Cấu hình Kiosk WebView



```bash
adb shell am start -n com.freekiosk/.MainActivity \
    --es url "https://your-dashboard.com" \
    --es pin "1234"
```



> [!NOTE]
> Chế độ WebView không yêu cầu Device Owner vì không cần quyền hiển thị lớp phủ.


## Tham chiếu lệnh

### Cú pháp cơ bản



```bash
adb shell am start -n com.freekiosk/.MainActivity [OPTIONS]
```



> [!TIP]
> **Các kiểu dữ liệu dùng thay thế được cho nhau.** `--es kiosk_enabled "true"`, `--ez kiosk_enabled true` và
> `--ei return_tap_count 5` đều hoạt động; giá trị luôn được lưu dưới dạng văn bản. Trước đây
> không phải vậy: truyền khóa boolean bằng `--es` từng bị bỏ qua mà không có thông báo nào.
>
> **Khóa không nhận ra sẽ được báo.** Khóa mà FreeKiosk không nhận ra nay được nêu tên trong toast
> trên thiết bị và trong logcat (`adb logcat | grep FreeKiosk-ADB`) thay vì bị bỏ qua
> trong im lặng. Nếu một cài đặt không có tác dụng, hãy xem ở đó trước.

### Tham số bắt buộc

| Tham số | Kiểu | Mô tả |
|-----------|------|-------------|
| `--es pin "XXXX"` | String | **Luôn bắt buộc**. PIN để xác thực (PIN mới hoặc PIN hiện có) |

### Tham số khóa ứng dụng

| Tham số | Kiểu | Mô tả |
|-----------|------|-------------|
| `--es lock_package "com.app"` | String | Tên gói của ứng dụng mà thiết bị sẽ bị khóa vào |
| `--ez auto_start true` | Boolean | Tự động mở ứng dụng bị khóa sau khi cấu hình |

### Tham số đa ứng dụng

| Tham số | Kiểu | Mô tả |
|-----------|------|-------------|
| `--es external_app_mode "multi"` | String | Chế độ ứng dụng: `single` (mặc định, kiểu cổ điển) hoặc `multi` (lưới màn hình chính) |
| `--es managed_apps '[...]'` | String (JSON) | Mảng JSON chứa các ứng dụng được quản lý (xem định dạng bên dưới) |

**Định dạng JSON của ứng dụng được quản lý:**

Mỗi ứng dụng trong mảng hỗ trợ các trường sau:

| Trường | Kiểu | Mặc định | Mô tả |
|-------|------|---------|-------------|
| `packageName` | String | **bắt buộc** | Tên gói Android |
| `displayName` | String | tự động xác định | Tên hiển thị (tự động lấy từ hệ thống nếu bỏ trống) |
| `showOnHomeScreen` | Boolean | `true` | Hiển thị trong lưới màn hình chính của chế độ đa ứng dụng |
| `launchOnBoot` | Boolean | `false` | Tự động mở khi thiết bị khởi động |
| `keepAlive` | Boolean | `false` | Giám sát và khởi động lại nếu ứng dụng bị crash |
| `allowAccessibility` | Boolean | `false` | Đưa các dịch vụ trợ năng của ứng dụng vào danh sách cho phép |

> **Lưu ý**: Gói chưa được cài đặt có trong danh sách sẽ bị bỏ qua mà không báo lỗi, chỉ ghi một cảnh báo vào logcat.

### Tham số WebView

| Tham số | Kiểu | Mô tả |
|-----------|------|-------------|
| `--es url "https://..."` | String | URL hiển thị trong WebView của kiosk |

### Tham số bảng điều khiển

Bảng điều khiển là một lưới các ô, mỗi ô mở một URL riêng. Nó nằm trong chế độ hiển thị
WebView, nên `--ez dashboard_mode true` tự đặt `display_mode` thành `webview`,
trừ khi `lock_package` quy định khác.

| Tham số | Kiểu | Mô tả |
|-----------|------|-------------|
| `--ez dashboard_mode true` | Boolean | Hiển thị lưới ô thay vì một URL duy nhất |
| `--es dashboard_tiles '[...]'` | String (JSON) | Mảng JSON chứa các ô (xem định dạng bên dưới) |

**Định dạng của ô:**

| Trường | Kiểu | Mặc định | Mô tả |
|-------|------|---------|-------------|
| `url` | String | **bắt buộc** | URL mà ô mở ra. Ô không có URL sẽ bị bỏ qua |
| `label` | String | chính URL đó | Văn bản hiển thị bên dưới biểu tượng |
| `id` | String | tự tạo | Mã định danh duy nhất của ô. Để FreeKiosk tự tạo, trừ khi cập nhật một ô cụ thể |
| `iconMode` | String | `favicon` | `favicon`, `image` hoặc `letter`. Giá trị không nhận ra sẽ quay về `favicon` |
| `iconValue` | String | - | URL của ảnh, dùng khi `iconMode` là `image` |
| `order` | Number | vị trí trong danh sách | Thứ tự hiển thị trong lưới |

```bash
adb shell "am start -n com.freekiosk/.MainActivity --es pin 1234 --ez dashboard_mode true --es dashboard_tiles '[{\"label\":\"Main app\",\"url\":\"https://myapp.eu\"},{\"label\":\"Reports\",\"url\":\"https://reports.myapp.eu\"}]'"
```

Hai khóa này cũng dùng được bên trong `--es config` với tên `dashboard_mode` và `dashboard_tiles`.

### Cài đặt bổ sung

Mọi khóa bên dưới đều được chuyển thẳng (passthrough): giá trị được truyền vào sẽ được lưu nguyên như vậy.

**Điều hướng và thoát**

| Tham số | Mô tả |
|-----------|-------------|
| `--es return_mode "tap_anywhere"` | Cách vào cài đặt: `tap_anywhere` (chạm vào màn hình `return_tap_count` lần, là mặc định) hoặc `button` (nút cố định). Bất kỳ giá trị nào khác đều khiến không còn cách nào để vào |
| `--es return_button_position "top-left"` | Góc đặt nút cố định: `top-left`, `top-right`, `bottom-left`, `bottom-right` |
| `--ei return_tap_count 5` | Số lần chạm để mở cài đặt |
| `--ei return_tap_timeout 1500` | Khoảng thời gian, tính bằng mili giây, để hoàn tất **tất cả** các lần chạm, tính từ lần chạm đầu tiên (mặc định 1500). Màn hình Cài đặt chấp nhận từ 500 đến 5000; qua ADB thì giá trị nào cũng được. Hãy tăng giá trị này trước khi điều khiển cử chỉ từ script, xem [Viết script cho cử chỉ mở cài đặt](#viết-script-cho-cử-chỉ-mở-cài-đặt) |
| `--ez volume_up_5tap_enabled true` | Nhấn nút Tăng âm lượng năm lần để mở cài đặt |
| `--ez webview_back_button_enabled true` | Hiện nút Quay lại ngay trong trang ở chế độ WebView |
| `--es back_button_timer_delay "10"` | Thời gian đếm ngược, tính bằng giây, khi `back_button_mode` là `timer` |
| `--ez overlay_button_visible true` | Hiện nút quay lại nổi ở chế độ Ứng dụng ngoài |
| `--es overlay_button_position "bottom-right"` | Góc đặt nút đó |
| `--ei pin_max_attempts 5` | Số lần nhập sai PIN trước khi bị khóa |
| `--es screen_orientation "landscape"` | Hướng màn hình của FreeKiosk: `auto` (theo thiết bị), `portrait`, `landscape`, `reverse_portrait` hoặc `reverse_landscape`. Không áp dụng cho ứng dụng bên ngoài |
| `--es keyboard_mode "default"` | Bàn phím trên màn hình: `default`, `force_numeric`, `smart` hoặc `none` (không có bàn phím trên màn hình; máy quét vẫn nhập được vào các ô) |

**Khóa chặt**

| Tham số | Mô tả |
|-----------|-------------|
| `--ez allow_power_button true` | Cho phép menu nguồn trong lock task |
| `--ez allow_notifications false` | Cho phép ngăn thông báo trong lock task |
| `--ez allow_system_info false` | Cho phép thông tin hệ thống trên thanh trạng thái trong lock task |
| `--ez block_factory_reset false` | Áp dụng hạn chế `DISALLOW_FACTORY_RESET` |
| `--ez allow_hardware_screenshot true` | Cho phép chụp màn hình bằng tổ hợp Nguồn + Giảm âm lượng khi chế độ khóa đang bật (chỉ dành cho Device Owner, mặc định tắt, có hiệu lực từ lần chế độ khóa khởi động tiếp theo) |
| `--ez allow_usb_debug_dialog true` | Cho phép lời nhắc "Cho phép gỡ lỗi USB?" xuất hiện khi chế độ khóa đang bật (chỉ dành cho Device Owner, mặc định tắt, có hiệu lực từ lần chế độ khóa khởi động tiếp theo; xem [mục khắc phục sự cố](#-lời-nhắc-cho-phép-gỡ-lỗi-usb-không-xuất-hiện-trong-chế-độ-khóa)) |
| `--ez keep_screen_on true` | Giữ màn hình luôn sáng |

**Hành vi của WebView**

| Tham số | Mô tả |
|-----------|-------------|
| `--ez auto_reload true` | Tải lại trang sau khi gặp lỗi tải trang |
| `--ez hide_error_url true` | Không hiện URL trên màn hình lỗi tải trang |
| `--ez pdf_viewer_enabled true` | Mở PDF trong trình xem tích hợp sẵn. **Đây cũng là cài đặt cho phép dùng URL `file://`**: nếu không bật, WebView sẽ từ chối tải tệp cục bộ, bất kể nhãn của cài đặt ghi gì (xem [Câu hỏi thường gặp](faq.md)) |
| `--ez disable_overscroll true` | Bỏ hiệu ứng giãn đàn hồi ở đầu và cuối trang. Mặc định tắt (hành vi chuẩn của Android) |
| `--ez session_reset_button_enabled true` | Hiện một nút nhỏ ở góc dưới bên trái, dùng để xóa cookie, bộ nhớ đệm và bộ nhớ lưu trữ web sau khi xác nhận, rồi quay về URL bắt đầu. Dành cho máy tính bảng dùng chung. Mặc định tắt |
| `--es webview_zoom_level "100"` | Mức thu phóng trang, từ 50 đến 200 |
| `--es webview_zoom_mode "standard"` | `standard` (thu phóng CSS) hoặc `fit` (dàn lại bố cục) |
| `--ez disable_user_zoom false` | Chặn thu phóng bằng thao tác chụm hai ngón và chạm đúp |
| `--ez inactivity_return_enabled false` | Quay về URL bắt đầu sau một thời gian không hoạt động |
| `--es inactivity_return_delay "60"` | Khoảng thời gian đó, tính bằng giây |

**Nhiều URL**

| Tham số | Mô tả |
|-----------|-------------|
| `--ez url_rotation_enabled true` | Xoay vòng qua một danh sách URL |
| `--es url_rotation_list '["https://a","https://b"]'` | Danh sách, dưới dạng mảng JSON |
| `--es url_rotation_interval "30"` | Số giây giữa các lần chuyển, tối thiểu 5 |
| `--ez url_rotation_pause_on_touch true` | Giữ nguyên trang trong lúc có người chạm vào trang hoặc nhập liệu |
| `--es url_rotation_resume_delay "60"` | Số giây không có thao tác chạm trước khi xoay vòng tiếp tục, tối thiểu 5 |
| `--ez url_planner_enabled true` | Lập lịch URL theo ngày và giờ |
| `--es url_planner_events '[...]'` | Các sự kiện lập lịch URL, dưới dạng mảng JSON |

**Sự kiện lập lịch URL**

`url_planner_events` nhận một mảng JSON. Chức năng lập lịch chỉ chạy ở chế độ Trang web với `url_planner_enabled true`; ngoài khoảng thời gian của sự kiện, máy tính bảng hiển thị URL thông thường. Yêu cầu phiên bản 2.0.0-beta.2 trở lên: các bản dựng cũ hơn bỏ qua cả hai khóa mà không có cảnh báo.

```bash
adb shell "am start -n com.freekiosk/.MainActivity --es pin YOUR_PIN --ez url_planner_enabled true --es url_planner_events '[{\"id\":\"advert-1\",\"type\":\"oneTime\",\"name\":\"Autumn advert\",\"url\":\"https://example.com/advert.html\",\"enabled\":true,\"priority\":1,\"startDate\":\"2026-10-12\",\"endDate\":\"2026-10-25\",\"allDay\":true}]'"
```

| Trường | Mô tả |
|-------|-------------|
| `id` | Chuỗi duy nhất cho mỗi sự kiện |
| `type` | `oneTime` (theo ngày cụ thể) hoặc `recurring` (hằng tuần) |
| `name`, `url`, `enabled` | Nhãn, URL cần hiển thị, bật/tắt |
| `priority` | 1 là cao nhất, dùng khi các sự kiện chồng lên nhau; sự kiện `oneTime` được ưu tiên hơn sự kiện `recurring` có cùng mức ưu tiên |
| `startDate`, `endDate` | Chỉ dành cho `oneTime`, định dạng `YYYY-MM-DD`, theo giờ địa phương. Ngày kết thúc được tính vào |
| `allDay` | Chỉ dành cho `oneTime`. Đặt `true`, hoặc dùng `startTime` và `endTime` thay thế |
| `days` | Chỉ dành cho `recurring`, từ `0` (Chủ nhật) đến `6` (Thứ Bảy) |
| `startTime`, `endTime` | `HH:MM`, định dạng 24 giờ, theo giờ địa phương. Giờ kết thúc sớm hơn giờ bắt đầu nghĩa là chạy qua đêm |

> **Windows PowerShell:** PowerShell xóa các dấu ngoặc kép bên trong JSON, và FreeKiosk sẽ nhận được `[{id:advert-1,...}]`, là chuỗi không hợp lệ. Hãy đặt lệnh vào một tệp `.sh`, dùng `adb push` đẩy tệp đó lên `/data/local/tmp` rồi chạy bằng `adb shell sh /data/local/tmp/file.sh`, hoặc dùng `cmd.exe`/Git Bash.

**Lọc URL**

| Tham số | Mô tả |
|-----------|-------------|
| `--ez url_filter_enabled true` | Giới hạn những URL được phép tải |
| `--es url_filter_mode "blacklist"` | `blacklist` hoặc `whitelist` |
| `--es url_filter_list '[]'` | Các mẫu, dưới dạng mảng JSON |
| `--ez url_filter_show_feedback true` | Thông báo cho người dùng khi một URL bị chặn |

**Màn hình và độ sáng**

| Tham số | Mô tả |
|-----------|-------------|
| `--ez brightness_management_enabled true` | Để FreeKiosk quản lý độ sáng |
| `--es default_brightness "0.5"` | Độ sáng từ 0 đến 1 |
| `--ez auto_brightness_enabled false` | Theo cảm biến ánh sáng môi trường |
| `--ez screen_scheduler_enabled false` | Bật và tắt màn hình theo lịch |
| `--es screen_scheduler_rules '[]'` | Các quy tắc của lịch, dưới dạng mảng JSON |
| `--ez screen_scheduler_wake_on_touch true` | Chạm để đánh thức màn hình ngoài khung giờ đã lên lịch |
| `--es screensaver_delay "300"` | Thời gian không hoạt động trước khi bật bảo vệ màn hình, tính bằng giây |
| `--es screensaver_brightness "0"` | Độ sáng khi bảo vệ màn hình đang hiển thị |

**Định dạng quy tắc của lịch hẹn giờ màn hình**

`screen_scheduler_rules` nhận một mảng JSON gồm các quy tắc. Mỗi quy tắc gồm:

| Trường | Kiểu | Ý nghĩa |
|-------|------|---------|
| `id` | string | Mã định danh duy nhất bất kỳ |
| `name` | string | Hiển thị trong danh sách quy tắc của ứng dụng |
| `enabled` | boolean | Quy tắc bị tắt vẫn được giữ lại nhưng bị bỏ qua |
| `days` | number[] | `0` = Chủ nhật, `1` = Thứ Hai … `6` = Thứ Bảy |
| `sleepTime` | `"HH:MM"` | Giờ (định dạng 24 giờ) màn hình **tắt** |
| `wakeTime` | `"HH:MM"` | Giờ (định dạng 24 giờ) màn hình **bật** |

Giờ tính theo múi giờ của chính máy tính bảng.

Khi `sleepTime` **muộn hơn** `wakeTime`, khoảng thời gian tắt màn hình kéo dài qua đêm và `days` chỉ
buổi tối mà khoảng đó **bắt đầu**. Vì vậy `[1,2,3,4,5]` với `sleepTime "17:00"` và `wakeTime "07:00"`
sẽ tắt màn hình vào mỗi tối các ngày trong tuần rồi bật lại vào sáng hôm sau, và để màn hình
bật suốt cuối tuần: thứ Bảy không được liệt kê nên không có khoảng nào bắt đầu vào tối thứ Bảy, còn khoảng
bắt đầu từ thứ Sáu sẽ kết thúc vào thứ Bảy lúc 07:00. Hãy liệt kê thêm `0` và `6` để áp dụng cho mọi đêm.

Khi `sleepTime` sớm hơn `wakeTime`, khoảng thời gian đó nằm gọn trong một ngày (chẳng hạn giờ nghỉ
trưa) vào các ngày được liệt kê. Nếu hai giờ bằng nhau, hoặc có giờ không đúng định dạng `HH:MM`,
quy tắc sẽ bị bỏ qua.

```bash
adb shell "am start -n com.freekiosk/.MainActivity --es pin 1234 --ez screen_scheduler_enabled true --es screen_scheduler_rules '[{\"id\":\"office\",\"name\":\"Office hours\",\"enabled\":true,\"days\":[1,2,3,4,5],\"sleepTime\":\"17:00\",\"wakeTime\":\"07:00\"}]'"
```

Đây là định dạng mà `src/types/screenScheduler.ts` triển khai, cũng là định dạng mà trình chỉnh sửa quy tắc
của chính ứng dụng ghi ra, nên một quy tắc tạo trên máy tính bảng rồi đọc lại từ Cloud là một ví dụ hợp lệ.

**Thanh trạng thái**

| Tham số | Mô tả |
|-----------|-------------|
| `--ez status_bar_enabled true` | Hiện thanh trạng thái riêng của FreeKiosk |
| `--ez status_bar_show_battery true` | Chỉ báo pin |
| `--ez status_bar_show_wifi true` | Chỉ báo Wi-Fi |
| `--ez status_bar_show_time true` | Đồng hồ |
| `--es status_bar_theme "dark"` | Giao diện thanh trạng thái: `dark` hoặc `light` |

### Tùy chọn chế độ Kiosk

| Tham số | Kiểu | Mặc định | Mô tả |
|-----------|------|---------|-------------|
| `--ez kiosk_enabled true` | Boolean | `true` | Bật/tắt chế độ Kiosk |
| `--ez auto_start true` | Boolean | - | Tự động mở ứng dụng bị khóa sau khi cấu hình |
| `--es auto_launch "true"` | String | - | Tự động khởi chạy khi thiết bị khởi động (dùng thay cho `auto_start`) |
| `--es auto_relaunch "true"` | String | - | Tự động mở lại nếu ứng dụng bị crash/thoát. `auto_relaunch_app` cũng được chấp nhận như một tên gọi khác |
| `--es test_mode "false"` | String | `"true"` | `"false"` = production (đặt `back_button_mode` thành `immediate`). `"true"` = kiểm thử (đặt `back_button_mode` thành `test`). Là lối tắt của `back_button_mode` |
| `--es back_button_mode "immediate"` | String | `"test"` | Hành vi khi quay về FreeKiosk bằng nút Quay lại của Android: `"test"` (ở lại FreeKiosk, cho phép dùng nút Quay lại), `"timer"` (đếm ngược rồi mở lại ứng dụng), `"immediate"` (mở lại ứng dụng ngay lập tức). Nếu `test_mode` cũng được đặt, `back_button_mode` được ưu tiên |
| `--es status_bar "true"` | String | - | Hiện thanh trạng thái tùy chỉnh |

### Tùy chọn mật khẩu

| Tham số | Kiểu | Mặc định | Mô tả |
|-----------|------|---------|-------------|
| `--es pin_mode "numeric"` | String | `numeric` | Chế độ nhập PIN: `numeric` (4-6 chữ số) hoặc `alphanumeric` (chữ cái, chữ số, ký tự đặc biệt) |

### Tùy chọn REST API

| Tham số | Kiểu | Mô tả |
|-----------|------|-------------|
| `--es rest_api_enabled "true"` | String | Bật máy chủ REST API |
| `--es rest_api_port "8080"` | String | Cổng của máy chủ API |
| `--es rest_api_key "secret"` | String | Khóa xác thực API |

### Tùy chọn MQTT

| Tham số | Kiểu | Mô tả |
|-----------|------|-------------|
| `--es mqtt_enabled "true"` | String | Bật MQTT client |
| `--es mqtt_broker_url "host"` | String | Tên máy chủ hoặc IP của MQTT broker |
| `--es mqtt_port "1883"` | String | Cổng của MQTT broker |
| `--es mqtt_username "user"` | String | Tên đăng nhập xác thực MQTT |
| `--es mqtt_password "pass"` | String | Mật khẩu xác thực MQTT (được lưu an toàn trong Keychain) |
| `--es mqtt_client_id "id"` | String | Client ID của MQTT (tự động tạo nếu để trống) |
| `--es mqtt_base_topic "freekiosk"` | String | Tiền tố topic MQTT gốc |
| `--es mqtt_discovery_prefix "homeassistant"` | String | Tiền tố MQTT discovery của Home Assistant |
| `--es mqtt_status_interval "30"` | String | Chu kỳ publish trạng thái, tính bằng giây |
| `--es mqtt_allow_control "true"` | String | Cho phép điều khiển từ xa qua MQTT |
| `--es mqtt_device_name "name"` | String | Tên thiết bị thân thiện cho HA discovery |

### Tùy chọn trình phát đa phương tiện

| Tham số | Kiểu | Mô tả |
|-----------|------|-------------|
| `--ez media_player_cache true` | Boolean | Phát nội dung của Trình phát đa phương tiện từ các tệp lưu trên thiết bị (bộ nhớ đệm ngoại tuyến). Nếu không đặt, mặc định là bật trên TV và tắt ở mọi nơi khác. Chính danh sách phát không được đặt qua ADB: hãy dùng Cài đặt hoặc Cloud |
| `--ez media_player_unattended true` | Boolean | Phát không giám sát của Trình phát đa phương tiện: không hiện thông báo lỗi trên màn hình, và mục nào không tải được hoặc bị treo trong 30 giây sẽ bị bỏ qua. Nếu không đặt, mặc định là bật trên TV và tắt ở mọi nơi khác. |
| `--ei media_player_cache_limit_mb 2048` | Integer | Dung lượng lớn nhất mà bộ nhớ đệm ngoại tuyến được phép đạt tới, tính bằng megabyte (mặc định 2048). Tệp nào làm vượt giới hạn này sẽ không được tải về mà được phát từ URL của nó. Đây là giá trị riêng của từng thiết bị: không nằm trong cấu hình Cloud |

### Tùy chọn bảo vệ màn hình

| Tham số | Kiểu | Mô tả |
|-----------|------|-------------|
| `--es screensaver_enabled "true"` | String | Bật bảo vệ màn hình khi không hoạt động |

### Đăng ký thiết bị với Cloud

| Tham số | Kiểu | Mô tả |
|-----------|------|-------------|
| `--es cloud_token "TOKEN"` | String | Mã token đăng ký dùng một lần, lấy từ trang *Thêm thiết bị* của FreeKiosk Cloud. Máy tính bảng tự đăng ký khi ứng dụng đang chạy |
| `--es cloud_url "https://..."` | String | Địa chỉ máy chủ quản lý. Không bắt buộc: mặc định là `https://mdm.ism.io.vn` (`DEFAULT_CLOUD_URL` trong `MainActivity.kt`), chỉ cần khi dùng máy chủ khác |

```bash
adb shell am start -n com.freekiosk/.MainActivity --es pin "1234" --es cloud_token "TOKEN"
```

Mã token không bao giờ được ghi vào logcat. Việc đăng ký chạy vào lần khởi động ứng dụng tiếp theo, và
chỉ trên máy tính bảng chưa được đăng ký: nếu gửi tới máy đã đăng ký, mã token sẽ được đưa vào hàng đợi
rồi bị bỏ qua (hãy hủy đăng ký trước trong Cài đặt, Nâng cao, Cloud). Nếu máy tính bảng chưa kết nối được
tới Cloud, nó thử lại sau mỗi 30 giây; mã token bị từ chối (hết hạn, đã được dùng, đã đạt giới hạn thiết bị)
được báo trên màn hình chào mừng.

### Viết script cho cử chỉ mở cài đặt

Để mở cài đặt cần `return_tap_count` lần chạm (mặc định 5) vào cùng một vị trí, tất cả hoàn tất
trong `return_tap_timeout` (mặc định 1500 ms). Khoảng thời gian này bắt đầu từ lần chạm **đầu tiên**,
không phải độ trễ giữa hai lần chạm. Script chạm bằng `adb shell input tap` phải xếp vừa mọi lệnh gọi
vào khoảng thời gian đó. Trên trình giả lập qua USB, mỗi lệnh gọi mất khoảng 0.12 s nên giá trị mặc định
là đủ; qua adb không dây hoặc từ máy tính chậm, một lệnh gọi có thể mất một giây trở lên (người báo cáo
trong [#250](https://github.com/RushB-fr/freekiosk/issues/250) đo được khoảng một giây), và bộ đếm bị đặt lại
trước lần chạm thứ năm. Hãy tăng khoảng thời gian này trước, rồi mới chạm:

```bash
adb shell am start -n com.freekiosk/.MainActivity --es pin "1234" --ei return_tap_timeout 15000
for i in 1 2 3 4 5; do adb shell input tap 540 960; done
```

Các lần chạm phải nằm trong phạm vi 80 px so với lần chạm đầu tiên, nên hãy dùng cùng một tọa độ cho tất cả.
Màn hình Cài đặt chỉ chấp nhận từ 500 đến 5000 và tự đưa về khoảng đó khi lưu, nên một
giá trị lớn hơn được đặt qua ADB chỉ tồn tại cho đến khi có người lưu cài đặt thủ công. Hãy đặt lại về `1500`
sau đó nếu máy tính bảng sẽ được dùng ở nơi công cộng. Yêu cầu phiên bản 2.0.0-beta.2 trở lên: từ
1.2.19 đến 2.0.0-beta.1, mọi khóa `return_*` đều bị bỏ qua mà không có thông báo, đó là lý do việc chỉnh sửa
thủ công cài đặt đã lưu từng có vẻ là cách duy nhất.


## Chờ cấu hình hoàn tất

Lệnh ADB trả về ngay lập tức, nhưng FreeKiosk cần thời gian để lưu cài đặt và khởi động lại. **Hãy dùng broadcast receiver để chờ hoàn tất**:

### Ví dụ TypeScript/JavaScript



```typescript
private async setupKioskModeUsingFreeKiosk(packageName: string): Promise<void> {
  console.log(`Setting up kiosk mode for ${packageName}...`);

  // Start listening for EXTERNAL_APP_LAUNCHED broadcast
  const appLaunchMonitor = this.execAsync(
    `adb -s ${this.adbTarget} logcat -c && adb -s ${this.adbTarget} logcat -s "FreeKiosk-ADB" | grep -m 1 "EXTERNAL_APP_LAUNCHED: ${packageName}"`
  );

  // Send configuration command with auto_start
  const kioskCmd = `adb -s ${this.adbTarget} shell am start -n com.freekiosk/.MainActivity --es lock_package "${packageName}" --es pin "${PIN}" --ez auto_start true`;
  await this.execAsync(kioskCmd);

  // Wait for external app to be launched and visible (timeout after 30s)
  console.log("Waiting for app to launch...");
  await Promise.race([
    appLaunchMonitor,
    new Promise((_, reject) => 
      setTimeout(() => reject(new Error('App launch timeout after 30s')), 30000)
    )
  ]);

  console.log(`✅ ${packageName} is now running and ready!`);
  // Start sending video/content here
}
```



### Ví dụ script Bash



```bash
#!/bin/bash
PACKAGE="com.example.app"
PIN="1234"

# Monitor logcat for completion marker in background
adb logcat -c
adb logcat -s "FreeKiosk-ADB" | grep -m 1 "SETTINGS_LOADED" &
LOGCAT_PID=$!

# Send configuration
adb shell am start -n com.freekiosk/.MainActivity \
    --es lock_package "$PACKAGE" \
    --es pin "$PIN" \
    --ez auto_start true

# Wait for completion (with 30s timeout)
timeout 30 wait $LOGCAT_PID

echo "Configuration complete!"
```



### Sự kiện broadcast

FreeKiosk phát các broadcast sau trong quá trình cấu hình qua ADB:

| Broadcast action | Khi nào | Mô tả |
|-----------------|------|-------------|
| `com.freekiosk.ADB_CONFIG_SAVED` | Ngay sau khi lưu cấu hình | Đã ghi xong vào cơ sở dữ liệu, sắp khởi động lại |
| `com.freekiosk.ADB_CONFIG_RESTARTING` | Ngay trước khi khởi động lại | Tiến trình sẽ bị dừng sau 500ms |
| `com.freekiosk.SETTINGS_LOADED` | Sau khi khởi động lại xong | Ứng dụng đã khởi động lại và tải cài đặt thành công |
| `com.freekiosk.EXTERNAL_APP_LAUNCHED` | Sau khi mở ứng dụng ngoài (auto_start=true) | Ứng dụng ngoài đã được mở và hiển thị (kèm extra package_name) |

**Với chế độ WebView**: Chờ `SETTINGS_LOADED`  
**Với chế độ Ứng dụng ngoài có auto_start**: Chờ `EXTERNAL_APP_LAUNCHED` để biết khi nào ứng dụng sẵn sàng nhận nội dung

### Chờ ứng dụng ngoài khởi chạy



```bash
#!/bin/bash
PACKAGE="com.example.app"
PIN="1234"

# Monitor for external app launch
adb logcat -c
adb logcat -s "FreeKiosk-ADB" | grep -m 1 "EXTERNAL_APP_LAUNCHED: $PACKAGE" &
LOGCAT_PID=$!

# Configure and auto-launch
adb shell am start -n com.freekiosk/.MainActivity \
    --es lock_package "$PACKAGE" \
    --es pin "$PIN" \
    --ez auto_start true

# Wait for app to be visible (with 30s timeout)
timeout 30 wait $LOGCAT_PID

echo "✅ $PACKAGE is now running and ready!"
# Start sending video/content here
```




## Ví dụ

### 1. Kiosk cloud gaming

Khóa thiết bị vào một ứng dụng phát game trực tuyến, có tự động mở lại (chế độ production):



```bash
adb shell am start -n com.freekiosk/.MainActivity \
    --es lock_package "com.valvesoftware.steamlink" \
    --es pin "1234" \
    --es auto_relaunch "true" \
    --es test_mode "false" \
    --ez auto_start true
```



> [!NOTE]
> `test_mode "false"` đặt `back_button_mode` thành `immediate`, nghĩa là nút Quay lại của Android sẽ mở lại ứng dụng ngay lập tức. Hãy bỏ qua tham số này hoặc đặt thành `"true"` khi kiểm thử để nút Quay lại đưa về FreeKiosk mà không tự động mở lại ứng dụng.

### 🏨 2. Máy tính bảng trong phòng khách sạn

Hiển thị bảng điều khiển khách sạn, bật REST API cho Home Assistant:



```bash
adb shell am start -n com.freekiosk/.MainActivity \
    --es url "https://hotel.local/dashboard" \
    --es pin "5678" \
    --es rest_api_enabled "true" \
    --es rest_api_port "8080" \
    --es rest_api_key "hotel_secret_key" \
    --es screensaver_enabled "true"
```



### 🍽️ 3. Màn hình thực đơn nhà hàng

Kiosk URL đơn giản:



```bash
adb shell am start -n com.freekiosk/.MainActivity \
    --es url "https://menu.restaurant.com" \
    --es pin "0000" \
    --es status_bar "false"
```

### 4. Kiosk đa ứng dụng

Cấu hình lưới màn hình chính với nhiều ứng dụng:

```bash
adb shell "am start -n com.freekiosk/.MainActivity \
    --es external_app_mode multi \
    --es managed_apps '[{\"packageName\":\"com.spotify.music\"},{\"packageName\":\"com.netflix.mediaclient\"},{\"packageName\":\"com.youtube\",\"launchOnBoot\":true,\"keepAlive\":true}]' \
    --es pin 1234 \
    --es test_mode false"
```

> **Mẹo**: Tên hiển thị được tự động lấy từ hệ thống. Có thể ghi đè chúng:
> ```bash
> --es managed_apps '[{\"packageName\":\"com.app\",\"displayName\":\"My Custom Name\"}]'
> ```

### 5. Cấu hình JSON đầy đủ

Với các thiết lập phức tạp, hãy dùng cấu hình JSON. Lưu ý rằng việc escape trong shell có thể rắc rối - dùng từng tham số riêng lẻ thường dễ hơn:



```bash
# JSON goes in single quotes inside the double-quoted command (see "Quoting JSON values")
adb shell "am start -n com.freekiosk/.MainActivity \
    --es pin 1234 \
    --es config '{\"lock_package\":\"com.app\",\"auto_relaunch\":\"true\"}'"

# Or use individual parameters (recommended for shell scripts)
adb shell am start -n com.freekiosk/.MainActivity \
    --es lock_package "com.app" \
    --es auto_relaunch "true" \
    --es status_bar "true" \
    --es rest_api_enabled "true" \
    --es rest_api_port "8080" \
    --es pin "1234"
```

### 6. Sửa cấu hình hiện có

Đổi ứng dụng bị khóa trên thiết bị đã được cấu hình:



```bash
# Must use the existing PIN
adb shell am start -n com.freekiosk/.MainActivity \
    --es lock_package "com.newapp.package" \
    --es pin "1234"
```




## Định dạng cấu hình JSON

Khi dùng `--es config '{...}'`, các khóa sau được hỗ trợ:



```json
{
  "url": "https://example.com",
  "lock_package": "com.example.app",
  "display_mode": "external_app",
  "external_app_mode": "multi",
  "managed_apps": [
    {"packageName": "com.app1", "showOnHomeScreen": true},
    {"packageName": "com.app2", "launchOnBoot": true, "keepAlive": true}
  ],
  "kiosk_enabled": "true",
  "auto_launch": "true",
  "auto_relaunch": "true",
  "screensaver_enabled": "true",
  "screensaver_delay": "300000",
  "screensaver_brightness": "10",
  "status_bar_enabled": "true",
  "status_bar_show_battery": "true",
  "status_bar_show_wifi": "true",
  "status_bar_show_time": "true",
  "rest_api_enabled": "true",
  "rest_api_port": "8080",
  "rest_api_key": "your_api_key",
  "allow_power_button": "false",
  "back_button_mode": "immediate",
  "test_mode": "false",
  "default_brightness": "75",
  "brightness_management_enabled": "true",
  "mqtt_enabled": "true",
  "mqtt_broker_url": "broker.local",
  "mqtt_port": "1883",
  "mqtt_username": "user",
  "mqtt_password": "password",
  "mqtt_client_id": "tablet1",
  "mqtt_base_topic": "freekiosk",
  "mqtt_discovery_prefix": "homeassistant",
  "mqtt_status_interval": "30",
  "mqtt_allow_control": "true",
  "mqtt_device_name": "Kitchen Tablet"
}
```




## Script cấp phát thiết bị hoàn chỉnh

Dưới đây là một script bash hoàn chỉnh để cấp phát một thiết bị mới:



```bash
#!/bin/bash
# provision_kiosk.sh - Provision a FreeKiosk device

PACKAGE="com.cloudgaming.app"
PIN="1234"
API_KEY="my_secret_key"

echo "Setting Device Owner..."
adb shell dpm set-device-owner com.freekiosk/.DeviceAdminReceiver

echo "Waiting for device..."
sleep 2

echo "Granting Usage Stats permission (required for foreground monitoring)..."
adb shell appops set com.freekiosk android:get_usage_stats allow

echo "Granting WRITE_SECURE_SETTINGS (required for auto-enabling accessibility service)..."
adb shell pm grant com.freekiosk android.permission.WRITE_SECURE_SETTINGS

echo "Configuring FreeKiosk..."
adb shell am start -n com.freekiosk/.MainActivity \
    --es lock_package "$PACKAGE" \
    --es pin "$PIN" \
    --es auto_relaunch "true" \
    --es test_mode "false" \
    --es rest_api_enabled "true" \
    --es rest_api_port "8080" \
    --es rest_api_key "$API_KEY" \
    --ez auto_start true

echo "✅ Device provisioned!"
echo "   Locked to: $PACKAGE"
echo "   REST API: http://<device-ip>:8080"
```




## 💻 Script PowerShell (Windows)



```powershell
# provision_kiosk.ps1 - Provision a FreeKiosk device (Windows)

$Package = "com.cloudgaming.app"
$Pin = "1234"
$ApiKey = "my_secret_key"

Write-Host "Setting Device Owner..."
adb shell dpm set-device-owner com.freekiosk/.DeviceAdminReceiver

Start-Sleep -Seconds 2

Write-Host "Granting Usage Stats permission..."
adb shell appops set com.freekiosk android:get_usage_stats allow

Write-Host "Granting WRITE_SECURE_SETTINGS..."
adb shell pm grant com.freekiosk android.permission.WRITE_SECURE_SETTINGS

Write-Host "Configuring FreeKiosk..."
# Note: JSON escaping in PowerShell is complex, use individual parameters
adb shell am start -n com.freekiosk/.MainActivity `
    --es lock_package $Package `
    --es auto_relaunch "true" `
    --es test_mode "false" `
    --es rest_api_enabled "true" `
    --es rest_api_port "8080" `
    --es rest_api_key $ApiKey `
    --es pin $Pin `
    --ez auto_start true

Write-Host "✅ Device provisioned!"
```




## Khắc phục sự cố

### Lỗi: "Can't set package ... as device owner"

```
java.lang.RuntimeException: Can't set package ComponentInfo{com.freekiosk/com.freekiosk.DeviceAdminReceiver} as device owner.
        at com.android.commands.dpm.Dpm.runSetDeviceOwner(Dpm.java:177)
```

`dpm` báo mọi lỗi cấp phát bằng cùng một thông báo này, nên không bao giờ cho biết
điều kiện tiên quyết nào đã thất bại. Hãy chạy script chẩn đoán thay thế — script kiểm tra riêng
từng điều kiện và chỉ ra nguyên nhân gây lỗi:

```powershell
# Windows
.\scripts\set-device-owner.ps1
```

Các điều kiện tiên quyết mà script kiểm tra, và cách xử lý từng điều kiện:

| Nguyên nhân gây lỗi | Cách khắc phục |
| --- | --- |
| FreeKiosk chưa được cài đặt | `adb install app-release.apk` |
| Đã có một Device Owner được thiết lập | Khôi phục cài đặt gốc. `-Remove` / `dpm remove-active-admin` chỉ hoạt động nếu APK được build với `android:testOnly="true"` |
| Có người dùng phụ | `adb shell pm remove-user <id>` |
| Có bất kỳ tài khoản nào trên thiết bị | Xóa mọi tài khoản trong Cài đặt → Tài khoản, rồi thử lại |
| Thiếu `android.software.device_admin` | Xem bên dưới — ROM không hỗ trợ chính sách thiết bị |

> [!WARNING]
> `adb shell dpm set-active-admin` vẫn in ra `Success:` ngay cả khi không làm gì —
> công cụ này không bao giờ kiểm tra giá trị trả về. Hãy xác nhận bằng
> `adb shell dumpsys device_policy`, lệnh này chỉ liệt kê admin nếu nó thực sự
> đã được đăng ký.

#### ROM không khai báo `android.software.device_admin`

Nhiều Android TV box giá rẻ (MXQ, X96, H96 và các loại tương tự) được xuất xưởng với bản dựng AOSP TV đã
bị cắt bỏ tính năng device admin. Kiểm tra bằng:

```bash
adb shell pm list features | grep device_admin
```

Nếu lệnh trên không in ra gì, `DevicePolicyManagerService` đang chạy với
`mHasFeature = false`: `setDeviceOwner()` luôn trả về `false` và
`setActiveAdmin()` không làm gì cả. **Không có thay đổi nào ở FreeKiosk có thể khắc phục điều này** —
tính năng này phải được khai báo trong system image.

Trên bản dựng `userdebug` hoặc `eng` cho phép `adb root` (kiểm tra bằng
`adb shell getprop ro.build.type`), script có thể khai báo giúp:

```powershell
.\scripts\set-device-owner.ps1 -Fix    # writes to /system, then REBOOTS the device
```

Các bước thủ công tương đương:

```bash
adb root && adb remount
adb shell 'cat > /system/etc/permissions/android.software.device_admin.xml <<EOF
<permissions>
    <feature name="android.software.device_admin" />
</permissions>
EOF'
adb shell chmod 644 /system/etc/permissions/android.software.device_admin.xml
adb shell restorecon /system/etc/permissions/android.software.device_admin.xml
adb reboot                       # the feature list is only parsed at boot
adb shell dpm set-device-owner com.freekiosk/.DeviceAdminReceiver
```

Ghi chú:

- Thay đổi này vẫn còn sau khi khởi động lại, nhưng **không** còn sau khi khôi phục cài đặt gốc hoặc bản cập nhật OTA
  ghi đè `/system`. Hãy áp dụng lại sau cả hai trường hợp.
- Trên bản dựng `user` không có `adb root`, không thể sửa `/system`. Box như vậy
  không thể cấp phát làm Device Owner nếu không flash lại ROM, nên hãy chạy FreeKiosk
  ở chế độ không có Device Owner (cấp quyền "Hiển thị trên ứng dụng khác" và
  "Quyền truy cập dữ liệu sử dụng" thủ công — xem các mục bên dưới).
- `android.software.managed_users` thường cũng thiếu trên chính các ROM này. Device
  Owner và lock task không cần nó; còn hồ sơ công việc và người dùng phụ thì cần.

### FreeKiosk không khởi chạy sau khi khởi động lại

Trước tiên hãy xác nhận rằng chính quy trình khởi động bị hỏng, chứ không phải ứng dụng:

```bash
adb logcat -d | grep -E 'Start proc .*freekiosk|E/BootReceiver'
```

`BootReceiver` ghi một lỗi về `WRITE_SECURE_SETTINGS` ở mỗi lần xử lý `BOOT_COMPLETED`
(bản thân lỗi này vô hại). **Nếu dòng đó không xuất hiện sau khi khởi động lại, nghĩa là receiver chưa
bao giờ nhận được `BOOT_COMPLETED`** — ROM đã bỏ mất broadcast, và không có cài đặt nào của FreeKiosk
khắc phục được. Hãy kiểm tra receiver vẫn hoạt động bằng cách gửi thủ công một
broadcast tương đương:

```bash
adb root
adb shell am broadcast -a android.intent.action.QUICKBOOT_POWERON -n com.freekiosk/.BootReceiver
# FreeKiosk should appear ~4 s later
```

> [!NOTE]
> `am broadcast -a android.intent.action.BOOT_COMPLETED` bị bỏ qua trong im lặng, kể cả khi chạy bằng
> root — đây là broadcast được bảo vệ. Lệnh in ra `Broadcast completed: result=0` và
> không khởi chạy gì cả, trông giống lỗi của FreeKiosk nhưng thực ra không phải. Hãy dùng
> `QUICKBOOT_POWERON`, mà `BootReceiver` cũng xử lý.

Đã ghi nhận hai hành vi của ROM làm hỏng việc khởi chạy khi khởi động, đều trên Android TV box
(Droidlogic/MXQ, Android 9):

1. **`BOOT_COMPLETED` không bao giờ được gửi tới các receiver của bên thứ ba khai báo trong manifest**, nên
   "Khởi chạy khi khởi động máy" không bao giờ kích hoạt.
2. **Intent Home được phân giải khi user 0 vẫn đang bị khóa.** `MainActivity` không phải
   `directBootAware`, nên bị loại khỏi truy vấn đó và launcher của OEM giành được
   Home — chính sách launcher mặc định của Device Owner được đăng ký đúng nhưng không bao giờ
   được tham chiếu. Android không phân giải lại Home sau khi mở khóa, nên launcher của OEM
   giữ màn hình trong suốt phần còn lại của phiên. Dùng `pm disable-user` với launcher của OEM
   cũng không giúp được gì: ROM bật lại nó khi khởi động.

Xác nhận trường hợp (2) bằng:

```bash
adb shell pm resolve-activity -a android.intent.action.MAIN -c android.intent.category.HOME
```

Nếu lệnh trên trả về `com.freekiosk.MainActivity` trong khi launcher của OEM vẫn nằm trên
màn hình sau khi khởi động lại, nghĩa là intent Home đã được phân giải trước khi FreeKiosk đủ điều kiện.

**Cách xử lý tạm** (cần ROM `userdebug`/`eng` cho phép `adb root`):

```powershell
.\scripts\install-boot-autostart.ps1     # installs, reboots, verifies
```

Script này cài `/system/bin/freekiosk-autostart.sh` và một tệp init `.rc` chạy nó khi
`sys.boot_completed=1`; script chờ user 0 được mở khóa, rồi khởi chạy
`MainActivity`, thử lại tối đa ba lần. Đã kiểm chứng qua ba lần khởi động lại liên tiếp trên
box MXQ. Hoàn tác bằng `.\scripts\install-boot-autostart.ps1 -Uninstall` rồi khởi động lại.

Giống bản vá `device_admin` ở trên, thay đổi này nằm trong `/system` và không còn sau khi
khôi phục cài đặt gốc hoặc bản cập nhật OTA ghi đè `/system`.

### Lỗi: "PIN required for first setup"

**Nguyên nhân**: Thiết bị chưa được cấu hình PIN nhưng lệnh không cung cấp PIN.

**Giải pháp**: Thêm `--es pin "XXXX"` vào lệnh.

### Lỗi: "PIN required" / "Invalid PIN"

**Nguyên nhân**: Thiết bị đã được cấu hình, PIN sai hoặc bị thiếu.

**Giải pháp**: Dùng PIN hiện có đã được cấu hình trên thiết bị.

### Lỗi: "Package not found"

**Nguyên nhân**: Ứng dụng `lock_package` chưa được cài đặt trên thiết bị.

**Giải pháp**: Cài đặt ứng dụng đích trước:
```bash
adb install myapp.apk
```

### Ứng dụng ngoài không nằm trên cùng / biến mất

**Nguyên nhân**: FreeKiosk cần quyền "Hiển thị trên ứng dụng khác" (SYSTEM_ALERT_WINDOW) để giữ ứng dụng ngoài ở trạng thái bị khóa.

**Giải pháp**:

**Cách 1: Thiết lập Device Owner (khuyến nghị cho kiosk)**
```bash
adb shell dpm set-device-owner com.freekiosk/.DeviceAdminReceiver
```
Với Device Owner, FreeKiosk có thể tự cấp cho mình mọi quyền cần thiết, kể cả "Xuất hiện trên cùng" và "Quyền truy cập dữ liệu sử dụng".

**Cách 2: Cấp quyền thủ công (không có Device Owner)**
1. Vào Cài đặt → Ứng dụng → FreeKiosk → Hiển thị trên ứng dụng khác
2. Bật quyền này thủ công

### EXTERNAL_APP_LAUNCHED không xuất hiện trong logcat

**Nguyên nhân**: Khi không có Device Owner, "Quyền truy cập dữ liệu sử dụng" (PACKAGE_USAGE_STATS) phải được cấp thủ công để FreeKiosk xác minh ứng dụng ngoài đang ở tiền cảnh.

**Giải pháp**: Cấp quyền này qua ADB:
```bash
adb shell appops set com.freekiosk android:get_usage_stats allow
```
Nếu không có quyền này, broadcast vẫn được phát nhưng kèm `(NOT verified)` thay vì `(verified in foreground)`. Tag logcat là `FreeKiosk-ADB`:
```bash
adb logcat -s "FreeKiosk-ADB"
```

> [!NOTE]
> Chỉ có thể thiết lập Device Owner khi **không có tài khoản người dùng nào** đang hoạt động trên thiết bị (Cài đặt → Tài khoản). Hãy xóa hết tài khoản trước, rồi chạy lệnh. Sau đó có thể đăng nhập lại. Nếu chỉ xóa tài khoản mà vẫn không được, khôi phục cài đặt gốc là phương án dự phòng đáng tin cậy. Sau khi thiết lập xong, mọi quyền được quản lý tự động.

### ♿ Dịch vụ trợ năng: "Permission denial: WRITE_SECURE_SETTINGS"

**Nguyên nhân**: Cần có quyền `WRITE_SECURE_SETTINGS` để bật dịch vụ trợ năng bằng chương trình. Chỉ riêng việc là Device Owner thì **không** tự động cấp quyền này.

**Giải pháp**: Cấp quyền qua ADB (chỉ cần làm một lần):
```bash
adb shell pm grant com.freekiosk android.permission.WRITE_SECURE_SETTINGS
```
Sau khi cấp quyền, chạm "Tự động bật (Device Owner)" trong Cài đặt → Nâng cao → Dịch vụ trợ năng. Quyền này được giữ nguyên sau khi khởi động lại.

Hoặc có thể bật dịch vụ trợ năng thủ công: Cài đặt → Trợ năng → Dịch vụ đã cài đặt → FreeKiosk.

### ❓ Không có gì xảy ra

**Nguyên nhân**: Gỡ lỗi ADB có thể đang bị tắt, hoặc thiết bị chưa được cấp phép.

**Giải pháp**:
1. Bật Gỡ lỗi USB trong Tùy chọn nhà phát triển
2. Chấp nhận lời nhắc "Cho phép gỡ lỗi USB" trên thiết bị
3. Kiểm tra bằng `adb devices`

### 🔒 Lời nhắc "Cho phép gỡ lỗi USB" không xuất hiện trong chế độ khóa

**Triệu chứng**: một máy tính chưa từng được cấp phép hiển thị là `unauthorized` trong `adb devices`, và lời nhắc không bao giờ hiện trên máy tính bảng khi chế độ khóa đang bật.

**Nguyên nhân**: lời nhắc là một màn hình của giao diện hệ thống (SystemUI), và chế độ khóa chỉ cho phép các ứng dụng nằm trong danh sách cho phép lên tiền cảnh. Đã kiểm tra trên trình giả lập Android 15: khi tắt cài đặt, hệ thống từ chối (`Attempted Lock Task Mode violation`); khi bật, một màn hình SystemUI mở ra phía trên chế độ khóa.

**Giải pháp**:
1. Cấp phép cho máy tính trước khi bật chế độ khóa. Việc cấp phép được ghi nhớ.
2. Với máy tính mới về sau, hãy tắt chế độ khóa trong cài đặt (chạm 5 lần, nhập PIN), cắm máy tính vào, chạm Cho phép, rồi bật lại chế độ khóa.
3. Hoặc bật **Cài đặt > Bảo mật > Cho phép hiển thị lời nhắc gỡ lỗi USB trong chế độ khóa** (`--ez allow_usb_debug_dialog true`). Chỉ dành cho Device Owner, mặc định tắt, và có hiệu lực từ lần chế độ khóa khởi động tiếp theo. **Khi tùy chọn này đang bật, bất kỳ ai cắm được máy tính vào máy tính bảng đều thấy lời nhắc và chạm được Cho phép**, từ đó cấp cho máy tính đó quyền truy cập ADB, và các màn hình khác của giao diện hệ thống cũng không còn bị chặn nữa. Hãy tắt tùy chọn này khi đã xong.

Không thể kích hoạt lời nhắc thật trên trình giả lập (trình giả lập không bắt buộc cấp phép ADB), và mới chỉ kiểm tra Android gốc (`com.android.systemui`): trên Android của nhà sản xuất, lời nhắc có thể thuộc một gói khác.

### 🔄 Cách đặt lại và cấp phát lại thiết bị

```bash
# Option 1: Factory reset (loses all data)
adb shell am broadcast -a android.intent.action.MASTER_CLEAR

# Option 2: Remove Device Owner + clear FreeKiosk data
adb shell dpm remove-active-admin com.freekiosk/.DeviceAdminReceiver
adb shell pm clear com.freekiosk
```


## Lưu ý về bảo mật



| Rủi ro | Biện pháp giảm thiểu |
|---|---|
| **Truy cập ADB = toàn quyền kiểm soát** | Bất kỳ ai có quyền truy cập ADB vào một thiết bị đang mở khóa đều có khả năng cấu hình lại thiết bị đó. Hãy tắt gỡ lỗi USB trong môi trường production. |
| **Lưu trữ PIN** | PIN ADB được lưu vào Android Keystore thông qua `react-native-keychain` với băm PBKDF2 (cùng kho lưu trữ an toàn với PIN trên giao diện). Phía native cũng giữ một mã băm SHA-256 để xác thực lại qua ADB. |
| **ADB qua mạng** | Nếu dùng `adb tcpip`, hãy bảo đảm an ninh mạng phù hợp, vì bất kỳ ai trong mạng đều có khả năng truy cập ADB. |
| **Lưu trữ cấu hình** | Cấu hình ADB trước tiên được lưu vào SharedPreferences dưới dạng "pending config", sau đó React Native áp dụng vào AsyncStorage ở lần khởi động kế tiếp. Cầu nối hai bước này bảo đảm dữ liệu được lưu bền vững qua các lần khởi động lại tiến trình (~500ms). |



### Khuyến nghị:
- Dùng PIN mạnh (từ 6 chữ số trở lên)
- Tắt gỡ lỗi USB sau khi thiết lập trong môi trường production
- Dùng chế độ Device Owner để khóa chặt kiosk hoàn toàn
- Cân nhắc bảo mật vật lý cho cổng USB


## Xem thêm



- [Tài liệu REST API](rest-api.md) - Điều khiển từ xa qua HTTP
- [Hướng dẫn cài đặt](installation.md) - Hướng dẫn thiết lập thủ công








