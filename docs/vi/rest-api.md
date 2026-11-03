

# Tài liệu REST API của FreeKiosk

**Điều khiển, giám sát và tự động hóa kiosk qua HTTP với phản hồi dạng JSON**

<p>
  <a href="README.md">Trang chủ tài liệu</a> •
  <a href="INTEGRATIONS.md">Tích hợp</a> •
  <a href="MQTT.md">MQTT</a>
</p>

## Mục lục

- [Tổng quan](#tổng-quan)
- [Cấu hình](#cấu-hình)
- [Bắt đầu](#bắt-đầu)
- [Tính năng](#tính-năng)
- [Khắc phục sự cố](#khắc-phục-sự-cố)
- [Tài nguyên liên quan](#tài-nguyên-liên-quan)




FreeKiosk tích hợp sẵn máy chủ REST API để kết nối với **Home Assistant** và các nền tảng nhà thông minh khác.

## Tổng quan



| Tính năng | Chi tiết |
|---|---|
| **Cổng mặc định** | 8080 |
| **Giao thức** | HTTP (dự kiến hỗ trợ HTTPS) |
| **Xác thực** | Khóa API tùy chọn (header `X-Api-Key`, hoặc mật khẩu HTTP Basic) |
| **Định dạng** | Phản hồi JSON |



> [!NOTE]
> Một số tính năng của API cần **chế độ Device Owner** để hoạt động đầy đủ (tắt màn hình thật sự, khởi động lại). Máy chủ HTTP vẫn truy cập được ngay cả khi màn hình tắt (v1.2.4+). Xem [Hướng dẫn cài đặt](installation.md#chế-độ-device-owner-nâng-cao) để biết các bước thiết lập Device Owner.

## Bật API

### Qua giao diện



| Bước | Thao tác |
|---|---|
| **1** | Chạm 5 lần vào nút bí mật → nhập mã PIN |
| **2** | Vào tab **Nâng cao** |
| **3** | Gạt công tắc **Bật REST API** |
| **4** | Đặt cổng (mặc định: 8080) và khóa API (tùy chọn) |
| **5** | Lưu cài đặt |



### Qua ADB (headless)



```bash
adb shell am start -n com.freekiosk/.MainActivity \
    --es pin "1234" \
    --es rest_api_enabled "true" \
    --es rest_api_port "8080" \
    --es rest_api_key "your_secret_key"
```



> [!NOTE]
> Xem [Hướng dẫn cấu hình ADB](adb-configuration.md) để biết cách cấp phát thiết bị headless đầy đủ.


## Tham chiếu endpoint

### Trạng thái & thông tin (GET)

#### `GET /api/status`

Trả về toàn bộ trạng thái thiết bị trong một lần gọi.



```json
{
  "success": true,
  "data": {
    "battery": { "level": 85, "charging": true, "temperature": 25.5 },
    "screen": { "on": true, "brightness": 75, "screensaverActive": false },
    "webview": { "currentUrl": "http://...", "canGoBack": false, "loading": false },
    "device": { "model": "SM-T510", "manufacturer": "samsung", "android": "11" },
    "wifi": { "connected": true, "ssid": "Home", "rssi": -45, "ip": "192.168.1.50" },
    "sensors": { "light": 150.5, "proximity": 5, "accelerometer": {...} },
    "autoBrightness": { "enabled": true, "min": 10, "max": 100, "currentLightLevel": 150.5 },
    "kiosk": { "enabled": true, "pinEnabled": true },
    "audio": { "volume": 50 },
    "storage": { "totalMB": 32000, "availableMB": 15000 },
    "memory": { "totalMB": 4096, "availableMB": 2048 }
  },
  "timestamp": 1704672000
}
```



#### `GET /api/battery`



```json
{
  "success": true,
  "data": {
    "level": 85,
    "charging": true,
    "plugged": "usb",
    "temperature": 25.5,
    "voltage": 4.2,
    "health": "good",
    "technology": "Li-ion"
  }
}
```



**📋 Các trường:**


| Trường | Phạm vi/Kiểu | Mô tả |
|---|---|---|
| **level** | 0-100 | Phần trăm pin |
| **charging** | boolean | Thiết bị có đang sạc hay không |
| **plugged** | string | Nguồn điện: `usb`, `ac`, `wireless` hoặc `none` |
| **temperature** | number | Nhiệt độ pin tính bằng °C |
| **voltage** | number | Điện áp pin tính bằng V |
| **health** | string | `good`, `overheat`, `dead`, `over_voltage`, `failure`, `cold` hoặc `unknown` |
| **technology** | string | Hệ hóa học của pin (ví dụ: `Li-ion`) |


```

#### `GET /api/brightness`



```json
{
  "success": true,
  "data": { "brightness": 75 }
}
```



#### `GET /api/screen`

Trả về trạng thái màn hình, tách riêng trạng thái vật lý và trạng thái lớp phủ.



```json
{
  "success": true,
  "data": {
    "on": true,
    "brightness": 75,
    "screensaverActive": false
  }
}
```



**Mô tả các trường:**


| Trường | Giá trị | Mô tả |
|---|---|---|
| **on** | `true`/`false` | Trạng thái màn hình vật lý lấy từ `PowerManager.isInteractive` |
| **brightness** | 0-100 | Phần trăm độ sáng hiện tại |
| **screensaverActive** | `true`/`false` | Lớp phủ bảo vệ màn hình có đang hiển thị hay không |



**Trạng thái màn hình vật lý (`on`):**
- `true` = màn hình đang bật về mặt vật lý (đang tiêu thụ điện)
- `false` = màn hình đang tắt về mặt vật lý (đã nhấn nút nguồn hoặc đã gọi `lockNow()`)
- Lưu ý: vẫn trả về `true` ngay cả khi lớp phủ bảo vệ màn hình đang hoạt động

**Trạng thái bảo vệ màn hình (`screensaverActive`):**
- `true` = lớp phủ bảo vệ màn hình đang che nội dung (màn hình có thể bị giảm sáng)
- `false` = nội dung bình thường đang hiển thị

**Diễn giải các trạng thái kết hợp:**


```javascript
// Screen physically on + content visible
{ "on": true, "screensaverActive": false }

// Screen physically on + screensaver overlay (dimmed/attenuated)
{ "on": true, "screensaverActive": true }

// Screen physically off (power button or Device Owner lockNow())
{ "on": false, "screensaverActive": false }
```



**Trường hợp sử dụng:**
- Kiểm tra màn hình có đang tiêu thụ điện hay không: `on === true`
- Kiểm tra nội dung có hiển thị cho người dùng hay không: `on === true && screensaverActive === false`
- Kiểm tra có đang ở chế độ tiết kiệm điện hay không: `on === false || screensaverActive === true`

#### `GET /api/sensors`

Trả về dữ liệu cảm biến ánh sáng, cảm biến tiệm cận và gia tốc kế.



```json
{
  "success": true,
  "data": {
    "light": 150.5,
    "proximity": 5,
    "accelerometer": { "x": 0.1, "y": 0.2, "z": 9.8 }
  }
}
```



#### `GET /api/storage`



```json
{
  "success": true,
  "data": {
    "totalMB": 32000,
    "availableMB": 15000,
    "usedMB": 17000,
    "usedPercent": 53
  }
}
```



#### `GET /api/memory`



```json
{
  "success": true,
  "data": {
    "totalMB": 4096,
    "availableMB": 2048,
    "usedMB": 2048,
    "usedPercent": 50,
    "lowMemory": false
  }
}
```



#### `GET /api/wifi`



```json
{
  "success": true,
  "data": {
    "connected": true,
    "ssid": "HomeNetwork",
    "rssi": -45,
    "ip": "192.168.1.50"
  }
}
```



#### `GET /api/info`

Thông tin thiết bị.



```json
{
  "success": true,
  "data": {
    "ip": "192.168.1.50",
    "hostname": "freekiosk",
    "version": "1.2.11",
    "isDeviceOwner": true,
    "kioskMode": true
  }
}
```



**Mô tả các trường:**


| Trường | Kiểu | Mô tả |
|---|---|---|
| **isDeviceOwner** | boolean | Ứng dụng có quyền Device Owner hay không (cần cho khởi động lại, khóa màn hình, tắt màn hình thật sự) |
| **kioskMode** | boolean | Chế độ lock task của kiosk có đang hoạt động hay không |



#### `GET /api/health`

Kiểm tra tình trạng hoạt động đơn giản.



```json
{
  "success": true,
  "data": { "status": "ok" }
}
```



#### `GET /api/screenshot`

Trả về ảnh PNG của màn hình hiện tại.

**Phản hồi**: dữ liệu nhị phân `image/png`

**Ví dụ sử dụng:**


```bash
# Save screenshot to file
curl http://TABLET_IP:8080/api/screenshot -o screenshot.png

# Display in HTML
<img src="http://TABLET_IP:8080/api/screenshot" />
```



> 💡 Ảnh chụp màn hình được lấy từ root view của ứng dụng. Chức năng này vẫn chụp được ngay cả khi lớp phủ bảo vệ màn hình đang hoạt động.
>
> **Chụp màn hình ứng dụng khác (chế độ nhiều ứng dụng / ứng dụng ngoài)** *(v1.2.20+)*: khi một ứng dụng được quản lý đang
> ở tiền cảnh, cửa sổ của chính FreeKiosk nằm ngoài màn hình và không thể sao chép, nên việc chụp phải đi qua
> **dịch vụ trợ năng** (`Cài đặt > Trợ năng > FreeKiosk`, yêu cầu Android 11 trở lên). Ngoài ra,
> Chế độ khóa với quyền Device Owner chặn chụp màn hình trên toàn thiết bị (đây chính là điều vô hiệu hóa tổ hợp phím
> Nguồn + Giảm âm lượng), khiến ảnh chụp này cũng bị đen: hãy bật **Bảo mật > Cho phép chụp màn hình từ xa** để FreeKiosk
> gỡ chặn trong một phần giây mà việc chụp diễn ra. Khi không thể chụp,
> endpoint trả về `503` kèm lý do, ví dụ:
>
> ```json
> {"success": false, "error": "Accessibility service is not enabled (required to capture another app)"}
> ```

> 💡 Người dùng Home Assistant cũng có thể nhận ảnh chụp màn hình dưới dạng thực thể `image` / `camera` tự động phát hiện qua MQTT, mà không cần mở máy chủ HTTP ra ngoài — xem [MQTT: Hình ảnh (Ảnh chụp màn hình và camera)](MQTT.md#-hình-ảnh-ảnh-chụp-màn-hình-và-camera).

#### `GET /api/camera/photo`

Chụp ảnh bằng camera của thiết bị. **(v1.2.5+)**

**Tham số truy vấn:**


| Tham số | Mặc định | Mô tả |
|---|---|---|
| **camera** | `back` | Camera sử dụng: `front` hoặc `back` |
| **quality** | `80` | Chất lượng nén JPEG (1-100) |
| **rotate** | *(theo cài đặt, auto)* | Xoay theo chiều kim đồng hồ: `auto`, `0`, `90`, `180` hoặc `270`. Nếu không truyền, áp dụng cài đặt **Góc xoay camera** (Cài đặt > Nâng cao > REST API); khi cài đặt này chưa được đặt, ảnh được xoay cho thẳng đứng dựa trên hướng camera và hướng màn hình. `auto` buộc dùng cách tính đó; giá trị cố định dùng cho camera vẫn ra ảnh bị xoay, hoặc cho máy tính bảng gắn tường. `0` trả về khung hình thô từ cảm biến, giống các phiên bản trước 2.0.0. Mọi giá trị khác đều trả về `400`. **(2.0.0+)** |



**Ví dụ:**


```
GET /api/camera/photo?camera=back&quality=80
GET /api/camera/photo?camera=front&quality=60
GET /api/camera/photo?camera=front&rotate=90
```



**Phản hồi**: dữ liệu nhị phân `image/jpeg`

**Lưu ý:**
- Lần chụp đầu tiên có thể mất 1-2 giây (khởi tạo camera + tự động phơi sáng)
- Cần cấp quyền camera (đã có sẵn trong các quyền của ứng dụng)
- Độ phân giải ảnh được tự động tối ưu (~1.2MP) để truyền qua HTTP nhanh
- Giá trị chất lượng càng cao thì tệp càng lớn
- Việc chụp sẽ thất bại khi tính năng phát hiện chuyển động đang dùng camera

> 💡 Ảnh chụp từ camera cũng có thể được publish qua MQTT dưới dạng các thực thể `image` / `camera` tự động phát hiện (mỗi camera một thực thể), kèm nút chụp trong Home Assistant — xem [MQTT: Hình ảnh (Ảnh chụp màn hình và camera)](MQTT.md#-hình-ảnh-ảnh-chụp-màn-hình-và-camera).

#### `GET /api/camera/stream`

Luồng **MJPEG** trực tiếp từ camera của thiết bị, để máy tính bảng kiosk có thể dùng làm camera trong Home Assistant.

**Mặc định tắt (opt-in)**: bật **Luồng camera trực tiếp** trong Cài đặt → Nâng cao → REST API. Khi chưa bật, endpoint trả về `503`.

**Phản hồi**: `multipart/x-mixed-replace; boundary=frame` — chuỗi liên tục không kết thúc gồm các phần JPEG, mỗi khung hình một phần. Phản hồi chỉ kết thúc khi client ngắt kết nối.

**Tham số truy vấn:** *(mỗi tham số ghi đè giá trị mặc định đã cấu hình cho riêng yêu cầu đó)*


| Tham số | Mặc định | Mô tả |
|---|---|---|
| **camera** | *(theo cài đặt)* | Camera sử dụng: `front` hoặc `back` |
| **fps** | *(theo cài đặt, 10)* | Số khung hình mỗi giây, 1-30 |
| **quality** | *(theo cài đặt, 60)* | Chất lượng nén JPEG, 1-100 |
| **width** | *(theo cài đặt, 1280)* | Độ phân giải camera lớn nhất được dùng, 160-3840 |
| **rotate** | *(theo cài đặt, auto)* | Xoay theo chiều kim đồng hồ: `auto`, `0`, `90`, `180` hoặc `270`, giống như với `/api/camera/photo`. Nếu không truyền, áp dụng cài đặt **Góc xoay camera**, được suy ra từ cảm biến khi chưa đặt. Mọi giá trị khác đều trả về `400` |



**Ví dụ:**


```bash
# Watch with ffplay
ffplay "http://TABLET_IP:8080/api/camera/stream?camera=front&fps=10"

# In a web page
<img src="http://TABLET_IP:8080/api/camera/stream" />

# Save 10 seconds of stream
curl -m 10 "http://TABLET_IP:8080/api/camera/stream?fps=5" -o stream.mjpeg
```



**Home Assistant** — tích hợp *MJPEG IP Camera* (Cài đặt → Thiết bị & dịch vụ → Thêm tích hợp):


| Trường | Giá trị |
|---|---|
| **MJPEG URL** | `http://TABLET_IP:8080/api/camera/stream?camera=front&fps=10` |
| **URL ảnh tĩnh** | `http://TABLET_IP:8080/api/camera/photo?camera=front` |
| **Tên đăng nhập** | tùy ý (bị bỏ qua) |
| **Mật khẩu** | khóa API, nếu đã đặt |



**Lưu ý:**
- **Phát hiện chuyển động vẫn hoạt động.** Một camera chỉ phục vụ được một client, nên trong khi luồng chạy, chuyển động được đo trên chính các khung hình của luồng và đánh thức màn hình qua cùng đường xử lý với bộ phát hiện thông thường. Không cần cấu hình gì — độ nhạy đã chọn vẫn được áp dụng.
  - Đo trên máy tính bảng Xiaomi: khung hình được so sánh hai lần mỗi giây thay vì một lần, cảnh tĩnh nằm ở tỷ lệ điểm ảnh thay đổi 0.005-0.012 so với 0.026 của bộ phát hiện thông thường, và khi có chuyển động đạt 0.16-0.56. Từ lúc phát hiện đến lúc đánh thức màn hình mất 19 ms.
  - Điều duy nhất không phát hiện được: **thay đổi màu sắc ở độ sáng không đổi**, vì chỉ so sánh mặt phẳng luma. Chuyển động, người và thay đổi ánh sáng không bị ảnh hưởng.
- Camera được mở khi người xem đầu tiên kết nối và được giải phóng khi người xem cuối cùng rời đi.
- Tối đa **2 người xem đồng thời**; các yêu cầu tiếp theo nhận `503`. Người xem thứ hai yêu cầu camera còn lại cũng bị từ chối — mỗi lần chỉ dùng một camera.
- Đo trên máy tính bảng Xiaomi ở 1280×960, chất lượng 60, 10 fps: duy trì ~8 fps, ~80 KB mỗi khung hình (~5 Mbit/s), ~66% một nhân CPU. Hãy hạ `fps` và `quality` cho máy tính bảng gắn tường.
- Nếu hình bị xoay ngang, hãy đặt `rotate` — xem ghi chú về hướng camera ở mục `/api/camera/photo`.

#### `GET /api/camera/list`

Liệt kê các camera có trên thiết bị. **(v1.2.5+)**



```json
{
  "success": true,
  "data": {
    "cameras": [
      { "id": "0", "facing": "back", "maxWidth": 4032, "maxHeight": 3024 },
      { "id": "1", "facing": "front", "maxWidth": 2560, "maxHeight": 1920 }
    ]
  }
}
```




### Lệnh điều khiển (POST)

#### `POST /api/brightness`
Đặt độ sáng màn hình (tắt độ sáng tự động nếu đang bật).

> ⚠️ Khi **Ứng dụng điều khiển độ sáng** bị tắt trong cài đặt, endpoint này bị bỏ qua (độ sáng do hệ thống/Tasker quản lý).

```json
{ "value": 75 }
```

#### `POST /api/autoBrightness/enable`
Bật tự động điều chỉnh độ sáng dựa trên cảm biến ánh sáng môi trường.

> ⚠️ Khi **Ứng dụng điều khiển độ sáng** bị tắt trong cài đặt, endpoint này bị bỏ qua.
```json
{ "min": 10, "max": 100, "offset": 10 }
```
- `min`: Phần trăm độ sáng tối thiểu (0-100, mặc định: 10)
- `max`: Phần trăm độ sáng tối đa (0-100, mặc định: 100)
- `offset`: *(tùy chọn)* Phần trăm cố định cộng thêm vào độ sáng đã tính (0-100, mặc định: giữ nguyên cài đặt hiện tại). Ví dụ `10` nghĩa là sáng hơn 10% so với giá trị cảm biến tính ra

> 💡 Dùng đường cong logarit để phù hợp với cảm nhận tự nhiên. Độ sáng được tính dựa trên mức ánh sáng môi trường (dải 10-1000 lux), sau đó cộng thêm offset (giới hạn tối đa 100%).

#### `POST /api/autoBrightness/disable`
Tắt độ sáng tự động và khôi phục cài đặt độ sáng thủ công trước đó.

#### `GET /api/autoBrightness`
Lấy trạng thái độ sáng tự động hiện tại.
```json
{
  "success": true,
  "data": {
    "enabled": true,
    "min": 10,
    "max": 100,
    "currentLightLevel": 250.5
  }
}
```

#### `GET|POST /api/screen/on`
Bật màn hình / đánh thức thiết bị.

#### `GET|POST /api/screen/off`
Tắt màn hình.

> ⚠️ **Cần Device Owner để điều khiển màn hình đầy đủ**
> 
> | Tính năng | Không có đặc quyền | Device Admin | AccessibilityService (API 28+) | Device Owner |
> |---------|--------------|--------------|-------------------------------|---------------|
> | `screen/off` | ⚠️ Giảm độ sáng xuống 0% | ✅ `lockNow()` | ✅ `GLOBAL_ACTION_LOCK_SCREEN` | ✅ `lockNow()` |
> | `screen/on` | Khôi phục độ sáng | Đánh thức thiết bị | Đánh thức thiết bị | Đánh thức thiết bị |
> | `lock` | ❌ Lỗi | ✅ Hoạt động | ✅ Hoạt động | ✅ Hoạt động |
> | `reboot` | ❌ Không khả dụng | ❌ Không khả dụng | ❌ Không khả dụng | ✅ Hoạt động |
> | Chế độ kiosk | ⚠️ Hiện lời nhắc cho người dùng | ⚠️ Hiện lời nhắc cho người dùng | ⚠️ Hiện lời nhắc cho người dùng | ✅ Im lặng |
> 
> **Phân biệt `"on"` và `"screensaverActive"`:**  
> - `"on"` báo cáo **trạng thái màn hình vật lý** (PowerManager.isInteractive)
> - `"screensaverActive"` báo cáo **lớp phủ bảo vệ màn hình** có đang hiển thị hay không
> - Hai giá trị này **độc lập với nhau**: bảo vệ màn hình có thể đang hoạt động trong khi màn hình vẫn bật về mặt vật lý
> 
> **FreeKiosk dùng cách tiếp cận 4 tầng để tắt màn hình:**  
> 1. **Device Owner**: `DevicePolicyManager.lockNow()` — tắt màn hình thật sự  
> 2. **Device Admin**: `DevicePolicyManager.lockNow()` — cũng hoạt động, không cần Device Owner  
> 3. **AccessibilityService (API 28+)**: `GLOBAL_ACTION_LOCK_SCREEN` — hoạt động mà không cần bất kỳ đặc quyền quản trị nào  
> 4. **Dự phòng**: Giảm độ sáng xuống 0% (màn hình vẫn bật nhưng hiển thị màu đen)  
>
> Điều này nghĩa là FreeKiosk có thể cùng tồn tại với MDM hiện có đang giữ quyền Device Owner — chỉ cần kích hoạt Device Admin hoặc AccessibilityService là khóa màn hình hoạt động đầy đủ.
> 
> Để bật chế độ Device Owner, xem [Hướng dẫn cài đặt](installation.md#chế-độ-device-owner-nâng-cao).

#### `GET|POST /api/screensaver/on`
Bật cài đặt bảo vệ màn hình. Bảo vệ màn hình sẽ tự kích hoạt sau khoảng thời gian không hoạt động đã cấu hình.

#### `GET|POST /api/screensaver/off`
Tắt cài đặt bảo vệ màn hình. Bảo vệ màn hình sẽ không còn tự kích hoạt khi không có thao tác. Nếu bảo vệ màn hình đang hoạt động, nó sẽ bị hủy kích hoạt.

#### `GET|POST /api/reload`
Tải lại trang WebView hiện tại.

#### `POST /api/url`
Điều hướng đến một URL mới.
```json
{ "url": "https://example.com" }
```

#### `POST /api/mode`
Chuyển chế độ hiển thị khi ứng dụng đang chạy, không cần khởi động lại thiết bị. Hỗ trợ cả ba chế độ hiển thị: WebView, Ứng dụng ngoài và Trình phát đa phương tiện. Việc chuyển được áp dụng qua cùng quy trình thiết lập như khi đổi chế độ trong Cài đặt, nên cũng được giữ lại sau khi khởi động lại ứng dụng.

**Chuyển sang chế độ WebView:**
```json
{ "mode": "webview", "url": "https://example.com" }
```
`url` là tùy chọn (bỏ qua để giữ URL hiện tại). Nếu thiết bị được cấu hình ở chế độ Bảng điều khiển, WebView hiển thị lưới bảng điều khiển như đã cấu hình.

**Chuyển sang chế độ Ứng dụng ngoài (một ứng dụng):**
```json
{ "mode": "external_app", "package": "com.example.app" }
```
Ứng dụng phải được cài trên thiết bị. Dịch vụ lớp phủ (nút quay về) được khởi động tự động.

**Chuyển sang chế độ Ứng dụng ngoài (cấu hình đã lưu, ví dụ lưới nhiều ứng dụng):**
```json
{ "mode": "external_app" }
```
Bỏ qua `package` để khôi phục cấu hình Ứng dụng ngoài đã lưu của thiết bị (lưới launcher nhiều ứng dụng nếu đã cấu hình).

**Chuyển sang chế độ Trình phát đa phương tiện:**
```json
{ "mode": "media_player" }
```
Dùng danh sách phát và cài đặt Trình phát đa phương tiện đã được cấu hình sẵn trên thiết bị.

#### `GET|POST /api/wake`
Đánh thức khỏi trạng thái bảo vệ màn hình.

#### `POST /api/tts`
Chuyển văn bản thành giọng nói. Dùng engine TextToSpeech gốc của Android (xử lý phía máy chủ, không phụ thuộc cầu nối JS).
```json
{ "text": "Hello World" }
```

**Tham số:**
- `text` (string, bắt buộc): Văn bản cần đọc
- `language` (string, tùy chọn): Thẻ ngôn ngữ BCP 47 (ví dụ `"zh-CN"`, `"en-US"`, `"fr"`, `"ja"`, `"ko"`). Nếu bỏ qua, ngôn ngữ được **tự động phát hiện** từ nội dung văn bản dựa trên phân tích bảng chữ Unicode (CJK → tiếng Trung, Hangul → tiếng Hàn, Hiragana/Katakana → tiếng Nhật, chữ Ả Rập → tiếng Ả Rập, chữ Thái → tiếng Thái, Devanagari → tiếng Hindi, Cyrillic → tiếng Nga, Latin → mặc định của thiết bị)

**Ví dụ:**
```json
{ "text": "你好世界" }
{ "text": "Hello World", "language": "en-US" }
{ "text": "こんにちは", "language": "ja" }
```
> 💡 Ngôn ngữ được tự động phát hiện từ nội dung văn bản khi không chỉ định `language`. Giọng TTS phù hợp được chọn trước mỗi lần đọc. Cần cài sẵn dữ liệu TTS của ngôn ngữ đích trên thiết bị Android (kiểm tra Cài đặt Android → TTS).

#### `POST /api/volume`
Đặt âm lượng đa phương tiện (0-100).
```json
{ "value": 50 }
```

#### `GET /api/volume`
Lấy âm lượng đa phương tiện hiện tại.
```json
{
  "success": true,
  "data": { "level": 80, "maxLevel": 100 }
}
```

#### `POST /api/toast`
Hiển thị thông báo toast.
```json
{ "text": "Message displayed!" }
```

#### `POST /api/js`
Thực thi JavaScript trong WebView.
```json
{ "code": "alert('Hello!')" }
```

#### `GET|POST /api/clearCache`
Xóa bộ nhớ đệm WebView, cookie, localStorage và tải lại trang. Thực hiện xóa bộ nhớ đệm đầy đủ ở tầng native, bao gồm:
- Bộ nhớ đệm WebView (bộ nhớ đệm HTTP, hình ảnh, script)
- Cookie (mọi tên miền)
- Bộ nhớ lưu trữ web (localStorage, sessionStorage)
- Dữ liệu biểu mẫu

Sau đó buộc mount lại toàn bộ WebView.

#### `POST /api/app/launch`
Khởi chạy một ứng dụng ngoài.
```json
{ "package": "com.spotify.music" }
```

#### `GET|POST /api/reboot`
Khởi động lại thiết bị (cần chế độ Device Owner). Thực thi ở tầng native, không phụ thuộc cầu nối JS.

#### `GET|POST /api/lock`
Khóa màn hình thiết bị. Dùng `DevicePolicyManager.lockNow()` (Device Owner) hoặc `GLOBAL_ACTION_LOCK_SCREEN` (AccessibilityService, API 28+) để tắt màn hình thật sự.

> ⚠️ Nếu không có Device Owner hoặc AccessibilityService, endpoint này trả về lỗi. Hãy dùng `/api/screen/off` làm phương án dự phòng (giảm độ sáng về 0).

#### `GET|POST /api/restart-ui`
Khởi động lại giao diện ứng dụng FreeKiosk. Gọi `activity.recreate()` để khởi động lại hoàn toàn activity React Native mà không cần khởi động lại thiết bị. Hữu ích khi khắc phục sự cố giao diện từ xa.


### Điều khiển âm thanh (POST)

#### `POST /api/audio/play`
Phát âm thanh từ URL.
```json
{
  "url": "https://example.com/sound.mp3",
  "loop": false,
  "volume": 50
}
```

#### `GET|POST /api/audio/stop`
Dừng âm thanh đang phát.

#### `GET|POST /api/audio/beep`
Phát một tiếng bíp ngắn.


### Điều khiển từ xa - Android TV (GET hoặc POST)

Phù hợp để điều khiển thiết bị Android TV hoặc điều hướng trong các ứng dụng.

> **Cách hoạt động**: Sự kiện phím điều khiển từ xa được gửi ở tầng native bằng **AccessibilityService** (xuyên ứng dụng, hoạt động trong cả ứng dụng ngoài) hoặc `activity.dispatchKeyEvent()` (dự phòng, chỉ trong FreeKiosk). Khi AccessibilityService được bật:
> - Phím hoạt động trên **mọi ứng dụng** (WebView, ứng dụng ngoài, launcher Android)
> - Điều hướng D-pad làm nổi bật các thành phần giao diện (nút, liên kết, ô nhập)
> - Quay lại, Home và Ứng dụng gần đây kích hoạt các hành động hệ thống tương ứng
>
> Nếu không có AccessibilityService, phím chỉ hoạt động trong Activity của chính FreeKiosk.

| Endpoint | Phím |
|----------|-----|
| `GET\|POST /api/remote/up` | D-pad Lên |
| `GET\|POST /api/remote/down` | D-pad Xuống |
| `GET\|POST /api/remote/left` | D-pad Trái |
| `GET\|POST /api/remote/right` | D-pad Phải |
| `GET\|POST /api/remote/select` | Chọn/Enter |
| `GET\|POST /api/remote/back` | Quay lại |
| `GET\|POST /api/remote/home` | Home |
| `GET\|POST /api/remote/menu` | Menu |
| `GET\|POST /api/remote/playpause` | Phát/Tạm dừng |

### Giả lập bàn phím (GET hoặc POST) ⌨️

Giả lập thao tác nhập từ bàn phím trên thiết bị. Có ba chế độ:

#### Nhấn một phím: `GET|POST /api/remote/keyboard/{key}`

Nhấn một phím trên bàn phím. Tên phím nằm trong đường dẫn URL.

```bash
# Press letter 'a'
curl http://tablet-ip:8080/api/remote/keyboard/a

# Press Enter
curl http://tablet-ip:8080/api/remote/keyboard/enter

# Press F5 (refresh in most browsers)
curl http://tablet-ip:8080/api/remote/keyboard/f5

# Press Escape
curl http://tablet-ip:8080/api/remote/keyboard/escape

# Press Space
curl http://tablet-ip:8080/api/remote/keyboard/space
```

**Các phím được hỗ trợ:**

| Nhóm | Phím |
|----------|------|
| Chữ cái | `a` đến `z` |
| Chữ số | `0` đến `9` |
| Phím chức năng | `f1` đến `f12` |
| Điều hướng | `up`, `down`, `left`, `right`, `home`, `end`, `pageup`, `pagedown` |
| Chỉnh sửa | `enter` / `return`, `space`, `tab`, `backspace`, `delete` / `del`, `insert`, `escape` / `esc` |
| Phím bật/tắt | `capslock`, `numlock`, `scrolllock` |
| Phím bổ trợ | `shift`, `ctrl` / `control`, `alt`, `meta` / `win` / `cmd` |
| Đa phương tiện | `playpause`, `play`, `pause`, `stop`, `next` / `nexttrack`, `previous` / `prevtrack`, `volumeup`, `volumedown`, `mute` |
| Android | `back`, `menu`, `search`, `power`, `select` / `center`, `androidhome` |
| Ký hiệu | `period` / `dot`, `comma`, `minus` / `dash`, `plus`, `equals`, `semicolon`, `apostrophe` / `quote`, `slash`, `backslash`, `leftbracket`, `rightbracket`, `grave` / `backtick`, `at`, `pound` / `hash`, `star` / `asterisk` |
| Ký tự đơn | Bất kỳ ký tự đơn nào: `.`, `,`, `-`, `=`, `/`, `;`, `'`, v.v. |

> 💡 **Lưu ý**: Trong endpoint bàn phím, `home` ứng với phím Home của bàn phím (đưa con trỏ về đầu dòng), KHÔNG phải nút Home của Android. Hãy dùng `androidhome` hoặc `/api/remote/home` cho nút Home của Android.

#### Phím tắt: `GET|POST /api/remote/keyboard?map={combo}`

Gửi phím tắt kèm các phím bổ trợ. Định dạng: `modifier1+modifier2+key`.

```bash
# Copy (Ctrl+C)
curl "http://tablet-ip:8080/api/remote/keyboard?map=ctrl+c"

# Paste (Ctrl+V)
curl "http://tablet-ip:8080/api/remote/keyboard?map=ctrl+v"

# Select All (Ctrl+A)
curl "http://tablet-ip:8080/api/remote/keyboard?map=ctrl+a"

# Close tab (Ctrl+W)
curl "http://tablet-ip:8080/api/remote/keyboard?map=ctrl+w"

# Alt+F4
curl "http://tablet-ip:8080/api/remote/keyboard?map=alt+f4"

# Ctrl+Shift+A (uppercase A with Ctrl)
curl "http://tablet-ip:8080/api/remote/keyboard?map=ctrl+shift+a"
```

**Phím bổ trợ được hỗ trợ:** `ctrl` / `control`, `alt`, `shift`, `meta` / `win` / `cmd`

Phản hồi:
```json
{
  "success": true,
  "data": {
    "executed": true,
    "command": "keyboardCombo",
    "map": "ctrl+c",
    "key": "c",
    "keyCode": 31,
    "modifiers": ["ctrl"],
    "metaState": 28672
  }
}
```

#### Nhập văn bản: `POST /api/remote/text`

Nhập cả một chuỗi văn bản vào ô nhập liệu đang được focus.

```bash
curl -X POST http://tablet-ip:8080/api/remote/text \
  -H "Content-Type: application/json" \
  -d '{"text": "Hello World!"}'
```

Phản hồi:
```json
{
  "success": true,
  "data": {
    "executed": true,
    "command": "keyboardText",
    "textLength": 12
  }
}
```

> #### Dịch vụ trợ năng (khuyến nghị cho chế độ Ứng dụng ngoài)
>
> Theo mặc định, giả lập bàn phím chỉ hoạt động bên trong WebView của FreeKiosk. Để đưa phím vào **ứng dụng ngoài** (ví dụ khi dùng chế độ hiển thị Ứng dụng ngoài), cần bật **Dịch vụ trợ năng của FreeKiosk**:
>
> 1. Vào **Cài đặt → Nâng cao → Dịch vụ trợ năng** rồi chạm **"Mở cài đặt trợ năng"**
> 2. Trong cài đặt Android, tìm **FreeKiosk** trong mục "Dịch vụ đã cài đặt" và bật lên
> 3. Chỉ báo trạng thái trong cài đặt FreeKiosk sẽ hiển thị **"● Đang hoạt động"** khi đã sẵn sàng
>
> **Lối tắt cho Device Owner**: Nếu FreeKiosk được đặt làm Device Owner, có thể bật dịch vụ tự động mà không cần vào cài đặt Android — chỉ cần chạm **"Tự động bật"** trong Cài đặt nâng cao.
>
> **Cách hoạt động**: Khi Dịch vụ trợ năng đang hoạt động, FreeKiosk dùng nó cho mọi thao tác đưa phím vào (cả WebView lẫn ứng dụng ngoài). Khi tắt, FreeKiosk quay về dùng `dispatchKeyEvent()`, chỉ hoạt động trong Activity của chính FreeKiosk.
>
> **ROM tập trung vào quyền riêng tư** (e/OS, LineageOS, CalyxOS, GrapheneOS): Cách dùng Dịch vụ trợ năng hoạt động trên mọi ROM, khác với phương pháp `Instrumentation` vốn cần quyền cấp độ chữ ký (signature-level) mà các ROM này chặn.
>
> #### 📊 Tương thích theo phiên bản Android
>
> Phương pháp đưa phím vào phụ thuộc vào phiên bản Android của thiết bị:
>
> | Tính năng | Android 13+ (API 33+) | Android 5–12 (API 21–32) |
> |---|---|---|
> | **Quay lại / Home / Ứng dụng gần đây** | ✅ `performGlobalAction()` | ✅ `performGlobalAction()` |
> | **Điều hướng DPAD** (lên, xuống, trái, phải) | ✅ `InputMethod.sendKeyEvent()` | ✅ Duyệt cây trợ năng + cuộn |
> | **Select / Enter** (trên thành phần giao diện) | ✅ `InputMethod.sendKeyEvent()` | ✅ `ACTION_CLICK` trên phần tử đang focus |
> | **Phát/Tạm dừng** | ✅ `InputMethod.sendKeyEvent()` | ✅ `GLOBAL_ACTION_HEADSETHOOK` (API 31+) |
> | **Phím in được** (a-z, 0-9, ký hiệu) | ✅ `InputMethod.sendKeyEvent()` | ✅ `ACTION_SET_TEXT` (nối thêm ký tự) |
> | **Backspace** | ✅ `InputMethod.sendKeyEvent()` | ✅ `ACTION_SET_TEXT` (xóa ký tự cuối) |
> | **Nhập văn bản** | ✅ `InputMethod.commitText()` | ✅ `ACTION_SET_TEXT` (nối thêm văn bản) |
> | **Shift + chữ cái** (ví dụ Shift+A → 'A') | ✅ `InputMethod.sendKeyEvent()` | ✅ `ACTION_SET_TEXT` (ký tự đã áp dụng Shift) |
> | **Phím không in được** (Tab, Escape, F1-F12) | ✅ `InputMethod.sendKeyEvent()` | ⚠️ Hạn chế (`input keyevent` — cần root) |
> | **Tổ hợp Ctrl/Alt** (Ctrl+C, Alt+F4) | ✅ `InputMethod.sendKeyEvent()` | ⚠️ Hạn chế (mất meta state) |
>
> **Tóm tắt**: Trên Android 13+, mọi thứ đều hoạt động qua các API InputMethod. Trên Android 5–12, hầu hết thao tác điều khiển từ xa vẫn hoạt động: điều hướng DPAD qua duyệt cây trợ năng, Select qua `ACTION_CLICK`, Phát/Tạm dừng qua global action (API 31+), văn bản/phím in được qua `ACTION_SET_TEXT`. Chỉ Tab, phím F và các phím tắt Ctrl/Alt bị hạn chế.

### Vị trí GPS (GET)

#### `GET /api/location`

Trả về tọa độ GPS đã biết gần nhất của thiết bị. Sử dụng các nhà cung cấp vị trí GPS, Network và Passive.

> ⚠️ **Yêu cầu**: Đã cấp quyền vị trí và đã bật GPS trên thiết bị.

```bash
curl http://tablet-ip:8080/api/location
```

Phản hồi:
```json
{
  "success": true,
  "data": {
    "executed": true,
    "command": "getLocation",
    "available": true,
    "latitude": 48.8566,
    "longitude": 2.3522,
    "accuracy": 15.0,
    "altitude": 35.0,
    "speed": 0.0,
    "bearing": 0.0,
    "provider": "gps",
    "time": 1704672000000,
    "providers": ["gps", "network", "passive"]
  }
}
```

Nếu không có vị trí khả dụng:
```json
{
  "success": true,
  "data": {
    "executed": true,
    "command": "getLocation",
    "available": false,
    "error": "No location available. Ensure GPS is enabled and location permission is granted.",
    "providers": ["network", "passive"]
  }
}
```


## Xác thực

Nếu đã cấu hình khóa API, hãy đưa khóa vào các yêu cầu:

```bash
curl -H "X-Api-Key: your-api-key" http://tablet-ip:8080/api/status
```

Khóa cũng được chấp nhận làm **mật khẩu của thông tin xác thực HTTP Basic** (tên đăng nhập bị bỏ qua). Cách này dành cho các client không gửi được header tùy chỉnh — trong đó có tích hợp *MJPEG IP Camera* của Home Assistant:

```bash
curl -u "freekiosk:your-api-key" http://tablet-ip:8080/api/status
```

> [!TIP]
> Nên ưu tiên dùng header khi có thể. Thông tin xác thực Basic được gửi kèm trong mọi yêu cầu và, qua HTTP thuần, không được bảo vệ tốt hơn header — nhưng khác với tham số truy vấn, nó giúp khóa không xuất hiện trong URL, lịch sử trình duyệt và nhật ký máy chủ.


## Tích hợp Home Assistant

### Cảm biến cơ bản

```yaml
# configuration.yaml

rest:
  - resource: http://TABLET_IP:8080/api/status
    scan_interval: 30
    sensor:
      - name: "Tablet Battery"
        value_template: "{{ value_json.data.battery.level }}"
        unit_of_measurement: "%"
        device_class: battery
      
      - name: "Tablet Brightness"
        value_template: "{{ value_json.data.screen.brightness }}"
        unit_of_measurement: "%"
      
      - name: "Tablet Light Sensor"
        value_template: "{{ value_json.data.sensors.light | round(0) }}"
        unit_of_measurement: "lx"
        device_class: illuminance
      
      - name: "Tablet WiFi Signal"
        value_template: "{{ value_json.data.wifi.rssi }}"
        unit_of_measurement: "dBm"
        device_class: signal_strength

    binary_sensor:
      - name: "Tablet Screen"
        value_template: "{{ value_json.data.screen.on }}"
        device_class: power
      
      - name: "Tablet Charging"
        value_template: "{{ value_json.data.battery.charging }}"
        device_class: battery_charging
      
      - name: "Tablet Screensaver"
        value_template: "{{ value_json.data.screen.screensaverActive }}"

  - resource: http://TABLET_IP:8080/api/location
    scan_interval: 300
    sensor:
      - name: "Tablet GPS Latitude"
        value_template: "{{ value_json.data.latitude | default('unavailable') }}"
      
      - name: "Tablet GPS Longitude"
        value_template: "{{ value_json.data.longitude | default('unavailable') }}"
      
      - name: "Tablet GPS Accuracy"
        value_template: "{{ value_json.data.accuracy | default('unavailable') }}"
        unit_of_measurement: "m"

  - resource: http://TABLET_IP:8080/api/battery
    scan_interval: 60
    sensor:
      - name: "Tablet Battery Temperature"
        value_template: "{{ value_json.data.temperature }}"
        unit_of_measurement: "°C"
        device_class: temperature
      
      - name: "Tablet Battery Health"
        value_template: "{{ value_json.data.health }}"
```

### Lệnh REST

```yaml
rest_command:
  tablet_screen_on:
    url: http://TABLET_IP:8080/api/screen/on
    method: POST
  
  tablet_screen_off:
    url: http://TABLET_IP:8080/api/screen/off
    method: POST
  
  tablet_brightness:
    url: http://TABLET_IP:8080/api/brightness
    method: POST
    content_type: "application/json"
    payload: '{"value": {{ brightness }}}'
  
  tablet_navigate:
    url: http://TABLET_IP:8080/api/url
    method: POST
    content_type: "application/json"
    payload: '{"url": "{{ url }}"}'
  
  tablet_reload:
    url: http://TABLET_IP:8080/api/reload
    method: POST
  
  tablet_lock:
    url: http://TABLET_IP:8080/api/lock
    method: POST
  
  tablet_restart_ui:
    url: http://TABLET_IP:8080/api/restart-ui
    method: POST
  
  tablet_tts:
    url: http://TABLET_IP:8080/api/tts
    method: POST
    content_type: "application/json"
    payload: '{"text": "{{ message }}", "language": "{{ language | default(\'\') }}"}'
  
  tablet_volume:
    url: http://TABLET_IP:8080/api/volume
    method: POST
    content_type: "application/json"
    payload: '{"value": {{ volume }}}'
  
  tablet_beep:
    url: http://TABLET_IP:8080/api/audio/beep
    method: POST
  
  tablet_toast:
    url: http://TABLET_IP:8080/api/toast
    method: POST
    content_type: "application/json"
    payload: '{"text": "{{ message }}"}'
  
  tablet_screensaver_on:
    url: http://TABLET_IP:8080/api/screensaver/on
    method: POST
  
  tablet_screensaver_off:
    url: http://TABLET_IP:8080/api/screensaver/off
    method: POST
  
  tablet_keyboard_key:
    url: "http://TABLET_IP:8080/api/remote/keyboard/{{ key }}"
    method: GET
  
  tablet_keyboard_combo:
    url: "http://TABLET_IP:8080/api/remote/keyboard?map={{ combo }}"
    method: GET
  
  tablet_type_text:
    url: http://TABLET_IP:8080/api/remote/text
    method: POST
    content_type: "application/json"
    payload: '{"text": "{{ text }}"}'
```

### Công tắc có trạng thái

`rest_command` là một *service*, không phải thực thể: gọi nó vẫn chạy được, nhưng nó không có gì để
hiển thị, nên các lệnh ở trên chỉ cho ra nút bấm chứ không bao giờ là công tắc phản ánh đúng việc
máy tính bảng đang làm. Ghép một lệnh với cảm biến tương ứng trong phần **Cảm biến
cơ bản** ở trên là có được một công tắc thật sự.

```yaml
template:
  - switch:
      - name: "Tablet screen"
        state: "{{ is_state('binary_sensor.tablet_screen', 'on') }}"
        turn_on:
          service: rest_command.tablet_screen_on
        turn_off:
          service: rest_command.tablet_screen_off

      - name: "Tablet screensaver"
        state: "{{ is_state('binary_sensor.tablet_screensaver', 'on') }}"
        turn_on:
          service: rest_command.tablet_screensaver_on
        turn_off:
          service: rest_command.tablet_screensaver_off
```

`binary_sensor.tablet_screen` đọc `screen.on`, là trạng thái màn hình **vật lý**
lấy từ `PowerManager`, còn `screen.screensaverActive` là giá trị riêng: bảo vệ màn hình là một
lớp phủ do ứng dụng vẽ ra, nên nó có thể đang hiển thị trong khi tấm nền màn hình vẫn bật. Đó là lý do
cần hai công tắc chứ không phải một.

> ⚠️ **Trạng thái REST được lấy bằng polling, còn trạng thái MQTT được push.** Các cảm biến ở trên dùng
> `scan_interval: 30`, nên một công tắc tạo theo cách này có thể chậm hơn máy tính bảng tới 30 giây,
> kể cả ngay sau khi tự gạt công tắc. Giảm `scan_interval` sẽ rút ngắn độ trễ, đổi lại là mỗi chu kỳ
> tốn một yêu cầu HTTP cho mỗi máy tính bảng. Nếu muốn một công tắc cập nhật ngay khi máy tính bảng
> thay đổi, hãy dùng MQTT: MQTT publish ngay theo broadcast thực tế
> `ACTION_SCREEN_ON` / `ACTION_SCREEN_OFF` và Home Assistant tự phát hiện các thực thể. Xem
> [MQTT](MQTT.md). Hai cách này có thể cùng tồn tại trên một máy tính bảng.

### Camera ảnh chụp màn hình

```yaml
camera:
  - platform: generic
    name: "Tablet Screenshot"
    still_image_url: http://TABLET_IP:8080/api/screenshot
    content_type: image/png
```

### Camera của thiết bị (ảnh chụp)

```yaml
camera:
  - platform: generic
    name: "Tablet Camera (Back)"
    still_image_url: http://TABLET_IP:8080/api/camera/photo?camera=back&quality=80
    content_type: image/jpeg

  - platform: generic
    name: "Tablet Camera (Front)"
    still_image_url: http://TABLET_IP:8080/api/camera/photo?camera=front&quality=80
    content_type: image/jpeg
```

> 💡 **Mẹo**: Dùng camera trước làm camera an ninh cơ bản, hoặc camera sau để giám sát. Kết hợp với các automation để chụp ảnh khi có sự kiện phát hiện chuyển động.

### Ví dụ automation

#### Độ sáng tự động theo ánh sáng trong phòng
```yaml
automation:
  - alias: "Tablet Auto Brightness"
    trigger:
      - platform: state
        entity_id: sensor.living_room_light_level
    action:
      - service: rest_command.tablet_brightness
        data:
          brightness: "{{ (states('sensor.living_room_light_level') | float / 10) | int | min(100) }}"
```

#### Tắt màn hình vào ban đêm
```yaml
automation:
  - alias: "Tablet Screen Off at Night"
    trigger:
      - platform: time
        at: "23:00:00"
    action:
      - service: rest_command.tablet_screensaver_on
```

#### Đánh thức máy tính bảng khi có chuyển động
```yaml
automation:
  - alias: "Wake Tablet on Motion"
    trigger:
      - platform: state
        entity_id: binary_sensor.living_room_motion
        to: "on"
    condition:
      - condition: state
        entity_id: binary_sensor.tablet_screensaver
        state: "on"
    action:
      - service: rest_command.tablet_screensaver_off
```

#### Thông báo chuông cửa
```yaml
automation:
  - alias: "Doorbell Alert on Tablet"
    trigger:
      - platform: state
        entity_id: binary_sensor.doorbell
        to: "on"
    action:
      - service: rest_command.tablet_beep
      - service: rest_command.tablet_toast
        data:
          message: "Someone is at the door!"
      - service: rest_command.tablet_navigate
        data:
          url: "http://homeassistant:8123/lovelace/cameras"
```


## Kiểm thử bằng cURL

```bash
# Get status
curl http://TABLET_IP:8080/api/status

# Set brightness
curl -X POST -H "Content-Type: application/json" \
  -d '{"value": 50}' http://TABLET_IP:8080/api/brightness

# Play beep
curl -X POST http://TABLET_IP:8080/api/audio/beep

# Save screenshot
curl http://TABLET_IP:8080/api/screenshot -o screenshot.png

# Show toast
curl -X POST -H "Content-Type: application/json" \
  -d '{"text": "Hello!"}' http://TABLET_IP:8080/api/toast

# Keyboard: press Enter
curl http://TABLET_IP:8080/api/remote/keyboard/enter

# Keyboard: Ctrl+A (select all)
curl "http://TABLET_IP:8080/api/remote/keyboard?map=ctrl+a"

# Type text into focused field
curl -X POST -H "Content-Type: application/json" \
  -d '{"text": "Hello World!"}' http://TABLET_IP:8080/api/remote/text

# Get GPS location
curl http://TABLET_IP:8080/api/location
```


## Phản hồi lỗi

```json
{
  "success": false,
  "error": "Error message",
  "timestamp": 1704672000
}
```

Các lỗi thường gặp:
- `401 Unauthorized` - Khóa API không hợp lệ hoặc bị thiếu
- `403 Forbidden` - Các lệnh điều khiển đang bị tắt
- `404 Not Found` - Endpoint không tồn tại
- `500 Internal Error` - Lỗi máy chủ


## Xem thêm

- [Hướng dẫn cấu hình ADB](adb-configuration.md) - Cấp phát thiết bị headless qua ADB
- [Hướng dẫn cài đặt](installation.md) - Thiết lập thủ công


## Nhật ký thay đổi

### v1.2.0
- Phát hành REST API đầu tiên
- Hơn 40 endpoint để điều khiển thiết bị toàn diện
- Sẵn sàng tích hợp với Home Assistant
- Cảm biến: pin, độ sáng, ánh sáng, tiệm cận, lưu trữ, bộ nhớ, Wi-Fi
- Điều khiển: màn hình, độ sáng, âm lượng, âm thanh, điều hướng, điều khiển từ xa
- Chụp ảnh màn hình
- Phát âm thanh (URL, tiếng bíp)
