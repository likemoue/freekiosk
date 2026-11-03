

# In im lặng của FreeKiosk

**In im lặng từ trang web tới máy in ESC/POS, không hiện hộp thoại in**

<p>
  <a href="README.md">Trang chủ tài liệu</a> •
  <a href="features-and-modes.md">Tính năng & chế độ</a> •
  <a href="faq.md">Câu hỏi thường gặp</a>
</p>


> [!IMPORTANT]
> Khung in (print framework) của Android luôn hiện hộp thoại in của hệ thống, kể cả với các dịch vụ in. Kiosk
> vận hành không giám sát thì không có ai chạm vào hộp thoại đó, vì vậy FreeKiosk tự điều khiển máy in.


## Mục lục

- [Những gì cần có](#những-gì-cần-có)
- [Thiết lập](#thiết-lập)
- [In từ trang web](#in-từ-trang-web)
- [JavaScript API](#javascript-api)
- [Khắc phục sự cố](#khắc-phục-sự-cố)
- [Hạn chế](#hạn-chế)


## Những gì cần có

- Máy in USB hiểu **ESC/POS**, bộ lệnh máy in POS phổ biến nhất. Máy in chỉ hiểu ngôn ngữ in
  nhãn như ZPL hoặc TSPL thì không được hỗ trợ.
- Bộ chuyển đổi USB-C có cổng **cấp nguồn xuyên suốt (power passthrough)**, để máy tính bảng vẫn được sạc khi
  máy in đang cắm.

Máy in được nhận diện theo **USB Printer Class**, không theo danh sách kiểu máy, nên phần cứng lạ
nhìn chung vẫn dùng được. Máy in chỉ có giao diện riêng của nhà sản xuất vẫn in được, nhưng không thể báo
mức giấy; hãy thêm nó vào `android/app/src/main/res/xml/usb_printer_filter.xml` theo vendor id và
product id nếu Android không đề xuất FreeKiosk khi cắm máy in.

> [!NOTE]
> **Phần cứng đã kiểm chứng.** Việc in đã được xác nhận từ đầu đến cuối trên **Xprinter C58H** (58mm),
> gắn với **HONOR Pad X8b LTE** chạy **Android 16**, in một trang web qua print stylesheet riêng của trang
> ở độ rộng mặc định **384 chấm**. Không cần mã riêng cho từng kiểu máy hay mục lọc nào. Chưa xác nhận được
> việc báo mức giấy trên kiểu máy đó — xem
> [Hạn chế](#hạn-chế).


## Thiết lập

1. Cắm máy in vào bộ chuyển đổi và bật máy in.
2. Android hỏi ứng dụng nào sẽ mở thiết bị này. Chọn **FreeKiosk** và đánh dấu **Luôn mở**.
3. Vào **Cài đặt > Chung > In ấn**.
4. Trong mục **In im lặng**, bật tùy chọn **Bật in im lặng**. Không cần bật
   **Bật in bằng window.print()**, tùy chọn này chỉ điều khiển `window.print()`. Nếu trang in bằng
   `window.print()` và không thể sửa mã của trang (ví dụ một dịch vụ lưu trữ sẵn), hãy bật thêm
   **Gửi window.print() tới máy in này**.
5. Kiểm tra thẻ trạng thái hiển thị tên máy in, rồi chạm **In trang thử**.

> [!WARNING]
> Thực hiện bước 2 **trước khi** bật chế độ khóa. Android chặn hộp thoại đó trong lock task, và nút
> **Cấp quyền truy cập** trong Cài đặt chỉ có tác dụng cho đến lần rút máy in kế tiếp. Chỉ lựa chọn
> "Luôn mở" mới còn hiệu lực sau khi khởi động lại, hoặc sau việc liệt kê lại thiết bị USB (re-enumeration) mà bộ chuyển đổi USB-C có cấp nguồn gây ra khi
> cắm hoặc rút nguồn của nó.

Trang thử hiển thị thước cột, ký tự tiền tệ và ký tự có dấu, dải xám chuyển sắc và các đường kẻ mảnh. Nếu
thước bị xuống dòng hoặc chừa lề rộng, **Độ rộng in** đang sai.

Độ rộng được đặt theo **chấm (dot)**, tức độ rộng vùng in được ghi trong thông số kỹ thuật của máy in. Chấm là đơn vị
máy in thực sự xử lý, nên không nơi nào giả định khổ giấy hay độ phân giải.


## In từ trang web

Gọi `window.FreeKiosk.silentPrinter.print()`. Print stylesheet của chính trang sẽ là thứ xuất hiện trên giấy,
gồm cả phông chữ, ngôn ngữ và mọi mã QR.

`window.print()` mở hộp thoại in của Android khi **Bật in bằng window.print()** đang bật, và
không làm gì nếu tắt. Khi **Gửi window.print() tới máy in này** đang bật, lệnh sẽ in tại đây thay vì thế, không
hiện hộp thoại, bất kể cài đặt In bằng window.print() ra sao: tùy chọn này dành cho trang mà không thể sửa mã, và
nó chuyển mọi lệnh `window.print()` của trang tới máy in hóa đơn.

Nếu tắt tùy chọn đó, một trang có thể dùng cả hai: A4 qua hộp thoại và hóa đơn qua In im lặng, nhưng cả hai đều
kết xuất cùng một stylesheet `@media print`. Hãy chuyển nó sang bố cục hóa đơn trước khi gọi
`silentPrinter.print()`, ví dụ bằng một class trên `<html>`, hoặc tự kết xuất hóa đơn rồi gọi
`printImage()`.

### In một frame ẩn (react-to-print, print-js)

Các thư viện như react-to-print và print-js sao chép nội dung cần in vào một `<iframe>` ẩn rồi gọi
`print()` của frame đó. Android bỏ qua lệnh gọi ở đó, nên FreeKiosk sao chép style và nội dung của frame
vào trang trong lúc in rồi in chính trang đó, qua hộp thoại hoặc qua máy in này, tùy theo cách
`window.print()` sẽ dùng. Một nút bên trong frame gọi `print()` của chính nó
cũng được xử lý theo cách tương tự.

- Chỉ sao chép được frame cùng origin (nguồn gốc) với trang. Frame khác origin (cross-origin) không in được.
- Những gì được sao chép: `<style>` và các liên kết stylesheet của frame, phần body, các giá trị đã gõ vào
  các ô nhập liệu và nội dung vẽ của các canvas. Script của frame không chạy lại.
- Hình ảnh được chờ tối đa 3 giây trước khi trang được kết xuất.
- Print stylesheet của chính trang vẫn áp dụng cho bản sao: một quy tắc ẩn mọi thứ trừ một
  phần tử của trang cũng có thể ẩn luôn bản sao.

Trang được dàn sao cho **một pixel CSS tương ứng một chấm của máy in**, nên hãy thiết kế theo độ rộng
đã cấu hình — 384px ở ví dụ dưới:

```css
@page {
  size: 384px auto;   /* the configured dot width */
  margin: 0;
}

@media print {
  body { width: 384px; margin: 0; color: #000; background: #fff; }
  .no-print { display: none; }
}
```

Ưu tiên `px` và phần trăm hơn `mm` hay `pt`: đơn vị vật lý nghĩa là bất cứ thứ gì trình duyệt cho là một
inch, và điều đó chẳng liên quan gì đến máy in. Giữ bố cục đơn giản — chữ đen trên nền trắng, không
có ảnh nền, và chữ đủ lớn để vẫn đọc được ở mức một chấm trên một pixel.

Trang đã được dàn sẵn theo độ rộng đã cấu hình, nên `width: 100%` và phần trăm dùng được mà không cần
lặp lại độ rộng theo chấm trong CSS — hữu ích khi cùng một trang phải in trên hai cuộn giấy khác nhau.

Hãy vẽ mã QR dưới dạng **SVG nội tuyến (inline SVG)** thay vì PNG. Mã vẫn là vector xuyên suốt bước kết xuất và
được chuyển thành các chấm một lần, ở độ phân giải gốc của máy in, thay vì bị co giãn từ kích thước
pixel mà trang đã chọn.


## JavaScript API

`window.FreeKiosk.silentPrinter` được chèn vào khi **Bật in im lặng** đang bật. Mọi lệnh gọi đều trả về một promise, nên
trang biết được lệnh in có thành công hay không, và `getStatus()` cho phép kiểm tra giấy trước khi hứa sẽ có
một phiếu in.

```js
window.addEventListener('freekiosk:ready', async () => {
  const { state, paper, printer } = await window.FreeKiosk.silentPrinter.getStatus();
  if (state !== 'ready') return;

  await window.FreeKiosk.silentPrinter.print('Test print');
});
```

Việc chèn diễn ra sau khi trang tải xong, nên hãy kiểm tra `window.FreeKiosk` ngay lúc in, hoặc
chờ sự kiện `freekiosk:ready`.

| Phương thức | Mô tả |
|--------|-------------|
| `getStatus()` | Trả về (resolve) `{ state, paper, printer }` |
| `print(jobName?)` | Kết xuất trang qua print stylesheet của nó và in kết quả, không hiện hộp thoại |
| `printImage(base64)` | In ảnh PNG hoặc JPEG, có hoặc không có tiền tố `data:` |

`print` dàn lại trang để in vào lúc được gọi, nên bản kết xuất `@media print` của trang mới là thứ
ra giấy, chứ không phải thứ đang hiện trên màn hình — một thay đổi DOM thực hiện ngay trước lệnh gọi sẽ được in. `jobName`
chỉ đặt tên cho lệnh in và không bao giờ được in ra; mặc định là tiêu đề của tài liệu.

`print` và `printImage` trả về (resolve) `true` khi máy in đã nhận đủ mọi byte.

`printImage` giải mã ở độ phân giải in chứ không phải độ phân giải gốc của ảnh, nên một bức ảnh lấy thẳng từ
camera không tốn bộ nhớ hơn một hóa đơn. Nó từ chối (reject) với `BAD_IMAGE` đối với dữ liệu lớn hơn 8MB,
và đối với ảnh có kích thước pixel quá lớn để giải mã an toàn ngay cả sau khi giảm kích thước như vậy.

`state` là một trong các giá trị `ready`, `no_printer`, `no_permission`, `paper_out` hoặc `error`. `paper` là `ok`,
`out` hoặc `unknown`. `unknown` nghĩa là không đọc được trạng thái giấy, và không chặn việc in.
Máy in không có cảm biến giấy thường báo `ok`, nên `ok` không đảm bảo còn giấy.

Các lần từ chối (reject) đều mang một `code`: `NO_PRINTER`, `NO_PERMISSION`, `PAPER_OUT`, `OPEN_FAILED`, `WRITE_FAILED`,
`BAD_IMAGE`, `PAGE_RENDER_FAILED`, `NO_WEBVIEW`, `ORIGIN_NOT_ALLOWED`, hoặc `ERROR` cho mọi trường hợp
không lường trước.

Tùy chọn **Giới hạn in theo nguồn gốc** trong Cài đặt chỉ cho phép dùng `window.FreeKiosk.silentPrinter`, kể cả `getStatus()`,
với các origin được liệt kê. Chỉ scheme, host và port của từng mục được so sánh. Khi bật mà
không liệt kê gì, không trang nào in được. Khi tắt, bất kỳ trang nào kiosk hiển thị đều có thể in. Giới hạn này cũng áp dụng cho
`window.print()` được chuyển tới máy in này. Nó không áp dụng cho hộp thoại in, vốn dù sao cũng cần có người
xác nhận.

Bản thân iframe không dùng được `window.FreeKiosk`: nó chỉ được chèn vào frame chính, và yêu cầu máy in
không xuất phát từ frame chính sẽ bị loại bỏ. `print()` của frame cùng origin được frame chính xử lý,
như mô tả trong [In một frame ẩn](#in-một-frame-ẩn-react-to-print-print-js),
còn frame khác origin thì không bao giờ in được.


## Khắc phục sự cố

| Triệu chứng | Nguyên nhân |
|---------|-------|
| Trạng thái hiển thị **Không phát hiện máy in** | Cáp, bộ chuyển đổi hoặc nguồn của máy in. Kiểm tra bộ chuyển đổi có truyền dữ liệu, không chỉ truyền điện |
| Trạng thái hiển thị **Chưa cấp quyền truy cập** | Chạm **Cấp quyền truy cập**. Nếu máy in đã cắm sẵn khi cài FreeKiosk, Android chưa từng đưa ra lựa chọn "Luôn mở" — hãy rút ra rồi cắm lại một lần để hiện lời nhắc đó |
| Thước bị xuống dòng, hoặc chừa lề rộng | **Độ rộng in** sai. Kiểm tra độ rộng theo chấm trong thông số kỹ thuật của máy in |
| Không in được gì, không báo lỗi | Máy in hết giấy nhưng không có cảm biến. Kiểm tra cuộn giấy |
| Một dải trắng dài sau mỗi lần in | Giảm **Đẩy giấy sau khi in** |
| `PAGE_RENDER_FAILED` | Không kết xuất được trang. Hãy để trang tự kết xuất bitmap của nó rồi gọi `printImage` thay thế |


## Hạn chế

- Chỉ hỗ trợ USB. Chưa hỗ trợ máy in Bluetooth và máy in mạng.
- Bộ lệnh là ESC/POS. Các ngôn ngữ in nhãn (ZPL, TSPL, EPL) và chế độ đồ họa riêng của Star chưa
  được triển khai.
- Mức giấy chỉ được báo bởi các máy in triển khai yêu cầu trạng thái của USB Printer Class, và
  chưa được xác nhận trên máy in nào như vậy. `getStatus()` trả về `paper: 'unknown'` khi
  không đọc được, và điều đó không chặn việc in.
