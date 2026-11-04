import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, BatteryFull, Camera, Check, Globe, HardDrive, Link2, Link2Off, Monitor, Pencil, Save, ShieldCheck, Trash2, Wifi, X } from 'lucide-react';
import { ReactNode, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { api } from '../api';
import { useCan } from '../auth';
import { CommandHistory, CommandPicker } from '../components/commands';
import { ConfigForm, SECRET_FIELDS } from '../components/config';
import { DeviceState, deviceSubtitle, StatusDot } from '../components/device';
import { dateTime, duration, megabytes, timeAgo } from '../format';
import { Badge, Button, Card, CardTitle, Empty, ErrorBox, Field, Input, Loading, Modal, notifyError, Notice, Select, Tabs, Textarea, useConfirm } from '../ui';

function Metric({ icon, label, value, detail }: { icon: ReactNode; label: string; value: ReactNode; detail?: ReactNode }) {
  return (
    <div className="flex min-w-0 items-start gap-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand-strong dark:text-brand [&_svg]:size-[18px]">{icon}</span>
      <div className="min-w-0">
        <div className="text-xs text-soft">{label}</div>
        <div className="truncate text-sm font-bold">{value}</div>
        {detail && <div className="truncate text-xs text-soft">{detail}</div>}
      </div>
    </div>
  );
}

function ConfigTab({ deviceId }: { deviceId: string }) {
  const can = useCan();
  const client = useQueryClient();
  const [edits, setEdits] = useState<Record<string, any>>({});
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [raw, setRaw] = useState('');
  const [showRaw, setShowRaw] = useState(false);
  const [saveAs, setSaveAs] = useState<string | null>(null);

  const config = useQuery<any>({ queryKey: ['device-config', deviceId], queryFn: () => api.get(`/api/admin/devices/${deviceId}/config`), refetchInterval: 15_000 });

  const save = useMutation({
    mutationFn: () => {
      let extra = {};
      if (raw.trim()) {
        try {
          extra = JSON.parse(raw);
        } catch {
          throw new Error('JSON nâng cao không hợp lệ');
        }
      }
      const sensitive = Object.fromEntries(Object.entries(secrets).filter(([, v]) => v));
      return api.patch(`/api/admin/devices/${deviceId}/config`, { config: { ...extra, ...edits }, sensitive: Object.keys(sensitive).length ? sensitive : undefined });
    },
    onSuccess: () => {
      toast.success('Đã lưu. Thiết bị sẽ áp dụng ở lần báo cáo kế tiếp');
      setEdits({});
      setSecrets({});
      setRaw('');
      client.invalidateQueries({ queryKey: ['device-config', deviceId] });
    },
    onError: notifyError,
  });

  const saveProfile = useMutation({
    mutationFn: () => api.post('/api/admin/profiles', { name: saveAs, config: config.data?.reported ?? {} }),
    onSuccess: () => {
      toast.success('Đã lưu cấu hình thành hồ sơ');
      setSaveAs(null);
      client.invalidateQueries({ queryKey: ['profiles'] });
    },
    onError: notifyError,
  });

  if (config.isLoading) return <Loading />;
  if (config.error) return <ErrorBox error={config.error} />;
  const reported = config.data.reported;
  const hasEdits = Object.keys(edits).length > 0 || Object.values(secrets).some(Boolean) || !!raw.trim();

  return (
    <div className="space-y-4 p-5">
      {!reported && <Notice>Thiết bị chưa báo cáo cấu hình. Thay đổi sẽ được gửi ngay khi thiết bị kết nối.</Notice>}
      {config.data.pending && <Notice tone="warn">Đang chờ thiết bị áp dụng cấu hình mới ở lần báo cáo kế tiếp.</Notice>}

      <ConfigForm base={reported ?? undefined} value={edits} onChange={setEdits} disabled={!can.operate} />

      {can.operate && (
        <div className="rounded-xl border border-line p-4">
          <p className="mb-3 font-semibold">Thông tin bí mật</p>
          <div className="grid gap-4 sm:grid-cols-2">
            {SECRET_FIELDS.map((field) => (
              <Field key={field.key} label={field.label} hint={'hint' in field ? field.hint : undefined}>
                <Input
                  type="password"
                  autoComplete="new-password"
                  placeholder={config.data.secrets[field.key] ? 'Đã đặt. Để trống để giữ nguyên' : 'Để trống để giữ nguyên'}
                  value={secrets[field.key] ?? ''}
                  onChange={(e) => setSecrets({ ...secrets, [field.key]: e.target.value })}
                />
              </Field>
            ))}
          </div>
        </div>
      )}

      <div>
        <button type="button" className="text-[13px] font-semibold text-brand-strong hover:underline dark:text-brand" onClick={() => setShowRaw(!showRaw)}>
          {showRaw ? 'Ẩn' : 'Hiện'} cấu hình JSON
        </button>
        {showRaw && (
          <div className="mt-3 grid gap-4 lg:grid-cols-2">
            <Field label="Thiết bị đang dùng" hint={config.data.reportedAt ? `Cập nhật ${timeAgo(config.data.reportedAt)}` : undefined}>
              <pre className="h-72 overflow-auto rounded-xl border border-line bg-raised p-3 text-xs">{JSON.stringify(reported ?? {}, null, 2)}</pre>
            </Field>
            <Field label="Thay đổi thêm bằng JSON" hint="Chỉ ghi các khóa cần đổi, cùng cấu trúc như bên trái. Những mục không có trong biểu mẫu sửa ở đây.">
              <Textarea className="h-72 font-mono text-xs" spellCheck={false} placeholder={'{\n  "general": { "printEnabled": true }\n}'} value={raw} onChange={(e) => setRaw(e.target.value)} disabled={!can.operate} />
            </Field>
          </div>
        )}
      </div>

      {can.operate && (
        <div className="flex flex-wrap gap-2">
          <Button disabled={!hasEdits} busy={save.isPending} onClick={() => save.mutate()}><Save className="size-4" /> Lưu và gửi xuống thiết bị</Button>
          {hasEdits && <Button variant="ghost" onClick={() => { setEdits({}); setSecrets({}); setRaw(''); }}>Hủy thay đổi</Button>}
          {reported && <Button variant="outline" onClick={() => setSaveAs('')}>Lưu thành hồ sơ</Button>}
        </div>
      )}

      <Modal
        open={saveAs !== null}
        onClose={() => setSaveAs(null)}
        title="Lưu cấu hình thành hồ sơ"
        hint="Toàn bộ cấu hình hiện tại của thiết bị, không gồm thông tin bí mật."
        footer={<><Button variant="outline" onClick={() => setSaveAs(null)}>Hủy</Button><Button disabled={!saveAs?.trim()} busy={saveProfile.isPending} onClick={() => saveProfile.mutate()}>Lưu hồ sơ</Button></>}
      >
        <Field label="Tên hồ sơ"><Input autoFocus value={saveAs ?? ''} onChange={(e) => setSaveAs(e.target.value)} /></Field>
      </Modal>
    </div>
  );
}

const SIGNAGE_STATE: Record<string, { label: string; tone: 'ok' | 'warn' | 'neutral' | 'info' }> = {
  none: { label: 'Không có danh sách phát', tone: 'neutral' },
  up_to_date: { label: 'Đã cập nhật', tone: 'ok' },
  waiting: { label: 'Đang chờ màn hình', tone: 'warn' },
  not_reported: { label: 'Chưa báo cáo', tone: 'info' },
};

export default function DeviceDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const can = useCan();
  const confirm = useConfirm();
  const client = useQueryClient();
  const [tab, setTab] = useState<'commands' | 'config' | 'signage' | 'screenshots' | 'activity'>('commands');
  const [editing, setEditing] = useState<string | null>(null);

  const device = useQuery<any>({ queryKey: ['device', id], queryFn: () => api.get(`/api/admin/devices/${id}`), refetchInterval: 5000 });
  const groups = useQuery<any[]>({ queryKey: ['groups'], queryFn: () => api.get('/api/admin/groups') });
  const profiles = useQuery<any[]>({ queryKey: ['profiles'], queryFn: () => api.get('/api/admin/profiles') });
  const playlists = useQuery<any[]>({ queryKey: ['playlists'], queryFn: () => api.get('/api/admin/signage/playlists') });
  const shots = useQuery<any[]>({ queryKey: ['screenshots', id], queryFn: () => api.get(`/api/admin/screenshots?deviceId=${id}`), enabled: tab === 'screenshots', refetchInterval: 5000 });
  const activity = useQuery<any[]>({ queryKey: ['device-activity', id], queryFn: () => api.get(`/api/admin/devices/${id}/activity`), enabled: tab === 'activity' });

  const refresh = () => {
    client.invalidateQueries({ queryKey: ['device', id] });
    client.invalidateQueries({ queryKey: ['devices'] });
  };
  const update = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch(`/api/admin/devices/${id}`, body),
    onSuccess: () => { toast.success('Đã lưu'); refresh(); },
    onError: notifyError,
  });
  const unenroll = useMutation({
    mutationFn: () => api.post(`/api/admin/devices/${id}/unenroll`),
    onSuccess: () => { toast.success('Thiết bị sẽ rời khỏi hệ thống ở lần báo cáo kế tiếp'); refresh(); },
    onError: notifyError,
  });
  const remove = useMutation({
    mutationFn: () => api.del(`/api/admin/devices/${id}`),
    onSuccess: () => { toast.success('Đã xóa thiết bị'); client.invalidateQueries({ queryKey: ['devices'] }); navigate('/quan-ly/thiet-bi'); },
    onError: notifyError,
  });
  const screenshot = useMutation({
    mutationFn: () => api.post('/api/admin/commands', { type: 'screenshot', target: { deviceIds: [id] } }),
    onSuccess: () => toast.success('Đã yêu cầu. Ảnh sẽ về trong khoảng 30 giây'),
    onError: notifyError,
  });

  if (device.isLoading) return <Loading />;
  if (device.error) return <ErrorBox error={device.error} />;
  const d = device.data;
  const gone = !!d.unenrolledAt;
  const net = (d.telemetry as any)?.network ?? {};
  const groupProfile = d.group?.profile;

  return (
    <>
      <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-2">
          <Link to="/quan-ly/thiet-bi" aria-label="Quay lại danh sách" className="mt-1 rounded-lg p-1 text-soft hover:bg-raised"><ArrowLeft className="size-5" /></Link>
          <div className="min-w-0">
            {editing === null ? (
              <div className="flex items-center gap-2">
                <h1 className="truncate text-2xl font-bold tracking-tight">{d.name}</h1>
                {d.deviceOwner && <Badge tone="info" title="Toàn quyền: khởi động lại, cài im lặng, tắt màn hình thật"><ShieldCheck className="size-3" /> Device Owner</Badge>}
                {can.operate && <button aria-label="Đổi tên" title="Đổi tên. Tablet hiện tên này ở màn hình chính sau tín hiệu kế tiếp, khoảng 30 giây." className="rounded-lg p-1 text-soft hover:bg-raised" onClick={() => setEditing(d.name)}><Pencil className="size-4" /></button>}
              </div>
            ) : (
              <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (editing.trim()) update.mutate({ name: editing }); setEditing(null); }}>
                <Input autoFocus aria-label="Tên thiết bị" value={editing} onChange={(e) => setEditing(e.target.value)} className="w-64" />
                <Button type="submit" size="sm" aria-label="Lưu tên"><Check className="size-4" /></Button>
                <Button size="sm" variant="ghost" aria-label="Hủy" onClick={() => setEditing(null)}><X className="size-4" /></Button>
              </form>
            )}
            <p className="mt-0.5 text-sm text-soft">{deviceSubtitle(d)}</p>
          </div>
        </div>
        {can.operate && (
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-[13px] text-soft">
              Nhóm:
              <Select className="w-44" disabled={gone} value={d.group?.id ?? ''} onChange={(e) => update.mutate({ groupId: e.target.value || null })}>
                <option value="">Không có nhóm</option>
                {groups.data?.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </Select>
            </label>
            {can.admin && !gone && (
              <Button variant="outline" disabled={d.forceUnenroll} onClick={async () => {
                if (await confirm({ title: 'Hủy đăng ký thiết bị?', message: 'Ở lần báo cáo kế tiếp, thiết bị xóa toàn bộ cài đặt FreeKiosk và thoát khỏi hệ thống. Không thể hoàn tác.', confirm: 'Hủy đăng ký', danger: true })) unenroll.mutate();
              }}><Link2Off className="size-4" /> Hủy đăng ký</Button>
            )}
            {can.admin && (
              <Button variant="danger-outline" onClick={async () => {
                if (await confirm({ title: 'Xóa thiết bị?', message: gone ? 'Xóa thiết bị cùng lịch sử lệnh và ảnh màn hình.' : 'Chỉ dùng cho máy đã mất. Nếu máy còn hoạt động, sau 30 phút bị từ chối nó sẽ tự xóa cài đặt.', confirm: 'Xóa', danger: true })) remove.mutate();
              }}><Trash2 className="size-4" /> Xóa</Button>
            )}
          </div>
        )}
      </header>

      {gone && (
        <Notice tone="warn" className="mb-4">
          <p className="font-semibold">Thiết bị này đã rời khỏi hệ thống.</p>
          <p className="mt-0.5">Hủy đăng ký {timeAgo(d.unenrolledAt)}. Thiết bị không còn kết nối và không nhận được lệnh. Hãy xóa khỏi trang quản lý sau khi đã ghi lại những gì cần.</p>
        </Notice>
      )}
      {d.forceUnenroll && !gone && <Notice tone="warn" className="mb-4">Đang chờ thiết bị nhận yêu cầu hủy đăng ký ở lần báo cáo kế tiếp.</Notice>}
      {d.openAlerts?.map((alert: any) => <Notice key={alert.id} tone={alert.severity === 'critical' ? 'bad' : 'warn'} className="mb-4">{alert.message}</Notice>)}

      <Card>
        <CardTitle
          title="Trạng thái trực tiếp"
          action={<span className="flex items-center gap-2 text-[13px] text-soft"><StatusDot online={d.online} /><DeviceState device={d} /> {timeAgo(d.lastSeenAt)}</span>}
        />
        <div className="grid gap-5 px-5 pb-4 sm:grid-cols-2 lg:grid-cols-3">
          <Metric icon={<BatteryFull />} label="Pin" value={d.batteryLevel === null ? 'Không có pin' : `${d.batteryLevel}%`} detail={d.batteryCharging ? 'Đang sạc' : undefined} />
          <Metric icon={<Wifi />} label="Mạng" value={d.ethernet ? 'Ethernet' : d.wifiSsid ? d.wifiSsid : d.wifiSignalDbm ? 'Wi-Fi' : net.cellular_connected ? (net.cellular_carrier || 'Di động') : 'Không rõ'} detail={d.wifiSignalDbm ? `${d.wifiSignalDbm} dBm` : undefined} />
          <Metric icon={<Monitor />} label="Màn hình" value={d.screenOn === null ? '—' : d.screenOn ? 'Đang bật' : 'Đang tắt'} detail={d.brightness !== null ? `Độ sáng ${Math.round(d.brightness)}%` : undefined} />
          <Metric icon={<HardDrive />} label="Bộ nhớ trống" value={megabytes(d.freeStorageMb)} detail={d.freeMemoryMb !== null ? `RAM trống ${megabytes(d.freeMemoryMb)}` : undefined} />
          <Metric icon={<Globe />} label="Địa chỉ IP" value={d.ipAddress ?? '—'} detail={d.publicIp ? `Công khai: ${d.publicIp}` : undefined} />
          <Metric icon={<Link2 />} label="URL hiện tại" value={<span title={d.currentUrl ?? undefined}>{d.currentUrl || '—'}</span>} detail={d.kioskMode ? 'Đang ở chế độ khóa' : undefined} />
        </div>
        <p className="border-t border-line px-5 py-2.5 text-xs text-soft">
          ID: <code>{d.id}</code> · FreeKiosk {d.appVersion ?? '—'} · Đăng ký {timeAgo(d.enrolledAt)} · Thời gian chạy {duration(d.uptimeSeconds)}{d.timezone ? ` · ${d.timezone}` : ''}
        </p>
      </Card>

      <Card className="mt-5">
        <Tabs
          className="px-3 pt-2"
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'commands', label: 'Lệnh' },
            { id: 'config', label: 'Cấu hình' },
            { id: 'signage', label: 'Bảng hiệu' },
            { id: 'screenshots', label: 'Ảnh màn hình' },
            { id: 'activity', label: 'Nhật ký' },
          ]}
        />

        {tab === 'commands' && (
          <>
            {can.operate && !gone && <div className="p-5"><CommandPicker target={{ deviceIds: [id] }} devices={[d]} /></div>}
            <CommandHistory deviceId={id} />
          </>
        )}
        {tab === 'config' && (
          <>
            {!gone && (
              <div className="border-b border-line p-5">
                {can.operate ? (
                  <Field label="Hồ sơ cấu hình" hint={groupProfile ? `Thiết bị đang dùng hồ sơ của nhóm ${d.group.name}. Chọn hồ sơ khác ở đây thì hồ sơ đó được ưu tiên.` : 'Hồ sơ gắn trực tiếp được ưu tiên hơn hồ sơ của nhóm.'}>
                    <Select className="max-w-sm" value={d.profile?.id ?? ''} onChange={(e) => update.mutate({ profileId: e.target.value || null })}>
                      <option value="">{groupProfile ? `Theo nhóm: ${groupProfile.name}` : 'Không dùng hồ sơ'}</option>
                      {profiles.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </Select>
                  </Field>
                ) : (
                  <p className="text-[13px] text-soft">Đang áp dụng hồ sơ: <b>{d.profile?.name ?? (groupProfile ? `${groupProfile.name} (theo nhóm)` : 'Không có')}</b></p>
                )}
              </div>
            )}
            {gone ? <div className="p-5 text-sm text-soft">Thiết bị đã rời khỏi hệ thống.</div> : <ConfigTab deviceId={id} />}
          </>
        )}
        {tab === 'signage' && (
          <div className="space-y-4 p-5">
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold">Trạng thái:</span>
              <Badge tone={SIGNAGE_STATE[d.signage.state].tone}>{SIGNAGE_STATE[d.signage.state].label}</Badge>
            </div>
            <Field label="Danh sách phát" hint="Danh sách gắn trực tiếp được ưu tiên hơn danh sách của nhóm. Gỡ ra thì thiết bị quay lại chế độ trước đó.">
              <Select className="max-w-sm" disabled={!can.operate || gone} value={d.playlist?.id ?? ''} onChange={(e) => update.mutate({ playlistId: e.target.value || null })}>
                <option value="">Không có</option>
                {playlists.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </Field>
            {d.playlist && <Link className="text-[13px] font-semibold text-brand-strong hover:underline dark:text-brand" to={`/quan-ly/bang-hieu/${d.playlist.id}`}>Mở danh sách phát "{d.playlist.name}"</Link>}
          </div>
        )}
        {tab === 'screenshots' && (
          <div className="p-5">
            {can.operate && !gone && <Button variant="outline" busy={screenshot.isPending} onClick={() => screenshot.mutate()} className="mb-4"><Camera className="size-4" /> Chụp ngay</Button>}
            {!shots.data?.length ? (
              <Empty icon={<Camera />} title="Chưa có ảnh nào" hint='Cần bật "Cho phép chụp màn hình từ xa" trong cấu hình của thiết bị.' />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {shots.data.map((shot) => (
                  <a key={shot.id} href={`/api/admin/screenshots/${shot.id}/image`} target="_blank" rel="noreferrer" className="overflow-hidden rounded-xl border border-line bg-raised">
                    <img loading="lazy" alt={`Ảnh màn hình lúc ${dateTime(shot.capturedAt)}`} src={`/api/admin/screenshots/${shot.id}/image`} className="aspect-video w-full object-contain" />
                    <span className="block px-3 py-1.5 text-xs text-soft">{dateTime(shot.capturedAt)}</span>
                  </a>
                ))}
              </div>
            )}
          </div>
        )}
        {tab === 'activity' && (
          <ul className="divide-y divide-line px-5 py-2">
            {activity.data?.map((entry) => (
              <li key={entry.id} className="flex items-baseline justify-between gap-4 py-2 text-[13px]">
                <span>{entry.message}</span>
                <span className="shrink-0 text-xs text-soft" title={dateTime(entry.createdAt)}>{timeAgo(entry.createdAt)}</span>
              </li>
            ))}
            {activity.data?.length === 0 && <li className="py-6 text-center text-sm text-soft">Chưa có hoạt động nào.</li>}
          </ul>
        )}
      </Card>
    </>
  );
}
