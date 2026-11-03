import { closestCenter, DndContext, DragEndEvent, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowLeft, CalendarClock, Film, Globe, GripVertical, ImageIcon, Pencil, Plus, Trash2, TriangleAlert, Tv, CirclePlay } from 'lucide-react';
import { ReactNode, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { api } from '../api';
import { useCan } from '../auth';
import { DeviceSummary } from '../components/device';
import { daysText, WEEKDAYS } from '../format';
import { Badge, Button, Card, CardTitle, Empty, ErrorBox, Field, Input, Loading, Modal, notifyError, Notice, PageHeader, Pills, Select, useConfirm } from '../ui';
import { SCREEN_STATE } from './Signage';

interface Item {
  key: string;
  kind: string;
  url?: string;
  mediaAssetId?: string;
  fileName?: string;
  title?: string;
  durationSeconds?: number | null;
  warning?: string | null;
}

const KIND: Record<string, { label: string; icon: ReactNode }> = {
  video: { label: 'Video', icon: <Film /> },
  image: { label: 'Hình ảnh', icon: <ImageIcon /> },
  web: { label: 'Trang web', icon: <Globe /> },
  youtube: { label: 'YouTube', icon: <CirclePlay /> },
};

function Row({ item, onRemove, onDuration, disabled }: { item: Item; onRemove: () => void; onDuration: (seconds: number | null) => void; disabled: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.key, disabled });
  const hasDuration = item.kind === 'image' || item.kind === 'web' || item.kind === 'youtube';
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={clsx('flex items-center gap-3 rounded-xl border border-line bg-card p-2.5', isDragging && 'relative z-10 shadow-xl')}>
      {!disabled && (
        <button type="button" aria-label="Kéo để đổi thứ tự" className="cursor-grab touch-none rounded p-1 text-faint hover:bg-raised active:cursor-grabbing" {...attributes} {...listeners}>
          <GripVertical className="size-4" />
        </button>
      )}
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand-strong dark:text-brand [&_svg]:size-[18px]">{KIND[item.kind].icon}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{item.title || item.fileName || item.url}</p>
        <p className="truncate text-xs text-soft">{KIND[item.kind].label}{item.title || item.fileName ? ` · ${item.fileName ?? item.url}` : ''}</p>
        {item.warning && <p className="mt-0.5 flex items-center gap-1 text-xs text-warn"><TriangleAlert className="size-3" /> {item.warning}</p>}
      </div>
      {hasDuration && (
        <label className="flex shrink-0 items-center gap-1 text-xs text-soft">
          <Input
            type="number"
            min={1}
            className="h-8 w-20 text-right"
            disabled={disabled}
            aria-label="Số giây hiển thị"
            placeholder={item.kind === 'web' ? '30' : item.kind === 'youtube' ? 'Hết video' : 'Mặc định'}
            value={item.durationSeconds ?? ''}
            onChange={(e) => onDuration(e.target.value ? Number(e.target.value) : null)}
          />
          giây
        </label>
      )}
      {!disabled && <button type="button" aria-label="Xóa mục này" className="shrink-0 rounded-lg p-1.5 text-soft hover:bg-raised hover:text-bad" onClick={onRemove}><Trash2 className="size-4" /></button>}
    </li>
  );
}

function AddItem({ onClose, onAdd }: { onClose: () => void; onAdd: (items: Item[]) => void }) {
  const [source, setSource] = useState<'library' | 'url' | 'web' | 'youtube'>('library');
  const [kind, setKind] = useState('video');
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [warning, setWarning] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const media = useQuery<any>({ queryKey: ['media'], queryFn: () => api.get('/api/admin/media') });
  const assets: any[] = media.data?.assets ?? [];
  const key = () => crypto.randomUUID();

  const check = async () => {
    setChecking(true);
    try {
      const result = await api.post('/api/admin/signage/check-url', { url });
      setWarning(result.warning);
    } catch {
      setWarning(null);
    } finally {
      setChecking(false);
    }
  };

  const add = async () => {
    if (source === 'library') {
      onAdd(assets.filter((a) => picked.includes(a.id)).map((a) => ({ key: key(), kind: a.kind, mediaAssetId: a.id, fileName: a.fileName, title: a.title })));
    } else if (source === 'web') {
      onAdd([{ key: key(), kind: 'web', url: url.trim(), title: title.trim() || undefined, durationSeconds: 30, warning }]);
    } else if (source === 'youtube') {
      onAdd([{ key: key(), kind: 'youtube', url: url.trim(), title: title.trim() || undefined }]);
    } else {
      onAdd([{ key: key(), kind, url: url.trim(), title: title.trim() || undefined }]);
    }
    onClose();
  };

  const valid = source === 'library' ? picked.length > 0 : source === 'youtube' ? url.trim().length > 0 : /^https?:\/\/\S+$/i.test(url.trim());

  return (
    <Modal open onClose={onClose} title="Thêm vào danh sách" wide footer={<><Button variant="outline" onClick={onClose}>Hủy</Button><Button disabled={!valid} onClick={add}>Thêm</Button></>}>
      <Pills
        value={source}
        onChange={(next) => { setSource(next); setUrl(''); setWarning(null); }}
        options={[
          { id: 'library', label: 'Từ thư viện', icon: <ImageIcon className="size-4" /> },
          { id: 'url', label: 'Video hoặc ảnh qua URL', icon: <Film className="size-4" /> },
          { id: 'web', label: 'Trang web', icon: <Globe className="size-4" /> },
          { id: 'youtube', label: 'YouTube', icon: <CirclePlay className="size-4" /> },
        ]}
      />
      <div className="mt-4 space-y-4">
        {source === 'library' && (
          assets.length === 0 ? <Notice>Thư viện đang trống. Dùng nút "Tải tệp lên" ở trang Bảng hiệu số.</Notice> : (
            <div className="grid max-h-80 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-4">
              {assets.map((asset) => {
                const on = picked.includes(asset.id);
                return (
                  <button key={asset.id} type="button" aria-pressed={on} onClick={() => setPicked(on ? picked.filter((p) => p !== asset.id) : [...picked, asset.id])} className={clsx('overflow-hidden rounded-xl border-2 text-left', on ? 'border-brand-strong' : 'border-line')}>
                    <span className="flex aspect-video items-center justify-center bg-raised">
                      {asset.kind === 'image' ? <img src={asset.url} alt="" className="size-full object-cover" /> : <Film className="size-7 text-faint" />}
                    </span>
                    <span className="block truncate px-2 py-1 text-xs font-medium">{asset.title}</span>
                  </button>
                );
              })}
            </div>
          )
        )}
        {source === 'url' && (
          <Field label="Loại">
            <Select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="video">Video</option>
              <option value="image">Hình ảnh</option>
            </Select>
          </Field>
        )}
        {source !== 'library' && (
          <>
            <Field
              label={source === 'youtube' ? 'Liên kết YouTube' : 'URL'}
              hint={source === 'web' ? 'Trang web cần mạng và không lưu ngoại tuyến. Khi mất mạng, màn hình bỏ qua mục này.' : source === 'youtube' ? 'Video phát đến hết. Hãy đọc điều khoản của YouTube trước khi dùng trên màn hình công cộng.' : undefined}
            >
              <Input autoFocus placeholder="https://..." value={url} onChange={(e) => { setUrl(e.target.value); setWarning(null); }} onBlur={() => source === 'web' && /^https?:\/\/\S+$/i.test(url.trim()) && check()} />
            </Field>
            {checking && <p className="text-xs text-soft">Đang kiểm tra trang…</p>}
            {warning && <Notice tone="warn">{warning}</Notice>}
            <Field label="Tiêu đề (không bắt buộc)"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
          </>
        )}
      </div>
    </Modal>
  );
}

function AssignDialog({ playlist, onClose }: { playlist: any; onClose: () => void }) {
  const client = useQueryClient();
  const devices = useQuery<DeviceSummary[]>({ queryKey: ['devices'], queryFn: () => api.get('/api/admin/devices') });
  const groups = useQuery<any[]>({ queryKey: ['groups'], queryFn: () => api.get('/api/admin/groups') });
  const [deviceIds, setDeviceIds] = useState<string[]>(playlist.devices.map((d: any) => d.id));
  const [groupIds, setGroupIds] = useState<string[]>(playlist.groups.map((g: any) => g.id));
  const save = useMutation({
    mutationFn: () => api.put(`/api/admin/signage/playlists/${playlist.id}/assign`, { deviceIds, groupIds }),
    onSuccess: () => {
      toast.success('Đã cập nhật màn hình');
      client.invalidateQueries({ queryKey: ['playlist', playlist.id] });
      client.invalidateQueries({ queryKey: ['signage-screens'] });
      onClose();
    },
    onError: notifyError,
  });
  const toggle = (list: string[], set: (v: string[]) => void, id: string) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  return (
    <Modal open onClose={onClose} title="Chọn màn hình phát danh sách này" hint="Danh sách gán riêng cho màn hình được ưu tiên hơn danh sách của nhóm." wide footer={<><Button variant="outline" onClick={onClose}>Hủy</Button><Button busy={save.isPending} onClick={() => save.mutate()}>Lưu</Button></>}>
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <p className="mb-2 text-[13px] font-semibold">Thiết bị</p>
          <div className="max-h-72 space-y-1.5 overflow-y-auto rounded-xl border border-line p-3">
            {devices.data?.filter((d) => !d.unenrolledAt).map((device) => (
              <label key={device.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="size-4 accent-brand-strong" checked={deviceIds.includes(device.id)} onChange={() => toggle(deviceIds, setDeviceIds, device.id)} />
                <span className="truncate">{device.name}</span>
              </label>
            ))}
            {!devices.data?.length && <p className="text-sm text-soft">Chưa có thiết bị.</p>}
          </div>
        </div>
        <div>
          <p className="mb-2 text-[13px] font-semibold">Nhóm</p>
          <div className="max-h-72 space-y-1.5 overflow-y-auto rounded-xl border border-line p-3">
            {groups.data?.map((group) => (
              <label key={group.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="size-4 accent-brand-strong" checked={groupIds.includes(group.id)} onChange={() => toggle(groupIds, setGroupIds, group.id)} />
                <span className="truncate">{group.name} ({group.deviceCount})</span>
              </label>
            ))}
            {!groups.data?.length && <p className="text-sm text-soft">Chưa có nhóm.</p>}
          </div>
        </div>
      </div>
    </Modal>
  );
}

const BLANK_RULE = { target: 'device', deviceId: '', groupId: '', days: [1, 2, 3, 4, 5], start: '', end: '', from: '', to: '', priority: 0 };

function RuleDialog({ playlistId, onClose }: { playlistId: string; onClose: () => void }) {
  const client = useQueryClient();
  const [rule, setRule] = useState(BLANK_RULE);
  const devices = useQuery<DeviceSummary[]>({ queryKey: ['devices'], queryFn: () => api.get('/api/admin/devices') });
  const groups = useQuery<any[]>({ queryKey: ['groups'], queryFn: () => api.get('/api/admin/groups') });
  const save = useMutation({
    mutationFn: () =>
      api.post('/api/admin/signage/rules', {
        playlistId,
        deviceId: rule.target === 'device' ? rule.deviceId : undefined,
        groupId: rule.target === 'group' ? rule.groupId : undefined,
        days: rule.days,
        start: rule.start || undefined,
        end: rule.end || undefined,
        from: rule.from || undefined,
        to: rule.to || undefined,
        priority: rule.priority,
      }),
    onSuccess: () => { toast.success('Đã thêm lịch'); client.invalidateQueries({ queryKey: ['playlist', playlistId] }); onClose(); },
    onError: notifyError,
  });
  const ready = rule.days.length > 0 && (rule.target === 'device' ? rule.deviceId : rule.groupId);
  return (
    <Modal open onClose={onClose} title="Thêm lịch phát" hint="Màn hình tự chọn theo đồng hồ của nó, nên vẫn đổi đúng giờ khi mất mạng." footer={<><Button variant="outline" onClick={onClose}>Hủy</Button><Button disabled={!ready} busy={save.isPending} onClick={() => save.mutate()}>Thêm lịch</Button></>}>
      <div className="space-y-4">
        <Field label="Áp dụng cho">
          <Select value={rule.target} onChange={(e) => setRule({ ...rule, target: e.target.value })}>
            <option value="device">Một màn hình</option>
            <option value="group">Một nhóm</option>
          </Select>
        </Field>
        {rule.target === 'device' ? (
          <Select aria-label="Chọn màn hình" value={rule.deviceId} onChange={(e) => setRule({ ...rule, deviceId: e.target.value })}>
            <option value="">Chọn màn hình…</option>
            {devices.data?.filter((d) => !d.unenrolledAt).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
        ) : (
          <Select aria-label="Chọn nhóm" value={rule.groupId} onChange={(e) => setRule({ ...rule, groupId: e.target.value })}>
            <option value="">Chọn nhóm…</option>
            {groups.data?.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </Select>
        )}
        <div>
          <span className="mb-1.5 block text-[13px] font-semibold">Các ngày</span>
          <div className="flex flex-wrap gap-1.5">
            {WEEKDAYS.map((day) => {
              const on = rule.days.includes(day.value);
              return (
                <button key={day.value} type="button" aria-pressed={on} aria-label={day.label} className={clsx('size-10 rounded-xl border text-[13px] font-semibold', on ? 'border-brand-strong bg-brand-strong text-white' : 'border-line hover:bg-raised')} onClick={() => setRule({ ...rule, days: on ? rule.days.filter((d) => d !== day.value) : [...rule.days, day.value] })}>{day.short}</button>
              );
            })}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Từ giờ"><Input type="time" value={rule.start} onChange={(e) => setRule({ ...rule, start: e.target.value })} /></Field>
          <Field label="Đến giờ"><Input type="time" value={rule.end} onChange={(e) => setRule({ ...rule, end: e.target.value })} /></Field>
          <Field label="Từ ngày"><Input type="date" value={rule.from} onChange={(e) => setRule({ ...rule, from: e.target.value })} /></Field>
          <Field label="Đến ngày"><Input type="date" value={rule.to} onChange={(e) => setRule({ ...rule, to: e.target.value })} /></Field>
        </div>
        <p className="text-xs text-soft">Để trống giờ là cả ngày, để trống ngày là không giới hạn. Giờ kết thúc sớm hơn giờ bắt đầu nghĩa là qua nửa đêm (22:00 đến 02:00).</p>
        <Field label="Độ ưu tiên" hint="Nhiều lịch trùng nhau thì số lớn hơn thắng; bằng nhau thì lịch gán cho màn hình thắng lịch của nhóm.">
          <Input type="number" min={0} max={1000} className="w-28" value={rule.priority} onChange={(e) => setRule({ ...rule, priority: Number(e.target.value) || 0 })} />
        </Field>
      </div>
    </Modal>
  );
}

export default function PlaylistDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const can = useCan();
  const confirm = useConfirm();
  const client = useQueryClient();
  const [items, setItems] = useState<Item[]>([]);
  const [dirty, setDirty] = useState(false);
  const [dialog, setDialog] = useState<'add' | 'assign' | 'rule' | 'rename' | null>(null);
  const [name, setName] = useState('');

  const playlist = useQuery<any>({ queryKey: ['playlist', id], queryFn: () => api.get(`/api/admin/signage/playlists/${id}`), refetchInterval: dirty ? false : 10_000 });

  useEffect(() => {
    if (!playlist.data || dirty) return;
    setItems(
      playlist.data.items.map((item: any) => ({
        key: item.id,
        kind: item.kind,
        url: item.mediaAsset ? undefined : item.url,
        mediaAssetId: item.mediaAsset?.id,
        fileName: item.mediaAsset?.fileName,
        title: item.title ?? item.mediaAsset?.title,
        durationSeconds: item.durationSeconds,
        warning: item.warning,
      })),
    );
  }, [playlist.data, dirty]);

  const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    setItems((list) => arrayMove(list, list.findIndex((i) => i.key === active.id), list.findIndex((i) => i.key === over.id)));
    setDirty(true);
  };

  const save = useMutation({
    mutationFn: () =>
      api.put(`/api/admin/signage/playlists/${id}/items`, {
        items: items.map((i) => ({ kind: i.kind, url: i.url, mediaAssetId: i.mediaAssetId, title: i.title, durationSeconds: i.durationSeconds ?? undefined })),
      }),
    onSuccess: async () => {
      toast.success('Đã lưu. Màn hình cập nhật trong vòng một phút');
      setDirty(false);
      await client.invalidateQueries({ queryKey: ['playlist', id] });
      client.invalidateQueries({ queryKey: ['playlists'] });
    },
    onError: notifyError,
  });
  const rename = useMutation({
    mutationFn: () => api.patch(`/api/admin/signage/playlists/${id}`, { name }),
    onSuccess: () => { setDialog(null); client.invalidateQueries({ queryKey: ['playlist', id] }); },
    onError: notifyError,
  });
  const remove = useMutation({
    mutationFn: () => api.del(`/api/admin/signage/playlists/${id}`),
    onSuccess: () => { toast.success('Đã xóa danh sách'); client.invalidateQueries({ queryKey: ['playlists'] }); navigate('/quan-ly/bang-hieu'); },
    onError: notifyError,
  });
  const removeRule = useMutation({
    mutationFn: (ruleId: string) => api.del(`/api/admin/signage/rules/${ruleId}`),
    onSuccess: () => client.invalidateQueries({ queryKey: ['playlist', id] }),
    onError: notifyError,
  });

  if (playlist.isLoading) return <Loading />;
  if (playlist.error) return <ErrorBox error={playlist.error} />;
  const p = playlist.data;

  return (
    <>
      <PageHeader
        back={<Link to="/quan-ly/bang-hieu" aria-label="Quay lại" className="mt-1 rounded-lg p-1 text-soft hover:bg-raised"><ArrowLeft className="size-5" /></Link>}
        title={<span className="flex items-center gap-2">{p.name}{can.operate && <button aria-label="Đổi tên" className="rounded-lg p-1 text-soft hover:bg-raised" onClick={() => { setName(p.name); setDialog('rename'); }}><Pencil className="size-4" /></button>}</span>}
        hint={`${items.length} mục`}
        action={can.operate && (
          <Button variant="danger-outline" onClick={async () => {
            if (await confirm({ title: `Xóa danh sách "${p.name}"?`, message: 'Các màn hình đang phát danh sách này sẽ quay lại chế độ trước đó.', confirm: 'Xóa', danger: true })) remove.mutate();
          }}><Trash2 className="size-4" /> Xóa</Button>
        )}
      />

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="min-w-0">
          <CardTitle
            title="Nội dung"
            hint={can.operate ? 'Kéo để đổi thứ tự.' : undefined}
            action={can.operate && (
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setDialog('add')}><Plus className="size-4" /> Thêm mục</Button>
                <Button size="sm" disabled={!dirty} busy={save.isPending} onClick={() => save.mutate()}>Lưu</Button>
              </div>
            )}
          />
          {dirty && <Notice tone="warn" className="mx-5 mb-3">Có thay đổi chưa lưu. Màn hình chỉ nhận sau khi bấm Lưu.</Notice>}
          {items.length === 0 ? (
            <Empty icon={<Film />} title="Danh sách đang trống" hint="Thêm video, ảnh, trang web hoặc YouTube." />
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={items.map((i) => i.key)} strategy={verticalListSortingStrategy}>
                <ol className="space-y-2 px-5 pb-5">
                  {items.map((item) => (
                    <Row
                      key={item.key}
                      item={item}
                      disabled={!can.operate}
                      onRemove={() => { setItems(items.filter((i) => i.key !== item.key)); setDirty(true); }}
                      onDuration={(seconds) => { setItems(items.map((i) => (i.key === item.key ? { ...i, durationSeconds: seconds } : i))); setDirty(true); }}
                    />
                  ))}
                </ol>
              </SortableContext>
            </DndContext>
          )}
        </Card>

        <div className="space-y-5">
          <Card>
            <CardTitle title="Màn hình" action={can.operate && <Button size="sm" variant="outline" onClick={() => setDialog('assign')}><Tv className="size-4" /> Chọn</Button>} />
            {p.screens.length === 0 ? (
              <p className="px-5 pb-5 text-sm text-soft">Chưa có màn hình nào phát danh sách này.</p>
            ) : (
              <ul className="space-y-2 px-5 pb-5">
                {p.screens.map((screen: any) => (
                  <li key={screen.id} className="flex items-center justify-between gap-2 text-sm">
                    <Link to={`/quan-ly/thiet-bi/${screen.id}`} className="truncate hover:underline">{screen.name}</Link>
                    <Badge tone={SCREEN_STATE[screen.state].tone}>{SCREEN_STATE[screen.state].label}</Badge>
                  </li>
                ))}
              </ul>
            )}
            {p.groups.length > 0 && <p className="border-t border-line px-5 py-2.5 text-xs text-soft">Theo nhóm: {p.groups.map((g: any) => g.name).join(', ')}</p>}
          </Card>

          <Card>
            <CardTitle title="Lịch phát" hint="Phát danh sách này vào giờ nhất định." action={can.operate && <Button size="sm" variant="outline" onClick={() => setDialog('rule')}><CalendarClock className="size-4" /> Thêm</Button>} />
            {p.rules.length === 0 ? (
              <p className="px-5 pb-5 text-sm text-soft">Chưa có lịch nào.</p>
            ) : (
              <ul className="divide-y divide-line px-5 pb-3">
                {p.rules.map((rule: any) => (
                  <li key={rule.id} className="flex items-start justify-between gap-2 py-2.5 text-[13px]">
                    <div className="min-w-0">
                      <p className="font-semibold">{rule.device?.name ?? `Nhóm ${rule.group?.name}`}</p>
                      <p className="text-soft">
                        {daysText(rule.days)}{rule.start ? ` · ${rule.start} đến ${rule.end}` : ' · cả ngày'}
                        {rule.from || rule.to ? ` · ${rule.from ?? '...'} đến ${rule.to ?? '...'}` : ''}
                        {rule.priority ? ` · ưu tiên ${rule.priority}` : ''}
                      </p>
                    </div>
                    {can.operate && <button aria-label="Xóa lịch" className="shrink-0 rounded-lg p-1 text-soft hover:bg-raised hover:text-bad" onClick={() => removeRule.mutate(rule.id)}><Trash2 className="size-4" /></button>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      {dialog === 'add' && <AddItem onClose={() => setDialog(null)} onAdd={(added) => { setItems([...items, ...added]); setDirty(true); }} />}
      {dialog === 'assign' && <AssignDialog playlist={p} onClose={() => setDialog(null)} />}
      {dialog === 'rule' && <RuleDialog playlistId={id} onClose={() => setDialog(null)} />}
      <Modal open={dialog === 'rename'} onClose={() => setDialog(null)} title="Đổi tên danh sách" footer={<><Button variant="outline" onClick={() => setDialog(null)}>Hủy</Button><Button disabled={!name.trim()} busy={rename.isPending} onClick={() => rename.mutate()}>Lưu</Button></>}>
        <Field label="Tên"><Input autoFocus value={name} onChange={(e) => setName(e.target.value)} /></Field>
      </Modal>
    </>
  );
}
