import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { LocateFixed, MapPin, MapPinOff, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { NavigateFunction, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { api } from '../api';
import { useCan } from '../auth';
import { accuracyText, DeviceState, DeviceSummary, locationMissing } from '../components/device';
import { dateTime, timeAgo } from '../format';
import { Button, Card, Empty, ErrorBox, Input, Loading, notifyError, Notice, PageHeader, Select, Switch, useConfirm } from '../ui';

type Placed = DeviceSummary & { location: NonNullable<DeviceSummary['location']> };

const ONLINE = '#16a34a';
const OFFLINE = '#94a3b8';
/** A place older than this may no longer be where the tablet is */
const STALE_MS = 24 * 3_600_000;
/** Vietnam, until there is a tablet to look at */
const START: L.LatLngTuple = [16.2, 106.3];

const byName = new Intl.Collator('vi', { numeric: true });

function isStale(device: Placed): boolean {
  return Date.now() - new Date(device.location.at).getTime() > STALE_MS;
}

/** Built from nodes, never from HTML: a device name comes from the tablet */
function popupOf(device: Placed, navigate: NavigateFunction): HTMLElement {
  const box = document.createElement('div');
  box.className = 'device-map-popup';
  const line = (text: string, className?: string) => {
    const row = document.createElement('div');
    if (className) row.className = className;
    row.textContent = text;
    box.appendChild(row);
  };
  line(device.name, 'device-map-popup-title');
  if (device.group) line(`Nhóm ${device.group.name}`);
  line(device.online ? 'Đang trực tuyến' : `Ngoại tuyến, tín hiệu cuối ${timeAgo(device.lastSeenAt)}`);
  line(`Vị trí lúc ${dateTime(device.location.at)} (${timeAgo(device.location.at)})${isStale(device) ? ', có thể đã cũ' : ''}`);
  const accuracy = accuracyText(device.location);
  if (accuracy) line(`Sai số ${accuracy}`);
  const link = document.createElement('a');
  link.href = `/quan-ly/thiet-bi/${device.id}`;
  link.textContent = 'Xem thiết bị';
  link.className = 'device-map-popup-link';
  link.addEventListener('click', (event) => {
    event.preventDefault();
    navigate(`/quan-ly/thiet-bi/${device.id}`);
  });
  box.appendChild(link);
  return box;
}

function MapView({ placed, focus, onPick }: { placed: Placed[]; focus: string | null; onPick: (id: string) => void }) {
  const navigate = useNavigate();
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const markers = useRef(new Map<string, L.CircleMarker>());
  const fitted = useRef(false);
  const pick = useRef(onPick);
  pick.current = onPick;

  useEffect(() => {
    // The wheel scrolls the page until the map is clicked: a page with a map in it is read by scrolling
    const view = L.map(box.current!, { worldCopyJump: true, scrollWheelZoom: false }).setView(START, 5);
    view.on('click', () => view.scrollWheelZoom.enable());
    view.on('mouseout', () => view.scrollWheelZoom.disable());
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>',
      // The site sends no referrer, and the OpenStreetMap tiles are refused without one
      referrerPolicy: 'strict-origin-when-cross-origin',
    }).addTo(view);
    layer.current = L.layerGroup().addTo(view);
    map.current = view;
    // The page lays itself out after the map has measured its box
    const resize = new ResizeObserver(() => view.invalidateSize());
    resize.observe(box.current!);
    return () => {
      resize.disconnect();
      view.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const view = map.current;
    const group = layer.current;
    if (!view || !group) return;
    group.clearLayers();
    markers.current.clear();
    for (const device of placed) {
      const at: L.LatLngTuple = [device.location.latitude, device.location.longitude];
      const color = device.online ? ONLINE : OFFLINE;
      if (device.location.accuracyM) {
        L.circle(at, { radius: device.location.accuracyM, color, weight: 1, opacity: 0.5, fillOpacity: 0.07, interactive: false }).addTo(group);
      }
      const marker = L.circleMarker(at, {
        radius: 8,
        color: '#ffffff',
        weight: 2,
        fillColor: color,
        fillOpacity: isStale(device) ? 0.45 : 1,
      }).addTo(group);
      const label = document.createElement('span');
      label.textContent = device.name;
      marker.bindTooltip(label, { direction: 'top', offset: [0, -8] });
      marker.bindPopup(() => popupOf(device, navigate));
      marker.on('click', () => pick.current(device.id));
      markers.current.set(device.id, marker);
    }
    if (!fitted.current && placed.length) {
      fitted.current = true;
      const bounds = L.latLngBounds(placed.map((device) => [device.location.latitude, device.location.longitude] as L.LatLngTuple));
      view.fitBounds(bounds, { padding: [48, 48], maxZoom: 16 });
    }
  }, [placed, navigate]);

  useEffect(() => {
    const view = map.current;
    const marker = focus ? markers.current.get(focus) : undefined;
    if (!view || !marker) return;
    view.flyTo(marker.getLatLng(), Math.max(view.getZoom(), 17), { duration: 0.6 });
    marker.openPopup();
  }, [focus, placed]);

  // isolate: Leaflet's own layers would otherwise come above the menu and the dialogs of the page
  return <div ref={box} className="device-map isolate h-[min(70vh,720px)] min-h-[380px] w-full rounded-2xl" />;
}

export default function DeviceMap() {
  const can = useCan();
  const confirm = useConfirm();
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [group, setGroup] = useState('');
  const focus = params.get('thiet-bi');

  const devices = useQuery<DeviceSummary[]>({ queryKey: ['devices'], queryFn: () => api.get('/api/admin/devices'), refetchInterval: 15_000 });
  const groups = useQuery<any[]>({ queryKey: ['groups'], queryFn: () => api.get('/api/admin/groups') });
  const settings = useQuery<{ enabled: boolean }>({ queryKey: ['location-settings'], queryFn: () => api.get('/api/admin/locations/settings') });

  const save = useMutation({
    mutationFn: (enabled: boolean) => api.patch('/api/admin/locations/settings', { enabled }),
    onSuccess: (_data, enabled) => {
      toast.success(enabled ? 'Đã bật: tablet báo vị trí ở tín hiệu kế tiếp' : 'Đã tắt và xóa vị trí đã lưu');
      client.invalidateQueries({ queryKey: ['location-settings'] });
      client.invalidateQueries({ queryKey: ['devices'] });
    },
    onError: notifyError,
  });

  const locate = useMutation({
    mutationFn: (deviceIds: string[]) => api.post('/api/admin/commands', { type: 'locate', target: { deviceIds } }),
    onSuccess: (result: { sent: number; skipped: unknown[] }) => {
      const skipped = result.skipped.length ? `, bỏ qua ${result.skipped.length} máy chưa có bản mới` : '';
      toast.success(`Đã hỏi ${result.sent} máy${skipped}. Vị trí mới hiện sau vài giây tới nửa phút.`);
      setTimeout(() => client.invalidateQueries({ queryKey: ['devices'] }), 8_000);
    },
    onError: notifyError,
  });

  const shown = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (devices.data ?? [])
      .filter((d) => !d.unenrolledAt)
      .filter((d) => (group === 'none' ? !d.group : !group || d.group?.id === group))
      .filter((d) => !query || [d.name, d.model, d.wifiSsid, d.group?.name].some((text) => text?.toLowerCase().includes(query)))
      .sort((a, b) => byName.compare(a.name, b.name));
  }, [devices.data, search, group]);
  const placed = useMemo(() => shown.filter((d): d is Placed => d.location !== null), [shown]);
  const missing = shown.filter((d) => d.location === null);

  const pick = (id: string) => setParams((current) => {
    const next = new URLSearchParams(current);
    next.set('thiet-bi', id);
    return next;
  }, { replace: true });

  if (devices.isLoading || settings.isLoading) return <Loading />;
  if (devices.error) return <ErrorBox error={devices.error} />;
  const enabled = settings.data?.enabled ?? true;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Bản đồ"
        hint="Nơi mỗi tablet tự báo. Tablet chỉ có Wi-Fi được Android định vị theo các mạng Wi-Fi quanh nó, thường sai số vài chục mét. Vị trí được làm mới mỗi 15 phút."
        action={
          can.operate && enabled ? (
            <Button busy={locate.isPending} disabled={!shown.length} onClick={() => locate.mutate(shown.map((d) => d.id))}>
              <LocateFixed className="size-4" /> Cập nhật vị trí ngay
            </Button>
          ) : undefined
        }
      />

      <Card className="flex flex-wrap items-center gap-3 p-4">
        <Switch
          checked={enabled}
          disabled={!can.admin || save.isPending}
          label="Thu thập vị trí thiết bị"
          onChange={async (value) => {
            if (!value && !(await confirm({
              title: 'Tắt thu thập vị trí?',
              message: 'Tablet ngừng gửi vị trí ở tín hiệu kế tiếp, và website xóa mọi vị trí đã lưu.',
              confirm: 'Tắt và xóa',
              danger: true,
            }))) return;
            save.mutate(value);
          }}
        />
        <div className="min-w-0 flex-1 text-sm">
          <div className="font-medium">Thu thập vị trí thiết bị</div>
          <div className="text-soft">
            {enabled
              ? 'Đang bật. Tablet ở chế độ Device Owner tự cấp quyền và tự bật dịch vụ vị trí của Android. Website chỉ giữ vị trí cuối cùng của mỗi máy.'
              : 'Đang tắt: tablet không lấy vị trí và website không lưu vị trí nào.'}
            {!can.admin && ' Chỉ quản trị viên đổi được.'}
          </div>
        </div>
      </Card>

      {!enabled ? (
        <Empty icon={<MapPinOff />} title="Thu thập vị trí đang tắt" hint="Bật công tắc ở trên để xem tablet trên bản đồ." />
      ) : (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
          <Card className="overflow-hidden p-2">
            <MapView placed={placed} focus={focus} onPick={pick} />
          </Card>

          <Card className="flex max-h-[min(70vh,720px)] min-h-[380px] flex-col p-0">
            <div className="space-y-2 border-b border-line p-3">
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
                <Input className="pl-9" placeholder="Tìm thiết bị" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <Select value={group} onChange={(e) => setGroup(e.target.value)}>
                <option value="">Mọi nhóm</option>
                {(groups.data ?? []).map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
                <option value="none">Không thuộc nhóm</option>
              </Select>
              <div className="text-xs text-soft">
                {placed.length} trên bản đồ{missing.length ? `, ${missing.length} chưa có vị trí` : ''}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {!shown.length && <div className="p-4 text-sm text-soft">Không có thiết bị nào.</div>}
              {placed.map((device) => (
                <button
                  key={device.id}
                  onClick={() => pick(device.id)}
                  className={clsx('flex w-full items-start gap-3 border-b border-line px-3 py-2.5 text-left hover:bg-raised', focus === device.id && 'bg-brand-soft')}
                >
                  <span className="mt-1.5 size-2.5 shrink-0 rounded-full" style={{ background: device.online ? ONLINE : OFFLINE, opacity: isStale(device) ? 0.5 : 1 }} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{device.name}</span>
                    <span className="block text-xs text-soft">
                      {[accuracyText(device.location), timeAgo(device.location.at), isStale(device) ? 'có thể đã cũ' : null].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                </button>
              ))}
              {missing.map((device) => (
                <div key={device.id} className="flex items-start gap-3 border-b border-line px-3 py-2.5">
                  <MapPin className="mt-0.5 size-4 shrink-0 text-faint" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{device.name}</span>
                      <DeviceState device={device} />
                    </span>
                    <span className="block text-xs text-soft">{locationMissing(device)}</span>
                  </span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {enabled && devices.data && devices.data.some((d) => d.locationState === 'no_fix') && (
        <Notice tone="info">
          Máy báo "chưa định vị được" thường là máy không có GPS và Android chưa tìm ra vị trí từ mạng Wi-Fi quanh nó. Kiểm tra trên máy: Cài đặt, Vị trí, Dịch vụ vị trí, bật Độ chính xác vị trí của Google và Quét Wi-Fi.
        </Notice>
      )}
    </div>
  );
}
