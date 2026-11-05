import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Download, Pencil, Plus, RefreshCw, SlidersHorizontal, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { api } from '../api';
import { useCan } from '../auth';
import { ConfigForm, SECRET_FIELDS } from '../components/config';
import { dateTime } from '../format';
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Loading, Modal, notifyError, Notice, PageHeader, Select, Textarea, useConfirm } from '../ui';

const count = (config: Record<string, any>): number =>
  Object.values(config ?? {}).reduce<number>((sum, value) => sum + (value && typeof value === 'object' && !Array.isArray(value) ? count(value) : 1), 0);

interface Form {
  id?: string;
  name: string;
  description: string;
  config: Record<string, any>;
  secrets: Record<string, string>;
  secretsSet?: Record<string, boolean>;
  /** The form started from this device's configuration */
  sourceDevice?: { id: string; name: string; reportedAt: string | null; secrets: Record<string, boolean> };
  copySecrets?: boolean;
}

function FromDevice({ onClose, onLoaded }: { onClose: () => void; onLoaded: (form: Form) => void }) {
  const [deviceId, setDeviceId] = useState('');
  const devices = useQuery<any[]>({ queryKey: ['devices'], queryFn: () => api.get('/api/admin/devices') });
  const usable = devices.data?.filter((d) => !d.unenrolledAt) ?? [];

  const load = useMutation({
    mutationFn: () => api.get<any>(`/api/admin/devices/${deviceId}/config`),
    onSuccess: (config) => {
      if (!config.reported) {
        toast.error('Thiết bị này chưa báo cáo cấu hình. Hãy chọn thiết bị khác hoặc chờ thiết bị kết nối.');
        return;
      }
      const device = usable.find((d) => d.id === deviceId);
      onLoaded({
        name: `Cấu hình từ ${device.name}`,
        description: '',
        config: config.reported,
        secrets: {},
        sourceDevice: { id: device.id, name: device.name, reportedAt: config.reportedAt, secrets: config.secrets },
        copySecrets: true,
      });
    },
    onError: notifyError,
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="Lấy cấu hình từ thiết bị"
      hint="Chép cấu hình mới nhất thiết bị đã báo cáo. Bạn xem lại và sửa được trước khi lưu thành hồ sơ."
      footer={<><Button variant="outline" onClick={onClose}>Hủy</Button><Button disabled={!deviceId} busy={load.isPending} onClick={() => load.mutate()}>Lấy cấu hình</Button></>}
    >
      {devices.isLoading ? <Loading /> : devices.error ? <ErrorBox error={devices.error} /> : !usable.length ? (
        <Notice>Chưa có thiết bị nào. Hãy đăng ký và cấu hình một thiết bị trước.</Notice>
      ) : (
        <Field label="Thiết bị">
          <Select autoFocus value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
            <option value="">Chọn thiết bị</option>
            {usable.map((d) => <option key={d.id} value={d.id}>{d.name}{d.online ? '' : ' (ngoại tuyến)'}</option>)}
          </Select>
        </Field>
      )}
    </Modal>
  );
}

export default function Profiles() {
  const can = useCan();
  const confirm = useConfirm();
  const client = useQueryClient();
  const [form, setForm] = useState<Form | null>(null);
  const [pickingDevice, setPickingDevice] = useState(false);
  const profiles = useQuery<any[]>({ queryKey: ['profiles'], queryFn: () => api.get('/api/admin/profiles') });
  const refresh = () => client.invalidateQueries({ queryKey: ['profiles'] });

  const save = useMutation({
    mutationFn: () => {
      const sensitive = Object.fromEntries(Object.entries(form!.secrets).filter(([, v]) => v));
      const body = {
        name: form!.name,
        description: form!.description || null,
        config: form!.config,
        sensitive: Object.keys(sensitive).length ? sensitive : undefined,
        copySecretsFromDeviceId: form!.sourceDevice && form!.copySecrets ? form!.sourceDevice.id : undefined,
      };
      return form!.id ? api.put(`/api/admin/profiles/${form!.id}`, body) : api.post('/api/admin/profiles', body);
    },
    onSuccess: (profile) => {
      toast.success(profile.appliedTo ? `Đã lưu và gửi tới ${profile.appliedTo} thiết bị` : 'Đã lưu hồ sơ');
      setForm(null);
      refresh();
    },
    onError: notifyError,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/admin/profiles/${id}`),
    onSuccess: () => { toast.success('Đã xóa hồ sơ'); refresh(); },
    onError: notifyError,
  });

  const editForm = (profile: any): Form => ({ id: profile.id, name: profile.name, description: profile.description ?? '', config: profile.config ?? {}, secrets: {}, secretsSet: profile.secrets });
  const duplicate = useMutation({
    mutationFn: (id: string) => api.post(`/api/admin/profiles/${id}/duplicate`),
    onSuccess: (copy) => {
      toast.success(`Đã tạo ${copy.name}. Đổi tên và sửa nếu cần, chưa máy nào dùng hồ sơ này`);
      refresh();
      setForm(editForm(copy));
    },
    onError: notifyError,
  });
  const apply = useMutation({
    mutationFn: (id: string) => api.post(`/api/admin/profiles/${id}/apply`),
    onSuccess: (result) => {
      toast.success(`Đã gửi lại hồ sơ cho ${result.appliedTo} thiết bị`);
      refresh();
      client.invalidateQueries({ queryKey: ['devices'] });
    },
    onError: notifyError,
  });

  const blank = (): Form => ({ name: '', description: '', config: {}, secrets: {} });

  return (
    <>
      <PageHeader
        title="Hồ sơ cấu hình"
        hint="Cấu hình đã lưu, áp dụng được cho thiết bị hoặc nhóm. Sửa hồ sơ là mọi máy đang dùng tự cập nhật."
        action={can.operate && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setPickingDevice(true)}><Download className="size-4" /> Lấy từ thiết bị</Button>
            <Button onClick={() => setForm(blank())}><Plus className="size-4" /> Hồ sơ mới</Button>
          </div>
        )}
      />
      {profiles.isLoading ? <Loading /> : profiles.error ? <ErrorBox error={profiles.error} /> : !profiles.data?.length ? (
        <Card>
          <Empty icon={<SlidersHorizontal />} title="Chưa có hồ sơ nào" hint='Bấm "Hồ sơ mới" để tự đặt, hoặc "Lấy từ thiết bị" để chép cấu hình một thiết bị đã làm sẵn.' />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {profiles.data.map((profile) => (
            <Card key={profile.id} className="p-5">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <h2 className="truncate font-bold">{profile.name}</h2>
                  {profile.description && <p className="mt-0.5 text-[13px] text-soft">{profile.description}</p>}
                </div>
                {can.operate && (
                  <div className="flex shrink-0">
                    <button aria-label={`Nhân bản ${profile.name}`} title="Nhân bản" className="rounded-lg p-1.5 text-soft hover:bg-raised" disabled={duplicate.isPending} onClick={() => duplicate.mutate(profile.id)}><Copy className="size-4" /></button>
                    <button aria-label={`Sửa ${profile.name}`} title="Sửa" className="rounded-lg p-1.5 text-soft hover:bg-raised" onClick={() => setForm(editForm(profile))}><Pencil className="size-4" /></button>
                    <button aria-label={`Xóa ${profile.name}`} className="rounded-lg p-1.5 text-soft hover:bg-raised hover:text-bad" onClick={async () => {
                      if (await confirm({ title: `Xóa hồ sơ ${profile.name}?`, message: 'Thiết bị đang dùng hồ sơ này giữ nguyên cấu hình hiện tại.', confirm: 'Xóa', danger: true })) remove.mutate(profile.id);
                    }}><Trash2 className="size-4" /></button>
                  </div>
                )}
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <Badge tone="info">{count(profile.config)} cài đặt</Badge>
                <Badge>{profile.usedBy ?? 0} thiết bị</Badge>
                <Badge>{profile._count?.groups ?? 0} nhóm</Badge>
                {profile.secrets?.pin && <Badge tone="warn">Có mã PIN</Badge>}
                {profile.differentCount > 0 && <Badge tone="warn">{profile.differentCount} thiết bị lệch</Badge>}
              </div>
              {profile.differentCount > 0 && can.operate && (
                <Button size="sm" variant="outline" className="mt-3" busy={apply.isPending} onClick={async () => {
                  if (await confirm({ title: `Áp lại hồ sơ ${profile.name}?`, message: `Gửi lại toàn bộ hồ sơ cho ${profile.usedBy} thiết bị đang dùng. Những gì đã đổi riêng trên các máy này, ở các mục hồ sơ có đặt, sẽ trở về như hồ sơ.`, confirm: 'Áp lại' })) apply.mutate(profile.id);
                }}><RefreshCw className="size-3.5" /> Áp lại cho các máy</Button>
              )}
            </Card>
          ))}
        </div>
      )}

      {pickingDevice && (
        <FromDevice
          onClose={() => setPickingDevice(false)}
          onLoaded={(loaded) => { setPickingDevice(false); setForm(loaded); }}
        />
      )}

      <Modal
        open={!!form}
        onClose={() => setForm(null)}
        wide
        title={form?.id ? 'Sửa hồ sơ' : 'Hồ sơ mới'}
        hint="Chỉ những mục bạn đặt mới được áp dụng, các cài đặt khác của thiết bị giữ nguyên."
        footer={<><Button variant="outline" onClick={() => setForm(null)}>Hủy</Button><Button disabled={!form?.name.trim()} busy={save.isPending} onClick={() => save.mutate()}>{form?.id ? 'Lưu và áp dụng' : 'Tạo hồ sơ'}</Button></>}
      >
        {form && (
          <div className="space-y-4">
            {form.sourceDevice && (
              <Notice>Cấu hình lấy từ <b>{form.sourceDevice.name}</b>{form.sourceDevice.reportedAt ? `, báo cáo lúc ${dateTime(form.sourceDevice.reportedAt)}` : ''}. Thiết bị không gửi mã PIN nên hồ sơ không có PIN, trừ khi bạn nhập bên dưới.</Notice>
            )}
            <Field label="Tên hồ sơ"><Input autoFocus placeholder="Ví dụ: Kiosk sảnh chờ" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Mô tả"><Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
            <ConfigForm value={form.config} onChange={(config) => setForm({ ...form, config })} />
            <div className="rounded-xl border border-line p-4">
              <p className="mb-3 font-semibold">Thông tin bí mật</p>
              {form.sourceDevice && (
                <label className="mb-3 flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={!!form.copySecrets} onChange={(e) => setForm({ ...form, copySecrets: e.target.checked })} />
                  Chép cả mật khẩu MQTT, khóa REST API và mật khẩu HTTP Basic của thiết bị này
                </label>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                {SECRET_FIELDS.map((field) => (
                  <Field key={field.key} label={field.key === 'pin' ? 'Mã PIN' : field.label}>
                    <Input type="password" autoComplete="new-password" placeholder={form.secretsSet?.[field.key] ? 'Đã đặt. Để trống để giữ nguyên' : 'Không đổi'} value={form.secrets[field.key] ?? ''} onChange={(e) => setForm({ ...form, secrets: { ...form.secrets, [field.key]: e.target.value } })} />
                  </Field>
                ))}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
