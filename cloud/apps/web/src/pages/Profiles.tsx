import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, SlidersHorizontal, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { api } from '../api';
import { useCan } from '../auth';
import { ConfigForm, SECRET_FIELDS } from '../components/config';
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Loading, Modal, notifyError, PageHeader, Textarea, useConfirm } from '../ui';

const count = (config: Record<string, any>): number =>
  Object.values(config ?? {}).reduce<number>((sum, value) => sum + (value && typeof value === 'object' && !Array.isArray(value) ? count(value) : 1), 0);

interface Form {
  id?: string;
  name: string;
  description: string;
  config: Record<string, any>;
  secrets: Record<string, string>;
  secretsSet?: Record<string, boolean>;
}

export default function Profiles() {
  const can = useCan();
  const confirm = useConfirm();
  const client = useQueryClient();
  const [form, setForm] = useState<Form | null>(null);
  const profiles = useQuery<any[]>({ queryKey: ['profiles'], queryFn: () => api.get('/api/admin/profiles') });
  const refresh = () => client.invalidateQueries({ queryKey: ['profiles'] });

  const save = useMutation({
    mutationFn: () => {
      const sensitive = Object.fromEntries(Object.entries(form!.secrets).filter(([, v]) => v));
      const body = { name: form!.name, description: form!.description || null, config: form!.config, sensitive: Object.keys(sensitive).length ? sensitive : undefined };
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

  const blank = (): Form => ({ name: '', description: '', config: {}, secrets: {} });

  return (
    <>
      <PageHeader
        title="Hồ sơ cấu hình"
        hint="Cấu hình đã lưu, áp dụng được cho thiết bị hoặc nhóm. Sửa hồ sơ là mọi máy đang dùng tự cập nhật."
        action={can.operate && <Button onClick={() => setForm(blank())}><Plus className="size-4" /> Hồ sơ mới</Button>}
      />
      {profiles.isLoading ? <Loading /> : profiles.error ? <ErrorBox error={profiles.error} /> : !profiles.data?.length ? (
        <Card>
          <Empty icon={<SlidersHorizontal />} title="Chưa có hồ sơ nào" hint='Bấm "Hồ sơ mới", hoặc mở một thiết bị rồi dùng "Lưu thành hồ sơ" ở thẻ Cấu hình.' />
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
                    <button aria-label={`Sửa ${profile.name}`} className="rounded-lg p-1.5 text-soft hover:bg-raised" onClick={() => setForm({ id: profile.id, name: profile.name, description: profile.description ?? '', config: profile.config ?? {}, secrets: {}, secretsSet: profile.secrets })}><Pencil className="size-4" /></button>
                    <button aria-label={`Xóa ${profile.name}`} className="rounded-lg p-1.5 text-soft hover:bg-raised hover:text-bad" onClick={async () => {
                      if (await confirm({ title: `Xóa hồ sơ ${profile.name}?`, message: 'Thiết bị đang dùng hồ sơ này giữ nguyên cấu hình hiện tại.', confirm: 'Xóa', danger: true })) remove.mutate(profile.id);
                    }}><Trash2 className="size-4" /></button>
                  </div>
                )}
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <Badge tone="info">{count(profile.config)} cài đặt</Badge>
                <Badge>{profile._count?.devices ?? 0} thiết bị</Badge>
                <Badge>{profile._count?.groups ?? 0} nhóm</Badge>
                {profile.secrets?.pin && <Badge tone="warn">Có mã PIN</Badge>}
              </div>
            </Card>
          ))}
        </div>
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
            <Field label="Tên hồ sơ"><Input autoFocus placeholder="Ví dụ: Kiosk sảnh chờ" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Mô tả"><Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
            <ConfigForm value={form.config} onChange={(config) => setForm({ ...form, config })} />
            <div className="rounded-xl border border-line p-4">
              <p className="mb-3 font-semibold">Thông tin bí mật</p>
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
