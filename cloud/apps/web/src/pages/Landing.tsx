import { useQuery } from '@tanstack/react-query';
import { ArrowRight, BellRing, CalendarClock, Camera, Download, FolderTree, Lock, LogIn, MonitorSmartphone, Package, Presentation, ShieldCheck, SlidersHorizontal, Zap } from 'lucide-react';
import { ReactNode, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { Logo } from '../layout';

const FEATURES: Array<{ icon: ReactNode; color: string; title: string; text: string }> = [
  { icon: <MonitorSmartphone />, color: 'bg-blue-500', title: 'Trạng thái trực tiếp', text: 'Pin, mạng, màn hình và bộ nhớ của từng máy, cập nhật mỗi 30 giây, kèm nhật ký xuất được ra CSV.' },
  { icon: <Zap />, color: 'bg-violet-500', title: 'Lệnh từ xa', text: 'Bật tắt màn hình, tải lại, khởi động lại, chụp màn hình, đọc văn bản, phát âm thanh, mở ứng dụng.' },
  { icon: <FolderTree />, color: 'bg-rose-500', title: 'Nhóm và thao tác hàng loạt', text: 'Chia máy theo cơ sở, phòng ban. Đổi URL hay gửi lệnh cho cả nhóm chỉ với một thao tác.' },
  { icon: <SlidersHorizontal />, color: 'bg-orange-500', title: 'Hồ sơ cấu hình', text: 'Đặt URL, độ sáng, chế độ khóa một lần. Sửa hồ sơ là mọi máy đang dùng hồ sơ đó tự cập nhật.' },
  { icon: <Presentation />, color: 'bg-teal-500', title: 'Bảng hiệu số', text: 'Danh sách phát gồm video, ảnh, trang web và YouTube, có lịch theo giờ và phát được khi mất mạng.' },
  { icon: <BellRing />, color: 'bg-cyan-500', title: 'Cảnh báo', text: 'Mất kết nối, pin yếu, sắp hết bộ nhớ: báo qua email, webhook có chữ ký, Slack, Discord và ntfy.' },
  { icon: <Camera />, color: 'bg-indigo-500', title: 'Ảnh màn hình từ xa', text: 'Xem màn hình đang hiển thị gì mà không cần có mặt tại chỗ, lưu lại thành thư viện theo từng máy.' },
  { icon: <Package />, color: 'bg-emerald-500', title: 'Phân phối APK', text: 'Tải APK lên một lần, cài im lặng cho cả nhóm, và cấp phát máy mới chỉ bằng một mã QR.' },
  { icon: <ShieldCheck />, color: 'bg-slate-600', title: 'Dữ liệu ở nhà bạn', text: 'Chạy trên máy chủ của bạn. Xác thực hai lớp, khóa riêng từng thiết bị, bí mật được mã hóa.' },
];

const STEPS = [
  { title: 'Đăng ký', text: 'Tạo mã trên trang quản lý, nhập vào máy hoặc quét QR. Máy xuất hiện sau vài giây.' },
  { title: 'Theo dõi', text: 'Mỗi máy báo cáo 30 giây một lần: pin, mạng, bộ nhớ, trang đang hiển thị.' },
  { title: 'Điều khiển', text: 'Gửi lệnh và áp dụng cấu hình cho một máy, một nhóm, hoặc toàn bộ, từ bất kỳ đâu.' },
];

function Preview() {
  const rows = [
    { name: 'Sảnh chính', model: 'Galaxy Tab A9', battery: 92, seen: '12 giây trước', online: true },
    { name: 'Thư viện tầng 2', model: 'Lenovo Tab M10', battery: 68, seen: '27 giây trước', online: true },
    { name: 'Phòng họp A', model: 'Fire HD 10', battery: 34, seen: '9 giây trước', online: true },
    { name: 'Cổng bảo vệ', model: 'Galaxy Tab A8', battery: 15, seen: '6 phút trước', online: false },
  ];
  return (
    <div aria-hidden="true" className="rounded-2xl border border-slate-200 bg-white p-5 text-slate-900 shadow-2xl shadow-blue-950/10">
      <div className="mb-4 flex items-center gap-3">
        <span className="flex size-9 items-center justify-center rounded-xl bg-blue-500 text-white">
          <MonitorSmartphone className="size-5" />
        </span>
        <div className="flex-1">
          <div className="text-sm font-bold">Tổng quan</div>
          <div className="text-xs text-slate-500">Hình minh họa</div>
        </div>
        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">● Trực tiếp</span>
      </div>
      <div className="grid grid-cols-4 gap-2">
        {[
          ['Tổng số', '24', 'text-blue-600'],
          ['Trực tuyến', '22', 'text-emerald-600'],
          ['Ngoại tuyến', '2', 'text-rose-600'],
          ['Pin TB', '81%', 'text-slate-900'],
        ].map(([label, value, color]) => (
          <div key={label} className="rounded-xl bg-slate-50 p-3">
            <div className="text-[11px] text-slate-500">{label}</div>
            <div className={`text-xl font-bold ${color}`}>{value}</div>
          </div>
        ))}
      </div>
      <div className="mt-4 space-y-1.5">
        {rows.map((row) => (
          <div key={row.name} className="flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-2">
            <span className={`size-2 rounded-full ${row.online ? 'bg-emerald-500' : 'bg-rose-500'}`} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-semibold">{row.name}</div>
              <div className="truncate text-[11px] text-slate-500">{row.model}</div>
            </div>
            <div className="h-1.5 w-14 overflow-hidden rounded-full bg-slate-200">
              <div className={`h-full ${row.battery > 50 ? 'bg-emerald-500' : row.battery > 25 ? 'bg-amber-500' : 'bg-rose-500'}`} style={{ width: `${row.battery}%` }} />
            </div>
            <div className="w-8 text-right text-[11px] text-slate-500">{row.battery}%</div>
            <div className="hidden w-20 text-right text-[11px] text-slate-500 sm:block">{row.seen}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Landing() {
  const { data: info } = useQuery({ queryKey: ['public-info'], queryFn: () => api.get('/api/public/info'), retry: false });
  // This page is always light, whatever the dashboard was left on
  useEffect(() => document.documentElement.classList.remove('dark'), []);

  return (
    <div className="h-full overflow-y-auto bg-white text-slate-900">
      <nav className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <Link to="/" className="flex items-center gap-2.5">
            <Logo className="size-8" />
            <span className="leading-tight">
              <span className="block text-[15px] font-bold text-blue-600">FreeKiosk Manager</span>
              <span className="block text-[10px] tracking-wide text-slate-500">{info?.organization ?? 'TỰ VẬN HÀNH'}</span>
            </span>
          </Link>
          <div className="flex items-center gap-2">
            <a href="#tinh-nang" className="hidden rounded-xl px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 sm:block">
              Tính năng
            </a>
            <a href="#cach-hoat-dong" className="hidden rounded-xl px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 sm:block">
              Cách hoạt động
            </a>
            <Link to="/quan-ly" className="inline-flex h-10 items-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700">
              <LogIn className="size-4" /> Đăng nhập
            </Link>
          </div>
        </div>
      </nav>

      <section className="hero-bg px-4 py-20 text-center text-white sm:py-28">
        <p className="mb-4 inline-flex items-center gap-2 text-xs font-semibold tracking-[0.2em] text-blue-300 uppercase">
          <Lock className="size-3.5" /> Tự vận hành, không mất phí bản quyền
        </p>
        <h1 className="hero-title text-5xl font-bold tracking-tight sm:text-7xl">FreeKiosk Manager</h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-200 sm:text-xl">Quản lý toàn bộ máy tính bảng kiosk từ một trang duy nhất.</p>
        <p className="mx-auto mt-3 max-w-2xl text-slate-400">Theo dõi, điều khiển và cập nhật mọi thiết bị đang chạy FreeKiosk, từ xa và theo thời gian thực.</p>
        <div className="mt-9 flex flex-wrap justify-center gap-3">
          <Link to="/quan-ly" className="inline-flex h-12 items-center gap-2 rounded-xl bg-blue-500 px-6 font-semibold text-white hover:bg-blue-600">
            Vào trang quản lý <ArrowRight className="size-4" />
          </Link>
          {info?.apkAvailable && (
            <a href="/dpc-apk-download/" className="inline-flex h-12 items-center gap-2 rounded-xl border border-slate-600 bg-slate-900/50 px-6 font-semibold text-white hover:bg-slate-800">
              <Download className="size-4" /> Tải ứng dụng{info.apkVersion ? ` ${info.apkVersion}` : ''}
            </a>
          )}
        </div>
        <div className="mx-auto mt-12 grid max-w-xl grid-cols-3 gap-3">
          {[
            ['Android 8+', 'Tương thích'],
            ['30 giây', 'Nhịp báo cáo'],
            ['MIT', 'Mã nguồn mở'],
          ].map(([value, label]) => (
            <div key={label} className="rounded-2xl border border-white/10 bg-white/5 px-3 py-4">
              <div className="text-lg font-bold">{value}</div>
              <div className="text-xs text-slate-400">{label}</div>
            </div>
          ))}
        </div>
      </section>

      <section id="tinh-nang" className="bg-slate-50 px-4 py-20">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-center text-3xl font-bold tracking-tight">Đủ công cụ để vận hành cả đội máy</h2>
          <p className="mt-2 text-center text-slate-600">Dành cho nơi triển khai hàng chục, hàng trăm kiosk ở nhiều địa điểm.</p>
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature) => (
              <div key={feature.title} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <span className={`flex size-10 items-center justify-center rounded-xl text-white [&_svg]:size-5 ${feature.color}`}>{feature.icon}</span>
                <h3 className="mt-4 font-bold">{feature.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{feature.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="cach-hoat-dong" className="px-4 py-20">
        <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-2">
          <div>
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Từ máy tính bảng đến <span className="text-blue-600">cả đội máy</span> trong ba bước
            </h2>
            <ol className="mt-8 space-y-5">
              {STEPS.map((step, index) => (
                <li key={step.title} className="flex gap-4">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-blue-600 font-bold text-white">{index + 1}</span>
                  <div>
                    <h3 className="font-bold">{step.title}</h3>
                    <p className="mt-0.5 text-sm text-slate-600">{step.text}</p>
                  </div>
                </li>
              ))}
            </ol>
            <div className="mt-8 flex items-center gap-2 text-sm text-slate-500">
              <CalendarClock className="size-4" /> Hẹn giờ lệnh theo ngày, lịch phát bảng hiệu theo khung giờ.
            </div>
          </div>
          <Preview />
        </div>
      </section>

      <footer className="border-t border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
        <p>
          Phần mềm kiosk dựa trên{' '}
          <a className="font-medium text-blue-600 hover:underline" href="https://github.com/RushB-fr/freekiosk" rel="noreferrer" target="_blank">
            FreeKiosk
          </a>{' '}
          của Rushb, giấy phép MIT. Trang này do đơn vị của bạn tự vận hành, không phải dịch vụ FreeKiosk Cloud chính thức.
        </p>
      </footer>
    </div>
  );
}
