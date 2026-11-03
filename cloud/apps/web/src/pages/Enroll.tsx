import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowLeft, Check, Download, KeyRound, QrCode, ShieldCheck, Smartphone, TerminalSquare, Trash2 } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { ReactNode, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { api } from '../api';
import { dateTime, timeAgo } from '../format';
import { Badge, Button, Card, CardTitle, CopyButton, Field, Input, Modal, notifyError, Notice, PageHeader, Select, Table, td, th, trow } from '../ui';

function Step({ n, title, children, last }: { n: number; title: string; children?: ReactNode; last?: boolean }) {
  return (
    <li className="flex gap-4">
      <div className="flex flex-col items-center">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-strong text-sm font-bold text-white">{n}</span>
        {!last && <span className="my-1 w-0.5 flex-1 bg-brand-strong/30" />}
      </div>
      <div className="pb-5">
        <p className="font-semibold">{title}</p>
        <div className="mt-0.5 text-sm text-soft">{children}</div>
      </div>
    </li>
  );
}

function QrBox({ value, label }: { value: string; label: string }) {
  return (
    <div className="inline-block rounded-2xl border border-line bg-white p-4">
      <QRCodeSVG value={value} size={value.length > 300 ? 300 : 220} level={value.length > 300 ? 'L' : 'M'} title={label} />
    </div>
  );
}

function TokenPanel({ token, mode, onClose }: { token: any; mode: 'standard' | 'managed'; onClose: () => void }) {
  const [ssid, setSsid] = useState('');
  const [wifiPassword, setWifiPassword] = useState('');
  const { data: qr } = useQuery<any>({ queryKey: ['token-qr', token.id], queryFn: () => api.get(`/api/admin/enrollment/tokens/${token.id}/qr`) });

  // The Wi-Fi details only ever exist in this page and in the picture: they are not sent anywhere
  const provisioning = useMemo(() => {
    if (!qr?.provisioning) return null;
    const payload = JSON.parse(qr.provisioning);
    if (ssid.trim()) {
      payload['android.app.extra.PROVISIONING_WIFI_SSID'] = ssid.trim();
      if (wifiPassword) {
        payload['android.app.extra.PROVISIONING_WIFI_PASSWORD'] = wifiPassword;
        payload['android.app.extra.PROVISIONING_WIFI_SECURITY_TYPE'] = 'WPA';
      }
    }
    return JSON.stringify(payload);
  }, [qr, ssid, wifiPassword]);

  return (
    <Modal open onClose={onClose} title={mode === 'managed' ? 'Mã QR cấp phát thiết bị' : 'Mã đăng ký thiết bị'} hint={`Hết hạn ${dateTime(token.expiresAt)}`} wide footer={<Button onClick={onClose}>Xong</Button>}>
      {!qr ? null : mode === 'standard' ? (
        <div className="grid items-start gap-6 sm:grid-cols-[auto_1fr]">
          <div className="text-center">
            <QrBox value={qr.app} label="Mã QR đăng ký" />
            <p className="mt-2 text-xs text-soft">Quét trong ứng dụng để điền sẵn cả hai ô</p>
          </div>
          <div className="space-y-4">
            <Field label="Địa chỉ máy chủ">
              <div className="flex gap-2"><Input readOnly value={qr.serverUrl} /><CopyButton size="md" value={qr.serverUrl} label="Chép" /></div>
            </Field>
            <Field label="Mã đăng ký">
              <div className="flex gap-2">
                <Input readOnly value={qr.token} className="text-center font-mono text-lg font-bold tracking-[0.25em]" />
                <CopyButton size="md" value={qr.token} label="Chép" />
              </div>
            </Field>
            <Notice tone="warn">Đăng ký sẽ xóa các cài đặt FreeKiosk hiện có trên máy.</Notice>
            <details>
              <summary className="cursor-pointer text-[13px] font-semibold text-brand-strong dark:text-brand">Cài không cần chạm máy, qua ADB</summary>
              <pre className="mt-2 overflow-x-auto rounded-xl bg-slate-900 p-3 text-xs text-slate-100">{qr.adb}</pre>
              <div className="mt-2"><CopyButton value={qr.adb} /></div>
              <p className="mt-2 text-xs text-soft">Đổi 1234 thành mã PIN bạn muốn đặt cho máy.</p>
            </details>
          </div>
        </div>
      ) : !provisioning ? (
        <div className="space-y-3">
          <Notice tone="warn">Chưa có APK cấp phát. Trình cài đặt của Android cần tải FreeKiosk từ máy chủ này.</Notice>
          <p className="text-sm text-soft">Tải lên bản <b>build -Pcloudprovi</b> (bản GitHub có dịch vụ trợ năng nên bị Play Protect chặn khi cấp phát bằng QR), rồi chọn "Đặt làm APK cấp phát".</p>
          <Link to="/quan-ly/ung-dung"><Button>Mở trang Ứng dụng</Button></Link>
        </div>
      ) : (
        <div className="grid items-start gap-6 sm:grid-cols-[auto_1fr]">
          <div className="text-center">
            <QrBox value={provisioning} label="Mã QR cấp phát" />
            <p className="mt-2 text-xs text-soft">APK: {qr.provisioningApk?.fileName}</p>
          </div>
          <div className="space-y-4">
            <ol className="list-decimal space-y-1.5 pl-5 text-sm">
              <li>Máy mới, hoặc đã khôi phục cài đặt gốc.</li>
              <li>Ở màn hình chào mừng, chạm 6 lần để mở trình quét QR.</li>
              <li>Quét mã này. Máy tự tải FreeKiosk, đặt Device Owner và tự đăng ký.</li>
            </ol>
            <div className="rounded-xl border border-line p-4">
              <p className="mb-3 text-[13px] font-semibold">Wi-Fi cho máy mới (không bắt buộc)</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Tên mạng"><Input value={ssid} onChange={(e) => setSsid(e.target.value)} /></Field>
                <Field label="Mật khẩu"><Input type="password" autoComplete="new-password" value={wifiPassword} onChange={(e) => setWifiPassword(e.target.value)} /></Field>
              </div>
              <p className="mt-2 text-xs text-soft">Thông tin này chỉ nằm trong ảnh QR, không gửi lên máy chủ.</p>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

export default function Enroll() {
  const client = useQueryClient();
  const [mode, setMode] = useState<'standard' | 'managed'>('standard');
  const [label, setLabel] = useState('');
  const [groupId, setGroupId] = useState('');
  const [profileId, setProfileId] = useState('');
  const [maxUses, setMaxUses] = useState(1);
  const [validHours, setValidHours] = useState(24);
  const [shown, setShown] = useState<any>(null);

  const tokens = useQuery<any[]>({ queryKey: ['tokens'], queryFn: () => api.get('/api/admin/enrollment/tokens'), refetchInterval: 15_000 });
  const groups = useQuery<any[]>({ queryKey: ['groups'], queryFn: () => api.get('/api/admin/groups') });
  const profiles = useQuery<any[]>({ queryKey: ['profiles'], queryFn: () => api.get('/api/admin/profiles') });
  const info = useQuery<any>({ queryKey: ['public-info'], queryFn: () => api.get('/api/public/info') });

  const create = useMutation({
    mutationFn: () => api.post('/api/admin/enrollment/tokens', { label: label || undefined, groupId: groupId || undefined, profileId: profileId || undefined, maxUses, validHours }),
    onSuccess: (token) => {
      setShown(token);
      setLabel('');
      client.invalidateQueries({ queryKey: ['tokens'] });
    },
    onError: notifyError,
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api.post(`/api/admin/enrollment/tokens/${id}/revoke`),
    onSuccess: () => { toast.success('Đã thu hồi mã'); client.invalidateQueries({ queryKey: ['tokens'] }); },
    onError: notifyError,
  });

  const Choice = ({ id, icon, title, text }: { id: 'standard' | 'managed'; icon: ReactNode; title: string; text: string }) => (
    <button
      type="button"
      aria-pressed={mode === id}
      onClick={() => setMode(id)}
      className={clsx('rounded-2xl border p-4 text-left transition-colors', mode === id ? 'border-brand-strong bg-brand-soft' : 'border-line bg-card hover:bg-raised')}
    >
      <span className="flex items-center gap-2 font-bold [&_svg]:size-[18px]">{icon} {title}</span>
      <span className="mt-1 block text-[13px] text-soft">{text}</span>
    </button>
  );

  return (
    <>
      <PageHeader
        title="Thêm thiết bị"
        hint="Chọn cách đăng ký thiết bị rồi làm theo các bước."
        back={<Link to="/quan-ly/thiet-bi" aria-label="Quay lại danh sách" className="mt-1 rounded-lg p-1 text-soft hover:bg-raised"><ArrowLeft className="size-5" /></Link>}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <Choice id="standard" icon={<ShieldCheck />} title="Tiêu chuẩn" text="Cài ứng dụng rồi nhập mã. Dùng được trên mọi thiết bị, xong trong một phút." />
        <Choice id="managed" icon={<QrCode />} title="Toàn quyền (Device Owner)" text="Khởi động lại, cài im lặng, tắt màn hình thật. Không cần chạm máy, trên máy đã khôi phục gốc." />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_380px]">
        <Card className="p-5">
          <h2 className="mb-4 text-[15px] font-bold">{mode === 'standard' ? 'Đăng ký tiêu chuẩn' : 'Cấp phát bằng mã QR'}</h2>
          {mode === 'standard' ? (
            <ol>
              <Step n={1} title="Cài FreeKiosk lên thiết bị">
                Tải ứng dụng rồi mở lên.
                {info.data?.apkAvailable && <a href="/dpc-apk-download/" className="mt-2 inline-flex"><Button size="sm" variant="outline"><Download className="size-4" /> Tải APK {info.data.apkVersion}</Button></a>}
              </Step>
              <Step n={2} title="Mở màn hình kết nối">Vào Cài đặt, Nâng cao, Quản lý Cloud.</Step>
              <Step n={3} title="Nhập mã">Gõ mã 8 ký tự hoặc quét mã QR ở bên phải.</Step>
              <Step n={4} title="Thiết bị xuất hiện trên trang quản lý" last>Trong vòng 30 giây.</Step>
            </ol>
          ) : (
            <ol>
              <Step n={1} title="Chuẩn bị máy">Máy mới hoặc đã khôi phục cài đặt gốc. Android chỉ cho toàn quyền với máy cấp phát từ trạng thái gốc.</Step>
              <Step n={2} title="Có APK cấp phát">
                <Link to="/quan-ly/ung-dung" className="font-semibold text-brand-strong hover:underline dark:text-brand">Tải bản build -Pcloudprovi lên</Link> và chọn làm APK cấp phát.
              </Step>
              <Step n={3} title="Tạo mã rồi quét">Chạm 6 lần ở màn hình chào mừng để mở trình quét. Máy tự làm các bước còn lại.</Step>
              <Step n={4} title="Thiết bị tự đăng ký" last>Hiện trên trang quản lý với nhãn Device Owner.</Step>
            </ol>
          )}
          {mode === 'standard' && (
            <Notice tone="warn"><Smartphone className="mr-1 inline size-4" /> Không có Device Owner thì không khởi động lại, không cài im lặng và không tắt màn hình thật được. Máy đã đặt Device Owner qua ADB sẽ được nhận biết tự động.</Notice>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="mb-4 flex items-center gap-2 text-[15px] font-bold"><KeyRound className="size-4" /> Tạo mã đăng ký</h2>
          <div className="space-y-3">
            <Field label="Ghi chú (không bắt buộc)"><Input placeholder="Ví dụ: Cơ sở Quận 1" value={label} onChange={(e) => setLabel(e.target.value)} /></Field>
            <Field label="Đưa vào nhóm">
              <Select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
                <option value="">Không có nhóm</option>
                {groups.data?.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </Select>
            </Field>
            <Field label="Áp dụng hồ sơ">
              <Select value={profileId} onChange={(e) => setProfileId(e.target.value)}>
                <option value="">Không dùng</option>
                {profiles.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Số máy được dùng"><Input type="number" min={1} max={1000} value={maxUses} onChange={(e) => setMaxUses(Number(e.target.value) || 1)} /></Field>
              <Field label="Hiệu lực (giờ)"><Input type="number" min={1} max={720} value={validHours} onChange={(e) => setValidHours(Number(e.target.value) || 24)} /></Field>
            </div>
            <Button className="w-full" busy={create.isPending} onClick={() => create.mutate()}><QrCode className="size-4" /> Tạo mã</Button>
          </div>
        </Card>
      </div>

      <Card className="mt-5">
        <CardTitle title="Các mã đã tạo" />
        {!tokens.data?.length ? (
          <p className="px-5 pb-5 text-sm text-soft">Chưa có mã nào.</p>
        ) : (
          <Table>
            <thead><tr><th className={th}>Mã</th><th className={th}>Ghi chú</th><th className={th}>Nhóm</th><th className={th}>Đã dùng</th><th className={th}>Hết hạn</th><th className={th} /></tr></thead>
            <tbody>
              {tokens.data.map((token) => (
                <tr key={token.id} className={trow}>
                  <td className={td}>
                    {token.active ? <code className="font-bold tracking-widest">{token.token}</code> : (
                      <Badge>{token.revokedAt ? 'Đã thu hồi' : token.usedCount >= token.maxUses ? <span className="inline-flex items-center gap-1"><Check className="size-3" /> Đã dùng</span> : 'Hết hạn'}</Badge>
                    )}
                  </td>
                  <td className={clsx(td, 'text-soft')}>{token.label ?? '—'}</td>
                  <td className={clsx(td, 'text-soft')}>{token.group?.name ?? '—'}</td>
                  <td className={clsx(td, 'tabular-nums')}>{token.usedCount}/{token.maxUses}</td>
                  <td className={clsx(td, 'text-soft')} title={dateTime(token.expiresAt)}>{new Date(token.expiresAt) > new Date() ? dateTime(token.expiresAt) : timeAgo(token.expiresAt)}</td>
                  <td className={clsx(td, 'text-right whitespace-nowrap')}>
                    {token.active && (
                      <>
                        <Button size="sm" variant="ghost" onClick={() => setShown(token)}><TerminalSquare className="size-4" /> Xem</Button>
                        <Button size="sm" variant="ghost" aria-label="Thu hồi mã" onClick={() => revoke.mutate(token.id)}><Trash2 className="size-4" /></Button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {shown && <TokenPanel token={shown} mode={mode} onClose={() => setShown(null)} />}
    </>
  );
}
