import { useQueryClient } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { Logo } from '../layout';
import { Badge, Button, ErrorBox, Field, Input } from '../ui';

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const client = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [remember, setRemember] = useState(true);
  const [needsCode, setNeedsCode] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/api/admin/auth/me').then(() => navigate('/quan-ly', { replace: true })).catch(() => {});
  }, [navigate]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api.post('/api/admin/auth/login', { email, password, remember, code: needsCode ? code : undefined });
      if (result.requires2fa) {
        setNeedsCode(true);
        return;
      }
      client.clear();
      navigate((location.state as { from?: string } | null)?.from ?? '/quan-ly', { replace: true });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <form onSubmit={submit} className="soft-shadow w-full max-w-md rounded-2xl border border-line bg-card px-8 py-9">
        <div className="mb-6 flex flex-col items-center text-center">
          <Logo className="size-12" />
          <h1 className="mt-3 text-xl font-bold">FreeKiosk Manager</h1>
          <Badge tone="solid-ok" className="mt-1">Tự vận hành</Badge>
          <p className="mt-2 text-sm text-soft">{needsCode ? 'Nhập mã từ ứng dụng xác thực' : 'Đăng nhập vào tài khoản của bạn'}</p>
        </div>

        {error != null && <div className="mb-4"><ErrorBox error={error} /></div>}

        {!needsCode ? (
          <div className="space-y-4">
            <Field label="Email">
              <Input type="email" autoComplete="username" required autoFocus placeholder="ban@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field label="Mật khẩu">
              <Input type="password" autoComplete="current-password" required placeholder="Mật khẩu của bạn" value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 accent-brand-strong" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              Ghi nhớ đăng nhập 30 ngày
            </label>
          </div>
        ) : (
          <Field label="Mã xác thực" hint="Mã 6 số, hoặc một mã khôi phục nếu bạn mất điện thoại.">
            <div className="relative">
              <ShieldCheck className="absolute top-2.5 left-3 size-5 text-soft" />
              <Input autoFocus required inputMode="text" autoComplete="one-time-code" className="pl-10 tracking-widest" value={code} onChange={(e) => setCode(e.target.value)} />
            </div>
          </Field>
        )}

        <Button type="submit" busy={busy} className="mt-5 w-full">
          {needsCode ? 'Xác nhận' : 'Đăng nhập'}
        </Button>
        {needsCode && (
          <Button variant="ghost" className="mt-2 w-full" onClick={() => { setNeedsCode(false); setCode(''); setError(null); }}>
            Quay lại
          </Button>
        )}
        <p className="mt-6 text-center text-xs text-soft">Quên mật khẩu? Hãy nhờ quản trị viên đặt lại trong mục Cài đặt, Thành viên.</p>
      </form>
    </div>
  );
}
