import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, Images, MonitorSmartphone, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { api } from '../api';
import { useCan } from '../auth';
import { DeviceSummary } from '../components/device';
import { LiveImage, liveProblem, useLive } from '../components/live';
import { bytes, dateTime, timeAgo } from '../format';
import { Button, Card, Empty, ErrorBox, Loading, Modal, notifyError, PageHeader, Select, Tabs, useConfirm } from '../ui';

const byName = new Intl.Collator('vi', { numeric: true });

/**
 * Every screen live, its name above it, one picture every few seconds (LiveService in the API). A click
 * opens it full size, with a hand on it.
 */
function LiveGrid({ devices, group }: { devices: DeviceSummary[]; group: string }) {
  const shown = useMemo(
    () =>
      devices
        .filter((d) => !d.unenrolledAt && (!group || d.group?.id === group))
        .sort((a, b) => Number(b.online) - Number(a.online) || byName.compare(a.name, b.name)),
    [devices, group],
  );
  const watched = shown.filter((d) => d.online).map((d) => d.id);
  const { byDevice } = useLive(watched, 'grid');

  if (!shown.length) return <Card><Empty icon={<MonitorSmartphone />} title="Không có thiết bị nào" /></Card>;
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
      {shown.map((device) => {
        const status = byDevice.get(device.id);
        const problem = liveProblem(status, device.online);
        return (
          <Link key={device.id} to={`/quan-ly/anh-man-hinh/truc-tiep/${device.id}`} className="group block">
            <Card className="overflow-hidden transition-shadow group-hover:shadow-lg">
              <div className="flex items-center gap-2 px-3 py-2">
                <span className={`size-2 shrink-0 rounded-full ${device.online ? 'bg-ok' : 'bg-faint'}`} />
                <span className="truncate text-sm font-semibold">{device.name}</span>
              </div>
              <div className="relative flex aspect-video items-center justify-center bg-black">
                {status?.seq ? (
                  <LiveImage deviceId={device.id} seq={status.seq} alt={`Màn hình của ${device.name}`} className={`h-full w-full object-contain ${problem ? 'opacity-40' : ''}`} />
                ) : null}
                {problem && <span className="absolute inset-x-3 text-center text-xs text-white/85">{problem}</span>}
              </div>
            </Card>
          </Link>
        );
      })}
    </div>
  );
}

export default function Screenshots() {
  const can = useCan();
  const confirm = useConfirm();
  const client = useQueryClient();
  const [deviceId, setDeviceId] = useState('');
  const [open, setOpen] = useState<any>(null);
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'anh' ? 'shots' : 'live';
  const [group, setGroup] = useState('');
  const groups = useQuery<any[]>({ queryKey: ['groups'], queryFn: () => api.get('/api/admin/groups') });

  const devices = useQuery<DeviceSummary[]>({ queryKey: ['devices'], queryFn: () => api.get('/api/admin/devices') });
  const devicesLive = useQuery<DeviceSummary[]>({ queryKey: ['devices'], queryFn: () => api.get('/api/admin/devices'), refetchInterval: 15_000 });
  const shots = useQuery<any[]>({
    queryKey: ['screenshots', deviceId || 'all'],
    queryFn: () => api.get(`/api/admin/screenshots${deviceId ? `?deviceId=${deviceId}` : ''}`),
    refetchInterval: 10_000,
    enabled: tab === 'shots',
  });
  const request = useMutation({
    mutationFn: () => api.post('/api/admin/commands', { type: 'screenshot', target: deviceId ? { deviceIds: [deviceId] } : { all: true } }),
    onSuccess: (result) => toast.success(`Đã yêu cầu ${result.sent} thiết bị. Ảnh sẽ về trong vài giây`),
    onError: notifyError,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/admin/screenshots/${id}`),
    onSuccess: () => { setOpen(null); client.invalidateQueries({ queryKey: ['screenshots'] }); },
    onError: notifyError,
  });

  return (
    <>
      <PageHeader
        title="Ảnh màn hình"
        hint={tab === 'live'
          ? 'Màn hình của từng thiết bị, cập nhật vài giây một lần. Bấm vào một màn hình để xem lớn và thao tác từ xa.'
          : 'Ảnh chụp theo lệnh, được giữ 30 ngày.'}
        action={tab === 'live' ? (
          <Select className="w-52" aria-label="Lọc theo nhóm" value={group} onChange={(e) => setGroup(e.target.value)}>
            <option value="">Mọi nhóm</option>
            {(groups.data ?? []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </Select>
        ) : (
          <>
            <Select className="w-52" aria-label="Lọc theo thiết bị" value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
              <option value="">Mọi thiết bị</option>
              {devices.data?.filter((d) => !d.unenrolledAt).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
            {can.operate && <Button busy={request.isPending} onClick={() => request.mutate()}><Camera className="size-4" /> {deviceId ? 'Chụp ngay' : 'Chụp tất cả'}</Button>}
          </>
        )}
      />
      <Tabs
        className="mb-5"
        value={tab}
        onChange={(next) => setParams(next === 'shots' ? { tab: 'anh' } : {}, { replace: true })}
        tabs={[
          { id: 'live', label: 'Trực tiếp' },
          { id: 'shots', label: 'Ảnh đã chụp' },
        ]}
      />
      {tab === 'live' ? (
        !can.operate ? (
          <Card><Empty icon={<MonitorSmartphone />} title="Cần quyền vận hành" hint="Tài khoản chỉ xem không mở được màn hình trực tiếp." /></Card>
        ) : devicesLive.isLoading ? <Loading /> : devicesLive.error ? <ErrorBox error={devicesLive.error} /> : (
          <LiveGrid devices={devicesLive.data ?? []} group={group} />
        )
      ) : shots.isLoading ? <Loading /> : shots.error ? <ErrorBox error={shots.error} /> : !shots.data?.length ? (
        <Card><Empty icon={<Images />} title="Chưa có ảnh nào" hint='Thiết bị cần bật "Cho phép chụp màn hình từ xa". Có thể bật hàng loạt bằng Hồ sơ cấu hình.' /></Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {shots.data.map((shot) => (
            <Card key={shot.id} className="overflow-hidden">
              <button type="button" className="block w-full bg-raised" aria-label={`Xem ảnh của ${shot.device?.name}`} onClick={() => setOpen(shot)}>
                <img src={`/api/admin/screenshots/${shot.id}/image`} alt="" loading="lazy" className="aspect-video w-full object-contain" />
              </button>
              <div className="px-3 py-2.5">
                <Link to={`/quan-ly/thiet-bi/${shot.deviceId}`} className="block truncate text-sm font-semibold hover:underline">{shot.device?.name}</Link>
                <p className="text-xs text-soft" title={dateTime(shot.capturedAt)}>{timeAgo(shot.capturedAt)} · {bytes(shot.sizeBytes)}</p>
              </div>
            </Card>
          ))}
        </div>
      )}
      <Modal
        open={!!open}
        wide
        onClose={() => setOpen(null)}
        title={open?.device?.name}
        hint={dateTime(open?.capturedAt)}
        footer={can.operate ? (
          <Button variant="danger-outline" onClick={async () => {
            if (await confirm({ title: 'Xóa ảnh này?', confirm: 'Xóa', danger: true })) remove.mutate(open.id);
          }}><Trash2 className="size-4" /> Xóa</Button>
        ) : undefined}
      >
        {open && <img src={`/api/admin/screenshots/${open.id}/image`} alt={`Màn hình của ${open.device?.name}`} className="w-full rounded-xl" />}
      </Modal>
    </>
  );
}
