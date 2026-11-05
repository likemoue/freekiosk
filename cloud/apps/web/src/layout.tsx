import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  Activity,
  Bell,
  BookOpenCheck,
  CalendarClock,
  FolderClosed,
  Home,
  Images,
  LogOut,
  Menu,
  Moon,
  Package,
  Presentation,
  Settings,
  SlidersHorizontal,
  Smartphone,
  Sun,
  Zap,
} from 'lucide-react';
import { ReactNode, useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { api } from './api';
import { useMe, useSignOut } from './auth';
import { Badge } from './ui';

export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect x="6" y="2" width="20" height="28" rx="4" fill="#2b7fff" />
      <rect x="9" y="5" width="14" height="20" rx="1.5" fill="#fff" />
      <rect x="12" y="14" width="8" height="7" rx="1.2" fill="#2b7fff" />
      <path d="M13.6 14v-2.2a2.4 2.4 0 0 1 4.8 0V14" fill="none" stroke="#2b7fff" strokeWidth="1.5" />
    </svg>
  );
}

export function useTheme(): [boolean, () => void] {
  const [dark, setDark] = useState(() => {
    try {
      return localStorage.getItem('theme') === 'dark';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    try {
      localStorage.setItem('theme', dark ? 'dark' : 'light');
    } catch {
      // A private window: the choice lasts for this page only
    }
  }, [dark]);
  return [dark, () => setDark((d) => !d)];
}

function NavItem({ to, icon, children, count, end }: { to: string; icon: ReactNode; children: ReactNode; count?: number; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        clsx(
          'flex items-center gap-3 rounded-xl px-3 py-2 text-[13.5px] font-medium transition-colors [&_svg]:size-[18px]',
          isActive ? 'bg-brand-soft text-brand-strong dark:text-brand' : 'text-soft hover:bg-raised hover:text-ink',
        )
      }
    >
      {icon}
      <span className="flex-1">{children}</span>
      {count !== undefined && <span className="text-xs tabular-nums text-faint">{count}</span>}
    </NavLink>
  );
}

function Sidebar({ deviceCount, online, onNavigate }: { deviceCount?: number; online?: number; onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col" onClick={onNavigate}>
      <Link to="/quan-ly" className="flex items-center gap-2.5 px-4 pt-5 pb-4">
        <Logo className="size-9" />
        <div className="leading-tight">
          <div className="text-[15px] font-bold">FreeKiosk Manager</div>
          <Badge tone="solid-ok" className="mt-0.5 !px-2 !py-0 text-[10.5px]">
            Tự vận hành
          </Badge>
        </div>
      </Link>
      <nav aria-label="Điều hướng chính" className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-3">
        <NavItem to="/quan-ly" end icon={<Home />}>
          Tổng quan
        </NavItem>
        <NavItem to="/quan-ly/thiet-bi" icon={<Smartphone />} count={deviceCount}>
          Thiết bị
        </NavItem>
        <NavItem to="/quan-ly/nhom" icon={<FolderClosed />}>
          Nhóm
        </NavItem>
        <NavItem to="/quan-ly/lenh" icon={<Zap />}>
          Lệnh
        </NavItem>
        <NavItem to="/quan-ly/lich" icon={<CalendarClock />}>
          Lịch hẹn giờ
        </NavItem>
        <NavItem to="/quan-ly/bang-hieu" icon={<Presentation />}>
          Trình phát video/ảnh
        </NavItem>
        <NavItem to="/quan-ly/ho-so" icon={<SlidersHorizontal />}>
          Hồ sơ cấu hình
        </NavItem>
        <NavItem to="/quan-ly/ung-dung" icon={<Package />}>
          Ứng dụng (APK)
        </NavItem>
        <NavItem to="/quan-ly/nhat-ky" icon={<Activity />}>
          Nhật ký hoạt động
        </NavItem>
        <NavItem to="/quan-ly/anh-man-hinh" icon={<Images />}>
          Ảnh màn hình
        </NavItem>
        <NavItem to="/quan-ly/bat-dau" icon={<BookOpenCheck />}>
          Bắt đầu
        </NavItem>
      </nav>
      {deviceCount !== undefined && (
        <div className="border-t border-line px-5 py-3 text-xs text-soft">
          <div className="flex justify-between">
            <span>Đang trực tuyến</span>
            <span className="tabular-nums">
              {online}/{deviceCount}
            </span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line">
            <div className="h-full rounded-full bg-brand" style={{ width: deviceCount ? `${((online ?? 0) / deviceCount) * 100}%` : 0 }} />
          </div>
        </div>
      )}
    </div>
  );
}

export function AppShell() {
  const me = useMe();
  const signOut = useSignOut();
  const location = useLocation();
  const [dark, toggleTheme] = useTheme();
  const [drawer, setDrawer] = useState(false);
  const [menu, setMenu] = useState(false);

  const { data: info } = useQuery({ queryKey: ['public-info'], queryFn: () => api.get('/api/public/info'), staleTime: 300_000 });
  const { data: overview } = useQuery({ queryKey: ['overview'], queryFn: () => api.get('/api/admin/overview'), refetchInterval: 15_000 });

  useEffect(() => setMenu(false), [location.pathname]);

  const initials = (me.name || me.email).trim().charAt(0).toUpperCase();
  const openAlerts: number = overview?.totals.openAlerts ?? 0;

  return (
    <div className="flex h-full">
      <aside className="hidden w-[248px] shrink-0 border-r border-line bg-card lg:block">
        <Sidebar deviceCount={overview?.totals.devices} online={overview?.totals.online} />
      </aside>

      {drawer && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button aria-label="Đóng menu" className="absolute inset-0 bg-black/50" onClick={() => setDrawer(false)} />
          <aside className="absolute inset-y-0 left-0 w-[260px] bg-card shadow-2xl">
            <Sidebar deviceCount={overview?.totals.devices} online={overview?.totals.online} onNavigate={() => setDrawer(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-card px-4">
          <button aria-label="Mở menu" className="rounded-lg p-1.5 text-soft hover:bg-raised lg:hidden" onClick={() => setDrawer(true)}>
            <Menu className="size-5" />
          </button>
          <div className="min-w-0 flex-1 truncate text-sm font-semibold">{info?.organization}</div>
          <button aria-label={dark ? 'Chuyển sang giao diện sáng' : 'Chuyển sang giao diện tối'} className="rounded-lg p-2 text-soft hover:bg-raised" onClick={toggleTheme}>
            {dark ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}
          </button>
          <Link to="/quan-ly/canh-bao" aria-label={`Cảnh báo: ${openAlerts} đang mở`} className="relative rounded-lg p-2 text-soft hover:bg-raised">
            <Bell className="size-[18px]" />
            {openAlerts > 0 && <span className="absolute top-1 right-1 min-w-4 rounded-full bg-bad px-1 text-center text-[10px] leading-4 font-bold text-white">{openAlerts}</span>}
          </Link>
          <div className="relative">
            <button className="flex items-center gap-2 rounded-xl p-1 pr-2 hover:bg-raised" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
              <span className="flex size-8 items-center justify-center rounded-full bg-slate-800 text-sm font-bold text-white">{initials}</span>
              <span className="hidden text-left leading-tight sm:block">
                <span className="block max-w-44 truncate text-[13px] font-semibold">{me.email}</span>
                <span className="block text-[11px] text-soft">{{ ADMIN: 'Quản trị viên', OPERATOR: 'Vận hành', VIEWER: 'Chỉ xem' }[me.role]}</span>
              </span>
            </button>
            {menu && (
              <div className="absolute right-0 z-30 mt-1 w-52 overflow-hidden rounded-xl border border-line bg-card py-1 shadow-xl">
                <Link to="/quan-ly/cai-dat" className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-raised">
                  <Settings className="size-4" /> Cài đặt
                </Link>
                <button onClick={signOut} className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-raised">
                  <LogOut className="size-4" /> Đăng xuất
                </button>
              </div>
            )}
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6">
          <div className="mx-auto max-w-[1200px]">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
