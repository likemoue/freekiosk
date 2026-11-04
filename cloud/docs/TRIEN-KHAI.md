# Triển khai FreeKiosk Manager

Theo đúng luồng hạ tầng đang có:

```text
Tablet, trình duyệt ──▶ Cloudflare ──▶ Cloudflare Tunnel ──▶ VM Nginx Proxy Manager ──▶ VM Ubuntu
                       (HTTPS)                               172.16.10.20:80            172.16.8.186:8090
                                                                                        └─ web (nginx)
                                                                                           ├─ api (NestJS)
                                                                                           └─ database (PostgreSQL)
```

Các địa chỉ trong tài liệu này là của hạ tầng hiện tại: VM Ubuntu `172.16.8.186`, Nginx Proxy Manager
`172.16.10.20`, tên miền `mdm.ism.io.vn`. Triển khai ở nơi khác thì thay bằng giá trị tương ứng.

## Yêu cầu

- VM Ubuntu có Docker và plugin Compose. Trên Ubuntu: `sudo apt install docker.io docker-compose-v2 docker-buildx`, rồi `sudo usermod -aG docker $USER`.
- 2 vCPU, 2 GB RAM là đủ cho vài trăm thiết bị. Dung lượng đĩa tùy lượng video của bảng hiệu số: đĩa phải chứa được **3 lần** `MEDIA_QUOTA_GB` (thư viện, một bản sao lưu, bản đang ghi), cộng khoảng 8 GB cho hệ thống và image.
- VM NPM truy cập được VM Ubuntu qua cổng `8090`.
- **Đặt IP cố định cho VM** (giữ chỗ trên máy chủ DHCP): NPM trỏ tới IP này, IP đổi thì website mất kết nối.

Cài Ubuntu mặc định chỉ dùng một nửa ổ. Xem còn trống không bằng `sudo vgs`, rồi cấp hết cho hệ thống. Làm được khi máy đang chạy:

```bash
sudo lvextend -r -l +100%FREE /dev/ubuntu-vg/ubuntu-lv
```

## 1. Cài trên VM Ubuntu

```bash
sudo mkdir -p /opt/freekiosk && sudo chown "$USER" /opt/freekiosk
git clone https://github.com/likemoue/freekiosk /opt/freekiosk
cd /opt/freekiosk/cloud
```

Tạo tệp `.env` với các khóa ngẫu nhiên, truyền vào địa chỉ công khai, IP LAN của VM này và email quản trị:

```bash
sh deploy/init-env.sh https://mdm.ism.io.vn 0.0.0.0 admin@ism.io.vn
```

Lệnh in ra mật khẩu đăng nhập lần đầu. **Hãy lưu lại tệp `.env` ở nơi an toàn**: mất `APP_SECRET` là mất
các thông tin bí mật đã mã hóa (mã PIN trong hồ sơ, mật khẩu MQTT, SMTP...).

Đặt hạn mức thư viện theo đĩa của bạn, ví dụ `echo MEDIA_QUOTA_GB=10 >> .env`.

Khởi động:

```bash
docker compose up -d --build
```

Thứ tự được compose lo: database (sẵn sàng) → migrate (chạy xong thoát) → api → web. Kiểm tra:

```bash
docker compose ps
curl -s http://172.16.8.186:8090/healthz
```

Phải trả về `{"status":"ok"}`.

### Tường lửa

Docker mở cổng bỏ qua UFW, nên phải chặn ở chuỗi `DOCKER-USER`, chỉ cho VM NPM vào. Dùng một dịch vụ systemd để luật được đặt lại
sau mỗi lần khởi động. Không dùng `iptables-persistent`, vì nó lưu cả các luật Docker tự sinh rồi khôi phục bản cũ:

```bash
sudo tee /etc/systemd/system/freekiosk-firewall.service > /dev/null <<'EOF'
[Unit]
Description=Chi cho Nginx Proxy Manager vao cong 8090 cua FreeKiosk Manager
After=docker.service
Requires=docker.service
PartOf=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/bin/sh -c 'iptables -C DOCKER-USER -p tcp -m conntrack --ctorigdstport 8090 --ctdir ORIGINAL ! -s 172.16.10.20 -j DROP 2>/dev/null || iptables -I DOCKER-USER -p tcp -m conntrack --ctorigdstport 8090 --ctdir ORIGINAL ! -s 172.16.10.20 -j DROP'
ExecStop=/usr/sbin/iptables -D DOCKER-USER -p tcp -m conntrack --ctorigdstport 8090 --ctdir ORIGINAL ! -s 172.16.10.20 -j DROP

[Install]
WantedBy=multi-user.target
EOF
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now freekiosk-firewall
```

Nếu không chặn, ai trong mạng LAN cũng vào thẳng được VM, bỏ qua Cloudflare.

## 2. Nginx Proxy Manager

Tạo **Proxy Host**:

| Mục | Giá trị |
|---|---|
| Domain Names | `mdm.ism.io.vn` |
| Scheme | `http` |
| Forward Hostname / IP | `172.16.8.186` |
| Forward Port | `8090` |
| Block Common Exploits | Bật |
| Websockets Support | Không cần: trang quản lý cập nhật bằng cách hỏi định kỳ |
| Access List | **Publicly Accessible** (xem cảnh báo ở mục 4) |
| SSL | Không bắt buộc. Tắt **Force SSL** nếu Cloudflare Tunnel nối tới NPM bằng HTTP, nếu không sẽ lặp chuyển hướng |

Trong thẻ **Advanced**, dán:

```nginx
client_max_body_size 64m;
proxy_request_buffering off;
proxy_buffering off;
proxy_read_timeout 300s;
proxy_send_timeout 300s;
```

## 3. Cloudflare Tunnel

Trong Zero Trust, **Networks > Tunnels**, chọn tunnel đang dùng, thêm **Public Hostname**:

| Mục | Giá trị |
|---|---|
| Subdomain | `mdm` |
| Domain | `ism.io.vn` |
| Type | `HTTP` |
| URL | `172.16.10.20:80` |

Giống các dịch vụ khác của bạn, tunnel trỏ về NPM chứ không trỏ thẳng VM Ubuntu. NPM chọn đúng proxy host
theo tên miền nên không cần đặt gì thêm.

Kiểm tra từ bên ngoài:

```bash
curl -s https://mdm.ism.io.vn/healthz
```

## 4. Quan trọng: đừng chặn đường của tablet

> [!CAUTION]
> Tablet không đăng nhập được Cloudflare Access và không vượt được thử thách trình duyệt. Mọi lớp chặn
> đều phải chừa các đường dẫn dưới đây.

| Đường dẫn | Ai dùng | Vì sao không chặn được |
|---|---|---|
| `/api/v1/*` | Ứng dụng trên tablet | Tín hiệu, lệnh, cấu hình, xác thực bằng khóa riêng từng máy |
| `/media/*` | Trình phát trên tablet | Tệp của danh sách phát, mở bằng mã trong đường dẫn |
| `/player/*` | Trình phát trên tablet | Trang phát video YouTube |
| `/dpc-apk-download*` | Trình cài đặt Android | Tải APK khi cấp phát bằng QR, chưa có tài khoản nào |

Cụ thể:

- **Phiên bản TLS.** Zone `ism.io.vn` đang đặt TLS tối thiểu 1.3. Android 8 và 9 không có TLS 1.3 nên **không kết nối được**,
  cả khi cấp phát bằng QR. Có máy đời đó thì phải hạ xuống 1.2, áp dụng cho cả zone.
- **Cloudflare Access.** IMS của bạn đang dùng Access theo email công ty. Nếu muốn dùng cho trang này, hãy
  tạo thêm một Access Application **Bypass (Everyone)** cho 4 đường dẫn trên, và không cần thêm gì cho
  `/api/admin/*` vì đã có đăng nhập và 2FA riêng.
- **WAF, Bot Fight Mode, Browser Integrity Check.** Ứng dụng Android gọi API bằng OkHttp, dễ bị xem là bot.
  Tạo **WAF Custom Rule**, hành động **Skip**, áp dụng cho `/api/v1/`, `/media/`, `/player/`,
  `/dpc-apk-download`. Riêng Bot Fight Mode (gói Free) không bỏ qua được bằng rule Skip nào, và áp dụng cho cả zone
  `ism.io.vn`: nếu đang bật thì phải tắt, hoặc dùng Super Bot Fight Mode của gói trả phí, loại này có rule Skip.
  Zone hiện tại đang tắt Bot Fight Mode, và OkHttp, Dalvik, DownloadManager, WebView đều đi qua không bị thử thách, nên
  chưa cần rule này. Chỉ tạo khi có máy thật sự bị chặn.
- **Cache.** Không tạo Cache Rule cho `/api/`, và không bật "Cache Everything" cho tên miền này.

Vì sao phải kỹ: ứng dụng gốc coi 401 và 403 kéo dài quá 30 phút là "đã bị xóa khỏi cloud" và **tự xóa toàn bộ
cài đặt, kể cả đăng ký**. Bản này đã được sửa để không tính trang HTML của proxy vào đó, nhưng máy vẫn mất kết
nối trong lúc bị chặn, và một lớp chặn trả JSON vẫn có thể gây xóa.

## 5. Đăng nhập lần đầu

1. Mở `https://mdm.ism.io.vn`, đăng nhập bằng email và mật khẩu lúc tạo `.env`.
2. Đổi mật khẩu theo yêu cầu.
3. Vào **Cài đặt, Bảo mật** để bật xác thực hai lớp.
4. Vào **Bắt đầu** để thêm thiết bị đầu tiên.

Sau khi đã đổi mật khẩu, có thể xóa dòng `ADMIN_PASSWORD` khỏi `.env`: nó chỉ dùng khi chưa có người dùng nào.

## 6. Build ứng dụng Android

Ứng dụng bản Việt hóa cần được build và ký bằng khóa của bạn. Trên máy có Android SDK và JDK 17 trở lên:

```bash
cd android
cp gradle.properties.example gradle.properties
```

Tạo khóa ký một lần rồi điền vào `gradle.properties`. **Giữ kỹ khóa này**: mất là không cập nhật được các máy đã cài.

```bash
keytool -genkeypair -v -keystore app/freekiosk-release.keystore -alias freekiosk -keyalg RSA -keysize 2048 -validity 10000
```

Cần hai bản APK:

```bash
./gradlew assembleRelease -Pcloudprovi
```

Bản này tải lên mục **Ứng dụng (APK)** và chọn **Đặt làm APK cấp phát**: dùng cho cấp phát bằng QR, vì Play Protect
chặn ngay trong trình cài đặt nếu APK có dịch vụ trợ năng.

```bash
./gradlew assembleRelease
```

Bản này có dịch vụ trợ năng, dùng khi cài bằng ADB. Tệp nằm ở `android/app/build/outputs/apk/release/app-release.apk`.

Địa chỉ máy chủ mặc định của ứng dụng đặt ở hai nơi, nếu tên miền của bạn khác `mdm.ism.io.vn`:

- `src/config/features.ts`, `DEFAULT_CLOUD_URL`
- `android/app/src/main/java/com/freekiosk/MainActivity.kt`, `DEFAULT_CLOUD_URL`

## 7. Cài tablet bằng cáp USB

Đây là cách nên dùng. Quét QR trên Samsung Android 16 hiện dừng ở "Đã xảy ra lỗi" ngay sau khi tải APK, trước khi ứng
dụng được chạy, nhiều khả năng do Google chặn ứng dụng quản lý chưa được duyệt, nên không sửa được bằng mã nguồn.
Cách này chỉ thay bước cài, nên giới hạn TLS ở mục 4 vẫn áp dụng.

**Cách nhanh:** công cụ `scripts/cai-tablet-usb`. Chạy `build.ps1` một lần, mở
`release-builds/CaiTablet-USB/CaiTablet.exe`, nhập một mã đăng ký dùng được nhiều máy, rồi cắm từng tablet đã bật
**Gỡ lỗi USB**. Công cụ tự làm mọi bước bên dưới và tắt **Gỡ lỗi USB** khi xong. Công cụ tạo được mã có sẵn nhóm và hồ sơ
ngay trong cửa sổ của nó (cần Windows 11), và áp được tệp sao lưu làm sẵn lên từng tablet. Xem `scripts/cai-tablet-usb/README.md`.

**Cách làm tay:**

1. Trên tablet: máy mới hoặc đã khôi phục gốc, **không đăng nhập tài khoản nào**, vì Android từ chối Device Owner khi máy
   có tài khoản. Bật **Tùy chọn nhà phát triển**, rồi **Gỡ lỗi USB**. Cắm cáp và chọn **Cho phép**.
2. Trên trang quản lý: **Thêm thiết bị**, **Tiêu chuẩn**, **Tạo mã**. Chép lệnh ở mục **Cài không cần chạm máy, qua ADB**.
3. Chạy lần lượt bằng `adb` trong Android SDK platform-tools. Lệnh cuối là lệnh vừa chép, đổi `1234` thành mã PIN của máy:

```bash
adb install -r app-release.apk
```

```bash
adb shell pm grant com.freekiosk android.permission.WRITE_SECURE_SETTINGS
```

```bash
adb shell dpm set-device-owner com.freekiosk/.DeviceAdminReceiver
```

```bash
adb shell am start -n com.freekiosk/.MainActivity --es pin "1234" --es cloud_url "https://mdm.ism.io.vn" --es cloud_token "MA_DANG_KY"
```

Đăng ký xóa cài đặt đang có trên máy, kể cả PIN vừa gửi, nên khi tablet đã lên website hãy chạy lại lệnh cuối chỉ với
`--es pin`, nếu không PIN sẽ về mặc định `1234`.

Dùng bản `assembleRelease`. Nếu Play Protect chặn lúc cài thì dùng bản `-Pcloudprovi` và bỏ lệnh `pm grant`: bản này không
có dịch vụ trợ năng. Cài xong hãy tắt **Gỡ lỗi USB**.

## Cập nhật phiên bản

```bash
cd /opt/freekiosk && git pull
cd cloud && docker compose up -d --build
```

Migration chạy tự động trước khi API khởi động. Tablet không bị ảnh hưởng trong lúc cập nhật: chúng tiếp tục
chạy, và báo cáo lại khi máy chủ lên.

**Cập nhật ứng dụng trên tablet:** tăng `versionCode` trong `android/app/build.gradle`, build bản `assembleRelease` rồi tải
lên mục **Ứng dụng (APK)**. Sau đó nhấn **Cài đặt** để đẩy xuống từng máy hoặc cả nhóm, hoặc trên tablet vào **Nâng cao**,
**Kiểm tra cập nhật**. Cả hai đều cài im lặng nên cần Device Owner. Bản này không phát hành trên GitHub, nên tablet chưa
đăng ký sẽ báo chưa có bản phát hành.

## Sao lưu và khôi phục

Sao lưu cơ sở dữ liệu và `.env` giữ 14 bản, tệp đã tải lên giữ 1 bản vì nặng. Chạy lúc 2 giờ sáng giờ Việt Nam (VM đang dùng giờ UTC). Bản sao lưu nằm cùng đĩa với dữ liệu nên không cứu được khi hỏng cả VM: hãy chép `/var/backups/freekiosk` sang nơi khác.

```bash
sudo install -d -o "$USER" -g "$USER" -m 700 /var/backups/freekiosk
```

```bash
(crontab -l 2>/dev/null; echo '0 19 * * * cd /opt/freekiosk/cloud && sh deploy/backup.sh /var/backups/freekiosk 14 >> /var/backups/freekiosk/backup.log 2>&1') | crontab -
```

Cron không báo lỗi cho ai, nên hãy xem `backup.log` để biết lần sao lưu gần nhất có chạy không.

Ảnh màn hình không được sao lưu vì tự hết hạn sau 30 ngày. Khôi phục:

```bash
sh deploy/restore.sh /var/backups/freekiosk 20261103-020000
```

> [!WARNING]
> Thiết bị đăng ký **sau** thời điểm của bản sao lưu sẽ bị máy chủ từ chối và tự hủy đăng ký sau 30 phút. Hãy đăng
> ký lại các máy đó, và tốt nhất là tắt API tới khi quyết định xong.

## Khi có sự cố

| Hiện tượng | Kiểm tra |
|---|---|
| `502` từ Cloudflare | `docker compose ps`; NPM có tới được `172.16.8.186:8090` không |
| Lặp chuyển hướng | Tắt **Force SSL** trong proxy host của NPM |
| Tablet báo "Không kết nối được máy chủ" | `curl https://mdm.ism.io.vn/healthz` từ mạng của tablet; xem mục 4 |
| Tablet ngoại tuyến nhưng vẫn có mạng | **Bảo mật > Sự kiện** trên Cloudflare, tìm yêu cầu tới `/api/v1/` bị chặn |
| Tải tệp lên bị lỗi | Thẻ Advanced của NPM phải có `client_max_body_size 64m` |
| Cấp phát QR báo lỗi tải về | Phải dùng bản `-Pcloudprovi`, và `/dpc-apk-download/` phải mở được khi chưa đăng nhập |
| Cấp phát QR báo sai checksum | Tải APK lên lại rồi tạo mã QR mới: mã cũ giữ checksum của APK cũ |
| Không chụp được màn hình | Bật "Cho phép chụp màn hình từ xa" trong cấu hình thiết bị |
| Video YouTube không phát | Một số video cấm nhúng. Trang `/player/youtube/` phải mở được khi chưa đăng nhập |
| Đăng nhập báo Cloudflare chặn (HTTP 403) | WAF Custom Rule của zone đang thử thách mật khẩu đã lộ (`cf.waf.credential_check.password_leaked`), ví dụ `admin`. Thêm tên miền này vào ngoại lệ của rule, hoặc đi vòng qua Cloudflare để đổi mật khẩu khác: `ssh -L 8090:127.0.0.1:8090 itadmin@172.16.8.186`, rồi mở `http://localhost:8090` |
| Quên mật khẩu quản trị duy nhất | Xem bên dưới |

Đặt lại mật khẩu khi không còn quản trị viên nào đăng nhập được, rồi khởi động lại để tạo lại từ `ADMIN_PASSWORD`:

```bash
docker compose exec database sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "DELETE FROM \"User\" WHERE email = '"'"'admin@ism.io.vn'"'"'"'
docker compose restart api
```

Lệnh này chỉ tạo lại tài khoản khi bảng người dùng đã trống, nên chỉ dùng được khi đó là tài khoản duy nhất.

Xem nhật ký:

```bash
docker compose logs -f --tail=100 api
```
