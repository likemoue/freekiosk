# Tích hợp

**Kết nối FreeKiosk với hệ thống tự động hóa**

[Trang chủ tài liệu](README.md) • [REST API](rest-api.md) • [MQTT](MQTT.md)


> [!IMPORTANT]
> REST API và MQTT có thể chạy đồng thời trên cùng một thiết bị.

## Mục lục

- [Các kênh tích hợp](#các-kênh-tích-hợp)
- [REST API](#rest-api)
- [MQTT](#mqtt)
- [Thiết lập headless](#thiết-lập-headless)
- [Chọn phương thức tích hợp](#chọn-phương-thức-tích-hợp)


## Các kênh tích hợp

FreeKiosk cung cấp hai phương thức tích hợp chính:

| Kênh | Phù hợp nhất cho | Tài liệu |
|---------|----------|---------------|
| **REST API** | Điều khiển theo yêu cầu qua HTTP | [Tài liệu REST API](rest-api.md) |
| **MQTT** | Telemetry thời gian thực + Home Assistant | [Tài liệu MQTT](MQTT.md) |

### So sánh tính năng

| Tính năng | REST API | MQTT |
|---------|:--------:|:----:|
| **Phương thức điều khiển** | Yêu cầu/phản hồi | Lệnh dạng push |
| **Telemetry** | Polling | Thời gian thực |
| **HA Discovery** | Thủ công | Tự động |
| **Khả dụng** | Trạng thái HTTP | LWT |
| **Bảo mật** | Khóa API | Tên đăng nhập/mật khẩu |


## REST API

**Điều khiển qua HTTP để quản lý thiết bị theo yêu cầu.**

### Tính năng chính

- **Hơn 40 endpoint** - Điều khiển toàn diện thiết bị
- **Trạng thái thiết bị** - Dữ liệu cảm biến theo thời gian thực
- **Điều khiển điều hướng** - Chuyển URL và chuyển ứng dụng
- **Chụp hình ảnh** - Truy cập ảnh chụp màn hình và camera
- **Bảo mật API** - Xác thực bằng khóa API (tùy chọn)

### Phù hợp nhất cho

- Tích hợp HTTP với Home Assistant
- Điều khiển từ ứng dụng di động
- Shell script (curl/wget)
- Bảng điều khiển web (JavaScript)

### Bắt đầu nhanh

```bash
# Get device status
curl -H "X-Api-Key: your-key" http://tablet-ip:8080/api/status

# Navigate to new URL
curl -X POST -H "X-Api-Key: your-key" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://new-dashboard.com"}' \
  http://tablet-ip:8080/api/url

# Take screenshot
curl -H "X-Api-Key: your-key" http://tablet-ip:8080/api/screenshot -o screenshot.png

# Watch the live camera stream (enable it first in Settings > Advanced > REST API)
ffplay "http://tablet-ip:8080/api/camera/stream?camera=front&fps=10"
```

> [!TIP]
> Xem [Tài liệu tham chiếu REST API](rest-api.md) đầy đủ để biết tất cả endpoint.

### Dùng máy tính bảng làm camera

Máy tính bảng gắn tường thường là thiết bị duy nhất đã được lắp sẵn trong phòng. Khi bật **Luồng camera trực tiếp**, camera của máy sẽ xuất hiện trong Home Assistant thông qua tích hợp *MJPEG IP Camera*:



| Trường | Giá trị |
|---|---|
| **MJPEG URL** | `http://TABLET_IP:8080/api/camera/stream?camera=front&fps=10` |
| **URL ảnh tĩnh** | `http://TABLET_IP:8080/api/camera/photo?camera=front` |
| **Tên đăng nhập / Mật khẩu** | tùy ý / khóa API, nếu đã đặt |



```yaml
# Or in configuration.yaml
camera:
  - platform: mjpeg
    name: Lobby Kiosk
    mjpeg_url: http://TABLET_IP:8080/api/camera/stream?camera=front&fps=10
    still_image_url: http://TABLET_IP:8080/api/camera/photo?camera=front
```

> [!NOTE]
> Tính năng đánh thức khi có chuyển động vẫn hoạt động trong lúc stream đang chạy: camera chỉ nhận một máy khách, nên chuyển động được đo ngay trên các khung hình của stream. Không cần cấu hình gì, và độ nhạy đã chọn vẫn được áp dụng. Khác biệt duy nhất trên thực tế là sự thay đổi màu ở độ sáng không đổi sẽ không bị phát hiện, vì chỉ so sánh mặt phẳng luma.

> [!TIP]
> MJPEG tốn tài nguyên: dự trù khoảng 5 Mbit/s và khoảng hai phần ba một nhân CPU ở 1280×960, chất lượng 60, 10 fps. Với nhu cầu giám sát thông thường, 5 fps và chất lượng 50 trông gần như giống hệt mà chỉ tốn một nửa chi phí. Nếu chỉ cần ảnh tĩnh, [các thực thể camera của MQTT](MQTT.md#-hình-ảnh-ảnh-chụp-màn-hình-và-camera) rẻ hơn nhiều.


## MQTT

**Telemetry thời gian thực và tự động phát hiện thiết bị trong Home Assistant.**

### Tính năng chính

- **Giao thức MQTT** - Hỗ trợ v5 / v3.1.1
- **HA Discovery** - Tự động cấu hình trong Home Assistant
- **Khả dụng** - Trạng thái LWT (Last Will Testament)
- **Telemetry** - Publish dữ liệu cảm biến theo thời gian thực
- **Điều khiển từ xa** - Các topic subscribe để nhận lệnh

### Phù hợp nhất cho

- Tích hợp Home Assistant (tự động phát hiện)
- Giám sát liên tục
- Tự động hóa theo sự kiện
- Quản lý nhiều thiết bị

### Bắt đầu nhanh

**Cấu hình Home Assistant:**
```yaml
mqtt:
  broker: your-broker-ip
  port: 1883
  discovery: true
  discovery_prefix: homeassistant
```

**Cấu trúc topic:**
```
freekiosk/lobby/availability         # Device online/offline
freekiosk/lobby/state                # All sensor data (JSON)
freekiosk/lobby/set/brightness       # Set brightness command
freekiosk/lobby/set/url              # Navigate to URL
```

> [!TIP]
> Xem [Tài liệu tham chiếu MQTT](MQTT.md) đầy đủ về topic và lệnh.


## Thiết lập headless

**Cấu hình các tích hợp qua ADB để triển khai hàng loạt.**

### Tham số cấu hình

**REST API:**
- `rest_api_enabled` - Bật REST API (`"true"`)
- `rest_api_port` - Cổng API (`"8080"`)
- `rest_api_key` - Khóa xác thực API

**MQTT:**
- `mqtt_enabled` - Bật MQTT (`"true"`)
- `mqtt_broker_url` - IP/hostname của broker
- `mqtt_port` - Cổng của broker (`"1883"`)
- `mqtt_username` - Tên đăng nhập MQTT
- `mqtt_password` - Mật khẩu MQTT
- `mqtt_discovery_prefix` - Tiền tố discovery của HA (`"homeassistant"`)

### Lệnh ví dụ

**Chỉ REST API:**
```bash
adb shell am start -n com.freekiosk/.MainActivity \
    --es rest_api_enabled "true" \
    --es rest_api_port "8080" \
    --es rest_api_key "my-secret-key" \
    --es pin "1234"
```

**Chỉ MQTT:**
```bash
adb shell am start -n com.freekiosk/.MainActivity \
    --es mqtt_enabled "true" \
    --es mqtt_broker_url "192.168.1.100" \
    --es mqtt_username "homeassistant" \
    --es mqtt_password "mqtt-password" \
    --es pin "1234"
```

**Cả hai cùng lúc:**
```bash
adb shell am start -n com.freekiosk/.MainActivity \
    --es rest_api_enabled "true" \
    --es rest_api_port "8080" \
    --es rest_api_key "my-secret-key" \
    --es mqtt_enabled "true" \
    --es mqtt_broker_url "192.168.1.100" \
    --es mqtt_username "homeassistant" \
    --es mqtt_password "mqtt-password" \
    --es pin "1234"
```

> [!NOTE]
> Xem [Hướng dẫn cấu hình ADB](adb-configuration.md) đầy đủ để biết tất cả tham số.


## Chọn phương thức tích hợp

### Hướng dẫn lựa chọn

| Trường hợp sử dụng | Nên dùng | Lý do |
|----------|-------------|-----|
| **Home Assistant** | MQTT | Tự động phát hiện + thời gian thực |
| **Ứng dụng di động** | REST API | Yêu cầu HTTP đơn giản |
| **Giám sát** | REST API | Polling để lấy trạng thái |
| **Tự động hóa theo sự kiện** | MQTT | Thông báo dựa trên push |
| **Tích hợp web** | REST API | Thân thiện với JavaScript |
| **Đội nhiều thiết bị** | MQTT | Broker tập trung |
| **Script** | REST API | Lệnh curl dễ dùng |
| **Điều khiển thời gian thực** | Cả hai | Tận dụng ưu điểm của cả hai |

### Cách kết hợp

Dùng cả hai để linh hoạt tối đa:

- **MQTT** - Telemetry liên tục và HA discovery
- **REST API** - Lệnh theo yêu cầu và chụp hình ảnh
- **ADB** - Cấp phát thiết bị ban đầu và cấu hình hàng loạt


## Tài liệu liên quan

- **REST API:** [Tài liệu tham chiếu đầy đủ các endpoint](rest-api.md)
- **MQTT:** [Topic, discovery và lệnh](MQTT.md)
- **Cấu hình ADB:** [Cấp phát thiết bị headless](adb-configuration.md)
- **Cài đặt:** [Hướng dẫn thiết lập thiết bị](installation.md)
- **FAQ:** [Câu hỏi thường gặp](faq.md)
