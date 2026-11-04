import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FolderClosed, Moon, Pencil, Plus, RefreshCw, Sun, Trash2, Globe, Zap } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { api } from '../api';
import { useCan } from '../auth';
import { CommandPicker } from '../components/commands';
import { Button, Card, Empty, ErrorBox, Field, Input, Loading, Modal, notifyError, PageHeader, Progress, Select, Textarea, useConfirm } from '../ui';

const COLORS = ['#2b7fff', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#64748b'];
const BLANK = { name: '', description: '', color: COLORS[0], profileId: '', playlistId: '' };

export default function Groups() {
  const can = useCan();
  const confirm = useConfirm();
  const client = useQueryClient();
  const [form, setForm] = useState<(typeof BLANK & { id?: string }) | null>(null);
  const [commandFor, setCommandFor] = useState<any>(null);
  const [urlFor, setUrlFor] = useState<any>(null);
  const [url, setUrl] = useState('');

  const groups = useQuery<any[]>({ queryKey: ['groups'], queryFn: () => api.get('/api/admin/groups'), refetchInterval: 15_000 });
  const profiles = useQuery<any[]>({ queryKey: ['profiles'], queryFn: () => api.get('/api/admin/profiles') });
  const playlists = useQuery<any[]>({ queryKey: ['playlists'], queryFn: () => api.get('/api/admin/signage/playlists') });
  const refresh = () => client.invalidateQueries({ queryKey: ['groups'] });

  const save = useMutation({
    mutationFn: () => {
      const body = { name: form!.name, description: form!.description || null, color: form!.color, profileId: form!.profileId || null, playlistId: form!.playlistId || null };
      return form!.id ? api.patch(`/api/admin/groups/${form!.id}`, body) : api.post('/api/admin/groups', body);
    },
    onSuccess: () => { toast.success('Đã lưu nhóm'); setForm(null); refresh(); },
    onError: notifyError,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/admin/groups/${id}`),
    onSuccess: () => { toast.success('Đã xóa nhóm'); refresh(); },
    onError: notifyError,
  });
  const quick = useMutation({
    mutationFn: ({ groupId, type }: { groupId: string; type: string }) => api.post('/api/admin/commands', { type, target: { groupId } }),
    onSuccess: (result) => toast.success(`Đã gửi tới ${result.sent} thiết bị`),
    onError: notifyError,
  });
  const setGroupUrl = useMutation({
    mutationFn: () => api.post('/api/admin/commands', { type: 'set_url', params: { url }, target: { groupId: urlFor.id } }),
    onSuccess: (result) => { toast.success(`Đã đổi URL cho ${result.sent} thiết bị`); setUrlFor(null); setUrl(''); },
    onError: notifyError,
  });

  return (
    <>
      <PageHeader
        title="Nhóm"
        hint="Chia thiết bị thành nhóm để quản lý hàng loạt"
        action={can.operate && <Button onClick={() => setForm({ ...BLANK })}><Plus className="size-4" /> Nhóm mới</Button>}
      />

      {groups.isLoading ? <Loading /> : groups.error ? <ErrorBox error={groups.error} /> : !groups.data?.length ? (
        <Card>
          <Empty icon={<FolderClosed />} title="Chưa có nhóm nào" hint="Tạo nhóm để sắp xếp thiết bị theo cơ sở, phòng ban." action={can.operate && <Button onClick={() => setForm({ ...BLANK })}>Tạo nhóm</Button>} />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {groups.data.map((group) => (
            <Card key={group.id} className="flex flex-col p-5">
              <div className="flex items-start gap-3">
                <span className="mt-1 size-3 shrink-0 rounded-full" style={{ background: group.color ?? COLORS[0] }} />
                <div className="min-w-0 flex-1">
                  <h2 className="truncate font-bold">{group.name}</h2>
                  {group.description && <p className="mt-0.5 text-[13px] text-soft">{group.description}</p>}
                </div>
                {can.operate && (
                  <div className="flex shrink-0">
                    <button aria-label={`Sửa ${group.name}`} className="rounded-lg p-1.5 text-soft hover:bg-raised" onClick={() => setForm({ id: group.id, name: group.name, description: group.description ?? '', color: group.color ?? COLORS[0], profileId: group.profileId ?? '', playlistId: group.playlistId ?? '' })}><Pencil className="size-4" /></button>
                    <button aria-label={`Xóa ${group.name}`} className="rounded-lg p-1.5 text-soft hover:bg-raised hover:text-bad" onClick={async () => {
                      if (await confirm({ title: `Xóa nhóm ${group.name}?`, message: 'Các thiết bị trong nhóm vẫn còn, chỉ không còn thuộc nhóm này.', confirm: 'Xóa', danger: true })) remove.mutate(group.id);
                    }}><Trash2 className="size-4" /></button>
                  </div>
                )}
              </div>
              <div className="mt-4 flex justify-between text-[13px]">
                <span className="text-soft">Đang trực tuyến</span>
                <span className="font-semibold tabular-nums">{group.onlineCount}/{group.deviceCount}</span>
              </div>
              <Progress className="mt-1.5" value={group.deviceCount ? (group.onlineCount / group.deviceCount) * 100 : 0} tone="ok" />
              <dl className="mt-3 space-y-1 text-[13px]">
                <div className="flex justify-between gap-3"><dt className="text-soft">Hồ sơ</dt><dd className="truncate font-medium">{group.profile?.name ?? '—'}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-soft">Danh sách phát</dt><dd className="truncate font-medium">{group.playlist?.name ?? '—'}</dd></div>
              </dl>
              {can.operate && group.deviceCount > 0 && (
                <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
                  <Button size="sm" variant="outline" onClick={() => quick.mutate({ groupId: group.id, type: 'reload' })}><RefreshCw className="size-3.5" /> Tải lại</Button>
                  <Button size="sm" variant="outline" onClick={() => quick.mutate({ groupId: group.id, type: 'screen_on' })}><Sun className="size-3.5" /> Bật</Button>
                  <Button size="sm" variant="outline" onClick={() => quick.mutate({ groupId: group.id, type: 'screen_off' })}><Moon className="size-3.5" /> Tắt</Button>
                  <Button size="sm" variant="outline" onClick={() => { setUrl(''); setUrlFor(group); }}><Globe className="size-3.5" /> Đổi URL</Button>
                  <Button size="sm" variant="outline" onClick={() => setCommandFor(group)}><Zap className="size-3.5" /> Lệnh khác</Button>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={!!form}
        onClose={() => setForm(null)}
        title={form?.id ? 'Sửa nhóm' : 'Nhóm mới'}
        footer={<><Button variant="outline" onClick={() => setForm(null)}>Hủy</Button><Button disabled={!form?.name.trim()} busy={save.isPending} onClick={() => save.mutate()}>Lưu</Button></>}
      >
        {form && (
          <div className="space-y-4">
            <Field label="Tên nhóm"><Input autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Mô tả"><Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
            <div>
              <span className="mb-1.5 block text-[13px] font-semibold">Màu</span>
              <div className="flex flex-wrap gap-2">
                {COLORS.map((color) => (
                  <button key={color} type="button" aria-label={`Màu ${color}`} aria-pressed={form.color === color} onClick={() => setForm({ ...form, color })} className={`size-7 rounded-full ${form.color === color ? 'ring-2 ring-ink ring-offset-2 ring-offset-card' : ''}`} style={{ background: color }} />
                ))}
              </div>
            </div>
            <Field label="Hồ sơ cấu hình" hint="Áp dụng cho mọi thiết bị trong nhóm chưa có hồ sơ riêng.">
              <Select value={form.profileId} onChange={(e) => setForm({ ...form, profileId: e.target.value })}>
                <option value="">Không dùng</option>
                {profiles.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </Field>
            <Field label="Danh sách phát" hint="Thiết bị có danh sách riêng vẫn phát danh sách của mình.">
              <Select value={form.playlistId} onChange={(e) => setForm({ ...form, playlistId: e.target.value })}>
                <option value="">Không có</option>
                {playlists.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </Field>
          </div>
        )}
      </Modal>

      <Modal open={!!commandFor} onClose={() => setCommandFor(null)} title={`Gửi lệnh tới nhóm ${commandFor?.name}`} wide>
        <CommandPicker target={{ groupId: commandFor?.id }} onSent={() => setCommandFor(null)} />
      </Modal>

      <Modal
        open={!!urlFor}
        onClose={() => setUrlFor(null)}
        title={`Đổi URL cho nhóm ${urlFor?.name}`}
        hint="Mọi thiết bị trong nhóm áp dụng ở lần báo cáo kế tiếp."
        footer={<><Button variant="outline" onClick={() => setUrlFor(null)}>Hủy</Button><Button disabled={!/^https?:\/\/\S+$/i.test(url)} busy={setGroupUrl.isPending} onClick={() => setGroupUrl.mutate()}>Áp dụng</Button></>}
      >
        <Field label="URL"><Input autoFocus placeholder="https://..." value={url} onChange={(e) => setUrl(e.target.value)} /></Field>
      </Modal>
    </>
  );
}
