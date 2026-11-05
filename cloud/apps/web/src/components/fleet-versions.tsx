import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Package, Rocket, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { api } from '../api';
import { useCan } from '../auth';
import { Badge, Button, Card, Empty, ErrorBox, Loading, notifyError, Notice, useConfirm } from '../ui';

interface DeviceRef {
  id: string;
  name: string;
  online: boolean;
}

interface VersionGroup {
  versionCode: number | null;
  versionName: string | null;
  behind: boolean;
  ahead: boolean;
  devices: DeviceRef[];
}

export interface AppVersions {
  packageName: string;
  label: string;
  iconUrl: string | null;
  latest: { apkId: string; fileName: string; versionName: string | null; versionCode: number | null } | null;
  versions: VersionGroup[];
  missing: DeviceRef[];
  notReported: DeviceRef[];
  state: 'same' | 'mixed' | 'behind' | 'none';
}

const STATE: Record<AppVersions['state'], { label: string; tone: 'ok' | 'warn' | 'neutral' | 'bad' }> = {
  mixed: { label: 'Lệch phiên bản', tone: 'bad' },
  behind: { label: 'Có bản mới hơn', tone: 'warn' },
  same: { label: 'Đồng nhất', tone: 'ok' },
  none: { label: 'Chưa có máy nào', tone: 'neutral' },
};

export const needsLooking = (app: AppVersions) => app.state === 'mixed' || app.state === 'behind';

export const useFleetVersions = () =>
  useQuery<AppVersions[]>({ queryKey: ['fleet-versions'], queryFn: () => api.get('/api/admin/apks/fleet-versions'), refetchInterval: 30_000 });

const versionText = (version: { versionName: string | null; versionCode: number | null }) =>
  version.versionName && version.versionCode !== null
    ? `${version.versionName} (${version.versionCode})`
    : version.versionName ?? (version.versionCode !== null ? `Mã ${version.versionCode}` : 'Không rõ');

function DeviceNames({ devices, open }: { devices: DeviceRef[]; open?: boolean }) {
  const list = (
    <span className="text-xs text-soft">
      {devices.map((device, index) => (
        <span key={device.id}>
          {index > 0 && ', '}
          <Link to={`/quan-ly/thiet-bi/${device.id}`} className="hover:underline">{device.name}</Link>
        </span>
      ))}
    </span>
  );
  if (open) return <p className="mt-0.5">{list}</p>;
  return (
    <details className="mt-0.5">
      <summary className="cursor-pointer text-xs text-soft">Xem {devices.length} thiết bị</summary>
      {list}
    </details>
  );
}

function AppIcon({ app }: { app: AppVersions }) {
  const [broken, setBroken] = useState(false);
  if (app.iconUrl && !broken) return <img src={app.iconUrl} alt="" loading="lazy" onError={() => setBroken(true)} className="size-10 rounded-xl object-contain" />;
  return <span className="flex size-10 items-center justify-center rounded-xl bg-brand-soft text-brand-strong dark:text-brand"><Package className="size-5" /></span>;
}

function AppRow({ app }: { app: AppVersions }) {
  const can = useCan();
  const confirm = useConfirm();
  const client = useQueryClient();
  const behind = app.versions.filter((version) => version.behind).flatMap((version) => version.devices);
  const update = useMutation({
    mutationFn: () => api.post(`/api/admin/apks/${app.latest!.apkId}/deploy`, { target: { deviceIds: behind.map((device) => device.id) } }),
    onSuccess: (result) => {
      if (result.sent > 0) toast.success(`Đã gửi bản mới tới ${result.sent} thiết bị`);
      if (result.skipped?.length) toast.warning(`Bỏ qua ${result.skipped.length} thiết bị: ${result.skipped[0].reason}`);
      client.invalidateQueries({ queryKey: ['fleet-versions'] });
      client.invalidateQueries({ queryKey: ['commands'] });
    },
    onError: notifyError,
  });

  return (
    <li className="flex flex-wrap items-start gap-3 px-5 py-4">
      <AppIcon app={app} />
      <div className="min-w-48 flex-1">
        <p className="flex flex-wrap items-center gap-2 font-semibold">
          {app.label}
          <Badge tone={STATE[app.state].tone}>{STATE[app.state].label}</Badge>
        </p>
        <p className="font-mono text-[11px] text-faint">{app.packageName}</p>
        <p className="mt-1 text-xs text-soft">
          {app.latest ? <>Mới nhất trong thư viện: <b>{versionText(app.latest)}</b></> : 'Chưa có APK trong thư viện để cập nhật từ website'}
        </p>
      </div>
      <div className="min-w-64 flex-[2] space-y-2">
        {app.versions.map((version) => (
          <div key={`${version.versionCode}-${version.versionName}`}>
            <p className="flex flex-wrap items-center gap-2 text-sm">
              <Badge tone={version.behind ? 'warn' : version.ahead ? 'neutral' : 'ok'}>{versionText(version)}</Badge>
              <span className="tabular-nums">{version.devices.length} thiết bị</span>
              {version.behind && <span className="text-xs text-warn">cũ hơn thư viện</span>}
              {version.ahead && <span className="text-xs text-soft">mới hơn thư viện</span>}
            </p>
            <DeviceNames devices={version.devices} open={version.behind} />
          </div>
        ))}
        {app.missing.length > 0 && (
          <div>
            <p className="text-sm text-soft">Chưa cài: {app.missing.length} thiết bị</p>
            <DeviceNames devices={app.missing} />
          </div>
        )}
        {app.notReported.length > 0 && <p className="text-xs text-soft">{app.notReported.length} thiết bị chưa gửi danh sách ứng dụng.</p>}
      </div>
      {can.operate && behind.length > 0 && app.latest && (
        <Button
          size="sm"
          busy={update.isPending}
          onClick={async () => {
            const self = app.packageName === 'com.freekiosk';
            if (await confirm({
              title: `Cập nhật ${app.label} lên ${versionText(app.latest!)}?`,
              message: `${behind.length} thiết bị: ${behind.map((device) => device.name).join(', ')}.${self ? ' FreeKiosk sẽ khởi động lại khi cài xong.' : ' Ứng dụng đang mở trên các máy này sẽ bị đóng để cài.'}`,
              confirm: 'Cập nhật',
            })) update.mutate();
          }}
        >
          <Rocket className="size-3.5" /> Cập nhật {behind.length} thiết bị
        </Button>
      )}
    </li>
  );
}

/** Which version of each app the tablets have, for the apps someone looks after */
export function FleetVersions() {
  const versions = useFleetVersions();
  if (versions.isLoading) return <Loading />;
  if (versions.error) return <ErrorBox error={versions.error} />;
  const rows = versions.data ?? [];
  const problems = rows.filter(needsLooking);
  return (
    <>
      <Notice className="mb-5">
        Chỉ so các ứng dụng có trong thư viện hoặc đang ở màn hình chính của tablet, theo mã phiên bản Android báo lên. Ứng dụng cài từ CH Play tự cập nhật vào những lúc khác nhau nên hay lệch nhau.
        {' '}Cách xử lý: tải bộ APK của bản đúng lên tab Thư viện APK, rồi bấm Cập nhật ở đây. Ứng dụng không tăng mã phiên bản khi ra bản mới thì trang này không phân biệt được.
      </Notice>
      {problems.length > 0 && (
        <Notice tone="warn" className="mb-5">
          <span className="inline-flex items-center gap-1.5"><TriangleAlert className="size-4" /> {problems.length} ứng dụng cần xem: {problems.map((app) => app.label).join(', ')}.</span>
        </Notice>
      )}
      <Card>
        {rows.length === 0 ? (
          <Empty icon={<Package />} title="Chưa có ứng dụng nào để so" hint="Tải APK lên thư viện, hoặc chọn ứng dụng cho màn hình chính của tablet." />
        ) : (
          <ul className="divide-y divide-line">{rows.map((app) => <AppRow key={app.packageName} app={app} />)}</ul>
        )}
      </Card>
    </>
  );
}
