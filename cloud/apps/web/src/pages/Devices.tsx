import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowDown, ArrowUp, ChevronsUpDown, FolderInput, Plus, Search, ShieldCheck, Smartphone, Tv, Zap } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { api } from '../api';
import { useCan } from '../auth';
import { CommandPicker } from '../components/commands';
import { BatteryMeter, DeviceState, deviceSubtitle, DeviceSummary } from '../components/device';
import { megabytes, timeAgo } from '../format';
import { Button, Card, Empty, ErrorBox, Input, Loading, Modal, notifyError, PageHeader, Select, Table, td, th, trow } from '../ui';

type SortKey = 'name' | 'group' | 'url' | 'battery' | 'storage' | 'seen';

const VALUE: Record<SortKey, (d: DeviceSummary) => string | number> = {
  name: (d) => d.name.toLowerCase(),
  group: (d) => d.group?.name.toLowerCase() ?? '',
  url: (d) => d.currentUrl ?? '',
  battery: (d) => d.batteryLevel ?? -1,
  storage: (d) => d.freeStorageMb ?? -1,
  seen: (d) => (d.lastSeenAt ? new Date(d.lastSeenAt).getTime() : 0),
};

export default function Devices() {
  const can = useCan();
  const navigate = useNavigate();
  const client = useQueryClient();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [group, setGroup] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'name', desc: false });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<'command' | 'group' | null>(null);
  const [moveTo, setMoveTo] = useState('');

  const devices = useQuery<DeviceSummary[]>({ queryKey: ['devices'], queryFn: () => api.get('/api/admin/devices'), refetchInterval: 10_000 });
  const groups = useQuery<any[]>({ queryKey: ['groups'], queryFn: () => api.get('/api/admin/groups') });

  const rows = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = (devices.data ?? []).filter((d) => {
      if (query && ![d.name, d.model, d.manufacturer, d.ipAddress, d.currentUrl, d.wifiSsid].some((t) => t?.toLowerCase().includes(query))) return false;
      if (status === 'online' && !d.online) return false;
      if (status === 'offline' && (d.online || d.unenrolledAt)) return false;
      if (status === 'unenrolled' && !d.unenrolledAt) return false;
      if (status !== 'unenrolled' && d.unenrolledAt && status) return false;
      if (group === 'none' ? !!d.group : group && d.group?.id !== group) return false;
      return true;
    });
    const value = VALUE[sort.key];
    return filtered.sort((a, b) => {
      const [x, y] = [value(a), value(b)];
      const order = typeof x === 'number' ? x - (y as number) : x.localeCompare(y as string, 'vi', { numeric: true });
      return sort.desc ? -order : order;
    });
  }, [devices.data, search, status, group, sort]);

  const active = rows.filter((d) => !d.unenrolledAt);
  const allChecked = active.length > 0 && active.every((d) => selected.has(d.id));
  const toggleSort = (key: SortKey) => setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: key === 'seen' }));
  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const move = useMutation({
    mutationFn: () => Promise.all([...selected].map((id) => api.patch(`/api/admin/devices/${id}`, { groupId: moveTo || null }))),
    onSuccess: () => {
      toast.success('Đã chuyển nhóm');
      setDialog(null);
      client.invalidateQueries({ queryKey: ['devices'] });
      client.invalidateQueries({ queryKey: ['groups'] });
    },
    onError: notifyError,
  });

  const Header = ({ id, children }: { id: SortKey; children: string }) => (
    <th className={th} aria-sort={sort.key === id ? (sort.desc ? 'descending' : 'ascending') : 'none'}>
      <button type="button" className="inline-flex items-center gap-1 hover:text-ink" onClick={() => toggleSort(id)}>
        {children}
        {sort.key === id ? sort.desc ? <ArrowDown className="size-3.5" /> : <ArrowUp className="size-3.5" /> : <ChevronsUpDown className="size-3.5 opacity-50" />}
      </button>
    </th>
  );

  return (
    <>
      <PageHeader
        title="Thiết bị"
        hint="Quản lý các thiết bị đã đăng ký"
        action={can.operate && <Button onClick={() => navigate('/quan-ly/thiet-bi/them')}><Plus className="size-4" /> Thêm thiết bị</Button>}
      />

      <Card>
        <div className="flex flex-wrap items-center gap-3 p-4">
          <div className="relative min-w-52 flex-1">
            <Search className="absolute top-3 left-3 size-4 text-soft" />
            <Input className="pl-9" placeholder="Tìm theo tên, kiểu máy, IP, URL…" aria-label="Tìm thiết bị" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select className="w-44" aria-label="Lọc theo trạng thái" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Mọi trạng thái</option>
            <option value="online">Trực tuyến</option>
            <option value="offline">Ngoại tuyến</option>
            <option value="unenrolled">Đã hủy đăng ký</option>
          </Select>
          <Select className="w-44" aria-label="Lọc theo nhóm" value={group} onChange={(e) => setGroup(e.target.value)}>
            <option value="">Mọi nhóm</option>
            <option value="none">Chưa có nhóm</option>
            {groups.data?.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </Select>
        </div>

        {selected.size > 0 && can.operate && (
          <div className="flex flex-wrap items-center gap-2 border-t border-line bg-brand-soft/60 px-4 py-2.5">
            <span className="mr-2 text-sm font-semibold">Đã chọn {selected.size} thiết bị</span>
            <Button size="sm" onClick={() => setDialog('command')}><Zap className="size-4" /> Gửi lệnh</Button>
            <Button size="sm" variant="outline" onClick={() => { setMoveTo(''); setDialog('group'); }}><FolderInput className="size-4" /> Chuyển nhóm</Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Bỏ chọn</Button>
          </div>
        )}

        {devices.isLoading ? (
          <Loading />
        ) : devices.error ? (
          <div className="p-4"><ErrorBox error={devices.error} /></div>
        ) : rows.length === 0 ? (
          <Empty
            icon={<Smartphone />}
            title={devices.data?.length ? 'Không có thiết bị nào khớp bộ lọc' : 'Chưa có thiết bị nào'}
            hint={devices.data?.length ? undefined : 'Thêm thiết bị đầu tiên để bắt đầu.'}
            action={!devices.data?.length && can.operate ? <Button onClick={() => navigate('/quan-ly/thiet-bi/them')}><Plus className="size-4" /> Thêm thiết bị</Button> : undefined}
          />
        ) : (
          <Table>
            <thead>
              <tr>
                {can.operate && (
                  <th className={clsx(th, 'w-10')}>
                    <input type="checkbox" aria-label="Chọn tất cả" className="size-4 accent-brand-strong" checked={allChecked} onChange={() => setSelected(allChecked ? new Set() : new Set(active.map((d) => d.id)))} />
                  </th>
                )}
                <Header id="name">Thiết bị</Header>
                <Header id="group">Nhóm</Header>
                <Header id="url">Đang hiển thị</Header>
                <Header id="battery">Pin</Header>
                <Header id="storage">Bộ nhớ trống</Header>
                <Header id="seen">Tín hiệu cuối</Header>
              </tr>
            </thead>
            <tbody>
              {rows.map((device) => (
                <tr key={device.id} className={clsx(trow, device.unenrolledAt && 'opacity-60')}>
                  {can.operate && (
                    <td className={td}>
                      <input type="checkbox" aria-label={`Chọn ${device.name}`} className="size-4 accent-brand-strong" disabled={!!device.unenrolledAt} checked={selected.has(device.id)} onChange={() => toggle(device.id)} />
                    </td>
                  )}
                  <td className={td}>
                    <Link to={`/quan-ly/thiet-bi/${device.id}`} className="flex items-center gap-2.5">
                      {device.formFactor === 'tv' ? <Tv className="size-4 shrink-0 text-soft" /> : <Smartphone className="size-4 shrink-0 text-soft" />}
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5 font-semibold hover:underline">
                          <span className="truncate">{device.name}</span>
                          {device.deviceOwner && <ShieldCheck className="size-3.5 shrink-0 text-brand" aria-label="Device Owner" />}
                        </span>
                        <span className="block truncate text-xs font-normal text-soft">{deviceSubtitle(device)}</span>
                      </span>
                    </Link>
                  </td>
                  <td className={clsx(td, 'text-soft')}>{device.group?.name ?? '—'}</td>
                  <td className={clsx(td, 'max-w-56 truncate text-soft')} title={device.currentUrl ?? undefined}>{device.currentUrl?.replace(/^https?:\/\//, '') || '—'}</td>
                  <td className={td}>{device.lastSeenAt ? <BatteryMeter level={device.batteryLevel} charging={device.batteryCharging} /> : '—'}</td>
                  <td className={clsx(td, 'tabular-nums text-soft')}>{megabytes(device.freeStorageMb)}</td>
                  <td className={td}>
                    <div className="flex flex-col items-start gap-0.5">
                      <DeviceState device={device} />
                      <span className="text-xs text-soft">{timeAgo(device.lastSeenAt)}</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Modal open={dialog === 'command'} onClose={() => setDialog(null)} title={`Gửi lệnh tới ${selected.size} thiết bị`} wide>
        <CommandPicker target={{ deviceIds: [...selected] }} onSent={() => setDialog(null)} />
      </Modal>

      <Modal
        open={dialog === 'group'}
        onClose={() => setDialog(null)}
        title={`Chuyển ${selected.size} thiết bị sang nhóm`}
        footer={
          <>
            <Button variant="outline" onClick={() => setDialog(null)}>Hủy</Button>
            <Button busy={move.isPending} onClick={() => move.mutate()}>Chuyển</Button>
          </>
        }
      >
        <Select aria-label="Nhóm đích" value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
          <option value="">Không thuộc nhóm nào</option>
          {groups.data?.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </Select>
      </Modal>
    </>
  );
}
