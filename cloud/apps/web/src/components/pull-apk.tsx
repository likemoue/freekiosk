import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Loader2, Rocket } from 'lucide-react';
import { useState } from 'react';
import { api } from '../api';
import { bytes } from '../format';
import { Button, Field, Modal, notifyError, Notice } from '../ui';
import { AppChoice } from './app-picker';
import { DeviceSelect } from './commands';
import { DeviceSummary } from './device';

interface CommandLine {
  id: string;
  batchId: string | null;
  status: string;
  errorMessage: string | null;
  result: { apk_id?: string; file_name?: string; already_in_library?: boolean; size_bytes?: number } | null;
}

/**
 * The APK of an app taken from a tablet that has it (the pull_apk command), into the library, to be
 * installed on the others like any upload. The tablet sends it in parts: an app from the Play Store is a
 * set of files, which the library takes as one.
 */
export function PullApkDialog({ onClose, onDeploy }: { onClose: () => void; onDeploy: (apk: any) => void }) {
  const client = useQueryClient();
  const [deviceId, setDeviceId] = useState('');
  const [app, setApp] = useState<{ packageName: string; label: string }>({ packageName: '', label: '' });
  const [batchId, setBatchId] = useState<string | null>(null);
  const devices = useQuery<DeviceSummary[]>({ queryKey: ['devices'], queryFn: () => api.get('/api/admin/devices') });
  const device = devices.data?.find((d) => d.id === deviceId);
  const able = !device || device.capabilities.length === 0 || device.capabilities.includes('pull_apk');

  const send = useMutation({
    mutationFn: () => api.post('/api/admin/commands', { type: 'pull_apk', params: { package_name: app.packageName, label: app.label }, target: { deviceIds: [deviceId] } }),
    onSuccess: (result: { batchId: string; sent: number; skipped: Array<{ reason: string }> }) => {
      if (!result.sent) {
        notifyError(new Error(result.skipped[0]?.reason ?? 'Thiết bị không nhận lệnh này'));
        return;
      }
      setBatchId(result.batchId);
    },
    onError: notifyError,
  });

  // The tablet answers when the library has the file: seconds for a small app, a few minutes for a large one
  const line = useQuery<CommandLine | null>({
    queryKey: ['pull-apk', batchId],
    queryFn: async () => ((await api.get<CommandLine[]>(`/api/admin/commands?deviceId=${deviceId}`)).find((row) => row.batchId === batchId) ?? null),
    enabled: !!batchId,
    refetchInterval: (query) => (['SUCCESS', 'ERROR', 'EXPIRED', 'CANCELLED'].includes(query.state.data?.status ?? '') ? false : 2_000),
  });
  const done = line.data?.status === 'SUCCESS';
  const failed = ['ERROR', 'EXPIRED', 'CANCELLED'].includes(line.data?.status ?? '');
  const apks = useQuery<any[]>({ queryKey: ['apks'], queryFn: () => api.get('/api/admin/apks'), enabled: done });
  const pulled = done ? apks.data?.find((apk) => apk.id === line.data?.result?.apk_id) : undefined;

  if (done && !apks.isFetching && line.data?.result?.apk_id && !pulled) client.invalidateQueries({ queryKey: ['apks'] });

  return (
    <Modal
      open
      onClose={onClose}
      title="Lấy APK từ thiết bị"
      hint="Tablet gửi tệp APK của ứng dụng lên thư viện, rồi cài được cho các thiết bị khác như APK tải lên."
      footer={
        batchId ? (
          <>
            <Button variant="outline" onClick={onClose}>Đóng</Button>
            {pulled && (
              <Button onClick={() => onDeploy(pulled)}>
                <Rocket className="size-4" /> Cài cho thiết bị khác
              </Button>
            )}
          </>
        ) : (
          <>
            <Button variant="outline" onClick={onClose}>Hủy</Button>
            <Button disabled={!deviceId || !app.packageName || !able} busy={send.isPending} onClick={() => send.mutate()}>
              Lấy về thư viện
            </Button>
          </>
        )
      }
    >
      {!batchId ? (
        <div className="space-y-4">
          <Field label="Thiết bị có sẵn ứng dụng">
            <DeviceSelect
              value={deviceId}
              onChange={(id) => {
                setDeviceId(id);
                setApp({ packageName: '', label: '' });
              }}
              devices={(devices.data ?? []).filter((d) => !d.unenrolledAt)}
            />
          </Field>
          {device && !able && <Notice tone="warn">Thiết bị này cần FreeKiosk bản mới nhất để gửi APK lên.</Notice>}
          {device && !device.online && <Notice tone="warn">Thiết bị đang ngoại tuyến: tệp sẽ được gửi khi máy kết nối lại, trong vòng một giờ.</Notice>}
          {deviceId && (
            <Field label="Ứng dụng">
              <AppChoice target={{ deviceIds: [deviceId] }} value={app.packageName} onChange={(packageName, label) => setApp({ packageName, label })} />
            </Field>
          )}
        </div>
      ) : done ? (
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-ok" />
          <div className="text-sm">
            <div className="font-semibold">{line.data?.result?.file_name ?? app.label}</div>
            <div className="text-soft">
              {line.data?.result?.already_in_library
                ? 'Đúng tệp này đã có trong thư viện, không lưu thêm bản nữa.'
                : `Đã vào thư viện${line.data?.result?.size_bytes ? `, ${bytes(line.data.result.size_bytes)}` : ''}.`}{' '}
              Bấm Cài cho thiết bị khác để chọn máy, nhóm hoặc tất cả.
            </div>
          </div>
        </div>
      ) : failed ? (
        <Notice tone="bad">{line.data?.errorMessage ?? 'Thiết bị không gửi được tệp.'}</Notice>
      ) : (
        <div className="flex items-start gap-3 text-sm">
          <Loader2 className="mt-0.5 size-5 shrink-0 animate-spin text-brand-strong" />
          <div>
            <div className="font-semibold">{line.data?.status === 'SENT' ? 'Tablet đang gửi tệp lên' : 'Đang chờ tablet nhận lệnh'}</div>
            <div className="text-soft">Ứng dụng lớn có thể mất vài phút. Có thể đóng hộp này: tệp vẫn vào thư viện khi gửi xong.</div>
          </div>
        </div>
      )}
    </Modal>
  );
}
