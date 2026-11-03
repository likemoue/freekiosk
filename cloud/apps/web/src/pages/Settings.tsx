import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { KeyRound, Plus, RotateCcw, ShieldCheck, Trash2 } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api } from '../api';
import { useCan, useMe } from '../auth';
import { dateTime, timeAgo } from '../format';
import { Badge, Button, Card, CardTitle, CopyButton, Field, Input, Modal, notifyError, Notice, PageHeader, Select, Switch, Table, Tabs, td, th, trow, useConfirm } from '../ui';

const ROLE_LABEL: Record<string, string> = { ADMIN: 'Quản trị viên', OPERATOR: 'Vận hành', VIEWER: 'Chỉ xem' };

function ProfileTab() {
  const me = useMe();
  const client = useQueryClient();
  const [name, setName] = useState(me.name);
  const save = useMutation({
    mutationFn: () => api.patch('/api/admin/auth/me', { name }),
    onSuccess: () => { toast.success('Đã lưu'); client.invalidateQueries({ queryKey: ['me'] }); },
    onError: notifyError,
  });
  return (
    <div className="max-w-md space-y-4 p-5">
      <Field label="Email" hint="Email dùng để đăng nhập."><Input readOnly value={me.email} /></Field>
      <Field label="Họ và tên"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Button disabled={!name.trim() || name === me.name} busy={save.isPending} onClick={() => save.mutate()}>Lưu</Button>
    </div>
  );
}

function SecurityTab() {
  const me = useMe();
  const client = useQueryClient();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [disabling, setDisabling] = useState(false);
  const [password, setPassword] = useState('');
  const refreshMe = () => client.invalidateQueries({ queryKey: ['me'] });

  const change = useMutation({
    mutationFn: () => api.post('/api/admin/auth/password', { currentPassword: current, newPassword: next }),
    onSuccess: () => { toast.success('Đã đổi mật khẩu. Các phiên đăng nhập khác đã bị đăng xuất'); setCurrent(''); setNext(''); },
    onError: notifyError,
  });
  const start = useMutation({ mutationFn: () => api.post('/api/admin/auth/2fa/setup'), onSuccess: (data) => { setSetup(data); setCode(''); }, onError: notifyError });
  const enable = useMutation({
    mutationFn: () => api.post('/api/admin/auth/2fa/enable', { code }),
    onSuccess: (data) => { setSetup(null); setRecovery(data.recoveryCodes); refreshMe(); },
    onError: notifyError,
  });
  const disable = useMutation({
    mutationFn: () => api.post('/api/admin/auth/2fa/disable', { password }),
    onSuccess: () => { toast.success('Đã tắt xác thực hai lớp'); setDisabling(false); setPassword(''); refreshMe(); },
    onError: notifyError,
  });

  return (
    <div className="grid gap-8 p-5 lg:grid-cols-2">
      <div className="space-y-4">
        <h3 className="font-bold">Đổi mật khẩu</h3>
        <Field label="Mật khẩu hiện tại"><Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} /></Field>
        <Field label="Mật khẩu mới" hint="Ít nhất 10 ký tự."><Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /></Field>
        <Button disabled={!current || next.length < 10} busy={change.isPending} onClick={() => change.mutate()}>Đổi mật khẩu</Button>
      </div>
      <div>
        <h3 className="flex items-center gap-2 font-bold"><ShieldCheck className="size-5 text-brand" /> Xác thực hai lớp</h3>
        <p className="mt-1 text-sm text-soft">Mã 6 số từ ứng dụng như Google Authenticator, được hỏi mỗi lần đăng nhập.</p>
        <div className="mt-3">
          {me.totpEnabled ? (
            <div className="flex flex-wrap items-center gap-3"><Badge tone="ok">Đang bật</Badge><Button variant="danger-outline" onClick={() => setDisabling(true)}>Tắt</Button></div>
          ) : (
            <Button busy={start.isPending} onClick={() => start.mutate()}>Bật xác thực hai lớp</Button>
          )}
        </div>
      </div>

      <Modal open={!!setup} onClose={() => setSetup(null)} title="Bật xác thực hai lớp" footer={<><Button variant="outline" onClick={() => setSetup(null)}>Hủy</Button><Button disabled={code.length < 6} busy={enable.isPending} onClick={() => enable.mutate()}>Xác nhận</Button></>}>
        {setup && (
          <div className="space-y-4 text-center">
            <p className="text-sm text-soft">Quét mã này bằng ứng dụng xác thực, rồi nhập mã 6 số.</p>
            <div className="inline-block rounded-2xl border border-line bg-white p-3"><QRCodeSVG value={setup.otpauthUrl} size={200} title="Mã QR xác thực hai lớp" /></div>
            <p className="break-all font-mono text-xs text-soft">{setup.secret}</p>
            <Input autoFocus inputMode="numeric" maxLength={6} className="mx-auto w-40 text-center tracking-widest" aria-label="Mã 6 số" value={code} onChange={(e) => setCode(e.target.value)} />
          </div>
        )}
      </Modal>
      <Modal open={!!recovery} onClose={() => setRecovery(null)} title="Lưu các mã khôi phục" footer={<Button onClick={() => setRecovery(null)}>Tôi đã lưu</Button>}>
        <Notice tone="warn">Mỗi mã dùng được một lần khi mất điện thoại. Các mã này chỉ hiện đúng một lần.</Notice>
        <div className="my-4 grid grid-cols-2 gap-2 font-mono text-sm">{recovery?.map((c) => <code key={c} className="rounded-lg bg-raised px-3 py-1.5 text-center">{c}</code>)}</div>
        {recovery && <CopyButton value={recovery.join('\n')} label="Sao chép tất cả" />}
      </Modal>
      <Modal open={disabling} onClose={() => setDisabling(false)} title="Tắt xác thực hai lớp" footer={<><Button variant="outline" onClick={() => setDisabling(false)}>Hủy</Button><Button variant="danger" disabled={!password} busy={disable.isPending} onClick={() => disable.mutate()}>Tắt</Button></>}>
        <Field label="Nhập mật khẩu để xác nhận"><Input type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
      </Modal>
    </div>
  );
}

function OrganizationTab() {
  const can = useCan();
  const client = useQueryClient();
  const settings = useQuery<any>({ queryKey: ['settings'], queryFn: () => api.get('/api/admin/settings') });
  const [name, setName] = useState('');
  useEffect(() => { if (settings.data) setName(settings.data.organization.name); }, [settings.data]);
  const save = useMutation({
    mutationFn: () => api.patch('/api/admin/settings/organization', { name }),
    onSuccess: () => { toast.success('Đã lưu'); client.invalidateQueries({ queryKey: ['settings'] }); client.invalidateQueries({ queryKey: ['public-info'] }); },
    onError: notifyError,
  });
  return (
    <div className="max-w-md space-y-4 p-5">
      <Field label="Tên tổ chức" hint="Hiện trên trang quản lý và trong cài đặt của thiết bị sau khi đăng ký."><Input disabled={!can.admin} value={name} onChange={(e) => setName(e.target.value)} /></Field>
      {can.admin && <Button disabled={!name.trim()} busy={save.isPending} onClick={() => save.mutate()}>Lưu</Button>}
      <Field label="Địa chỉ máy chủ" hint="Đặt bằng PUBLIC_URL trong tệp .env trên máy chủ. Thiết bị dùng địa chỉ này để kết nối.">
        <div className="flex gap-2"><Input readOnly value={settings.data?.publicUrl ?? ''} /><CopyButton size="md" value={settings.data?.publicUrl ?? ''} label="Chép" /></div>
      </Field>
    </div>
  );
}

function TeamTab() {
  const me = useMe();
  const confirm = useConfirm();
  const client = useQueryClient();
  const [form, setForm] = useState<{ email: string; name: string; role: string } | null>(null);
  const [temporary, setTemporary] = useState<{ email: string; password: string } | null>(null);
  const users = useQuery<any[]>({ queryKey: ['users'], queryFn: () => api.get('/api/admin/users') });
  const refresh = () => client.invalidateQueries({ queryKey: ['users'] });

  const create = useMutation({
    mutationFn: () => api.post('/api/admin/users', form),
    onSuccess: (result) => { setTemporary({ email: result.user.email, password: result.temporaryPassword }); setForm(null); refresh(); },
    onError: notifyError,
  });
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => api.patch(`/api/admin/users/${id}`, body),
    onSuccess: () => { toast.success('Đã lưu'); refresh(); },
    onError: notifyError,
  });
  const reset = useMutation({
    mutationFn: (user: any) => api.post(`/api/admin/users/${user.id}/reset-password`).then((r) => ({ ...r, email: user.email })),
    onSuccess: (result) => setTemporary({ email: result.email, password: result.temporaryPassword }),
    onError: notifyError,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/admin/users/${id}`),
    onSuccess: () => { toast.success('Đã xóa thành viên'); refresh(); },
    onError: notifyError,
  });

  return (
    <div>
      <CardTitle
        title="Thành viên"
        hint="Quản trị viên làm được mọi việc. Vận hành gửi lệnh và sửa cấu hình. Chỉ xem không thay đổi được gì."
        action={<Button size="sm" onClick={() => setForm({ email: '', name: '', role: 'OPERATOR' })}><Plus className="size-4" /> Thêm thành viên</Button>}
      />
      <Table>
        <thead><tr><th className={th}>Tên</th><th className={th}>Vai trò</th><th className={th}>2FA</th><th className={th}>Đăng nhập cuối</th><th className={th}>Hoạt động</th><th className={th} /></tr></thead>
        <tbody>
          {users.data?.map((user) => (
            <tr key={user.id} className={trow}>
              <td className={td}><span className="font-semibold">{user.name}</span><span className="block text-xs text-soft">{user.email}</span></td>
              <td className={td}>
                <Select className="h-8 w-36 text-[13px]" aria-label={`Vai trò của ${user.email}`} value={user.role} onChange={(e) => update.mutate({ id: user.id, body: { role: e.target.value } })}>
                  {Object.entries(ROLE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </Select>
              </td>
              <td className={td}>{user.totpEnabled ? <Badge tone="ok">Bật</Badge> : <Badge>Tắt</Badge>}</td>
              <td className={clsx(td, 'text-soft')} title={dateTime(user.lastLoginAt)}>{user.lastLoginAt ? timeAgo(user.lastLoginAt) : 'Chưa đăng nhập'}</td>
              <td className={td}><Switch label={`Cho phép ${user.email} đăng nhập`} disabled={user.id === me.id} checked={user.isActive} onChange={(isActive) => update.mutate({ id: user.id, body: { isActive } })} /></td>
              <td className={clsx(td, 'text-right whitespace-nowrap')}>
                <Button size="sm" variant="ghost" onClick={async () => {
                  if (await confirm({ title: `Đặt lại mật khẩu của ${user.email}?`, message: 'Người này bị đăng xuất và phải đổi mật khẩu tạm ở lần đăng nhập tới.', confirm: 'Đặt lại', danger: true })) reset.mutate(user);
                }}><RotateCcw className="size-3.5" /> Mật khẩu</Button>
                {user.id !== me.id && (
                  <button aria-label={`Xóa ${user.email}`} className="rounded-lg p-1.5 text-soft hover:bg-raised hover:text-bad" onClick={async () => {
                    if (await confirm({ title: `Xóa ${user.email}?`, confirm: 'Xóa', danger: true })) remove.mutate(user.id);
                  }}><Trash2 className="size-4" /></button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </Table>

      <Modal open={!!form} onClose={() => setForm(null)} title="Thêm thành viên" footer={<><Button variant="outline" onClick={() => setForm(null)}>Hủy</Button><Button disabled={!form?.email || !form?.name.trim()} busy={create.isPending} onClick={() => create.mutate()}>Thêm</Button></>}>
        {form && (
          <div className="space-y-4">
            <Field label="Email"><Input type="email" autoFocus value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            <Field label="Họ và tên"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Vai trò">
              <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                {Object.entries(ROLE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </Select>
            </Field>
          </div>
        )}
      </Modal>
      <Modal open={!!temporary} onClose={() => setTemporary(null)} title="Mật khẩu tạm" footer={<Button onClick={() => setTemporary(null)}>Xong</Button>}>
        <Notice tone="warn">Mật khẩu này chỉ hiện đúng một lần. Hãy gửi cho {temporary?.email} qua kênh an toàn. Người đó phải đổi ngay khi đăng nhập.</Notice>
        <div className="mt-4 flex items-center gap-2"><Input readOnly className="font-mono" value={temporary?.password ?? ''} /><CopyButton size="md" value={temporary?.password ?? ''} label="Chép" /></div>
      </Modal>
    </div>
  );
}

function EmailTab() {
  const client = useQueryClient();
  const settings = useQuery<any>({ queryKey: ['settings'], queryFn: () => api.get('/api/admin/settings') });
  const [form, setForm] = useState({ host: '', port: 587, secure: false, user: '', password: '', from: '' });
  useEffect(() => {
    if (settings.data?.smtp) setForm((f) => ({ ...f, ...settings.data.smtp, password: '' }));
  }, [settings.data]);
  const save = useMutation({
    mutationFn: () => api.put('/api/admin/settings/smtp', { host: form.host, port: Number(form.port), secure: form.secure, user: form.user, password: form.password || undefined, from: form.from }),
    onSuccess: () => { toast.success('Đã lưu. Thử bằng nút "Gửi thử" ở mục Cảnh báo, Kênh thông báo'); client.invalidateQueries({ queryKey: ['settings'] }); },
    onError: notifyError,
  });
  return (
    <div className="max-w-lg space-y-4 p-5">
      <p className="text-sm text-soft">Máy chủ gửi thư dùng cho kênh cảnh báo qua email.</p>
      <div className="grid grid-cols-[1fr_110px] gap-3">
        <Field label="Máy chủ SMTP"><Input placeholder="smtp.example.com" value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} /></Field>
        <Field label="Cổng"><Input type="number" value={form.port} onChange={(e) => setForm({ ...form, port: Number(e.target.value) })} /></Field>
      </div>
      <label className="flex items-center gap-3 text-sm"><Switch label="Dùng TLS trực tiếp" checked={form.secure} onChange={(secure) => setForm({ ...form, secure })} /> TLS trực tiếp (thường là cổng 465)</label>
      <Field label="Tên đăng nhập"><Input autoComplete="off" value={form.user} onChange={(e) => setForm({ ...form, user: e.target.value })} /></Field>
      <Field label="Mật khẩu"><Input type="password" autoComplete="new-password" placeholder={settings.data?.smtp?.hasPassword ? 'Đã đặt. Để trống để giữ nguyên' : undefined} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
      <Field label="Địa chỉ gửi"><Input type="email" placeholder="kiosk@example.com" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} /></Field>
      <Button disabled={!form.host || !form.from} busy={save.isPending} onClick={() => save.mutate()}>Lưu</Button>
    </div>
  );
}

export default function Settings() {
  const can = useCan();
  const [tab, setTab] = useState<'profile' | 'security' | 'organization' | 'team' | 'email'>('profile');
  return (
    <>
      <PageHeader title="Cài đặt" hint="Tài khoản, bảo mật và tổ chức của bạn" />
      <Card>
        <Tabs
          className="px-3 pt-2"
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'profile', label: 'Hồ sơ' },
            { id: 'security', label: <span className="inline-flex items-center gap-1.5"><KeyRound className="size-3.5" /> Bảo mật</span> },
            { id: 'organization', label: 'Tổ chức' },
            { id: 'team', label: 'Thành viên', hidden: !can.admin },
            { id: 'email', label: 'Email', hidden: !can.admin },
          ]}
        />
        {tab === 'profile' && <ProfileTab />}
        {tab === 'security' && <SecurityTab />}
        {tab === 'organization' && <OrganizationTab />}
        {tab === 'team' && <TeamTab />}
        {tab === 'email' && <EmailTab />}
      </Card>
    </>
  );
}
