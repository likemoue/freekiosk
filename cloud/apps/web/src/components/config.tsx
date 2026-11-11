import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { Field, Input, Select, Switch, Textarea } from '../ui';

type Json = Record<string, any>;

export interface ConfigField {
  path: string;
  label: string;
  hint?: string;
  type: 'text' | 'number' | 'bool' | 'select' | 'percent' | 'list';
  options?: Array<{ value: string; label: string }>;
  /** A select whose values are numbers in the config: stored as such, or "30" would differ from the 30 a tablet reports */
  numeric?: boolean;
  placeholder?: string;
  min?: number;
  max?: number;
}

/** The settings of the app worth a form (src/utils/storage.ts, exportConfig). The rest is in JSON below */
export const CONFIG_SECTIONS: Array<{ id: string; title: string; hint?: string; fields: ConfigField[] }> = [
  {
    id: 'content',
    title: 'Nội dung hiển thị',
    fields: [
      { path: 'general.displayMode', label: 'Chế độ hiển thị', type: 'select', options: [{ value: 'webview', label: 'Trang web' }, { value: 'external_app', label: 'Ứng dụng ngoài' }, { value: 'media_player', label: 'Đa phương tiện' }] },
      { path: 'general.url', label: 'URL hiển thị', type: 'text', placeholder: 'https://...' },
      { path: 'general.externalApp.package', label: 'Gói ứng dụng ngoài', type: 'text', placeholder: 'com.example.app' },
      { path: 'general.autoReload', label: 'Tự động tải lại khi lỗi', type: 'bool' },
      { path: 'general.pdfViewerEnabled', label: 'Trình xem PDF tích hợp', type: 'bool' },
      { path: 'general.urlRotation.enabled', label: 'Xoay vòng URL', type: 'bool' },
      { path: 'general.urlRotation.interval', label: 'Thời gian mỗi URL (giây)', type: 'number', min: 1 },
      { path: 'general.urlRotation.list', label: 'Danh sách URL xoay vòng', hint: 'Mỗi URL một dòng.', type: 'list' },
      { path: 'general.inactivityReturn.enabled', label: 'Quay về khi không hoạt động', type: 'bool' },
      { path: 'general.inactivityReturn.delay', label: 'Thời gian chờ (giây)', type: 'number', min: 5 },
    ],
  },
  {
    id: 'display',
    title: 'Màn hình',
    fields: [
      { path: 'display.brightnessManagement', label: 'Quản lý độ sáng', type: 'bool' },
      { path: 'display.defaultBrightness', label: 'Độ sáng mặc định', type: 'percent' },
      { path: 'display.autoBrightness.enabled', label: 'Độ sáng tự động', type: 'bool' },
      { path: 'display.keepScreenOn', label: 'Giữ màn hình luôn bật', hint: 'Khi bật, màn hình kiosk luôn sáng, bất kể thời gian tắt màn hình bên dưới.', type: 'bool' },
      {
        path: 'display.screenOffTimeout',
        label: 'Thời gian tắt màn hình',
        hint: 'Không chạm bao lâu thì Android tắt màn hình. Chỉ có tác dụng trên màn hình kiosk khi đã tắt Giữ màn hình luôn bật; khi ứng dụng khác đang mở thì luôn có tác dụng. Cần Device Owner. Máy chạy FreeKiosk trước 2.1.0-beta.21 nhận thêm lệnh Thời gian tắt màn hình khi áp hồ sơ.',
        type: 'select',
        numeric: true,
        options: [
          { value: '30', label: '30 giây' },
          { value: '60', label: '1 phút' },
          { value: '120', label: '2 phút' },
          { value: '300', label: '5 phút' },
          { value: '600', label: '10 phút' },
          { value: '1800', label: '30 phút' },
          { value: '-1', label: 'Không bao giờ tắt' },
        ],
      },
      { path: 'display.autoWakeOnScreenOff', label: 'Tự đánh thức khi màn hình tắt', type: 'bool' },
      { path: 'display.statusBar.enabled', label: 'Hiện thanh trạng thái', type: 'bool' },
      { path: 'display.zoom.level', label: 'Mức thu phóng (%)', type: 'number', min: 10, max: 400 },
      { path: 'display.zoom.disableUserZoom', label: 'Cấm người dùng thu phóng', type: 'bool' },
      { path: 'display.screensaver.enabled', label: 'Bảo vệ màn hình', type: 'bool' },
      { path: 'display.screensaver.type', label: 'Kiểu bảo vệ màn hình', type: 'select', options: [{ value: 'dim', label: 'Làm tối' }, { value: 'url', label: 'Trang web' }, { value: 'video', label: 'Video' }] },
      { path: 'display.screensaver.url', label: 'URL bảo vệ màn hình', type: 'text', placeholder: 'https://...' },
      { path: 'display.screenScheduler.enabled', label: 'Lịch ngủ màn hình', hint: 'Các khung giờ đặt trong JSON hoặc trên thiết bị.', type: 'bool' },
      { path: 'display.customUserAgent', label: 'User-Agent tùy chỉnh', type: 'text' },
    ],
  },
  {
    id: 'media',
    title: 'Trình phát đa phương tiện',
    hint: 'Bị bỏ qua khi thiết bị đang được gán một danh sách phát ở mục Trình phát video/ảnh.',
    fields: [
      { path: 'general.mediaPlayer.loop', label: 'Lặp lại', type: 'bool' },
      { path: 'general.mediaPlayer.shuffle', label: 'Phát ngẫu nhiên', type: 'bool' },
      { path: 'general.mediaPlayer.mute', label: 'Tắt tiếng video', type: 'bool' },
      { path: 'general.mediaPlayer.cache', label: 'Lưu bộ nhớ đệm ngoại tuyến', type: 'bool' },
      { path: 'general.mediaPlayer.imageDuration', label: 'Thời lượng mỗi ảnh (giây)', type: 'number', min: 1 },
      { path: 'general.mediaPlayer.fitMode', label: 'Cách hiển thị', type: 'select', options: [{ value: 'contain', label: 'Vừa khung' }, { value: 'cover', label: 'Lấp đầy' }] },
    ],
  },
  {
    id: 'security',
    title: 'Bảo mật và khóa',
    fields: [
      { path: 'security.kioskEnabled', label: 'Chế độ khóa', hint: 'Cấp xong quyền camera, micrô rồi mới bật: Android ẩn hộp thoại xin quyền khi đang khóa.', type: 'bool' },
      { path: 'security.autoLaunch', label: 'Tự khởi chạy khi bật máy', type: 'bool' },
      { path: 'security.defaultLauncher', label: 'Đặt làm launcher mặc định', type: 'bool' },
      { path: 'security.allowPowerButton', label: 'Cho phép nút nguồn', type: 'bool' },
      { path: 'security.allowNotifications', label: 'Cho phép thông báo', type: 'bool' },
      { path: 'security.blockFactoryReset', label: 'Chặn khôi phục cài đặt gốc', type: 'bool' },
      { path: 'security.allowRemoteScreenshot', label: 'Cho phép chụp màn hình từ xa', type: 'bool' },
      { path: 'security.returnMode', label: 'Cách vào cài đặt', hint: 'Chỉ có tác dụng trên màn hình kiosk. Khi đang mở ứng dụng thì chạm màn hình, nút cố định và nút âm lượng đều không vào được cài đặt, trừ chế độ một ứng dụng.', type: 'select', options: [{ value: 'tap_anywhere', label: 'Chạm nhiều lần bất kỳ đâu' }, { value: 'button', label: 'Nút cố định' }] },
      { path: 'security.returnTapCount', label: 'Số lần chạm', type: 'number', min: 2, max: 20 },
      { path: 'security.pinMaxAttempts', label: 'Số lần nhập sai PIN tối đa', type: 'number', min: 1, max: 100 },
      { path: 'security.lockscreen.enabled', label: 'Điều khiển trên màn hình khóa', hint: 'Các nút nhanh trên màn hình nhập PIN. Từng nút bật trong JSON, ở security.lockscreen.', type: 'bool' },
      { path: 'security.lockscreen.clearData', label: 'Nút Xóa dữ liệu trên màn hình nhập PIN', hint: 'Không hỏi PIN: ai cầm máy cũng chọn được ứng dụng trên màn hình kiosk và xóa dữ liệu của nó (đăng nhập, tệp, cài đặt). Cần bật dòng trên, Device Owner và Android 9. Bản app cũ bỏ qua dòng này.', type: 'bool' },
      { path: 'security.urlFilter.enabled', label: 'Lọc URL', type: 'bool' },
      { path: 'security.urlFilter.mode', label: 'Kiểu lọc', type: 'select', options: [{ value: 'blacklist', label: 'Danh sách chặn' }, { value: 'whitelist', label: 'Danh sách cho phép' }] },
      { path: 'security.urlFilter.list', label: 'Danh sách URL', hint: 'Mỗi mẫu một dòng.', type: 'list' },
    ],
  },
  {
    id: 'integrations',
    title: 'REST API và MQTT',
    fields: [
      { path: 'advanced.restApi.enabled', label: 'Bật REST API trên thiết bị', type: 'bool' },
      { path: 'advanced.restApi.port', label: 'Cổng REST API', type: 'number', min: 1, max: 65535 },
      { path: 'advanced.restApi.allowControl', label: 'Cho phép điều khiển qua REST', type: 'bool' },
      { path: 'advanced.mqtt.enabled', label: 'Bật MQTT', type: 'bool' },
      { path: 'advanced.mqtt.brokerUrl', label: 'Địa chỉ broker', type: 'text' },
      { path: 'advanced.mqtt.port', label: 'Cổng broker', type: 'number', min: 1, max: 65535 },
      { path: 'advanced.mqtt.username', label: 'Tên đăng nhập MQTT', type: 'text' },
      { path: 'advanced.mqtt.baseTopic', label: 'Topic gốc', type: 'text' },
      { path: 'advanced.mqtt.deviceName', label: 'Tên thiết bị trên MQTT', type: 'text' },
    ],
  },
];

export const SECRET_FIELDS = [
  { key: 'pin', label: 'Mã PIN mới', hint: 'Ít nhất 4 ký tự. Chỉ gửi xuống thiết bị, không đọc ngược lại được.' },
  { key: 'mqttPassword', label: 'Mật khẩu MQTT' },
  { key: 'restApiKey', label: 'Khóa REST API' },
  { key: 'httpBasicAuthPassword', label: 'Mật khẩu HTTP Basic' },
] as const;

/** What the form calls a setting, or its path when the form does not show it */
export function settingLabel(path: string): string {
  for (const section of CONFIG_SECTIONS) {
    const field = section.fields.find((f) => f.path === path);
    if (field) return field.label;
  }
  return path;
}

export function getPath(source: Json | null | undefined, path: string): any {
  return path.split('.').reduce<any>((node, key) => (node === null || node === undefined ? undefined : node[key]), source);
}

/** A copy with this value set, or removed along with the branches it leaves empty */
export function setPath(source: Json, path: string, value: unknown): Json {
  const [head, ...rest] = path.split('.');
  const out = { ...source };
  if (rest.length === 0) {
    if (value === undefined) delete out[head];
    else out[head] = value;
    return out;
  }
  const child = setPath(out[head] ?? {}, rest.join('.'), value);
  if (Object.keys(child).length === 0) delete out[head];
  else out[head] = child;
  return out;
}

function Control({ field, value, base, onChange }: { field: ConfigField; value: any; base: any; onChange: (value: unknown) => void }) {
  const effective = value !== undefined ? value : base;
  const changed = value !== undefined;
  const ring = changed ? 'ring-2 ring-brand/40' : '';

  if (field.type === 'bool') {
    // With no report to compare to (a profile), "do not change" has to be a choice of its own
    if (base === undefined) {
      return (
        <Select className={ring} value={value === undefined ? '' : value ? 'on' : 'off'} onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value === 'on')}>
          <option value="">Không đổi</option>
          <option value="on">Bật</option>
          <option value="off">Tắt</option>
        </Select>
      );
    }
    return (
      <div className="flex h-10 items-center gap-3">
        <Switch label={field.label} checked={!!effective} onChange={(next) => onChange(next === !!base ? undefined : next)} />
        {changed && <span className="text-xs font-semibold text-brand-strong dark:text-brand">Đã sửa</span>}
      </div>
    );
  }
  if (field.type === 'select') {
    const read = (raw: string) => (field.numeric ? Number(raw) : raw);
    return (
      <Select className={ring} value={effective === undefined || effective === null ? '' : String(effective)} onChange={(e) => onChange(e.target.value === '' || read(e.target.value) === base ? undefined : read(e.target.value))}>
        {base === undefined && <option value="">Không đổi</option>}
        {field.options?.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </Select>
    );
  }
  if (field.type === 'percent') {
    const percent = effective === undefined || effective === null ? '' : Math.round(Number(effective) * 100);
    return (
      <Input
        className={ring}
        type="number"
        min={0}
        max={100}
        placeholder={base === undefined ? 'Không đổi' : undefined}
        value={percent}
        onChange={(e) => {
          if (e.target.value === '') return onChange(undefined);
          const next = Math.min(100, Math.max(0, Number(e.target.value))) / 100;
          onChange(next === base ? undefined : next);
        }}
      />
    );
  }
  if (field.type === 'list') {
    const toText = (list: any) => (Array.isArray(list) ? list.map((item) => (typeof item === 'string' ? item : item?.url ?? '')).join('\n') : '');
    const baseIsPlain = !Array.isArray(base) || base.every((item) => typeof item === 'string');
    return (
      <Textarea
        className={ring}
        rows={3}
        placeholder={base === undefined ? 'Không đổi' : undefined}
        value={toText(effective)}
        onChange={(e) => {
          const lines = e.target.value.split('\n').map((line) => line.trimEnd());
          onChange(e.target.value === '' && base === undefined ? undefined : baseIsPlain ? lines.filter((l, i) => l || i === lines.length - 1) : lines);
        }}
      />
    );
  }
  return (
    <Input
      className={ring}
      type={field.type === 'number' ? 'number' : 'text'}
      min={field.min}
      max={field.max}
      placeholder={field.placeholder ?? (base === undefined ? 'Không đổi' : undefined)}
      value={effective ?? ''}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw === '') return onChange(base === undefined ? undefined : field.type === 'number' ? undefined : '');
        const next = field.type === 'number' ? Number(raw) : raw;
        onChange(next === base ? undefined : next);
      }}
    />
  );
}

/**
 * `value` holds only what is being changed; `base` is what the device last reported, and is
 * empty for a profile. Whatever is not touched stays out of what gets sent.
 */
export function ConfigForm({ base, value, onChange, disabled }: { base?: Json | null; value: Json; onChange: (next: Json) => void; disabled?: boolean }) {
  const [open, setOpen] = useState<string | null>('content');
  return (
    <fieldset disabled={disabled} className="divide-y divide-line">
      {CONFIG_SECTIONS.map((section) => {
        const edits = section.fields.filter((f) => getPath(value, f.path) !== undefined).length;
        const isOpen = open === section.id;
        return (
          <div key={section.id}>
            <button type="button" aria-expanded={isOpen} className="flex w-full items-center gap-3 px-1 py-3 text-left" onClick={() => setOpen(isOpen ? null : section.id)}>
              <span className="flex-1 font-semibold">{section.title}</span>
              {edits > 0 && <span className="rounded-full bg-brand-soft px-2 py-0.5 text-xs font-semibold text-brand-strong dark:text-brand">{edits} thay đổi</span>}
              <ChevronDown className={`size-4 text-soft transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>
            {isOpen && (
              <div className="pb-4">
                {section.hint && <p className="mb-3 text-[13px] text-soft">{section.hint}</p>}
                <div className="grid gap-4 sm:grid-cols-2">
                  {section.fields.map((field) => (
                    <Field key={field.path} label={field.label} hint={field.hint} className={field.type === 'list' ? 'sm:col-span-2' : undefined}>
                      <Control
                        field={field}
                        value={getPath(value, field.path)}
                        base={base ? getPath(base, field.path) : undefined}
                        onChange={(next) => onChange(setPath(value, field.path, next))}
                      />
                    </Field>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </fieldset>
  );
}
