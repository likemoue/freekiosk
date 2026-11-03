import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { AlertTriangle, ArrowRight, Plus, Smartphone } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useCan } from '../auth';
import { BatteryMeter, deviceSubtitle, DeviceSummary, StatusDot } from '../components/device';
import { timeAgo } from '../format';
import { Badge, Button, Card, CardTitle, Empty, ErrorBox, Loading, PageHeader, Progress } from '../ui';

function Stat({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <Card className="px-5 py-4">
      <div className="text-[13px] text-soft">{label}</div>
      <div className={clsx('mt-1 text-3xl font-bold tabular-nums', color)}>{value}</div>
    </Card>
  );
}

export default function Overview() {
  const can = useCan();
  const navigate = useNavigate();
  const overview = useQuery({ queryKey: ['overview'], queryFn: () => api.get('/api/admin/overview'), refetchInterval: 15_000 });
  const devices = useQuery<DeviceSummary[]>({ queryKey: ['devices'], queryFn: () => api.get('/api/admin/devices'), refetchInterval: 10_000 });

  if (overview.isLoading) return <Loading />;
  if (overview.error) return <ErrorBox error={overview.error} />;
  const { totals, appVersions, groups, alerts, recent } = overview.data;
  const recentDevices = [...(devices.data ?? [])]
    .filter((d) => !d.unenrolledAt)
    .sort((a, b) => new Date(b.lastSeenAt ?? 0).getTime() - new Date(a.lastSeenAt ?? 0).getTime())
    .slice(0, 8);

  return (
    <>
      <PageHeader title="Tổng quan" hint="Toàn cảnh các thiết bị của bạn" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Tổng số thiết bị" value={totals.devices} color="text-brand-strong dark:text-brand" />
        <Stat label="Trực tuyến" value={totals.online} color="text-ok" />
        <Stat label="Ngoại tuyến" value={totals.offline} color="text-bad" />
        <Stat label="Pin trung bình" value={totals.averageBattery === null ? '—' : `${totals.averageBattery}%`} />
      </div>

      {totals.devices === 0 ? (
        <Card className="mt-6">
          <Empty
            icon={<Smartphone />}
            title="Chưa có thiết bị nào"
            hint="Thêm thiết bị đầu tiên để bắt đầu."
            action={can.operate && <Button onClick={() => navigate('/quan-ly/thiet-bi/them')}><Plus className="size-4" /> Thêm thiết bị</Button>}
          />
        </Card>
      ) : (
        <div className="mt-6 grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardTitle title="Thiết bị gần đây" action={<Link to="/quan-ly/thiet-bi" className="text-[13px] font-semibold text-brand-strong hover:underline dark:text-brand">Xem tất cả</Link>} />
            <ul className="px-3 pb-3">
              {recentDevices.map((device) => (
                <li key={device.id}>
                  <Link to={`/quan-ly/thiet-bi/${device.id}`} className="flex items-center gap-3 rounded-xl px-2 py-2.5 hover:bg-raised">
                    <StatusDot online={device.online} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold">{device.name}</div>
                      <div className="truncate text-xs text-soft">{deviceSubtitle(device)}</div>
                    </div>
                    <div className="hidden sm:block"><BatteryMeter level={device.batteryLevel} charging={device.batteryCharging} /></div>
                    <div className="w-24 text-right text-xs text-soft">{timeAgo(device.lastSeenAt)}</div>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>

          <div className="space-y-6">
            <Card>
              <CardTitle title="Cảnh báo đang mở" action={<Link to="/quan-ly/canh-bao" className="text-[13px] font-semibold text-brand-strong hover:underline dark:text-brand">Xem tất cả</Link>} />
              {alerts.length === 0 ? (
                <p className="px-5 pb-5 text-sm text-soft">Không có cảnh báo nào.</p>
              ) : (
                <ul className="px-3 pb-3">
                  {alerts.map((alert: any) => (
                    <li key={alert.id}>
                      <Link to={`/quan-ly/thiet-bi/${alert.deviceId}`} className="flex items-start gap-2.5 rounded-xl px-2 py-2 hover:bg-raised">
                        <AlertTriangle className={clsx('mt-0.5 size-4 shrink-0', alert.severity === 'critical' ? 'text-bad' : 'text-warn')} />
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold">{alert.device.name}</div>
                          <div className="text-xs text-soft">{alert.message}</div>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            {groups.length > 0 && (
              <Card>
                <CardTitle title="Theo nhóm" />
                <ul className="space-y-3 px-5 pb-5">
                  {groups.filter((g: any) => g.total > 0).slice(0, 6).map((group: any) => (
                    <li key={group.id}>
                      <div className="mb-1 flex justify-between text-[13px]">
                        <span className="truncate font-medium">{group.name}</span>
                        <span className="tabular-nums text-soft">{group.online}/{group.total}</span>
                      </div>
                      <Progress value={group.total ? (group.online / group.total) * 100 : 0} tone="ok" />
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            <Card>
              <CardTitle title="Phiên bản ứng dụng" />
              <ul className="space-y-2 px-5 pb-5 text-[13px]">
                {appVersions.map((version: any) => (
                  <li key={version.label} className="flex justify-between">
                    <span>{version.label}</span>
                    <Badge>{version.total}</Badge>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </div>
      )}

      <Card className="mt-6">
        <CardTitle title="Hoạt động gần đây" action={<Link to="/quan-ly/nhat-ky" className="inline-flex items-center gap-1 text-[13px] font-semibold text-brand-strong hover:underline dark:text-brand">Nhật ký <ArrowRight className="size-3.5" /></Link>} />
        {recent.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-soft">Chưa có hoạt động nào.</p>
        ) : (
          <ul className="divide-y divide-line px-5 pb-3">
            {recent.map((entry: any) => (
              <li key={entry.id} className="flex items-baseline justify-between gap-4 py-2 text-[13px]">
                <span className={entry.severity === 'warning' ? 'text-warn' : undefined}>{entry.message}</span>
                <span className="shrink-0 text-xs text-soft">{timeAgo(entry.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
