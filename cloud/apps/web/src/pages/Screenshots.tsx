import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, Images, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { api } from '../api';
import { useCan } from '../auth';
import { DeviceSummary } from '../components/device';
import { bytes, dateTime, timeAgo } from '../format';
import { Button, Card, Empty, ErrorBox, Loading, Modal, notifyError, PageHeader, Select, useConfirm } from '../ui';

export default function Screenshots() {
  const can = useCan();
  const confirm = useConfirm();
  const client = useQueryClient();
  const [deviceId, setDeviceId] = useState('');
  const [open, setOpen] = useState<any>(null);

  const devices = useQuery<DeviceSummary[]>({ queryKey: ['devices'], queryFn: () => api.get('/api/admin/devices') });
  const shots = useQuery<any[]>({
    queryKey: ['screenshots', deviceId || 'all'],
    queryFn: () => api.get(`/api/admin/screenshots${deviceId ? `?deviceId=${deviceId}` : ''}`),
    refetchInterval: 10_000,
  });
  const request = useMutation({
    mutationFn: () => api.post('/api/admin/commands', { type: 'screenshot', target: deviceId ? { deviceIds: [deviceId] } : { all: true } }),
    onSuccess: (result) => toast.success(`Đã yêu cầu ${result.sent} thiết bị. Ảnh sẽ về trong khoảng 30 giây`),
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
        hint="Xem thiết bị đang hiển thị gì mà không cần có mặt tại chỗ. Ảnh được giữ 30 ngày."
        action={
          <>
            <Select className="w-52" aria-label="Lọc theo thiết bị" value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
              <option value="">Mọi thiết bị</option>
              {devices.data?.filter((d) => !d.unenrolledAt).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
            {can.operate && <Button busy={request.isPending} onClick={() => request.mutate()}><Camera className="size-4" /> {deviceId ? 'Chụp ngay' : 'Chụp tất cả'}</Button>}
          </>
        }
      />
      {shots.isLoading ? <Loading /> : shots.error ? <ErrorBox error={shots.error} /> : !shots.data?.length ? (
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
