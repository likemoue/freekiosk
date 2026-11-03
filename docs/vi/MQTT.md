

# Tài liệu MQTT của FreeKiosk

**Telemetry thời gian thực, topic lệnh và tự động phát hiện thiết bị trong Home Assistant**

<p>
  <a href="README.md">Trang chủ tài liệu</a> •
  <a href="INTEGRATIONS.md">Tích hợp</a> •
  <a href="rest-api.md">REST API</a>
</p>

## Mục lục

- [Tổng quan](#tổng-quan)
- [Cấu hình](#cấu-hình)
- [Bắt đầu](#bắt-đầu)
- [Tính năng](#tính-năng)
- [Khắc phục sự cố](#khắc-phục-sự-cố)
- [Tài nguyên liên quan](#tài-nguyên-liên-quan)




FreeKiosk tích hợp sẵn một MQTT client native để kết nối thời gian thực với **Home Assistant** và các nền tảng dùng MQTT khác.

## Tổng quan



| Tính năng | Chi tiết |
|---|---|
| **Giao thức** | MQTT v5 / v3.1.1 (HiveMQ Client) |
| **Cổng mặc định** | 1883 |
| **Discovery** | Home Assistant MQTT Discovery (tự động tạo thiết bị + thực thể) |
| **Dựa trên push** | Cập nhật trạng thái theo thời gian thực (không cần polling) |
| **LWT** | Theo dõi khả dụng qua Last Will and Testament |



> [!TIP]
> **MQTT so với REST API**: MQTT hoạt động theo cơ chế push: máy tính bảng tự động publish cập nhật trạng thái mỗi N giây. REST API cần polling. MQTT là cách tích hợp được ưu tiên cho Home Assistant. Cả hai có thể chạy đồng thời.

## Bật MQTT

### Qua giao diện



| Bước | Hành động |
|---|---|
| **1** | Chạm 5 lần + nhập PIN để vào cài đặt FreeKiosk |
| **2** | Chuyển sang tab **Nâng cao** |
| **3️⃣ Mục MQTT** | Cuộn tới mục **MQTT** |
| **4️⃣ Bật MQTT** | Bật công tắc **MQTT** |
| **5️⃣ Cấu hình broker** | Nhập URL broker (VD: `192.168.1.100`) |
| **6️⃣ Đặt thông tin đăng nhập** | Cấu hình cổng, tên đăng nhập, mật khẩu |
| **7️⃣ Kết nối** | Nhấn nút **Kết nối** |
| **8️⃣ Kiểm tra trạng thái** | Kiểm tra chỉ báo kết nối cho thấy Đã kết nối |



> [!NOTE]
> Cài đặt được lưu tự động khi nhập. Kết nối chỉ được thiết lập khi nhấn "Kết nối" — không tự động kết nối lại sau mỗi lần gõ phím.

### Qua sao lưu/khôi phục

Cài đặt MQTT được đưa vào bản sao lưu/khôi phục của FreeKiosk. Có thể cấu hình một thiết bị rồi xuất cấu hình sang các thiết bị khác.


## Tùy chọn cấu hình



| Cài đặt | Mặc định | Mô tả |
|---|---|---|
| **Bật MQTT** | Tắt | Công tắc chính của MQTT client |
| **URL của broker** | *(trống)* | Tên máy chủ hoặc địa chỉ IP của MQTT broker (bắt buộc) |
| **Cổng** | 1883 | Cổng của MQTT broker (1-65535) |
| **Tên đăng nhập** | *(trống)* | Tên đăng nhập MQTT (tùy chọn) |
| **Mật khẩu** | *(trống)* | Mật khẩu MQTT (lưu trong Android Keychain, tùy chọn) |
| **Client ID** | *(tự động)* | Client ID của MQTT (tự tạo dạng `freekiosk_{deviceId}` nếu để trống) |
| **Tên thiết bị** | *(trống)* | Tên dễ nhớ dùng trong topic MQTT và tên thiết bị trên HA (VD: "lobby", "entrance"). Nếu để trống, dùng Android ID. |
| **Topic gốc** | `freekiosk` | Tiền tố topic MQTT gốc của thiết bị này |
| **Tiền tố Discovery** | `homeassistant` | Tiền tố MQTT discovery của Home Assistant |
| **Chu kỳ gửi trạng thái** | 30 | Tần suất gửi trạng thái (5-3600 giây) |
| **Cho phép điều khiển từ xa** | Bật | Cho phép nhận lệnh qua MQTT (độ sáng, tải lại, v.v.) |
| **Luôn bật phát hiện chuyển động** | Tắt | Chạy phát hiện chuyển động bằng camera liên tục (tốn pin hơn) |




## Cấu trúc topic

Với thiết bị có `deviceName = lobby` (hoặc `deviceId` nếu chưa đặt tên) và topic gốc mặc định `freekiosk`:



| Mục đích | Topic | QoS | Retained |
|---|---|---|---|
| **Khả dụng (LWT)** | `freekiosk/lobby/availability` | 1 | Có |
| **Trạng thái (toàn bộ dữ liệu)** | `freekiosk/lobby/state` | 0 | Có |
| **Lệnh** | `freekiosk/lobby/set/{entity}` | 1 | Không |
| **Ảnh chụp màn hình (JPEG)** | `freekiosk/lobby/image/screenshot` | 0 | Có |
| **Camera (JPEG)** | `freekiosk/lobby/image/camera_front` `freekiosk/lobby/image/camera_back` | 0 | Có |
| **Discovery** | `homeassistant/{component}/freekiosk_{deviceId}/{objectId}/config` | 1 | Có |



### Topic ID

Định danh topic là **Tên thiết bị** đã cấu hình (sau khi chuẩn hóa: chuyển thành chữ thường, thay dấu cách bằng dấu gạch dưới) hoặc `ANDROID_ID` nếu chưa đặt tên. Nhờ vậy topic dễ đọc hơn khi dùng tên thiết bị (VD: `freekiosk/lobby/state` thay vì `freekiosk/9774d56d682e549c/state`).

### Khả dụng



| Trạng thái | Hành động | Retained |
|---|---|---|
| **Trực tuyến** | Được publish khi kết nối thành công | `"online"` |
| **Ngoại tuyến** | Được publish qua LWT khi mất kết nối bất ngờ | `"offline"` |
| **Ngắt kết nối chủ động** | Publish trước khi ngắt kết nối | `"offline"` |



### Trạng thái

Một đối tượng JSON được publish định kỳ (mặc định: 30 giây một lần), chứa toàn bộ dữ liệu của thiết bị:



```json
{
  "battery": {
    "level": 85,
    "charging": true
  },
  "screen": {
    "on": true,
    "brightness": 75,
    "screensaverActive": false
  },
  "wifi": {
    "ssid": "HomeNetwork",
    "signalLevel": 83,
    "ip": "192.168.1.50"
  },
  "device": {
    "ip": "192.168.1.50",
    "version": "1.2.12",
    "kioskMode": true,
    "isDeviceOwner": true,
    "motionAlwaysOn": false
  },
  "sensors": {
    "light": 150.5
  },
  "memory": {
    "usedPercent": 41
  },
  "storage": {
    "availableMB": 27685
  },
  "audio": {
    "volume": 50
  },
  "webview": {
    "currentUrl": "http://192.168.1.244",
    "motionDetected": false
  },
  "images": {
    "screenshotEnabled": true,
    "screenshotAuto": false,
    "screenshotInterval": 60,
    "cameraEnabled": false,
    "cameraAuto": false,
    "cameraInterval": 300
  }
}
```

> 💡 Khối `images` chỉ xuất hiện khi tính năng publish ảnh qua MQTT khả dụng (xem
> [Hình ảnh (Ảnh chụp màn hình và camera)](#-hình-ảnh-ảnh-chụp-màn-hình-và-camera)).




## Home Assistant MQTT Discovery

FreeKiosk tự động publish cấu hình [MQTT Discovery](https://www.home-assistant.io/integrations/mqtt/#mqtt-discovery) khi kết nối/kết nối lại. Tất cả thực thể xuất hiện dưới một thiết bị duy nhất trong Home Assistant.

### Điều kiện tiên quyết



| Yêu cầu | Chi tiết |
|---|---|
| **Home Assistant** | Đã cấu hình [tích hợp MQTT](https://www.home-assistant.io/integrations/mqtt/) |
| **MQTT Broker** | Cả HA và máy tính bảng đều truy cập được (VD: Mosquitto) |
| **Discovery** | Đã bật MQTT Discovery trong HA (mặc định đã bật) |



### 📱 Thiết bị

Tất cả thực thể được nhóm trong một thiết bị HA:



| Trường | Giá trị |
|---|---|
| **Tên** | FreeKiosk {deviceName} *(hoặc FreeKiosk {deviceId} nếu chưa đặt tên)* |
| **Model** | FreeKiosk |
| **Nhà sản xuất** | FreeKiosk |
| **Phiên bản phần mềm** | *(phiên bản ứng dụng)* |
| **URL cấu hình** | `http://{localIp}:8080` |



### Thực thể

#### Cảm biến (11)



| Thực thể | Value template | Device class | Đơn vị |
|---|---|---|---|
| **Battery Level** | `battery.level` | battery | % |
| **Brightness** | `screen.brightness` | — | % |
| **WiFi SSID** | `wifi.ssid` | — | — |
| **WiFi Signal** | `wifi.signalLevel` | — | % |
| **Light Sensor** | `sensors.light` | illuminance | lx |
| **IP Address** | `device.ip` | — | — |
| **App Version** | `device.version` | — | — |
| **Memory Used** | `memory.usedPercent` | — | % |
| **Storage Free** | `storage.availableMB` | — | MB |
| **Current URL** | `webview.currentUrl` | — | — |
| **Volume** | `audio.volume` | — | % |



#### Cảm biến nhị phân (6)



| Thực thể | Value template | Device class |
|---|---|---|
| **Screen** | `screen.on` | power |
| **Screensaver** | `screen.screensaverActive` | — |
| **Battery Charging** | `battery.charging` | battery_charging |
| **Kiosk Mode** | `device.kioskMode` | — |
| **Device Owner** | `device.isDeviceOwner` | — |
| **Motion** | `webview.motionDetected` | motion |



#### Điều khiển dạng số (2)



| Thực thể | Topic lệnh | Tối thiểu | Tối đa | Đơn vị |
|---|---|---|---|---|
| **Brightness Control** | `.../set/brightness` | 0 | 100 | % |
| **Volume Control** | `.../set/volume` | 0 | 100 | % |



#### Công tắc (3)



| Thực thể | Topic lệnh | Payload |
|---|---|---|
| **Screen Power** | `.../set/screen` | ON / OFF |
| **Screensaver** | `.../set/screensaver` | ON / OFF |
| **Always-on Motion Detection** | `.../set/motion_always_on` | ON / OFF |



#### Nút bấm (14)



| Thực thể | Topic lệnh | Biểu tượng |
|---|---|---|
| **Reload** | `.../set/reload` | mdi:reload |
| **Wake** | `.../set/wake` | mdi:alarm |
| **Reboot** | `.../set/reboot` | mdi:restart |
| **Clear Cache** | `.../set/clear_cache` | mdi:delete-sweep |
| **Lock** | `.../set/lock` | mdi:lock |
| **Remote Up** | `.../set/remote_up` | mdi:arrow-up-bold |
| **Remote Down** | `.../set/remote_down` | mdi:arrow-down-bold |
| **Remote Left** | `.../set/remote_left` | mdi:arrow-left-bold |
| **Remote Right** | `.../set/remote_right` | mdi:arrow-right-bold |
| **Remote Select** | `.../set/remote_select` | mdi:radiobox-marked |
| **Remote Back** | `.../set/remote_back` | mdi:arrow-left-circle |
| **Remote Home** | `.../set/remote_home` | mdi:home |
| **Remote Menu** | `.../set/remote_menu` | mdi:menu |
| **Remote Play/Pause** | `.../set/remote_playpause` | mdi:play-pause |



#### Văn bản (6)



| Thực thể | Topic lệnh | Mô tả |
|---|---|---|
| **Navigate URL** | `.../set/url` | Điều hướng WebView đến một URL |
| **Text to Speech** | `.../set/tts` | Đọc to văn bản trên máy tính bảng |
| **Toast Message** | `.../set/toast` | Hiển thị thông báo toast trên màn hình |
| **Keyboard Key** | `.../set/keyboard_key` | Nhấn một phím (VD: `enter`, `a`, `f5`) |
| **Keyboard Combo** | `.../set/keyboard_combo` | Nhấn một tổ hợp phím (VD: `ctrl+c`, `alt+f4`) |
| **Keyboard Text** | `.../set/keyboard_text` | Nhập một chuỗi văn bản vào ô đang được chọn |



#### 📷 Hình ảnh (Ảnh chụp màn hình và camera)

**Mặc định tắt (opt-in)** — không có gì được chụp hay publish cho đến khi bật trong **Cài đặt → MQTT**. Mỗi
luồng được bật sẽ publish một payload JPEG trên topic riêng và thêm các thực thể sau:



| Luồng | Thực thể *(tiền tố `freekiosk_{deviceId}_`)* | Bật bởi |
|---|---|---|
| **Ảnh chụp màn hình** | `image.*_screenshot_image`, `camera.*_screenshot_cam`, `button.*_screenshot_capture`, `switch.*_screenshot_auto`, `number.*_screenshot_interval` | "Gửi ảnh chụp màn hình" |
| **Camera** *(mỗi camera hiện có một bộ)* | `image.*_camera_front_image`, `camera.*_camera_front_cam`, `button.*_camera_front_capture` (+ các biến thể `camera_back_*`), `switch.*_camera_auto`, `number.*_camera_interval` | "Gửi ảnh chụp từ camera" |



Mỗi luồng publish cả thực thể `image` lẫn thực thể `camera`: `image` hoạt động tốt trong thẻ
Markdown/picture và trong thông báo, `camera` dùng trong thẻ `picture-glance` / `picture-entity`.
Hai thực thể dùng chung một topic nên cùng hiển thị một ảnh.



| Cài đặt | Mặc định | Ghi chú |
|---|---|---|
| **Tự động gửi** | Tắt | Publish định kỳ; cũng có thể bật/tắt từ HA (`switch`) |
| **Chu kỳ** | 60 s (ảnh chụp màn hình) / 300 s (camera) | 5-3600 s, cũng có thể đặt từ HA (`number`) |
| **Chất lượng JPEG** | 70 | Chất lượng càng thấp thì thông điệp MQTT càng nhỏ |
| **Chiều rộng tối đa của ảnh chụp màn hình** | 1280 px | `0` giữ nguyên độ phân giải gốc |



> [!NOTE]
> Ảnh được publish ở dạng **retained** để Home Assistant khôi phục ảnh gần nhất sau khi khởi động lại.
> Khi tắt một luồng, cả cấu hình discovery lẫn ảnh retained của luồng đó đều bị xóa, nên không còn
> dữ liệu cũ nào sót lại trên broker.

> [!CAUTION]
> **Bất kỳ ai đọc được broker đều xem được các ảnh này, và bất kỳ ai ghi được vào
> topic lệnh đều có thể yêu cầu chụp một ảnh.** Đó chính là mục đích của tính năng, nhưng cũng nên nói rõ:
> ảnh chụp màn hình cho thấy mọi thứ kiosk đang hiển thị, kể cả biểu mẫu mà ai đó đang điền,
> còn ảnh chụp từ camera cho thấy bất kỳ ai đang đứng trước thiết bị.
>
> Ba hệ quả cần lường trước:
> - **Kết nối chỉ được mã hóa trên cổng 8883.** FreeKiosk chỉ bật TLS khi cổng là 8883,
>   nên trên cổng mặc định 1883, ảnh JPEG đi qua mạng ở dạng không mã hóa.
> - **Ảnh được publish ở dạng retained**, nhờ đó Home Assistant khôi phục được ảnh sau khi khởi động lại,
>   nhưng điều này cũng có nghĩa là ảnh gần nhất nằm lại trên broker cho đến khi có thứ gì ghi đè lên.
>   Một thiết bị chỉ cần bị tắt nguồn cũng để lại ảnh chụp cuối cùng ở đó vô thời hạn.
>   Tắt luồng rồi kết nối lại sẽ xóa ảnh đó (xem ghi chú ở trên).
> - **Hạn chế các topic bằng ACL của broker.** Trên Mosquitto, hãy giới hạn ai được subscribe
>   `{baseTopic}/+/image/#` và ai được publish vào `{baseTopic}/+/set/#`. Tắt
>   "Cho phép điều khiển từ xa" sẽ loại bỏ các lệnh chụp nhưng không dừng việc publish định kỳ.

> [!IMPORTANT]
> Đây là ảnh tĩnh, không phải luồng video. Mỗi lần chụp bằng camera mất khoảng 1-2 s
> (thời gian khởi động cảm biến), nên chu kỳ dưới 5 s bị từ chối và các yêu cầu lặp lại trong vòng 2 s bị bỏ qua.

**Tổng cộng: 42 thực thể** được tự động phát hiện trong Home Assistant, cộng thêm tối đa 11 thực thể ảnh khi
bật publish ảnh chụp màn hình và camera.


## Tham chiếu lệnh

Gửi lệnh bằng cách publish tới `{baseTopic}/{topicId}/set/{entity}`.



| Hậu tố topic | Lệnh | Payload | Mô tả |
|---|---|---|---|
| **brightness** | setBrightness | `0-100` (số nguyên) | Đặt độ sáng màn hình |
| **volume** | setVolume | `0-100` (số nguyên) | Đặt âm lượng đa phương tiện |
| **screen** | screenOn / screenOff | `ON` / `OFF` | Bật hoặc tắt màn hình |
| **screensaver** | screensaverOn / screensaverOff | `ON` / `OFF` | Bật/tắt bảo vệ màn hình |
| **motion_always_on** | setMotionAlwaysOn | `ON` / `OFF` | Bật/tắt phát hiện chuyển động luôn bật |
| **reload** | reload | bất kỳ | Tải lại WebView |
| **wake** | wake | bất kỳ | Đánh thức khỏi bảo vệ màn hình |
| **reboot** | reboot | bất kỳ | Khởi động lại thiết bị (cần Device Owner) |
| **clear_cache** | clearCache | bất kỳ | Xóa bộ nhớ đệm WebView |
| **lock** | lockDevice | bất kỳ | Khóa màn hình thiết bị |
| **url** | setUrl | chuỗi URL | Điều hướng đến URL |
| **mode** | setMode | JSON: `{"mode":"webview","url":"https://..."}`, `{"mode":"external_app","package":"com.app"}` (bỏ `package` để dùng cấu hình nhiều ứng dụng đã lưu), hoặc `{"mode":"media_player"}` | Chuyển chế độ hiển thị khi đang chạy (webview / external_app / media_player) |
| **tts** | tts | chuỗi văn bản | Chuyển văn bản thành giọng nói (xử lý native) |
| **toast** | toast | chuỗi văn bản | Hiển thị thông báo toast (xử lý native) |
| **launch_app** | launchApp | tên gói | Khởi chạy ứng dụng ngoài |
| **execute_js** | executeJs | chuỗi mã JS | Thực thi JavaScript trong WebView |
| **audio_play** | audioPlay | JSON `{"url":"...","loop":false,"volume":50}` | Phát âm thanh từ URL |
| **audio_stop** | audioStop | bất kỳ | Dừng phát âm thanh |
| **audio_beep** | audioBeep | bất kỳ | Phát tiếng bíp |
| **rotation_start** | rotationStart | bất kỳ | Bắt đầu xoay vòng URL |
| **rotation_stop** | rotationStop | bất kỳ | Dừng xoay vòng URL |
| **restart_ui** | restartUi | bất kỳ | Khởi động lại giao diện ứng dụng |
| **remote_up** | remoteKey (up) | `PRESS` | D-pad Lên |
| **remote_down** | remoteKey (down) | `PRESS` | D-pad Xuống |
| **remote_left** | remoteKey (left) | `PRESS` | D-pad Trái |
| **remote_right** | remoteKey (right) | `PRESS` | D-pad Phải |
| **remote_select** | remoteKey (select) | `PRESS` | D-pad Chọn / Enter |
| **remote_back** | remoteKey (back) | `PRESS` | Nút Quay lại |
| **remote_home** | remoteKey (home) | `PRESS` | Nút Home |
| **remote_menu** | remoteKey (menu) | `PRESS` | Nút Menu |
| **remote_playpause** | remoteKey (playpause) | `PRESS` | Phát/Tạm dừng đa phương tiện |
| **keyboard_key** | keyboardKey | tên phím (VD: `enter`, `a`, `f5`) | Nhấn một phím |
| **keyboard_combo** | keyboardCombo | chuỗi tổ hợp phím (VD: `ctrl+c`) | Nhấn một tổ hợp phím |
| **keyboard_text** | keyboardText | chuỗi văn bản | Nhập văn bản vào ô đang được chọn |
| **screenshot_capture** | publishScreenshot | `PRESS` | Chụp màn hình và publish lên `.../image/screenshot` |
| **camera_capture_front** | publishCameraPhoto (front) | `PRESS` | Chụp bằng camera trước và publish lên `.../image/camera_front` |
| **camera_capture_back** | publishCameraPhoto (back) | `PRESS` | Chụp bằng camera sau và publish lên `.../image/camera_back` |
| **screenshot_auto** | setImageAutoPublish (screenshot) | `ON` / `OFF` | Bật/tắt publish ảnh chụp màn hình định kỳ |
| **camera_auto** | setImageAutoPublish (camera) | `ON` / `OFF` | Bật/tắt publish ảnh camera định kỳ |
| **screenshot_interval** | setImageInterval (screenshot) | `5-3600` (giây) | Chu kỳ tự động publish ảnh chụp màn hình |
| **camera_interval** | setImageInterval (camera) | `5-3600` (giây) | Chu kỳ tự động publish ảnh camera |



> [!NOTE]
> Các lệnh tương đương hoàn toàn với [REST API](rest-api.md). Cả hai giao diện đều đi qua cùng một trình xử lý lệnh native. Lệnh điều khiển từ xa và bàn phím được xử lý native thông qua AccessibilityService (trên mọi ứng dụng) hoặc Activity key dispatch (trong ứng dụng). TTS và Toast cũng được xử lý native (không cần đi vòng qua JS).


## Phát hiện chuyển động

FreeKiosk có thể phát hiện chuyển động bằng camera của thiết bị và báo cáo dưới dạng cảm biến nhị phân trong Home Assistant.



| Chế độ | Hành vi | Ảnh hưởng đến pin |
|---|---|---|
| **Mặc định** | Phát hiện chuyển động chỉ chạy khi bảo vệ màn hình đang hoạt động (để đánh thức màn hình khi có chuyển động) | Tối thiểu |
| **Luôn bật** | Phát hiện chuyển động liên tục qua công tắc HA hoặc cài đặt MQTT | Cao hơn |



**Chế độ luôn bật**: Bật "Luôn bật phát hiện chuyển động" trong cài đặt MQTT hoặc qua thực thể công tắc trên HA để chạy phát hiện chuyển động liên tục. Cảm biến nhị phân `motion_detected` sẽ cập nhật theo thời gian thực. Lưu ý: chế độ này dùng camera liên tục và làm tốn pin hơn.

> [!NOTE]
> Cần cấp quyền camera để phát hiện chuyển động hoạt động. FreeKiosk tự động yêu cầu quyền này ở lần mở đầu tiên.


## Hành vi kết nối

### Tự động kết nối lại

MQTT client tự động kết nối lại khi mất kết nối (mất Wi-Fi, broker khởi động lại). Khi kết nối lại, client sẽ:


| Bước | Hành động |
|---|---|
| **1** | Publish `"online"` lên topic availability |
| **2** | Publish lại toàn bộ 42 cấu hình HA Discovery |
| **3** | Subscribe lại các topic lệnh |
| **4** | Tiếp tục publish trạng thái định kỳ |



### LWT (Last Will and Testament)

Nếu mất kết nối đột ngột, broker sẽ publish `"offline"` lên topic availability. Home Assistant sẽ hiển thị thiết bị ở trạng thái "Unavailable".

### Chạy đồng thời với REST API

MQTT và REST API có thể chạy đồng thời. Cả hai dùng chung trình xử lý lệnh nội bộ và dữ liệu trạng thái. Bật MQTT không làm tắt REST API.


## Kiểm thử bằng MQTT CLI



```bash
# Subscribe to all FreeKiosk topics
mosquitto_sub -h BROKER_IP -t "freekiosk/#" -v

# Check device availability
mosquitto_sub -h BROKER_IP -t "freekiosk/TOPIC_ID/availability"

# Read device state
mosquitto_sub -h BROKER_IP -t "freekiosk/TOPIC_ID/state"

# Set brightness to 50%
mosquitto_pub -h BROKER_IP -t "freekiosk/TOPIC_ID/set/brightness" -m "50"

# Turn screen off
mosquitto_pub -h BROKER_IP -t "freekiosk/TOPIC_ID/set/screen" -m "OFF"

# Turn screen on
mosquitto_pub -h BROKER_IP -t "freekiosk/TOPIC_ID/set/screen" -m "ON"

# Navigate to URL
mosquitto_pub -h BROKER_IP -t "freekiosk/TOPIC_ID/set/url" -m "https://example.com"

# Reload WebView
mosquitto_pub -h BROKER_IP -t "freekiosk/TOPIC_ID/set/reload" -m "PRESS"

# Play audio
mosquitto_pub -h BROKER_IP -t "freekiosk/TOPIC_ID/set/audio_play" -m '{"url":"https://example.com/sound.mp3","volume":50}'

# Text-to-speech
mosquitto_pub -h BROKER_IP -t "freekiosk/TOPIC_ID/set/tts" -m "Hello from Home Assistant"

# Show toast
mosquitto_pub -h BROKER_IP -t "freekiosk/TOPIC_ID/set/toast" -m "Hello!"

# Toggle always-on motion detection
mosquitto_pub -h BROKER_IP -t "freekiosk/TOPIC_ID/set/motion_always_on" -m "ON"

# Request a screenshot, then watch the payload size arriving
mosquitto_sub -h BROKER_IP -t "freekiosk/TOPIC_ID/image/#" -F "%t %l bytes" &
mosquitto_pub -h BROKER_IP -t "freekiosk/TOPIC_ID/set/screenshot_capture" -m "PRESS"

# Request a front camera snapshot and save it to a file
mosquitto_pub -h BROKER_IP -t "freekiosk/TOPIC_ID/set/camera_capture_front" -m "PRESS"
mosquitto_sub -h BROKER_IP -t "freekiosk/TOPIC_ID/image/camera_front" -C 1 > snapshot.jpg

# Publish a screenshot every 30 seconds
mosquitto_pub -h BROKER_IP -t "freekiosk/TOPIC_ID/set/screenshot_interval" -m "30"
mosquitto_pub -h BROKER_IP -t "freekiosk/TOPIC_ID/set/screenshot_auto" -m "ON"

# View HA discovery configs
mosquitto_sub -h BROKER_IP -t "homeassistant/#" -v
```



Thay `BROKER_IP` bằng IP của MQTT broker và `TOPIC_ID` bằng tên thiết bị (VD: `lobby`), hoặc Android ID nếu chưa đặt tên.


## 🏠 Ví dụ Home Assistant

### 🤖 Tự động hóa

#### 🏃 Đánh thức máy tính bảng khi phòng có chuyển động



```yaml
automation:
  - alias: "Wake Tablet on Room Motion"
    trigger:
      - platform: state
        entity_id: binary_sensor.freekiosk_abc123_motion
        to: "on"
    condition:
      - condition: state
        entity_id: binary_sensor.freekiosk_abc123_screensaver_active
        state: "on"
    action:
      - service: mqtt.publish
        data:
          topic: "freekiosk/lobby/set/wake"
          payload: "PRESS"
```



#### 🌙 Tắt màn hình máy tính bảng vào ban đêm



```yaml
automation:
  - alias: "Tablet Screen Off at Night"
    trigger:
      - platform: time
        at: "23:00:00"
    action:
      - service: mqtt.publish
        data:
          topic: "freekiosk/lobby/set/screen"
          payload: "OFF"
```



#### 🌅 Bật màn hình máy tính bảng vào buổi sáng



```yaml
automation:
  - alias: "Tablet Screen On in Morning"
    trigger:
      - platform: time
        at: "07:00:00"
    action:
      - service: mqtt.publish
        data:
          topic: "freekiosk/lobby/set/screen"
          payload: "ON"
```



#### 🔔 Cảnh báo chuông cửa trên máy tính bảng



```yaml
automation:
  - alias: "Doorbell Alert on Tablet"
    trigger:
      - platform: state
        entity_id: binary_sensor.doorbell
        to: "on"
    action:
      - service: mqtt.publish
        data:
          topic: "freekiosk/lobby/set/audio_beep"
          payload: "PRESS"
      - service: mqtt.publish
        data:
          topic: "freekiosk/lobby/set/toast"
          payload: "Someone is at the door!"
      - service: mqtt.publish
        data:
          topic: "freekiosk/lobby/set/url"
          payload: "http://homeassistant:8123/lovelace/cameras"
```



#### 💡 Điều chỉnh độ sáng theo ánh sáng trong phòng



```yaml
automation:
  - alias: "Tablet Auto Brightness via MQTT"
    trigger:
      - platform: state
        entity_id: sensor.living_room_light_level
    action:
      - service: mqtt.publish
        data:
          topic: "freekiosk/lobby/set/brightness"
          payload: >-
            {{ (states('sensor.living_room_light_level') | float / 10) | int | min(100) }}
```



#### 🗣️ Thông báo bằng TTS



```yaml
automation:
  - alias: "Announce Weather on Tablet"
    trigger:
      - platform: time
        at: "08:00:00"
    action:
      - service: mqtt.publish
        data:
          topic: "freekiosk/lobby/set/tts"
          payload: "Good morning! Today's forecast is {{ states('weather.home') }}."
```



#### 📷 Kiểm tra nội dung kiosk đang hiển thị sau khi cập nhật



```yaml
automation:
  - alias: "Notify with Kiosk Screenshot"
    trigger:
      - platform: state
        entity_id: update.freekiosk_lobby
        to: "off"
    action:
      # Ask for a fresh screenshot, then give the tablet time to capture and publish it
      - service: mqtt.publish
        data:
          topic: "freekiosk/lobby/set/screenshot_capture"
          payload: "PRESS"
      - delay: "00:00:05"
      - service: notify.mobile_app_phone
        data:
          message: "Lobby kiosk after update"
          data:
            image: /api/image_proxy/image.freekiosk_abc123_screenshot_image
```



### 📊 Thẻ bảng điều khiển (Lovelace)



```yaml
type: entities
title: Tablet
entities:
  - entity: sensor.freekiosk_abc123_battery_level
  - entity: binary_sensor.freekiosk_abc123_battery_charging
  - entity: binary_sensor.freekiosk_abc123_screen_on
  - entity: number.freekiosk_abc123_brightness_control
  - entity: number.freekiosk_abc123_volume_control
  - entity: switch.freekiosk_abc123_screen_power
  - entity: switch.freekiosk_abc123_screensaver
  - entity: switch.freekiosk_abc123_motion_always_on
  - entity: binary_sensor.freekiosk_abc123_motion_detected
  - entity: text.freekiosk_abc123_tts
  - entity: text.freekiosk_abc123_toast
  - entity: sensor.freekiosk_abc123_wifi_ssid
  - entity: sensor.freekiosk_abc123_wifi_signal
  - entity: button.freekiosk_abc123_reload
  - entity: button.freekiosk_abc123_wake
  - entity: button.freekiosk_abc123_reboot
```



Màn hình kiosk và camera (khi bật publish ảnh):



```yaml
type: picture-glance
title: Lobby Kiosk
camera_image: camera.freekiosk_abc123_screenshot_cam
camera_view: auto
entities:
  - entity: button.freekiosk_abc123_screenshot_capture
  - entity: switch.freekiosk_abc123_screenshot_auto
  - entity: binary_sensor.freekiosk_abc123_screen_on
```




## Khắc phục sự cố

### Thiết bị không xuất hiện trong Home Assistant



| Kiểm tra | Giải pháp |
|---|---|
| **Tích hợp MQTT** | Xác nhận tích hợp MQTT đã được cấu hình trong HA |
| **Khả năng truy cập broker** | Kiểm tra URL broker đúng và máy tính bảng truy cập được |
| **Đã bật Discovery** | Kiểm tra MQTT Discovery đã được bật trong HA (Settings > Integrations > MQTT > Configure) |
| **Thông điệp discovery** | Dùng `mosquitto_sub -h BROKER_IP -t "homeassistant/#" -v` để xác minh các thông điệp discovery |



### Thực thể hiển thị "Unknown"



| Vấn đề | Giải pháp |
|---|---|
| **Lần publish trạng thái đầu tiên** | Chờ lần publish trạng thái đầu tiên (tối đa 30 giây theo mặc định) |
| **Topic trạng thái** | Kiểm tra: `mosquitto_sub -h BROKER_IP -t "freekiosk/TOPIC_ID/state"` |
| **Cảm biến nhị phân** | Đảm bảo JSON trạng thái chứa các trường boolean cần thiết |
| **TTS/Toast** | Hai thực thể này luôn hiển thị trống — đây là thiết kế có chủ đích (lệnh kiểu fire-and-forget) |



### Kết nối liên tục bị ngắt



| Nguyên nhân | Giải pháp |
|---|---|
| **Độ ổn định Wi-Fi** | Kiểm tra độ ổn định Wi-Fi trên máy tính bảng |
| **Xung đột client ID** | Xác nhận broker cho phép client ID đã cấu hình |
| **Client trùng lặp** | Kiểm tra xem có client khác đang dùng cùng client ID không |
| **Hoạt động bình thường** | Client tự động kết nối lại — các lần ngắt kết nối ngắn là bình thường |



### Công tắc Screen Power tự quay về ON



| Vấn đề | Giải pháp |
|---|---|
| **Lỗi phiên bản** | Đã được khắc phục từ v1.2.20 trở lên. Máy tính bảng publish trạng thái mới ngay khi màn hình thực sự thay đổi (hook native `ACTION_SCREEN_ON`/`OFF`), nên Home Assistant không còn giữ giá trị cũ cho đến lần publish định kỳ tiếp theo |
| **Không có Device Owner / dịch vụ trợ năng** | Khi không có cả hai, FreeKiosk không thể tắt hẳn màn hình, chỉ giảm độ sáng xuống 0. Khi đó trạng thái báo đúng thực tế là `on`, nên công tắc quay về ON. Hãy bật Device Owner hoặc dịch vụ trợ năng của FreeKiosk |



### Công tắc Screensaver không bật bảo vệ màn hình



| Vấn đề | Giải pháp |
|---|---|
| **Lỗi phiên bản** | Đã khắc phục từ v1.2.20 trở lên. Gửi `ON` giờ sẽ hiển thị bảo vệ màn hình ngay lập tức; trước đây lệnh chỉ bật lại tính năng và màn hình tối đi sau khi hết thời gian không hoạt động |
| **Ý nghĩa của thực thể** | Công tắc phản ánh `screen.screensaverActive`, tức là bảo vệ màn hình có đang hiển thị ngay lúc này hay không, chứ không phải tính năng này có được bật trong cài đặt hay không |



### Thiết bị chuyển sang không khả dụng sau vài giờ



| Nguyên nhân | Giải pháp |
|---|---|
| **Doze / tối ưu hóa pin** | Khi máy tính bảng đã rút sạc và không hoạt động, Android trì hoãn mạng của ứng dụng và broker ngắt kết nối, dù FreeKiosk đã giữ wake lock. Hãy loại trừ FreeKiosk khỏi tối ưu hóa pin: mục cài đặt MQTT hiển thị cảnh báo kèm nút chạm một lần khi chưa được loại trừ |
| **Chế độ khóa đang bật** | Được hỗ trợ từ v1.2.20 trở lên: FreeKiosk đưa hộp thoại hệ thống vào danh sách cho phép trong vài giây hiển thị, nên nút trong ứng dụng hoạt động được khi đang ghim. Nếu hộp thoại vẫn không xuất hiện, hãy cấp quyền bằng ADB: `adb shell dumpsys deviceidle whitelist +com.freekiosk` |
| **Luôn cắm sạc** | Máy tính bảng cắm nguồn liên tục sẽ không bao giờ vào Doze, đây là cách thiết lập kiosk thông thường |
| **Tiến trình bị tắt (không có chế độ khóa)** | Khi không có chế độ khóa, trước đây FreeKiosk chạy mà không có dịch vụ tiền cảnh, nên trình quản lý pin của OEM có thể kill tiến trình và MQTT không bao giờ hoạt động lại. Từ v1.2.20 trở lên, một thông báo giữ chạy nền im lặng sẽ xuất hiện khi bật MQTT mà không có chế độ khóa. Không tắt thông báo đó |


### Phát hiện chuyển động không hoạt động



| Vấn đề | Giải pháp |
|---|---|
| **Quyền camera** | Cấp quyền camera cho ứng dụng (được yêu cầu tự động ở lần mở đầu tiên) |
| **Hành vi mặc định** | Theo mặc định, chuyển động chỉ được kích hoạt khi bảo vệ màn hình đang hoạt động |
| **Chế độ luôn bật** | Bật "Luôn bật phát hiện chuyển động" để phát hiện liên tục |
| **Log gỡ lỗi** | Kiểm tra log: `adb logcat | grep MotionDetection` |



### Ảnh chụp màn hình hoặc ảnh camera không cập nhật



| Vấn đề | Giải pháp |
|---|---|
| **Luồng đang tắt** | Bật "Gửi ảnh chụp màn hình" / "Gửi ảnh chụp từ camera" trong Cài đặt > MQTT — cả hai đều tắt theo mặc định |
| **Thiếu thực thể** | Bộ thực thể được publish khi kết nối: hãy kết nối lại MQTT sau khi bật một luồng |
| **Camera đang bận** | Phát hiện chuyển động đang giữ camera: lệnh chụp sẽ bỏ cuộc sau khoảng 10 s (`Camera capture failed … nothing published`), ảnh trước đó được giữ lại và phát hiện chuyển động tự phục hồi. Tắt phát hiện chuyển động luôn bật, hoặc chụp khi bảo vệ màn hình không hoạt động |
| **Màn hình tắt** | *Dự kiến, chưa đo kiểm:* ảnh chụp màn hình cần một cửa sổ đang hiển thị nên dự kiến sẽ lỗi khi màn hình tắt, còn ảnh chụp từ camera dự kiến vẫn hoạt động vì đường xử lý hoàn toàn là native. Chưa được kiểm chứng trên thiết bị |
| **Quyền camera** | Cấp quyền camera (được yêu cầu khi bật luồng camera) |
| **Payload quá lớn** | Một số broker giới hạn kích thước thông điệp (Mosquitto `message_size_limit`). Hãy giảm chất lượng JPEG / chiều rộng tối đa; cảnh báo được ghi log khi vượt quá 1 MB |
| **Yêu cầu lặp lại** | Hai lần chụp của cùng một luồng trong vòng 2 giây sẽ bị giới hạn tần suất — lần thứ hai bị bỏ qua |
| **Log gỡ lỗi** | Kiểm tra log: `adb logcat \| grep MqttImagePublisher` |



### WiFi SSID hiển thị "WiFi" thay vì tên thật



| Vấn đề | Giải pháp |
|---|---|
| **Quyền vị trí** | Cấp quyền vị trí (được yêu cầu tự động ở lần mở đầu tiên) |
| **Yêu cầu của Android** | Android yêu cầu quyền vị trí để đọc SSID Wi-Fi (Android 8.0 trở lên) |



### TTS không phát giọng nói



| Vấn đề | Giải pháp |
|---|---|
| **Engine TTS** | Đảm bảo thiết bị đã cài engine TTS (hầu hết thiết bị Android đều có sẵn Google TTS) |
| **Âm lượng** | Kiểm tra âm lượng thiết bị không bị tắt tiếng |
| **Xử lý native** | TTS được module MQTT xử lý native — không cần chạy REST API |




## Chi tiết kỹ thuật



| Thành phần | Chi tiết |
|---|---|
| **Thư viện MQTT** | HiveMQ MQTT Client (`com.hivemq:hivemq-mqtt-client:1.3.12`) |
| **Kết nối** | Tự động kết nối lại với exponential backoff |
| **Clean Session** | Có (không lưu subscription) |
| **Keep Alive** | 30 giây |
| **An toàn luồng** | Các callback MQTT được chuyển sang luồng chính qua `Handler(Looper.getMainLooper())` |
| **Lưu trữ mật khẩu** | Được mã hóa trong Android Keychain (giống khóa REST API) |
| **TTS và Toast** | Được xử lý native trong module MQTT (không cần đi vòng qua JS) |
| **Publish ảnh** | Mặc định tắt. Được chụp và publish native, payload JPEG trên `.../image/*`, QoS 0, **retained**. Bất kỳ ai có quyền subscribe topic đều đọc được, và ở dạng không mã hóa trừ khi cổng broker là 8883 (xem cảnh báo trong phần [Hình ảnh](#-hình-ảnh-ảnh-chụp-màn-hình-và-camera)) |




## Xem thêm



| Tài liệu | Nội dung chính |
|---|---|
| **Tài liệu REST API** | Tích hợp qua HTTP (polling) |
| **Hướng dẫn cấu hình ADB** | Cấp phát thiết bị headless qua ADB |
| **Hướng dẫn cài đặt** | Thiết lập thiết bị |
| **Tổng quan về tích hợp** | So sánh các phương thức tích hợp |








