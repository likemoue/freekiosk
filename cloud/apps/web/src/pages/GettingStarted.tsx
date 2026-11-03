import { BatteryWarning, Camera, Check, Copy, Download, KeyRound, QrCode, SlidersHorizontal, Tv, Zap, CalendarClock, WifiOff } from 'lucide-react';
import { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useCan } from '../auth';
import { Badge, Button, Card, Notice, PageHeader } from '../ui';

function Bullet({ children }: { children: ReactNode }) {
  return (
    <li className="flex gap-2 text-sm">
      <Check className="mt-0.5 size-4 shrink-0 text-ok" /> <span>{children}</span>
    </li>
  );
}

function Tip({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex gap-3 text-sm">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand-strong dark:text-brand [&_svg]:size-4">{icon}</span>
      <span className="pt-1">{children}</span>
    </li>
  );
}

export default function GettingStarted() {
  const can = useCan();
  return (
    <>
      <PageHeader title="Bắt đầu" hint="Hai cách đưa máy đầu tiên vào quản lý. Cách bạn chọn quyết định máy làm được những gì về sau." />

      <p className="mb-3 text-xs font-bold tracking-widest text-soft uppercase">Bước 1</p>
      <h2 className="text-lg font-bold">Chọn cách thiết lập máy</h2>
      <p className="mb-4 text-sm text-soft">Android chỉ trao toàn quyền cho máy được cấp phát từ trạng thái gốc. Cài ứng dụng bằng tay sẽ mất quyền đó cho tới khi khôi phục máy, nên hãy chọn đúng ngay từ đầu.</p>

      <div className="grid gap-5 md:grid-cols-2">
        <Card className="p-6">
          <div className="flex items-center gap-2">
            <QrCode className="size-5 text-brand" />
            <Badge tone="info">Khuyên dùng</Badge>
          </div>
          <h3 className="mt-3 font-bold">Cấp phát bằng mã QR</h3>
          <p className="text-[13px] text-soft">Máy mới, hoặc máy khôi phục cài đặt gốc được</p>
          <p className="mt-3 text-sm">Chạm 6 lần ở màn hình chào mừng để mở trình quét rồi quét mã. Máy tự tải FreeKiosk, tự cài, trở thành Device Owner và tự đăng ký.</p>
          <ul className="mt-3 space-y-1.5">
            <Bullet>Khởi động lại, cài im lặng, tắt màn hình thật</Bullet>
            <Bullet>Không phải tải hay cài gì bằng tay</Bullet>
            <Bullet>Ghi sẵn được thông tin Wi-Fi vào mã</Bullet>
          </ul>
          {can.operate && <Link to="/quan-ly/thiet-bi/them" className="mt-4 inline-flex"><Button><QrCode className="size-4" /> Tạo mã QR</Button></Link>}
        </Card>

        <Card className="p-6">
          <Download className="size-5 text-soft" />
          <h3 className="mt-3 font-bold">Cài ứng dụng bằng tay</h3>
          <p className="text-[13px] text-soft">Máy đang dùng, không khôi phục được</p>
          <p className="mt-3 text-sm">Cài APK lên máy, mở FreeKiosk, vào Cài đặt, Nâng cao, Quản lý Cloud, rồi nhập địa chỉ máy chủ cùng mã đăng ký.</p>
          <Notice tone="warn" className="mt-3">Máy ở chế độ tiêu chuẩn: không khởi động lại, không cài im lặng, không tắt màn hình thật. Muốn có các quyền này phải khôi phục gốc và đi theo đường QR. Đăng ký cũng xóa các cài đặt FreeKiosk có sẵn trên máy.</Notice>
          <p className="mt-3 flex gap-2 text-[13px] text-soft"><Tv className="size-4 shrink-0" /> Android TV, Google TV, Fire TV: cài APK bằng adb rồi nhập địa chỉ và mã bằng điều khiển từ xa, vì TV không có camera để quét.</p>
          {can.operate && <Link to="/quan-ly/thiet-bi/them" className="mt-4 inline-flex"><Button variant="outline"><KeyRound className="size-4" /> Lấy mã đăng ký</Button></Link>}
        </Card>
      </div>

      <p className="mt-8 mb-3 text-xs font-bold tracking-widest text-soft uppercase">Bước 2</p>
      <h2 className="text-lg font-bold">Cấu hình và điều khiển</h2>
      <p className="mb-4 text-sm text-soft">Máy báo cáo 30 giây một lần và hiện ngoại tuyến sau hai phút không có tín hiệu.</p>
      <Card className="p-6">
        <ul className="grid gap-4 md:grid-cols-2">
          <Tip icon={<SlidersHorizontal />}>Đổi nội dung hiển thị ở trang của từng máy. Cấu hình được đẩy xuống ở lần báo cáo kế tiếp.</Tip>
          <Tip icon={<Copy />}>Lưu cấu hình thành hồ sơ để áp dụng cho cả nhóm một lần.</Tip>
          <Tip icon={<Zap />}>Gửi lệnh (tải lại, chụp màn hình, đọc văn bản, khởi động lại) và xem kết quả trong lịch sử.</Tip>
          <Tip icon={<CalendarClock />}>Hẹn giờ các thao tác lặp lại, và nhận cảnh báo khi máy mất kết nối hay yếu pin.</Tip>
        </ul>
      </Card>

      <h2 className="mt-8 text-lg font-bold">Những điều nên biết</h2>
      <p className="mb-4 text-sm text-soft">Các nguyên nhân gây sự cố hay gặp nhất.</p>
      <Card className="p-6">
        <ul className="space-y-4">
          <Tip icon={<BatteryWarning />}>Hãy cấp quyền bỏ tối ưu hóa pin khi ứng dụng hỏi. Thiếu quyền này, Android sẽ ngắt máy khỏi mạng sau một lúc chạy bằng pin.</Tip>
          <Tip icon={<Camera />}>Cấp quyền camera và micrô trước khi bật chế độ khóa: Android ẩn hộp thoại xin quyền khi đang khóa.</Tip>
          <Tip icon={<WifiOff />}>Máy ở chế độ ứng dụng ngoài vẫn báo cáo, nhưng lệnh chạy qua JavaScript có thể chậm cho tới khi FreeKiosk trở lại tiền cảnh.</Tip>
          <Tip icon={<QrCode />}>Cấp phát bằng QR phải dùng bản build <code>-Pcloudprovi</code>. Bản có dịch vụ trợ năng bị Play Protect chặn ngay trong trình cài đặt.</Tip>
        </ul>
      </Card>
    </>
  );
}
