import { useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useSignOut } from '../auth';
import { Logo } from '../layout';
import { Button, ErrorBox, Field, Input, Notice } from '../ui';

export default function ChangePassword() {
  const navigate = useNavigate();
  const client = useQueryClient();
  const signOut = useSignOut();
  const [currentPassword, setCurrent] = useState('');
  const [newPassword, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (newPassword !== again) {
      setError(new Error('Hai lần nhập mật khẩu mới không khớp'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/admin/auth/password', { currentPassword, newPassword });
      await client.invalidateQueries({ queryKey: ['me'] });
      navigate('/quan-ly', { replace: true });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <form onSubmit={submit} className="soft-shadow w-full max-w-md rounded-2xl border border-line bg-card px-8 py-9">
        <div className="mb-5 flex flex-col items-center text-center">
          <Logo className="size-12" />
          <h1 className="mt-3 text-xl font-bold">Đặt mật khẩu của bạn</h1>
        </div>
        <Notice className="mb-4">Tài khoản đang dùng mật khẩu tạm. Hãy đổi trước khi tiếp tục.</Notice>
        {error != null && <div className="mb-4"><ErrorBox error={error} /></div>}
        <div className="space-y-4">
          <Field label="Mật khẩu hiện tại">
            <Input type="password" autoComplete="current-password" required autoFocus value={currentPassword} onChange={(e) => setCurrent(e.target.value)} />
          </Field>
          <Field label="Mật khẩu mới" hint="Ít nhất 10 ký tự.">
            <Input type="password" autoComplete="new-password" required minLength={10} value={newPassword} onChange={(e) => setNext(e.target.value)} />
          </Field>
          <Field label="Nhập lại mật khẩu mới">
            <Input type="password" autoComplete="new-password" required value={again} onChange={(e) => setAgain(e.target.value)} />
          </Field>
        </div>
        <Button type="submit" busy={busy} className="mt-5 w-full">Lưu mật khẩu</Button>
        <Button variant="ghost" className="mt-2 w-full" onClick={signOut}>Đăng xuất</Button>
      </form>
    </div>
  );
}
