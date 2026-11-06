import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  AppWindow, ArrowUpCircle, Ban, Bell, Camera, LocateFixed, PackageMinus, DownloadCloud, CircleStop, Code2, Eraser, Globe, LayoutGrid, Moon, MousePointerClick, Power, RefreshCw, RotateCcw, Search, Sun, SunDim, Timer, Trash2, Volume1, Volume2, VolumeX, Wifi, MessageSquareText, Sparkles,
} from 'lucide-react';
import { ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { api } from '../api';
import { useCan } from '../auth';
import { COMMAND_STATUS, dateTime, timeAgo } from '../format';
import { Badge, Button, Field, Input, notifyError, Select, Tabs, td, th, Table, trow, Textarea, useConfirm, Empty } from '../ui';
import { AppChoice, AppsChoice } from './app-picker';
import { SECRET_FIELDS, settingLabel } from './config';
import { DeviceSummary } from './device';
import { HomeAppsEditor } from './home-apps';

export type Target = { deviceIds?: string[]; groupId?: string; all?: boolean };

type ParamField = { name: string; label: string; type?: 'text' | 'textarea' | 'password' | 'url' | 'select' | 'percent' | 'app' | 'apps'; placeholder?: string; required?: boolean; hint?: string; options?: Array<{ value: string; label: string }>; defaultValue?: string };

interface CommandDef {
  type: string;
  label: string;
  hint?: string;
  icon: ReactNode;
  category: 'quick' | 'apps' | 'screensaver' | 'audio' | 'advanced';
  capability?: string;
  /** What to say of a device without the capability */
  lacking?: string;
  adminOnly?: boolean;
  danger?: string;
  /** The same, when it depends on what was chosen */
  dangerFor?: (values: Record<string, any>, deviceCount: number) => string;
  confirmLabel?: string;
  params?: ParamField[];
  /** The app has no command for this: the server sends it through the configuration, confirmed by a heartbeat */
  viaConfig?: boolean;
  /** Not a form with a send button: a screen of its own */
  editor?: boolean;
}

const SCREEN_TIMEOUTS = [
  { value: '30', label: '30 giây' },
  { value: '60', label: '1 phút' },
  { value: '120', label: '2 phút' },
  { value: '300', label: '5 phút' },
  { value: '600', label: '10 phút' },
  { value: '1800', label: '30 phút' },
  { value: '-1', label: 'Không tự tắt' },
];

const COMMANDS: CommandDef[] = [
  { type: 'home_apps', label: 'Ứng dụng trên màn hình', hint: 'Thêm hoặc gỡ ứng dụng trên màn hình chính của tablet.', icon: <LayoutGrid />, category: 'apps', editor: true },
  { type: 'launch_app', label: 'Mở ứng dụng', hint: 'Mở ứng dụng đã chọn ngay trên tablet.', icon: <AppWindow />, category: 'apps', params: [{ name: 'package_name', label: 'Ứng dụng', type: 'app', required: true }] },
  { type: 'reload', label: 'Tải lại trang', icon: <RefreshCw />, category: 'quick', capability: 'reload' },
  { type: 'screen_on', label: 'Bật màn hình', icon: <Sun />, category: 'quick', capability: 'screen' },
  { type: 'screen_off', label: 'Tắt màn hình', icon: <Moon />, category: 'quick', capability: 'screen' },
  { type: 'wake', label: 'Đánh thức', icon: <MousePointerClick />, category: 'quick', capability: 'screen' },
  { type: 'screenshot', label: 'Chụp màn hình', hint: 'Cần bật "Cho phép chụp màn hình từ xa" trên thiết bị. Ảnh xuất hiện ở mục Ảnh màn hình.', icon: <Camera />, category: 'quick', capability: 'screenshot' },
  { type: 'locate', label: 'Cập nhật vị trí', hint: 'Tablet lấy vị trí mới cho trang Bản đồ ngay, thay vì chờ lần tự làm mới 15 phút một lần.', icon: <LocateFixed />, category: 'quick', capability: 'locate', lacking: 'Cần FreeKiosk bản mới nhất' },
  { type: 'toast', label: 'Hiện thông báo', icon: <Bell />, category: 'quick', capability: 'toast', params: [{ name: 'message', label: 'Nội dung', required: true, placeholder: 'Ví dụ: Bảo trì lúc 17:00' }] },
  { type: 'reboot', label: 'Khởi động lại', hint: 'Cần thiết bị ở chế độ Device Owner.', icon: <RotateCcw />, category: 'quick', capability: 'reboot', danger: 'Thiết bị sẽ khởi động lại ngay khi nhận lệnh.' },
  { type: 'stop_apps', label: 'Dừng mọi ứng dụng', hint: 'Đóng hẳn các ứng dụng đang chạy và đưa tablet về màn hình chính. Dữ liệu và đăng nhập trong ứng dụng vẫn giữ nguyên. Cần FreeKiosk bản mới nhất và chế độ Device Owner.', icon: <CircleStop />, category: 'apps', capability: 'stop_apps', lacking: 'Thiết bị này cần FreeKiosk bản mới nhất và chế độ Device Owner. Bản mới cài ở mục Ứng dụng (APK).', danger: 'Ứng dụng đang mở trên các thiết bị đã chọn sẽ bị đóng ngay, kể cả khi có người đang dùng.' },
  {
    type: 'clear_app_data',
    label: 'Xóa dữ liệu ứng dụng',
    hint: 'Xóa đăng nhập, tệp và cài đặt của ứng dụng, như vừa cài mới. Ứng dụng vẫn còn trên máy, đang mở thì bị đóng. Cần FreeKiosk bản mới nhất và chế độ Device Owner.',
    icon: <Trash2 />,
    category: 'apps',
    capability: 'clear_app_data',
    lacking: 'Thiết bị này cần FreeKiosk bản mới nhất và chế độ Device Owner. Bản mới cài ở mục Ứng dụng (APK).',
    params: [{ name: 'packages', label: 'Ứng dụng', type: 'apps', required: true }],
    confirmLabel: 'Xóa dữ liệu',
    dangerFor: (values, deviceCount) => `Xóa toàn bộ dữ liệu của ${(values.labels ?? []).join(', ')} trên ${deviceCount} thiết bị? Tài khoản đăng nhập, tệp và cài đặt trong các ứng dụng này sẽ mất và không khôi phục được.`,
  },
  {
    type: 'uninstall_app',
    label: 'Xóa ứng dụng',
    hint: 'Gỡ hẳn ứng dụng khỏi tablet, kèm dữ liệu của nó, và bỏ khỏi màn hình chính. Cài lại được từ mục Ứng dụng (APK). Ứng dụng có sẵn theo máy thì Android không cho gỡ. Cần FreeKiosk bản mới nhất và chế độ Device Owner.',
    icon: <PackageMinus />,
    category: 'apps',
    capability: 'uninstall_app',
    lacking: 'Thiết bị này cần FreeKiosk bản mới nhất và chế độ Device Owner. Bản mới cài ở mục Ứng dụng (APK).',
    params: [{ name: 'packages', label: 'Ứng dụng', type: 'apps', required: true }],
    confirmLabel: 'Xóa ứng dụng',
    dangerFor: (values, deviceCount) => `Gỡ ${(values.labels ?? []).join(', ')} khỏi ${deviceCount} thiết bị? Ứng dụng và toàn bộ dữ liệu của nó trên máy sẽ mất. Muốn dùng lại phải cài lại.`,
  },
  {
    type: 'pull_apk',
    label: 'Lấy APK về website',
    hint: 'Tablet gửi tệp APK của ứng dụng lên thư viện ở mục Ứng dụng (APK), kể cả ứng dụng nhiều tệp cài từ CH Play. Từ đó cài cho các thiết bị khác. Chọn một thiết bị.',
    icon: <DownloadCloud />,
    category: 'apps',
    capability: 'pull_apk',
    lacking: 'Thiết bị này cần FreeKiosk bản mới nhất. Bản mới cài ở mục Ứng dụng (APK).',
    params: [{ name: 'package_name', label: 'Ứng dụng', type: 'app', required: true }],
  },
  { type: 'clear_cache', label: 'Xóa bộ nhớ đệm', hint: 'Xóa bộ nhớ đệm, cookie và dữ liệu trang web của FreeKiosk rồi tải lại trang.', icon: <Eraser />, category: 'apps' },
  { type: 'screensaver_on', label: 'Bật bảo vệ màn hình', icon: <SunDim />, category: 'screensaver' },
  { type: 'screensaver_off', label: 'Tắt bảo vệ màn hình', icon: <Ban />, category: 'screensaver' },
  { type: 'speak', label: 'Đọc văn bản', icon: <MessageSquareText />, category: 'audio', capability: 'tts', params: [{ name: 'text', label: 'Văn bản cần đọc', type: 'textarea', required: true }] },
  { type: 'play_sound', label: 'Phát âm thanh', icon: <Volume2 />, category: 'audio', capability: 'audio', params: [{ name: 'url', label: 'URL tệp âm thanh', type: 'url', required: true, placeholder: 'https://...' }] },
  { type: 'audio_stop', label: 'Dừng âm thanh', icon: <VolumeX />, category: 'audio', capability: 'audio' },
  { type: 'set_volume', label: 'Chỉnh âm lượng', hint: 'Âm lượng của tablet, kể cả khi đang mở ứng dụng khác.', icon: <Volume1 />, category: 'audio', capability: 'set_volume', lacking: 'Thiết bị này cần FreeKiosk bản mới nhất. Bản mới cài ở mục Ứng dụng (APK).', params: [{ name: 'percent', label: 'Âm lượng', type: 'percent', required: true, defaultValue: '50' }] },
  { type: 'set_url', label: 'Đổi URL hiển thị', hint: 'Trang hiển thị trên kiosk đổi ngay khi thiết bị nhận được.', icon: <Globe />, category: 'advanced', viaConfig: true, params: [{ name: 'url', label: 'URL', type: 'url', required: true, placeholder: 'https://...' }] },
  { type: 'set_brightness', label: 'Đổi độ sáng', hint: 'Nhập từ 0 đến 100.', icon: <Sparkles />, category: 'advanced', viaConfig: true, params: [{ name: 'percent', label: 'Độ sáng (%)', required: true, placeholder: '70' }] },
  { type: 'set_screen_timeout', label: 'Thời gian sáng màn hình', hint: 'Màn hình tự tắt sau bao lâu khi không có thao tác, kể cả khi đang mở ứng dụng khác.', icon: <Timer />, category: 'advanced', capability: 'screen_timeout', lacking: 'Thiết bị này cần FreeKiosk bản mới nhất. Bản mới cài ở mục Ứng dụng (APK).', params: [{ name: 'seconds', label: 'Tắt màn hình sau', type: 'select', required: true, options: SCREEN_TIMEOUTS }] },
  {
    type: 'system_update',
    label: 'Cập nhật Android',
    hint: 'Tablet tự mở Cập nhật phần mềm của Samsung hoặc System update của Lenovo, tải bản mới về và cài đặt, rồi khởi động lại. Màn hình tablet và lịch sử lệnh hiện % đang tải. Lenovo chỉ cài khi máy rảnh nên tắt màn hình trong lúc cài. Máy đã ở bản mới nhất thì không làm gì, nên có thể hẹn giờ chạy mỗi đêm ở Lịch hẹn giờ. Cần Wi-Fi, pin từ 30% hoặc đang sạc, FreeKiosk bản mới nhất, chế độ Device Owner và dịch vụ trợ năng của FreeKiosk.',
    icon: <ArrowUpCircle />,
    category: 'advanced',
    capability: 'system_update',
    lacking: 'Thiết bị này cần FreeKiosk bản mới nhất, chế độ Device Owner và dịch vụ trợ năng của FreeKiosk. Hiện có máy Samsung và Lenovo.',
    confirmLabel: 'Cập nhật',
    dangerFor: (_values, deviceCount) => `Cập nhật Android trên ${deviceCount} thiết bị? Mỗi máy tải bản mới về (thường 1 đến 3 GB), không dùng được trong lúc cài, rồi tự khởi động lại. Không hạ lại bản cũ được sau khi cập nhật.`,
  },
  { type: 'add_wifi_network', label: 'Thêm mạng Wi-Fi', hint: 'Chỉ lưu để dùng sau, không chuyển mạng ngay. Mật khẩu chỉ gửi tới thiết bị, không lưu lại.', icon: <Wifi />, category: 'advanced', adminOnly: true, params: [{ name: 'ssid', label: 'Tên mạng (SSID)', required: true }, { name: 'password', label: 'Mật khẩu', type: 'password' }] },
  { type: 'execute_js', label: 'Chạy JavaScript', hint: 'Mã chạy ngay trong trang đang hiển thị. Chỉ dùng mã bạn hiểu rõ.', icon: <Code2 />, category: 'advanced', adminOnly: true, danger: 'Mã JavaScript sẽ chạy trong trang kiosk trên các thiết bị đã chọn.', params: [{ name: 'code', label: 'Mã JavaScript', type: 'textarea', required: true }] },
];

const CATEGORIES = [
  { id: 'quick', label: 'Thao tác nhanh' },
  { id: 'apps', label: 'Ứng dụng' },
  { id: 'screensaver', label: 'Bảo vệ màn hình' },
  { id: 'audio', label: 'Âm thanh' },
  { id: 'advanced', label: 'Nâng cao' },
] as const;

const isBlank = (value: unknown) => (Array.isArray(value) ? value.length === 0 : typeof value !== 'string' || !value.trim());

const startingValues = (command: CommandDef): Record<string, any> =>
  Object.fromEntries((command.params ?? []).filter((param) => param.defaultValue !== undefined).map((param) => [param.name, param.defaultValue!]));

export const COMMAND_LABELS: Record<string, string> = {
  ...Object.fromEntries(COMMANDS.map((c) => [c.type, c.label])),
  install_apk: 'Cài APK',
  apply_profile: 'Áp hồ sơ cấu hình',
  push_config: 'Đổi cấu hình',
};

export function CommandPicker({ target, devices, onSent }: { target: Target | null; devices?: DeviceSummary[]; onSent?: () => void }) {
  const can = useCan();
  const confirm = useConfirm();
  const client = useQueryClient();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]['id']>('quick');
  const [selected, setSelected] = useState<CommandDef | null>(null);
  const [values, setValues] = useState<Record<string, any>>({});
  // Starts the app pickers over, with what is on the kiosk ticked again, after a command goes
  const [round, setRound] = useState(0);
  const deviceCount = useRef(0);

  const shown = useMemo(() => {
    const query = search.trim().toLowerCase();
    return query ? COMMANDS.filter((c) => c.label.toLowerCase().includes(query)) : COMMANDS.filter((c) => c.category === category);
  }, [search, category]);

  // With one device in view, what it cannot do is greyed out, like an action that cannot run
  const unsupported = (command: CommandDef) =>
    devices?.length === 1 && command.capability && devices[0].capabilities.length > 0 && !devices[0].capabilities.includes(command.capability);

  const send = useMutation({
    mutationFn: () => api.post('/api/admin/commands', { type: selected!.type, params: values, target }),
    onSuccess: (result) => {
      if (result.sent > 0) toast.success(`Đã gửi tới ${result.sent} thiết bị`);
      else if (!result.skipped?.length) toast.warning('Không có thiết bị nào trong lựa chọn này');
      if (result.skipped?.length) toast.warning(`Bỏ qua ${result.skipped.length} thiết bị: ${result.skipped[0].reason}`);
      setValues(selected ? startingValues(selected) : {});
      setRound((current) => current + 1);
      client.invalidateQueries({ queryKey: ['commands'] });
      onSent?.();
    },
    onError: notifyError,
  });

  const submit = async () => {
    if (!selected || !target) return;
    const warning = selected.dangerFor ? selected.dangerFor(values, deviceCount.current) : selected.danger;
    if (warning && !(await confirm({ title: selected.label, message: warning, confirm: selected.confirmLabel ?? 'Gửi lệnh', danger: true }))) return;
    send.mutate();
  };

  const missing = selected?.params?.some((p) => p.required && isBlank(values[p.name]));

  return (
    <div>
      <div className="relative">
        <Search className="absolute top-3 left-3 size-4 text-soft" />
        <Input className="pl-9" placeholder="Tìm lệnh trong mọi nhóm…" aria-label="Tìm lệnh" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      {!search.trim() && <Tabs className="mt-3" tabs={[...CATEGORIES]} value={category} onChange={setCategory} />}
      <div className="mt-3 flex flex-wrap gap-2">
        {shown.map((command) => {
          // A device that cannot run it can still be told why: only the send button is off then
          const off = command.adminOnly && !can.admin;
          const cannot = unsupported(command);
          return (
            <button
              key={command.type}
              type="button"
              disabled={!!off}
              title={off ? 'Chỉ quản trị viên' : cannot ? 'Thiết bị không hỗ trợ' : undefined}
              onClick={() => { setSelected(command); setValues(startingValues(command)); setRound((current) => current + 1); }}
              className={clsx(
                'inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 text-[13px] font-semibold transition-colors [&_svg]:size-4 disabled:cursor-not-allowed disabled:opacity-45',
                cannot && 'opacity-60',
                selected?.type === command.type ? 'border-brand-strong bg-brand-soft text-brand-strong dark:text-brand' : 'border-line bg-card hover:bg-raised',
              )}
            >
              {command.icon}
              {command.label}
            </button>
          );
        })}
        {shown.length === 0 && <p className="py-2 text-sm text-soft">Không có lệnh nào khớp.</p>}
      </div>

      <div className="mt-4 rounded-xl border border-dashed border-line p-4">
        {!selected ? (
          <p className="flex items-center justify-center gap-2 py-4 text-sm text-soft">
            <MousePointerClick className="size-4" /> Chọn một lệnh để gửi
          </p>
        ) : (
          <div className="space-y-3">
            <div>
              <p className="font-bold">{selected.label}</p>
              {selected.hint && <p className="text-[13px] text-soft">{selected.hint}</p>}
            </div>
            {selected.editor && <HomeAppsEditor target={target} onSent={onSent} />}
            {selected.params?.map((param) => param.type === 'app' || param.type === 'apps' ? (
              <div key={`${param.name}-${round}`}>
                {param.type === 'app' ? (
                  <AppChoice target={target} value={values[param.name] ?? ''} onChange={(packageName, label) => setValues((current) => ({ ...current, [param.name]: packageName, label }))} />
                ) : (
                  <AppsChoice
                    target={target}
                    value={values[param.name]}
                    onChange={(packages, labels, count) => {
                      deviceCount.current = count;
                      setValues((current) => ({ ...current, [param.name]: packages, labels }));
                    }}
                  />
                )}
              </div>
            ) : (
              <Field key={param.name} label={param.label}>
                {param.type === 'percent' ? (
                  <div className="flex max-w-sm items-center gap-3">
                    <input type="range" min={0} max={100} step={5} aria-label={param.label} className="h-2 flex-1 accent-brand-strong" value={values[param.name] ?? '0'} onChange={(e) => setValues({ ...values, [param.name]: e.target.value })} />
                    <span className="w-11 text-right text-sm font-semibold tabular-nums">{values[param.name] ?? '0'}%</span>
                  </div>
                ) : param.type === 'select' ? (
                  <Select aria-label={param.label} value={values[param.name] ?? ''} onChange={(e) => setValues({ ...values, [param.name]: e.target.value })}>
                    <option value="">Chọn…</option>
                    {param.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </Select>
                ) : param.type === 'textarea' ? (
                  <Textarea rows={3} placeholder={param.placeholder} value={values[param.name] ?? ''} onChange={(e) => setValues({ ...values, [param.name]: e.target.value })} />
                ) : (
                  <Input type={param.type === 'password' ? 'password' : 'text'} autoComplete="off" placeholder={param.placeholder} value={values[param.name] ?? ''} onChange={(e) => setValues({ ...values, [param.name]: e.target.value })} />
                )}
              </Field>
            ))}
            {!selected.editor && (
              <>
                {unsupported(selected) && <p className="text-[13px] text-warn">{selected.lacking ?? 'Thiết bị này không hỗ trợ lệnh này.'}</p>}
                <div className="flex items-center gap-3">
                  <Button disabled={!target || missing || !can.operate || !!unsupported(selected)} busy={send.isPending} onClick={submit}>
                    <Power className="size-4" /> Gửi lệnh
                  </Button>
                  {!target && <span className="text-[13px] text-warn">Chưa chọn thiết bị</span>}
                </div>
                <p className="text-xs text-soft">
                  {selected.viaConfig
                    ? 'Thiết bị đang trực tuyến nhận trong vài giây. Bản FreeKiosk cũ hơn 2.1.0-beta.8 nhận trong tối đa 30 giây. Thiết bị đang ngoại tuyến sẽ nhận khi kết nối lại.'
                    : 'Thiết bị đang trực tuyến nhận trong vài giây. Bản FreeKiosk cũ hơn 2.1.0-beta.8 nhận trong tối đa 30 giây. Lệnh hết hạn sau 1 giờ nếu thiết bị vẫn ngoại tuyến.'}
                </p>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** What the command was about, in words where the type allows it */
function commandDetail(command: { type: string; params?: Record<string, any>; result?: Record<string, any> | null }): string | null {
  const params = command.params ?? {};
  if (command.type === 'install_apk') return [params.file_name, params.version].filter(Boolean).join(' ') || null;
  if (command.type === 'stop_apps') return Array.isArray(command.result?.stopped) ? `Đã dừng ${command.result.stopped.length} ứng dụng` : null;
  if (command.type === 'launch_app') return params.label || params.package_name || null;
  if (command.type === 'uninstall_app') {
    const names = Array.isArray(params.labels) && params.labels.length ? params.labels : params.packages;
    const removed = Array.isArray(command.result?.removed) ? `Đã gỡ ${command.result.removed.length} ứng dụng` : '';
    const missing = Array.isArray(command.result?.missing) ? command.result.missing.length : 0;
    return [Array.isArray(names) ? names.join(', ') : '', removed, missing ? `Máy không có ${missing} ứng dụng` : ''].filter(Boolean).join('. ') || null;
  }
  if (command.type === 'pull_apk') {
    const result = command.result ?? {};
    if (result.file_name) return `${result.file_name}${result.already_in_library ? ' (đã có trong thư viện)' : ''}`;
    return params.label || params.package_name || null;
  }
  if (command.type === 'clear_app_data') {
    const names = Array.isArray(params.labels) && params.labels.length ? params.labels : params.packages;
    const missing = Array.isArray(command.result?.missing) ? command.result.missing.length : 0;
    return [Array.isArray(names) ? names.join(', ') : '', missing ? `Máy không có ${missing} ứng dụng` : ''].filter(Boolean).join('. ') || null;
  }
  if (command.type === 'system_update') return systemUpdateDetail(command);
  if (command.type === 'set_screen_timeout') return SCREEN_TIMEOUTS.find((option) => option.value === String(params.seconds))?.label ?? `${params.seconds} giây`;
  if (command.type === 'set_url') return params.url ?? null;
  if (command.type === 'locate') {
    const location = command.result?.location;
    if (location?.state !== 'ok' || typeof location.latitude !== 'number') return null;
    const accuracy = typeof location.accuracy_m === 'number' ? `, sai số ±${Math.round(location.accuracy_m)} m` : '';
    return `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}${accuracy}`;
  }
  if (command.type === 'apply_profile') return params.profile ?? null;
  if (command.type === 'push_config') {
    const secrets = (params.secrets ?? []).map((key: string) => SECRET_FIELDS.find((field) => field.key === key)?.label ?? key);
    return [...(params.settings ?? []).map(settingLabel), ...secrets].join(', ') || null;
  }
  if (command.type === 'set_brightness' || command.type === 'set_volume') return params.percent !== undefined ? `${params.percent}%` : null;
  if (command.type === 'home_apps') {
    const parts = [
      params.add?.length ? `Thêm ${params.add.join(', ')}` : '',
      params.remove?.length ? `Gỡ ${params.remove.join(', ')}` : '',
      params.switch_to_multi ? 'Chuyển sang chế độ nhiều ứng dụng' : '',
      params.wait_install?.length ? `Ẩn ${params.wait_install.join(', ')} đến khi máy cài xong` : '',
    ];
    return parts.filter(Boolean).join('. ') || null;
  }
  return Object.keys(params).length ? JSON.stringify(params).slice(0, 80) : null;
}

const SYSTEM_UPDATE_STAGES: Record<string, string> = {
  checking: 'Đang kiểm tra bản cập nhật',
  downloading: 'Đang tải bản cập nhật',
  installing: 'Đang cài đặt, máy sắp khởi động lại',
};

/** Where an Android update is while it runs (SystemUpdater.kt reports it), then what it came to */
function systemUpdateDetail(command: { status?: string; result?: Record<string, any> | null }): string | null {
  const result = command.result ?? {};
  if (command.status === 'SUCCESS') {
    if (result.up_to_date) return `Đã là bản mới nhất (${result.build ?? 'không rõ bản'})`;
    const patch = result.security_patch ? `, bản vá bảo mật ${result.security_patch}` : '';
    return result.from && result.to ? `${result.from} → ${result.to}${patch}` : null;
  }
  const progress = result.progress;
  if (!progress || (command.status !== 'SENT' && command.status !== 'EXPIRED')) return null;
  const stage = SYSTEM_UPDATE_STAGES[progress.stage] ?? 'Đang cập nhật';
  const note = typeof progress.message === 'string' && progress.message ? ` (${progress.message})` : '';
  return (typeof progress.percent === 'number' ? `${stage}: ${progress.percent}%` : `${stage}…`) + note;
}

/**
 * What a tablet could not remove, by name: most often an app that came with it, which Android keeps. The
 * others went all the same, so the command is a warning rather than a failure (the server says so).
 */
function uninstallWarning(command: { type: string; status: string; params?: Record<string, any>; result?: Record<string, any> | null }): string | null {
  if (command.type !== 'uninstall_app' || command.status !== 'SUCCESS') return null;
  const failed: string[] = Array.isArray(command.result?.failed) ? command.result.failed.map(String) : [];
  if (!failed.length) return null;
  const packages: unknown[] = Array.isArray(command.params?.packages) ? command.params.packages : [];
  const labels: unknown[] = Array.isArray(command.params?.labels) ? command.params.labels : [];
  // Each line is "package: what Android said"
  const names = failed.map((line) => {
    const packageName = line.split(':')[0].trim();
    const label = labels[packages.indexOf(packageName)];
    return typeof label === 'string' && label ? label : packageName;
  });
  const builtIn = failed.every((line) => line.includes('DELETE_FAILED_INTERNAL_ERROR'));
  return `Không gỡ được ${names.join(', ')}${builtIn ? ': thường là ứng dụng có sẵn theo máy, Android không cho gỡ' : ''}.`;
}

/**
 * Who a line is from: someone, the schedule, or the website on its own (HomeAppsService.installMissing,
 * and the app joining the screen after such an install, which has nobody to name either)
 */
const senderOf = (command: { createdBy?: string | null; source?: string | null }) =>
  command.createdBy ??
  (command.source?.startsWith('schedule') ? 'Lịch hẹn giờ' : command.source === 'home_missing' || command.source === 'after_install' ? 'Tự động' : '—');

// What a tablet answers in its own terms, in words. The original stays on hover
const COMMAND_ERRORS: Array<[RegExp, string]> = [
  [/Cut short by a restart of FreeKiosk, sent again/, 'Bị ngắt khi FreeKiosk khởi động lại, website đã tự gửi lại lệnh cài ở dòng sau.'],
  [/Device restarted before the command result/, 'FreeKiosk khởi động lại trước khi kịp báo kết quả. Lệnh có thể đã chạy xong, hãy xem lại trên máy.'],
  [/Could not clear the data of/, 'Android không cho xóa dữ liệu của một số ứng dụng đã chọn.'],
  [/This app version cannot locate the device/, 'Cần FreeKiosk bản mới nhất để lấy vị trí.'],
  [/Handler unavailable/, 'Màn hình kiosk chưa chạy trên máy: FreeKiosk đang chạy nền, thường sau khi khởi động lại lúc tắt màn hình. Bật màn hình rồi gửi lại.'],
  [/App not installed/, 'Máy chưa cài ứng dụng này.'],
  [/Could not uninstall/, 'Android không cho gỡ một số ứng dụng đã chọn, thường là ứng dụng có sẵn theo máy.'],
  [/Uninstalling apps requires Device Owner/, 'Xóa ứng dụng cần chế độ Device Owner.'],
  [/This app version cannot (uninstall apps|send apps to the website)/, 'Cần FreeKiosk bản mới nhất.'],
  [/Clearing app data requires Device Owner/, 'Xóa dữ liệu ứng dụng cần chế độ Device Owner.'],
  [/System update needs Wi-Fi/, 'Cần Wi-Fi để tải bản cập nhật Android. Gửi lại khi máy có Wi-Fi.'],
  [/Battery too low for a system update/, 'Pin dưới 30% và không sạc. Cắm sạc rồi gửi lại.'],
  [/System update needs the accessibility service/, 'Cần bật dịch vụ trợ năng của FreeKiosk trên máy.'],
  [/System update needs Device Owner/, 'Cập nhật Android cần chế độ Device Owner.'],
  [/No Samsung (or Lenovo )?software update/, 'Máy này không có mục cập nhật phần mềm của Samsung hay Lenovo.'],
  [/Software update did not answer/, 'Màn hình Cập nhật phần mềm không phản hồi. Xem màn hình máy ở Ảnh màn hình > Trực tiếp rồi gửi lại.'],
  [/Download stopped/, 'Bản cập nhật dừng tải giữa chừng (thường do mất Wi-Fi). Gửi lại để tải tiếp.'],
  [/Restarted on the same build/, 'Máy đã khởi động lại nhưng vẫn ở bản Android cũ: chưa cài được bản cập nhật.'],
  [/A system update is already under way/, 'Máy đang cập nhật Android từ một lệnh trước.'],
  [/Clearing app data requires Android 9/, 'Xóa dữ liệu ứng dụng cần Android 9 trở lên.'],
  [/INSTALL_FAILED_MISSING_SPLIT/, 'Tệp APK này chỉ là một phần của ứng dụng (đóng gói dạng App Bundle) nên Android không cài được một mình. Hãy tải lên cả bộ tệp của ứng dụng.'],
  [/INSTALL_FAILED_UPDATE_INCOMPATIBLE/, 'Máy đang có bản ký bằng khóa khác, cần gỡ bản đó trước.'],
  [/INSTALL_FAILED_VERSION_DOWNGRADE/, 'Máy đang có bản mới hơn tệp APK này.'],
  [/INSTALL_FAILED_NO_MATCHING_ABIS/, 'Tệp APK không hợp với loại CPU của máy.'],
  [/INSTALL_FAILED_OLDER_SDK/, 'Android của máy cũ hơn mức ứng dụng yêu cầu.'],
  [/INSTALL_FAILED_INSUFFICIENT_STORAGE/, 'Máy không đủ dung lượng trống.'],
];

/** HomeAppsService.SENT_AGAIN: an install of the website's own that a restart cut short, then sent again */
const SENT_AGAIN = 'Cut short by a restart of FreeKiosk, sent again';

const errorInWords = (message: string) => COMMAND_ERRORS.find(([code]) => code.test(message))?.[1] ?? message;

const HISTORY_PAGE = 200;

/**
 * New lines come in at the top, a whole fleet's at once, and the list holds only so many: what someone
 * was reading further down dropped off its end, and they landed among newer lines. Lines the server stops
 * returning now stay until the reader goes back to the top, and the first line in view is put back where
 * it was (Chrome and Firefox do that much while the line exists, Safari does not).
 */
function useSteadyLines<T extends { id: string }>(lines: T[], truncated: boolean) {
  const box = useRef<HTMLDivElement>(null);
  const place = useRef<{ id: string; top: number } | null>(null);
  const shown = useRef<T[]>([]);

  const steady = useMemo(() => {
    if (!place.current || !truncated) return lines;
    const fresh = new Set(lines.map((line) => line.id));
    return [...lines, ...shown.current.filter((line) => !fresh.has(line.id))];
  }, [lines, truncated]);
  shown.current = steady;

  const scroller = () => box.current?.closest('main') ?? null;

  const remember = () => {
    const main = scroller();
    if (!main || !box.current) return;
    const top = main.getBoundingClientRect().top;
    const rows = box.current.querySelectorAll<HTMLElement>('tr[data-line]');
    // From the first line nobody is being pushed away from anything: what is new should show
    for (let index = 0; index < rows.length; index += 1) {
      const rect = rows[index].getBoundingClientRect();
      if (rect.bottom <= top) continue;
      place.current = index === 0 ? null : { id: rows[index].dataset.line!, top: rect.top };
      return;
    }
    place.current = null;
  };

  useLayoutEffect(() => {
    const main = scroller();
    if (main && box.current && place.current) {
      const row = box.current.querySelector<HTMLElement>(`tr[data-line="${place.current.id}"]`);
      if (row) main.scrollTop += row.getBoundingClientRect().top - place.current.top;
    }
    remember();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steady]);

  useEffect(() => {
    const main = scroller();
    if (!main) return;
    main.addEventListener('scroll', remember, { passive: true });
    return () => main.removeEventListener('scroll', remember);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { box, steady };
}

export function CommandHistory({ deviceId, showDevice }: { deviceId?: string; showDevice?: boolean }) {
  const client = useQueryClient();
  const can = useCan();
  const [search, setSearch] = useState('');
  // One command to a fleet is a line per tablet, so what fits on a page goes back only a few commands
  const [limit, setLimit] = useState(HISTORY_PAGE);
  const { data = [] } = useQuery<any[]>({
    queryKey: ['commands', deviceId ?? 'all', limit],
    queryFn: () => api.get(`/api/admin/commands?take=${limit}${deviceId ? `&deviceId=${deviceId}` : ''}`),
    // Faster while a command is on its way: the answer comes within seconds now
    refetchInterval: (query) => (query.state.data?.some((command) => command.status === 'PENDING' || command.status === 'SENT') ? 2000 : 5000),
    placeholderData: keepPreviousData,
  });
  const cancel = useMutation({
    mutationFn: (id: string) => api.post(`/api/admin/commands/${id}/cancel`),
    onSuccess: () => client.invalidateQueries({ queryKey: ['commands'] }),
    onError: notifyError,
  });
  const { box, steady } = useSteadyLines(data, data.length >= limit);
  const rows = steady.filter((c) => {
    const query = search.trim().toLowerCase();
    if (!query) return true;
    return [COMMAND_LABELS[c.type] ?? c.type, c.device?.name, c.createdBy].some((text) => text?.toLowerCase().includes(query));
  });

  return (
    <div ref={box}>
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5 pb-3">
        <h2 className="text-[15px] font-bold">Lịch sử lệnh</h2>
        <Input className="max-w-56" placeholder="Tìm lệnh…" aria-label="Tìm trong lịch sử lệnh" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      {rows.length === 0 ? (
        search.trim() && data.length > 0
          ? <Empty title="Không có lệnh nào khớp" hint="Chỉ tìm trong các dòng đã tải. Bấm Tải thêm để tìm xa hơn." />
          : <Empty title="Chưa có lệnh nào" hint="Lệnh đã gửi và kết quả sẽ hiện ở đây." />
      ) : (
        <Table>
          <thead>
            <tr>
              <th className={th}>Thời gian</th>
              {showDevice && <th className={th}>Thiết bị</th>}
              <th className={th}>Lệnh</th>
              <th className={th}>Trạng thái</th>
              <th className={th}>Người gửi</th>
              <th className={th} />
            </tr>
          </thead>
          <tbody>
            {rows.map((command) => {
              const warning = uninstallWarning(command);
              // Cut short by a restart of FreeKiosk and sent again by the website (HomeAppsService.SENT_AGAIN)
              const resent = command.type === 'install_apk' && command.errorMessage === SENT_AGAIN;
              const status = resent ? { label: 'Đã gửi lại', tone: 'neutral' as const } : warning ? { label: 'Cảnh báo', tone: 'warn' as const } : COMMAND_STATUS[command.status];
              const detail = commandDetail(command);
              return (
                <tr key={command.id} data-line={command.id} className={trow}>
                  <td className={clsx(td, 'whitespace-nowrap text-soft')} title={dateTime(command.createdAt)}>{timeAgo(command.createdAt)}</td>
                  {showDevice && <td className={td}>{command.device?.name}</td>}
                  <td className={td}>
                    <span className="font-medium">{COMMAND_LABELS[command.type] ?? command.type}</span>
                    {detail && <span className="ml-2 break-words text-xs text-soft">{detail}</span>}
                    {command.errorMessage && <p className={clsx('mt-0.5 text-xs', resent ? 'text-soft' : 'text-bad')} title={command.errorMessage}>{errorInWords(command.errorMessage)}</p>}
                    {warning && <p className="mt-0.5 text-xs text-warn" title={command.result.failed.join('\n')}>{warning}</p>}
                  </td>
                  <td className={td}><Badge tone={status.tone}>{status.label}</Badge></td>
                  <td className={clsx(td, 'text-soft')}>{senderOf(command)}</td>
                  <td className={clsx(td, 'text-right')}>
                    {command.status === 'PENDING' && can.operate && (
                      <Button size="sm" variant="ghost" onClick={() => cancel.mutate(command.id)}>Hủy</Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
      {data.length >= limit && (
        <div className="flex justify-center px-5 py-3">
          <Button size="sm" variant="outline" onClick={() => setLimit(limit + HISTORY_PAGE)}>Tải thêm</Button>
        </div>
      )}
    </div>
  );
}

export function DeviceSelect({ value, onChange, devices, placeholder = 'Chọn thiết bị…' }: { value: string; onChange: (id: string) => void; devices: DeviceSummary[]; placeholder?: string }) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} aria-label={placeholder}>
      <option value="">{placeholder}</option>
      {devices.map((device) => (
        <option key={device.id} value={device.id}>
          {device.name}{device.online ? '' : ' (ngoại tuyến)'}
        </option>
      ))}
    </Select>
  );
}
