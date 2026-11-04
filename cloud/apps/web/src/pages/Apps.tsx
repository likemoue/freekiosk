import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Download, Package, QrCode, Rocket, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { api } from '../api';
import { useCan } from '../auth';
import { DeviceSelect } from '../components/commands';
import { DeviceSummary } from '../components/device';
import { UploadButton } from '../components/upload';
import { bytes, dateTime } from '../format';
import { Badge, Button, Card, Empty, ErrorBox, Loading, Modal, notifyError, Notice, PageHeader, Pills, Select, Table, td, th, trow, useConfirm } from '../ui';

function DeployDialog({ apk, onClose }: { apk: any; onClose: () => void }) {
  const [scope, setScope] = useState<'device' | 'group' | 'all'>('group');
  const [deviceId, setDeviceId] = useState('');
  const [groupId, setGroupId] = useState('');
  const devices = useQuery<DeviceSummary[]>({ queryKey: ['devices'], queryFn: () => api.get('/api/admin/devices') });
  const groups = useQuery<any[]>({ queryKey: ['groups'], queryFn: () => api.get('/api/admin/groups') });
  const target = scope === 'all' ? { all: true } : scope === 'group' ? (groupId ? { groupId } : null) : deviceId ? { deviceIds: [deviceId] } : null;
  const deploy = useMutation({
    mutationFn: () => api.post(`/api/admin/apks/${apk.id}/deploy`, { target }),
    onSuccess: (result) => {
      toast.success(`Đã gửi tới ${result.sent} thiết bị`);
      if (result.skipped.length) toast.warning(`Bỏ qua ${result.skipped.length} thiết bị không ở chế độ Device Owner`);
      onClose();
    },
    onError: notifyError,
  });
  return (
    <Modal open onClose={onClose} title={`Cài ${apk.fileName}`} hint="Cài im lặng, cần thiết bị ở chế độ Device Owner." footer={<><Button variant="outline" onClick={onClose}>Hủy</Button><Button disabled={!target} busy={deploy.isPending} onClick={() => deploy.mutate()}><Rocket className="size-4" /> Cài đặt</Button></>}>
      <Pills value={scope} onChange={setScope} options={[{ id: 'device', label: 'Một thiết bị' }, { id: 'group', label: 'Một nhóm' }, { id: 'all', label: 'Tất cả' }]} />
      <div className="mt-3">
        {scope === 'device' && <DeviceSelect value={deviceId} onChange={setDeviceId} devices={(devices.data ?? []).filter((d) => !d.unenrolledAt)} />}
        {scope === 'group' && (
          <Select aria-label="Chọn nhóm" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            <option value="">Chọn nhóm…</option>
            {groups.data?.map((g) => <option key={g.id} value={g.id}>{g.name} ({g.deviceCount})</option>)}
          </Select>
        )}
      </div>
      {apk.packageName === 'com.freekiosk' && <Notice tone="warn" className="mt-3">Đây là bản cập nhật của chính FreeKiosk: ứng dụng sẽ khởi động lại khi cài xong. APK phải cùng khóa ký với bản đang chạy.</Notice>}
    </Modal>
  );
}

export default function Apps() {
  const can = useCan();
  const confirm = useConfirm();
  const client = useQueryClient();
  const [deploying, setDeploying] = useState<any>(null);
  const apks = useQuery<any[]>({ queryKey: ['apks'], queryFn: () => api.get('/api/admin/apks') });
  const refresh = () => client.invalidateQueries({ queryKey: ['apks'] });

  const provisioning = useMutation({
    mutationFn: (id: string) => api.post(`/api/admin/apks/${id}/provisioning`),
    onSuccess: () => { toast.success('Đã đặt làm APK cấp phát'); refresh(); client.invalidateQueries({ queryKey: ['public-info'] }); },
    onError: notifyError,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/admin/apks/${id}`),
    onSuccess: () => { toast.success('Đã xóa APK'); refresh(); },
    onError: notifyError,
  });

  return (
    <>
      <PageHeader
        title="Ứng dụng (APK)"
        hint="Tải APK lên rồi cài im lặng cho thiết bị, hoặc chọn làm APK cấp phát cho mã QR."
        action={can.operate && (
          <UploadButton
            purpose="apk"
            accept=".apk,application/vnd.android.package-archive"
            label="Tải APK lên"
            finish={(id) => api.post(`/api/admin/apks/finish/${id}`, {})}
            onDone={refresh}
            onError={(message) => toast.error(message)}
          />
        )}
      />
      <Notice className="mb-5">
        Cấp phát bằng QR cần bản <code>assembleRelease -Pcloudprovi</code>: bản GitHub khai báo dịch vụ trợ năng nên bị Play Protect chặn giữa chừng. Bản GitHub vẫn dùng được khi cài qua ADB.
        {' '}Nút Kiểm tra cập nhật trong ứng dụng tìm bản FreeKiosk có mã phiên bản cao nhất ở trang này; nếu một phiên bản có cả hai bản dựng, tablet nhận bản không có <code>cloudprovi</code> trong tên tệp.
      </Notice>
      <Card>
        {apks.isLoading ? <Loading /> : apks.error ? <div className="p-4"><ErrorBox error={apks.error} /></div> : !apks.data?.length ? (
          <Empty icon={<Package />} title="Chưa có APK nào" hint="Tải lên bản FreeKiosk hoặc ứng dụng bạn muốn cài cho các thiết bị." />
        ) : (
          <Table>
            <thead><tr><th className={th}>Tệp</th><th className={th}>Gói</th><th className={th}>Phiên bản</th><th className={th}>Kích thước</th><th className={th}>Ngày tải lên</th><th className={th} /></tr></thead>
            <tbody>
              {apks.data.map((apk) => (
                <tr key={apk.id} className={trow}>
                  <td className={td}>
                    <span className="font-semibold">{apk.fileName}</span>
                    {apk.isProvisioning && <Badge tone="ok" className="ml-2"><QrCode className="size-3" /> APK cấp phát</Badge>}
                    <span className="block font-mono text-[11px] text-faint" title="SHA-256">{apk.sha256Hex.slice(0, 16)}…</span>
                  </td>
                  <td className={clsx(td, 'font-mono text-xs text-soft')}>{apk.packageName ?? '—'}</td>
                  <td className={clsx(td, 'text-soft')}>{apk.versionName ?? '—'}{apk.versionCode ? ` (${apk.versionCode})` : ''}</td>
                  <td className={clsx(td, 'tabular-nums text-soft')}>{bytes(apk.sizeBytes)}</td>
                  <td className={clsx(td, 'text-soft')}>{dateTime(apk.createdAt)}</td>
                  <td className={clsx(td, 'text-right whitespace-nowrap')}>
                    {can.operate && <Button size="sm" variant="outline" onClick={() => setDeploying(apk)}><Rocket className="size-3.5" /> Cài đặt</Button>}
                    {can.admin && apk.packageName === 'com.freekiosk' && !apk.isProvisioning && <Button size="sm" variant="ghost" className="ml-1" onClick={() => provisioning.mutate(apk.id)}><QrCode className="size-3.5" /> Đặt làm APK cấp phát</Button>}
                    {apk.isProvisioning && <a href="/dpc-apk-download/" className="ml-1 inline-flex"><Button size="sm" variant="ghost"><Download className="size-3.5" /> Tải về</Button></a>}
                    {can.admin && (
                      <button aria-label={`Xóa ${apk.fileName}`} className="ml-1 rounded-lg p-1.5 text-soft hover:bg-raised hover:text-bad" onClick={async () => {
                        if (await confirm({ title: `Xóa ${apk.fileName}?`, message: apk.isProvisioning ? 'Đây là APK cấp phát: mã QR sẽ không dùng được cho tới khi chọn APK khác.' : undefined, confirm: 'Xóa', danger: true })) remove.mutate(apk.id);
                      }}><Trash2 className="size-4" /></button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {deploying && <DeployDialog apk={deploying} onClose={() => setDeploying(null)} />}
    </>
  );
}
