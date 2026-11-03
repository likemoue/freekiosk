import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { BellOff, CheckCircle2, Mail, Pencil, Plus, Send, Trash2, Webhook, Smartphone } from 'lucide-react';
import { ReactNode, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { api } from '../api';
import { useCan } from '../auth';
import { dateTime, timeAgo } from '../format';
import { Badge, Button, Card, CardTitle, Empty, Field, Input, Loading, Modal, notifyError, PageHeader, Select, Switch, Table, Tabs, td, th, trow, useConfirm } from '../ui';

const TYPES: Record<string, string> = {
  offline: 'Thiết bị ngoại tuyến',
  battery_low: 'Pin yếu',
  battery_critical: 'Pin rất yếu',
  storage_low: 'Sắp hết bộ nhớ',
};

function AlertList({ state }: { state: 'open' | 'all' }) {
  const alerts = useQuery<any[]>({ queryKey: ['alerts', state], queryFn: () => api.get(`/api/admin/alerts${state === 'open' ? '?state=open' : ''}`), refetchInterval: 10_000 });
  if (alerts.isLoading) return <Loading />;
  if (!alerts.data?.length) return <Empty icon={<CheckCircle2 />} title={state === 'open' ? 'Không có cảnh báo nào đang mở' : 'Chưa có cảnh báo nào'} />;
  return (
    <Table>
      <thead><tr><th className={th}>Thiết bị</th><th className={th}>Cảnh báo</th><th className={th}>Nội dung</th><th className={th}>Bắt đầu</th><th className={th}>Trạng thái</th></tr></thead>
      <tbody>
        {alerts.data.map((alert) => (
          <tr key={alert.id} className={trow}>
            <td className={td}><Link className="font-semibold hover:underline" to={`/quan-ly/thiet-bi/${alert.deviceId}`}>{alert.device.name}</Link></td>
            <td className={td}><Badge tone={alert.severity === 'critical' ? 'bad' : 'warn'}>{TYPES[alert.type] ?? alert.type}</Badge></td>
            <td className={clsx(td, 'text-soft')}>{alert.message}</td>
            <td className={clsx(td, 'whitespace-nowrap text-soft')} title={dateTime(alert.openedAt)}>{timeAgo(alert.openedAt)}</td>
            <td className={td}>{alert.resolvedAt ? <Badge tone="ok">Đã hết {timeAgo(alert.resolvedAt)}</Badge> : <Badge tone="warn">Đang mở</Badge>}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function Rules() {
  const can = useCan();
  const client = useQueryClient();
  const settings = useQuery<any>({ queryKey: ['alert-settings'], queryFn: () => api.get('/api/admin/alerts/settings') });
  const [form, setForm] = useState<any>(null);
  useEffect(() => { if (settings.data) setForm(settings.data); }, [settings.data]);
  const save = useMutation({
    mutationFn: () => api.patch('/api/admin/alerts/settings', form),
    onSuccess: () => { toast.success('Đã lưu quy tắc'); client.invalidateQueries({ queryKey: ['alert-settings'] }); },
    onError: notifyError,
  });
  if (!form) return <Loading />;

  const row = (type: string, description: string, key: string, unit: string, min: number) => {
    const enabled = !form.disabled.includes(type);
    return (
      <tr key={type} className={trow}>
        <td className={td}><span className="font-semibold">{TYPES[type]}</span><span className="block text-xs text-soft">{description}</span></td>
        <td className={td}><Switch label={`Bật cảnh báo ${TYPES[type]}`} disabled={!can.admin} checked={enabled} onChange={(on) => setForm({ ...form, disabled: on ? form.disabled.filter((d: string) => d !== type) : [...form.disabled, type] })} /></td>
        <td className={td}>
          <span className="flex items-center gap-2">
            <Input type="number" className="w-24" min={min} disabled={!can.admin} aria-label={`Ngưỡng ${TYPES[type]}`} value={form[key]} onChange={(e) => setForm({ ...form, [key]: Number(e.target.value) })} />
            <span className="text-[13px] text-soft">{unit}</span>
          </span>
        </td>
      </tr>
    );
  };

  return (
    <div>
      <Table>
        <thead><tr><th className={th}>Loại cảnh báo</th><th className={th}>Bật</th><th className={th}>Ngưỡng</th></tr></thead>
        <tbody>
          {row('offline', 'Không nhận được tín hiệu', 'offlineMinutes', 'phút', 2)}
          {row('battery_low', 'Pin xuống dưới ngưỡng', 'batteryLow', '%', 1)}
          {row('battery_critical', 'Pin xuống rất thấp', 'batteryCritical', '%', 1)}
          {row('storage_low', 'Bộ nhớ trống còn ít', 'storageLowMb', 'MB trống', 1)}
        </tbody>
      </Table>
      <div className="flex flex-wrap items-center gap-4 border-t border-line p-5">
        <label className="flex items-center gap-2 text-sm">
          <Switch label="Báo khi hết cảnh báo" disabled={!can.admin} checked={form.notifyResolved} onChange={(notifyResolved) => setForm({ ...form, notifyResolved })} />
          Báo cả khi hết cảnh báo
        </label>
        {can.admin && <Button busy={save.isPending} onClick={() => save.mutate()}>Lưu quy tắc</Button>}
      </div>
    </div>
  );
}

const BLANK_CHANNEL = { name: '', type: 'webhook', enabled: true, events: [] as string[], to: '', url: '', secret: '', format: 'generic', server: 'https://ntfy.sh', topic: '', token: '' };
const CHANNEL_ICON: Record<string, ReactNode> = { email: <Mail className="size-4" />, webhook: <Webhook className="size-4" />, ntfy: <Smartphone className="size-4" /> };
const CHANNEL_LABEL: Record<string, string> = { email: 'Email', webhook: 'Webhook', ntfy: 'ntfy (đẩy về điện thoại)' };

function Channels() {
  const confirm = useConfirm();
  const client = useQueryClient();
  const [form, setForm] = useState<(typeof BLANK_CHANNEL & { id?: string; hasSecret?: boolean }) | null>(null);
  const channels = useQuery<any[]>({ queryKey: ['channels'], queryFn: () => api.get('/api/admin/alerts/channels'), refetchInterval: 15_000 });
  const refresh = () => client.invalidateQueries({ queryKey: ['channels'] });

  const save = useMutation({
    mutationFn: () => {
      const f = form!;
      const config = f.type === 'email'
        ? { to: f.to.split(/[\s,;]+/).filter(Boolean) }
        : f.type === 'webhook'
          ? { url: f.url, secret: f.secret || undefined, format: f.format }
          : { server: f.server, topic: f.topic, token: f.token || undefined };
      const body = { name: f.name, type: f.type, enabled: f.enabled, events: f.events, config };
      return f.id ? api.put(`/api/admin/alerts/channels/${f.id}`, body) : api.post('/api/admin/alerts/channels', body);
    },
    onSuccess: () => { toast.success('Đã lưu kênh'); setForm(null); refresh(); },
    onError: notifyError,
  });
  const test = useMutation({
    mutationFn: (id: string) => api.post(`/api/admin/alerts/channels/${id}/test`),
    onSuccess: () => { toast.success('Đã gửi tin thử'); refresh(); },
    onError: (error) => { notifyError(error); refresh(); },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/admin/alerts/channels/${id}`),
    onSuccess: refresh,
    onError: notifyError,
  });

  return (
    <div>
      <CardTitle
        title="Kênh thông báo"
        hint="Cảnh báo được gửi tới đâu. Webhook có chữ ký HMAC-SHA256 ở tiêu đề X-FreeKiosk-Signature."
        action={<Button size="sm" onClick={() => setForm({ ...BLANK_CHANNEL })}><Plus className="size-4" /> Kênh mới</Button>}
      />
      {channels.isLoading ? <Loading /> : !channels.data?.length ? (
        <Empty icon={<BellOff />} title="Chưa có kênh nào" hint="Khi chưa có kênh, cảnh báo chỉ hiện trên trang này." />
      ) : (
        <ul className="divide-y divide-line border-t border-line">
          {channels.data.map((channel) => (
            <li key={channel.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <span className="flex size-9 items-center justify-center rounded-xl bg-brand-soft text-brand-strong dark:text-brand">{CHANNEL_ICON[channel.type]}</span>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-sm font-semibold">{channel.name}{!channel.enabled && <Badge>Đang tắt</Badge>}</p>
                <p className="truncate text-xs text-soft">
                  {CHANNEL_LABEL[channel.type]}
                  {channel.events.length ? ` · ${channel.events.map((e: string) => TYPES[e]).join(', ')}` : ' · mọi cảnh báo'}
                  {channel.lastSentAt ? ` · gửi lần cuối ${timeAgo(channel.lastSentAt)}` : ''}
                </p>
                {channel.lastError && <p className="truncate text-xs text-bad">Lỗi gần nhất: {channel.lastError}</p>}
              </div>
              <Button size="sm" variant="outline" busy={test.isPending && test.variables === channel.id} onClick={() => test.mutate(channel.id)}><Send className="size-3.5" /> Gửi thử</Button>
              <button aria-label={`Sửa ${channel.name}`} className="rounded-lg p-1.5 text-soft hover:bg-raised" onClick={() => setForm({ ...BLANK_CHANNEL, id: channel.id, name: channel.name, type: channel.type, enabled: channel.enabled, events: channel.events, to: channel.config.to?.join(', ') ?? '', url: channel.config.url ?? '', format: channel.config.format ?? 'generic', server: channel.config.server ?? BLANK_CHANNEL.server, topic: channel.config.topic ?? '', hasSecret: channel.hasSecret })}><Pencil className="size-4" /></button>
              <button aria-label={`Xóa ${channel.name}`} className="rounded-lg p-1.5 text-soft hover:bg-raised hover:text-bad" onClick={async () => {
                if (await confirm({ title: `Xóa kênh ${channel.name}?`, confirm: 'Xóa', danger: true })) remove.mutate(channel.id);
              }}><Trash2 className="size-4" /></button>
            </li>
          ))}
        </ul>
      )}

      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? 'Sửa kênh' : 'Kênh thông báo mới'} footer={<><Button variant="outline" onClick={() => setForm(null)}>Hủy</Button><Button disabled={!form?.name.trim()} busy={save.isPending} onClick={() => save.mutate()}>Lưu</Button></>}>
        {form && (
          <div className="space-y-4">
            <Field label="Tên kênh"><Input autoFocus placeholder="Ví dụ: Nhóm IT" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Loại">
              <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                {Object.entries(CHANNEL_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </Select>
            </Field>
            {form.type === 'email' && <Field label="Người nhận" hint="Cách nhau bằng dấu phẩy. Cần cấu hình SMTP trong Cài đặt."><Input placeholder="it@truong.edu.vn, bao-tri@truong.edu.vn" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} /></Field>}
            {form.type === 'webhook' && (
              <>
                <Field label="URL nhận"><Input placeholder="https://..." value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} /></Field>
                <Field label="Định dạng">
                  <Select value={form.format} onChange={(e) => setForm({ ...form, format: e.target.value })}>
                    <option value="generic">JSON đầy đủ</option>
                    <option value="slack">Slack</option>
                    <option value="discord">Discord</option>
                  </Select>
                </Field>
                <Field label="Khóa ký" hint="Để trống thì không ký."><Input type="password" autoComplete="new-password" placeholder={form.hasSecret ? 'Đã đặt. Để trống để giữ nguyên' : undefined} value={form.secret} onChange={(e) => setForm({ ...form, secret: e.target.value })} /></Field>
              </>
            )}
            {form.type === 'ntfy' && (
              <>
                <Field label="Máy chủ ntfy"><Input value={form.server} onChange={(e) => setForm({ ...form, server: e.target.value })} /></Field>
                <Field label="Topic"><Input value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })} /></Field>
                <Field label="Mã truy cập (không bắt buộc)"><Input type="password" autoComplete="new-password" placeholder={form.hasSecret ? 'Đã đặt. Để trống để giữ nguyên' : undefined} value={form.token} onChange={(e) => setForm({ ...form, token: e.target.value })} /></Field>
              </>
            )}
            <div>
              <span className="mb-1.5 block text-[13px] font-semibold">Chỉ nhận các loại (bỏ trống là nhận tất cả)</span>
              <div className="space-y-1.5">
                {Object.entries(TYPES).map(([type, label]) => (
                  <label key={type} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" className="size-4 accent-brand-strong" checked={form.events.includes(type)} onChange={(e) => setForm({ ...form, events: e.target.checked ? [...form.events, type] : form.events.filter((x) => x !== type) })} />
                    {label}
                  </label>
                ))}
              </div>
            </div>
            <label className="flex items-center gap-3 text-sm"><Switch label="Bật kênh" checked={form.enabled} onChange={(enabled) => setForm({ ...form, enabled })} /> Đang bật</label>
          </div>
        )}
      </Modal>
    </div>
  );
}

export default function Alerts() {
  const can = useCan();
  const [tab, setTab] = useState<'open' | 'all' | 'rules' | 'channels'>('open');
  return (
    <>
      <PageHeader title="Cảnh báo" hint="Biết ngay khi thiết bị mất kết nối, yếu pin hoặc sắp hết bộ nhớ." />
      <Tabs
        className="mb-4"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'open', label: 'Đang mở' },
          { id: 'all', label: 'Lịch sử' },
          { id: 'rules', label: 'Quy tắc' },
          { id: 'channels', label: 'Kênh thông báo', hidden: !can.admin },
        ]}
      />
      <Card>
        {tab === 'open' && <AlertList state="open" />}
        {tab === 'all' && <AlertList state="all" />}
        {tab === 'rules' && <Rules />}
        {tab === 'channels' && <Channels />}
      </Card>
    </>
  );
}
