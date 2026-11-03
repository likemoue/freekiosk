

# Hướng dẫn phát triển FreeKiosk

**Build, chạy và phát hành FreeKiosk trên máy cục bộ**

<p>
  <a href="README.md">Trang chủ tài liệu</a> •
  <a href="installation.md">Cài đặt</a> •
  <a href="roadmap-and-changelog.md">Lộ trình</a>
</p>

## Mục lục

- [Điều kiện tiên quyết](#điều-kiện-tiên-quyết)
- [Yêu cầu bổ sung](#yêu-cầu-bổ-sung)
- [Thiết lập cục bộ](#thiết-lập-cục-bộ)
- [Chạy trên Android](#-chạy-trên-android)
- [Sự cố thường gặp](#sự-cố-thường-gặp)
- [Build APK bản phát hành](#build-apk-bản-phát-hành)
- [Vị trí đầu ra](#vị-trí-đầu-ra)
- [Đóng góp](#đóng-góp)
- [Cách đóng góp](#cách-đóng-góp)
- [Tài liệu kỹ thuật liên quan](#tài-liệu-kỹ-thuật-liên-quan)
- [Cấu trúc dự án](#cấu-trúc-dự-án)



> [!NOTE]
> Trang này tập trung vào **thiết lập cho người đóng góp**. Việc triển khai vận hành được mô tả trong [`installation.md`](installation.md).

## Điều kiện tiên quyết



| Công cụ | Phiên bản | Mục đích |
|---|---|---|
| **Node.js** | 18+ | Môi trường chạy JavaScript |
| **React Native CLI** | Mới nhất | Phát triển đa nền tảng |
| **Android Studio** | Mới nhất | Trình giả lập Android và công cụ build |
| **JDK** | 17+ | Phát triển Java cho Android |
| **Git** | Mới nhất | Quản lý phiên bản |



### Yêu cầu bổ sung

- **Android SDK** (API level 26+ / Android 8.0+)
- **Thiết bị Android thật** hoặc **trình giả lập** để kiểm thử
- Đã bật **Gỡ lỗi USB** trên thiết bị phát triển

## Thiết lập cục bộ



```bash
# Clone the repository
git clone https://github.com/rushb-fr/freekiosk.git
cd freekiosk

# Install dependencies
npm install

# iOS dependencies (if developing for iOS)
cd ios && pod install && cd ..
```



> [!TIP]
> Nhớ chạy `pod install` sau mỗi thay đổi đối với các dependency native.

## 📱 Chạy trên Android



```bash
# Start Metro bundler
npm start

# In another terminal, run on Android
npx react-native run-android

# Or run on specific device
npx react-native run-android --device <device_id>
```



### Sự cố thường gặp

| Sự cố | Cách khắc phục |
|---|---|
| **Metro bundler không khởi động** | Xóa bộ nhớ đệm: `npm start -- --reset-cache` |
| **Build thất bại** | Dọn bản build Android: `cd android && ./gradlew clean && cd ..` |
| **Không nhận diện được thiết bị** | Kiểm tra gỡ lỗi USB: `adb devices` |

## Build APK bản phát hành



```bash
# Navigate to Android directory
cd android

# Build release APK (GitHub release, website download)
./gradlew assembleRelease

# Build release APK for the cloud (accessibility service stripped, see below)
./gradlew assembleRelease -Pcloudprovi

# Build release AAB (for Play Store)
./gradlew bundleRelease -Pplaystore
```

Một bản phát hành tạo ra **hai** APK. APK được tải lên FreeKiosk Cloud phải là bản build
`-Pcloudprovi`: Cloud phân phối nó cho trình hướng dẫn thiết lập Android trong quá trình cấp phát thiết bị
Device Owner bằng QR, và Play Protect chặn bản cài sideload có khai báo dịch vụ trợ năng,
khiến trình hướng dẫn dừng với thông báo "App blocked to protect your device". APK trên GitHub giữ lại
dịch vụ này cho việc cấp phát qua ADB, đây cũng là cách duy nhất để cấp
`WRITE_SECURE_SETTINGS` cho phép bật dịch vụ đó.



### Vị trí đầu ra



| Định dạng | Đường dẫn |
|---|---|
| **APK** | `android/app/build/outputs/apk/release/app-release.apk` |
| **AAB** | `android/app/build/outputs/bundle/release/app-release.aab` |



> [!IMPORTANT]
> Với bản build production, hãy bảo đảm đã cấu hình khóa ký (signing key) trong `android/app/build.gradle`.

## Đóng góp



| Tài nguyên | Liên kết |
|---|---|
| **Hướng dẫn đóng góp** | [CONTRIBUTING.md](../../CONTRIBUTING.md) |
| **Trình theo dõi issue** | [GitHub Issues](https://github.com/rushb-fr/freekiosk/issues) |
| **Thảo luận** | [GitHub Discussions](https://github.com/rushb-fr/freekiosk/discussions) |
| **FAQ** | [Câu hỏi thường gặp](faq.md) |



### Cách đóng góp

1. **Fork** repository
2. **Tạo** nhánh tính năng: `git checkout -b feature/amazing-feature`
3. **Commit** các thay đổi: `git commit -m 'Add amazing feature'`
4. **Push** lên nhánh: `git push origin feature/amazing-feature`
5. **Mở** một Pull Request

## Tài liệu kỹ thuật liên quan



| Tài liệu | Trọng tâm |
|---|---|
| **Hướng dẫn cài đặt** | [Cài đặt](installation.md) - Hướng dẫn thiết lập thủ công |
| **Cấu hình ADB** | [Cấu hình ADB](adb-configuration.md) - Cấp phát thiết bị bằng script |
| **REST API** | [REST API](rest-api.md) - Các endpoint HTTP và tự động hóa |
| **MQTT** | [MQTT](MQTT.md) - Tích hợp Home Assistant |
| **Lộ trình** | [Lộ trình và nhật ký thay đổi](roadmap-and-changelog.md) - Lập kế hoạch phát hành |




## Cấu trúc dự án



```
freekiosk/
├── src/                    # React Native source code
│   ├── components/         # Reusable UI components
│   ├── screens/           # App screens
│   ├── navigation/        # Navigation configuration
│   └── assets/           # Images and resources
├── android/               # Android-specific code
│   ├── app/              # Main Android app
│   ├── gradle/           # Gradle build configuration
│   └── build.gradle      # Android build script
├── ios/                  # iOS-specific code (if applicable)
├── docs/                 # Documentation source
└── __tests__/           # Unit tests
```








