import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  AppWindow, Ban, Bell, Camera, CircleStop, Code2, Eraser, Globe, LayoutGrid, Moon, MousePointerClick, Power, RefreshCw, RotateCcw, Search, Sun, SunDim, Timer, Volume1, Volume2, VolumeX, Wifi, MessageSquareText, Sparkles,
} from 'lucide-react';
import { ReactNode, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { api } from '../api';
import { useCan } from '../auth';
import { COMMAND_STATUS, dateTime, timeAgo } from '../format';
import { Badge, Button, Field, Input, notifyError, Select, Tabs, td, th, Table, trow, Textarea, useConfirm, Empty } from '../ui';
import { DeviceSummary } from './device';
import { HomeAppsEditor } from './home-apps';

export type Target = { deviceIds?: string[]; groupId?: string; all?: boolean };

type ParamField = { name: string; label: string; type?: 'text' | 'textarea' | 'password' | 'url' | 'select' | 'percent'; placeholder?: string; required?: boolean; hint?: string; options?: Array<{ value: string; label: string }>; defaultValue?: string };

interface CommandDef {
  type: string;
  label: string;
  hint?: string;
  icon: ReactNode;
  category: 'quick' | 'screensaver' | 'audio' | 'advanced';
  capability?: string;
  /** What to say of a device without the capability */
  lacking?: string;
  adminOnly?: boolean;
  danger?: string;
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
  { type: 'home_apps', label: 'Ứng dụng trên màn hình', hint: 'Thêm hoặc gỡ ứng dụng trên màn hình chính của tablet.', icon: <LayoutGrid />, category: 'quick', editor: true },
  { type: 'reload', label: 'Tải lại trang', icon: <RefreshCw />, category: 'quick', capability: 'reload' },
  { type: 'screen_on', label: 'Bật màn hình', icon: <Sun />, category: 'quick', capability: 'screen' },
  { type: 'screen_off', label: 'Tắt màn hình', icon: <Moon />, category: 'quick', capability: 'screen' },
  { type: 'wake', label: 'Đánh thức', icon: <MousePointerClick />, category: 'quick', capability: 'screen' },
  { type: 'screenshot', label: 'Chụp màn hình', hint: 'Cần bật "Cho phép chụp màn hình từ xa" trên thiết bị. Ảnh xuất hiện ở mục Ảnh màn hình.', icon: <Camera />, category: 'quick', capability: 'screenshot' },
  { type: 'toast', label: 'Hiện thông báo', icon: <Bell />, category: 'quick', capability: 'toast', params: [{ name: 'message', label: 'Nội dung', required: true, placeholder: 'Ví dụ: Bảo trì lúc 17:00' }] },
  { type: 'reboot', label: 'Khởi động lại', hint: 'Cần thiết bị ở chế độ Device Owner.', icon: <RotateCcw />, category: 'quick', capability: 'reboot', danger: 'Thiết bị sẽ khởi động lại ngay khi nhận lệnh.' },
  { type: 'stop_apps', label: 'Dừng mọi ứng dụng', hint: 'Đóng hẳn các ứng dụng đang chạy và đưa tablet về màn hình chính. Dữ liệu và đăng nhập trong ứng dụng vẫn giữ nguyên. Cần FreeKiosk bản mới nhất và chế độ Device Owner.', icon: <CircleStop />, category: 'quick', capability: 'stop_apps', lacking: 'Thiết bị này cần FreeKiosk bản mới nhất và chế độ Device Owner. Bản mới cài ở mục Ứng dụng (APK).', danger: 'Ứng dụng đang mở trên các thiết bị đã chọn sẽ bị đóng ngay, kể cả khi có người đang dùng.' },
  { type: 'clear_cache', label: 'Xóa bộ nhớ đệm', icon: <Eraser />, category: 'quick' },
  { type: 'screensaver_on', label: 'Bật bảo vệ màn hình', icon: <SunDim />, category: 'screensaver' },
  { type: 'screensaver_off', label: 'Tắt bảo vệ màn hình', icon: <Ban />, category: 'screensaver' },
  { type: 'speak', label: 'Đọc văn bản', icon: <MessageSquareText />, category: 'audio', capability: 'tts', params: [{ name: 'text', label: 'Văn bản cần đọc', type: 'textarea', required: true }] },
  { type: 'play_sound', label: 'Phát âm thanh', icon: <Volume2 />, category: 'audio', capability: 'audio', params: [{ name: 'url', label: 'URL tệp âm thanh', type: 'url', required: true, placeholder: 'https://...' }] },
  { type: 'audio_stop', label: 'Dừng âm thanh', icon: <VolumeX />, category: 'audio', capability: 'audio' },
  { type: 'set_volume', label: 'Chỉnh âm lượng', hint: 'Âm lượng của tablet, kể cả khi đang mở ứng dụng khác.', icon: <Volume1 />, category: 'audio', capability: 'set_volume', lacking: 'Thiết bị này cần FreeKiosk bản mới nhất. Bản mới cài ở mục Ứng dụng (APK).', params: [{ name: 'percent', label: 'Âm lượng', type: 'percent', required: true, defaultValue: '50' }] },
  { type: 'set_url', label: 'Đổi URL hiển thị', hint: 'Trang hiển thị trên kiosk đổi ngay khi thiết bị nhận được.', icon: <Globe />, category: 'advanced', viaConfig: true, params: [{ name: 'url', label: 'URL', type: 'url', required: true, placeholder: 'https://...' }] },
  { type: 'set_brightness', label: 'Đổi độ sáng', hint: 'Nhập từ 0 đến 100.', icon: <Sparkles />, category: 'advanced', viaConfig: true, params: [{ name: 'percent', label: 'Độ sáng (%)', required: true, placeholder: '70' }] },
  { type: 'set_screen_timeout', label: 'Thời gian sáng màn hình', hint: 'Màn hình tự tắt sau bao lâu khi không có thao tác, kể cả khi đang mở ứng dụng khác.', icon: <Timer />, category: 'advanced', capability: 'screen_timeout', lacking: 'Thiết bị này cần FreeKiosk bản mới nhất. Bản mới cài ở mục Ứng dụng (APK).', params: [{ name: 'seconds', label: 'Tắt màn hình sau', type: 'select', required: true, options: SCREEN_TIMEOUTS }] },
  { type: 'launch_app', label: 'Mở ứng dụng', icon: <AppWindow />, category: 'advanced', params: [{ name: 'package_name', label: 'Tên gói', required: true, placeholder: 'com.example.app' }] },
  { type: 'add_wifi_network', label: 'Thêm mạng Wi-Fi', hint: 'Chỉ lưu để dùng sau, không chuyển mạng ngay. Mật khẩu chỉ gửi tới thiết bị, không lưu lại.', icon: <Wifi />, category: 'advanced', adminOnly: true, params: [{ name: 'ssid', label: 'Tên mạng (SSID)', required: true }, { name: 'password', label: 'Mật khẩu', type: 'password' }] },
  { type: 'execute_js', label: 'Chạy JavaScript', hint: 'Mã chạy ngay trong trang đang hiển thị. Chỉ dùng mã bạn hiểu rõ.', icon: <Code2 />, category: 'advanced', adminOnly: true, danger: 'Mã JavaScript sẽ chạy trong trang kiosk trên các thiết bị đã chọn.', params: [{ name: 'code', label: 'Mã JavaScript', type: 'textarea', required: true }] },
];

const CATEGORIES = [
  { id: 'quick', label: 'Thao tác nhanh' },
  { id: 'screensaver', label: 'Bảo vệ màn hình' },
  { id: 'audio', label: 'Âm thanh' },
  { id: 'advanced', label: 'Nâng cao' },
] as const;

const startingValues = (command: CommandDef): Record<string, string> =>
  Object.fromEntries((command.params ?? []).filter((param) => param.defaultValue !== undefined).map((param) => [param.name, param.defaultValue!]));

export const COMMAND_LABELS: Record<string, string> = {
  ...Object.fromEntries(COMMANDS.map((c) => [c.type, c.label])),
  install_apk: 'Cài APK',
};

export function CommandPicker({ target, devices, onSent }: { target: Target | null; devices?: DeviceSummary[]; onSent?: () => void }) {
  const can = useCan();
  const confirm = useConfirm();
  const client = useQueryClient();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]['id']>('quick');
  const [selected, setSelected] = useState<CommandDef | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});

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
      client.invalidateQueries({ queryKey: ['commands'] });
      onSent?.();
    },
    onError: notifyError,
  });

  const submit = async () => {
    if (!selected || !target) return;
    if (selected.danger && !(await confirm({ title: selected.label, message: selected.danger, confirm: 'Gửi lệnh', danger: true }))) return;
    send.mutate();
  };

  const missing = selected?.params?.some((p) => p.required && !values[p.name]?.trim());

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
              onClick={() => { setSelected(command); setValues(startingValues(command)); }}
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
            {selected.params?.map((param) => (
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
  if (command.type === 'set_screen_timeout') return SCREEN_TIMEOUTS.find((option) => option.value === String(params.seconds))?.label ?? `${params.seconds} giây`;
  if (command.type === 'set_url') return params.url ?? null;
  if (command.type === 'set_brightness' || command.type === 'set_volume') return params.percent !== undefined ? `${params.percent}%` : null;
  if (command.type === 'home_apps') {
    const parts = [
      params.add?.length ? `Thêm ${params.add.join(', ')}` : '',
      params.remove?.length ? `Gỡ ${params.remove.join(', ')}` : '',
      params.switch_to_multi ? 'Chuyển sang chế độ nhiều ứng dụng' : '',
    ];
    return parts.filter(Boolean).join('. ') || null;
  }
  return Object.keys(params).length ? JSON.stringify(params).slice(0, 80) : null;
}

// The codes Android answers an install with, in words. The code itself stays on hover
const INSTALL_ERRORS: Array<[RegExp, string]> = [
  [/INSTALL_FAILED_MISSING_SPLIT/, 'Tệp APK này chỉ là một phần của ứng dụng (đóng gói dạng App Bundle) nên Android không cài được một mình. Hãy tải lên cả bộ tệp của ứng dụng.'],
  [/INSTALL_FAILED_UPDATE_INCOMPATIBLE/, 'Máy đang có bản ký bằng khóa khác, cần gỡ bản đó trước.'],
  [/INSTALL_FAILED_VERSION_DOWNGRADE/, 'Máy đang có bản mới hơn tệp APK này.'],
  [/INSTALL_FAILED_NO_MATCHING_ABIS/, 'Tệp APK không hợp với loại CPU của máy.'],
  [/INSTALL_FAILED_OLDER_SDK/, 'Android của máy cũ hơn mức ứng dụng yêu cầu.'],
  [/INSTALL_FAILED_INSUFFICIENT_STORAGE/, 'Máy không đủ dung lượng trống.'],
];

const errorInWords = (message: string) => INSTALL_ERRORS.find(([code]) => code.test(message))?.[1] ?? message;

const HISTORY_PAGE = 200;

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
  const rows = data.filter((c) => {
    const query = search.trim().toLowerCase();
    if (!query) return true;
    return [COMMAND_LABELS[c.type] ?? c.type, c.device?.name, c.createdBy].some((text) => text?.toLowerCase().includes(query));
  });

  return (
    <div>
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
              const status = COMMAND_STATUS[command.status];
              const detail = commandDetail(command);
              return (
                <tr key={command.id} className={trow}>
                  <td className={clsx(td, 'whitespace-nowrap text-soft')} title={dateTime(command.createdAt)}>{timeAgo(command.createdAt)}</td>
                  {showDevice && <td className={td}>{command.device?.name}</td>}
                  <td className={td}>
                    <span className="font-medium">{COMMAND_LABELS[command.type] ?? command.type}</span>
                    {detail && <span className="ml-2 break-words text-xs text-soft">{detail}</span>}
                    {command.errorMessage && <p className="mt-0.5 text-xs text-bad" title={command.errorMessage}>{errorInWords(command.errorMessage)}</p>}
                  </td>
                  <td className={td}><Badge tone={status.tone}>{status.label}</Badge></td>
                  <td className={clsx(td, 'text-soft')}>{command.createdBy ?? (command.source?.startsWith('schedule') ? 'Lịch hẹn giờ' : '—')}</td>
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
