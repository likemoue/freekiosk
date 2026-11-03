import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { Activity, Download, Search } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { DeviceSummary } from '../components/device';
import { dateTime, timeAgo } from '../format';
import { Badge, Button, Card, Empty, ErrorBox, Input, Loading, PageHeader, Select, Table, td, th, trow } from '../ui';

const ACTIONS = [
  ['', 'Mọi hành động'],
  ['device.', 'Thiết bị'],
  ['command.', 'Lệnh'],
  ['config.', 'Cấu hình'],
  ['alert.', 'Cảnh báo'],
  ['user.', 'Tài khoản'],
  ['apk.', 'APK'],
  ['playlist.', 'Danh sách phát'],
];

const SEVERITY: Record<string, { label: string; tone: 'neutral' | 'warn' | 'bad' }> = {
  info: { label: 'Thông tin', tone: 'neutral' },
  warning: { label: 'Cảnh báo', tone: 'warn' },
  error: { label: 'Lỗi', tone: 'bad' },
};

export default function ActivityLog() {
  const [search, setSearch] = useState('');
  const [action, setAction] = useState('');
  const [severity, setSeverity] = useState('');
  const [deviceId, setDeviceId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const devices = useQuery<DeviceSummary[]>({ queryKey: ['devices'], queryFn: () => api.get('/api/admin/devices') });

  const params = new URLSearchParams();
  if (search.trim()) params.set('search', search.trim());
  if (action) params.set('action', action);
  if (severity) params.set('severity', severity);
  if (deviceId) params.set('deviceId', deviceId);
  if (from) params.set('from', new Date(`${from}T00:00:00`).toISOString());
  if (to) params.set('to', new Date(`${to}T23:59:59`).toISOString());
  const query = params.toString();

  const log = useInfiniteQuery<any[]>({
    queryKey: ['activity', query],
    initialPageParam: '',
    queryFn: ({ pageParam }) => api.get(`/api/admin/activity?${query}${pageParam ? `&cursor=${pageParam}` : ''}`),
    getNextPageParam: (last) => (last.length === 100 ? last[last.length - 1].id : undefined),
    refetchInterval: 20_000,
  });
  const rows = log.data?.pages.flat() ?? [];

  return (
    <>
      <PageHeader
        title="Nhật ký hoạt động"
        hint="Mọi thao tác trên thiết bị và tài khoản."
        action={<a href={`/api/admin/activity/export.csv?${query}`}><Button variant="outline"><Download className="size-4" /> Xuất CSV</Button></a>}
      />
      <Card>
        <div className="flex flex-wrap items-center gap-3 p-4">
          <div className="relative min-w-48 flex-1">
            <Search className="absolute top-3 left-3 size-4 text-soft" />
            <Input className="pl-9" placeholder="Tìm trong nội dung…" aria-label="Tìm trong nhật ký" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select className="w-40" aria-label="Lọc theo hành động" value={action} onChange={(e) => setAction(e.target.value)}>
            {ACTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
          <Select className="w-36" aria-label="Lọc theo mức độ" value={severity} onChange={(e) => setSeverity(e.target.value)}>
            <option value="">Mọi mức độ</option>
            <option value="warning">Cảnh báo</option>
            <option value="error">Lỗi</option>
          </Select>
          <Select className="w-44" aria-label="Lọc theo thiết bị" value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
            <option value="">Mọi thiết bị</option>
            {devices.data?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
          <Input type="date" className="w-40" aria-label="Từ ngày" value={from} onChange={(e) => setFrom(e.target.value)} />
          <Input type="date" className="w-40" aria-label="Đến ngày" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        {log.isLoading ? <Loading /> : log.error ? <div className="p-4"><ErrorBox error={log.error} /></div> : rows.length === 0 ? (
          <Empty icon={<Activity />} title="Không có hoạt động nào" />
        ) : (
          <>
            <Table>
              <thead><tr><th className={th}>Thời gian</th><th className={th}>Thiết bị</th><th className={th}>Nội dung</th><th className={th}>Mức độ</th><th className={th}>Người thực hiện</th></tr></thead>
              <tbody>
                {rows.map((entry) => {
                  const level = SEVERITY[entry.severity] ?? SEVERITY.info;
                  return (
                    <tr key={entry.id} className={trow}>
                      <td className={clsx(td, 'whitespace-nowrap text-soft')} title={dateTime(entry.createdAt)}>{timeAgo(entry.createdAt)}</td>
                      <td className={td}>{entry.deviceId ? <Link className="hover:underline" to={`/quan-ly/thiet-bi/${entry.deviceId}`}>{entry.deviceName}</Link> : '—'}</td>
                      <td className={td}>{entry.message}</td>
                      <td className={td}><Badge tone={level.tone}>{level.label}</Badge></td>
                      <td className={clsx(td, 'text-soft')}>{entry.userEmail ?? 'Hệ thống'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
            <div className="flex items-center justify-between border-t border-line px-5 py-3 text-[13px] text-soft">
              <span>Đang hiện {rows.length} dòng</span>
              {log.hasNextPage && <Button size="sm" variant="outline" busy={log.isFetchingNextPage} onClick={() => log.fetchNextPage()}>Tải thêm</Button>}
            </div>
          </>
        )}
      </Card>
    </>
  );
}
