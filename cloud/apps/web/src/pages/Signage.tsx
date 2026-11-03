import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Film, ImageIcon, ListVideo, Plus, Trash2, Tv } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { api } from '../api';
import { useCan } from '../auth';
import { UploadButton } from '../components/upload';
import { bytes, dateTime, timeAgo } from '../format';
import { Badge, Button, Card, CopyButton, Empty, ErrorBox, Field, Input, Loading, Modal, notifyError, PageHeader, Progress, Select, Table, Tabs, td, th, trow, useConfirm } from '../ui';

export const SCREEN_STATE: Record<string, { label: string; tone: 'ok' | 'warn' | 'neutral' | 'info' | 'bad' }> = {
  none: { label: 'Không có danh sách', tone: 'neutral' },
  up_to_date: { label: 'Đã cập nhật', tone: 'ok' },
  waiting: { label: 'Đang chờ màn hình', tone: 'warn' },
  not_reported: { label: 'Chưa báo cáo', tone: 'info' },
  app_too_old: { label: 'Ứng dụng quá cũ', tone: 'bad' },
};

function Screens() {
  const can = useCan();
  const client = useQueryClient();
  const screens = useQuery<any[]>({ queryKey: ['signage-screens'], queryFn: () => api.get('/api/admin/signage/screens'), refetchInterval: 10_000 });
  const playlists = useQuery<any[]>({ queryKey: ['playlists'], queryFn: () => api.get('/api/admin/signage/playlists') });
  const assign = useMutation({
    mutationFn: ({ id, playlistId }: { id: string; playlistId: string | null }) => api.patch(`/api/admin/devices/${id}`, { playlistId }),
    onSuccess: () => { toast.success('Đã đổi danh sách phát'); client.invalidateQueries({ queryKey: ['signage-screens'] }); },
    onError: notifyError,
  });

  if (screens.isLoading) return <Loading />;
  if (screens.error) return <div className="p-4"><ErrorBox error={screens.error} /></div>;
  if (!screens.data?.length) return <Empty icon={<Tv />} title="Chưa có màn hình nào" hint="Đăng ký máy tính bảng hoặc TV chạy FreeKiosk, màn hình sẽ hiện ở đây để chọn nội dung phát." />;
  return (
    <Table>
      <thead><tr><th className={th}>Màn hình</th><th className={th}>Danh sách phát</th><th className={th}>Nguồn</th><th className={th}>Trạng thái</th></tr></thead>
      <tbody>
        {screens.data.map((screen) => {
          const state = SCREEN_STATE[screen.state];
          return (
            <tr key={screen.id} className={trow}>
              <td className={td}>
                <Link to={`/quan-ly/thiet-bi/${screen.id}`} className="font-semibold hover:underline">{screen.name}</Link>
                <span className="block text-xs text-soft">{screen.online ? 'Trực tuyến' : `Tín hiệu cuối ${timeAgo(screen.lastSeenAt)}`}</span>
              </td>
              <td className={td}>
                <Select className="max-w-60" aria-label={`Danh sách phát của ${screen.name}`} disabled={!can.operate} value={screen.playlist?.id ?? ''} onChange={(e) => assign.mutate({ id: screen.id, playlistId: e.target.value || null })}>
                  <option value="">{screen.groupPlaylist ? `Theo nhóm: ${screen.groupPlaylist.name}` : 'Không có'}</option>
                  {playlists.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Select>
              </td>
              <td className={`${td} text-soft`}>{screen.playlist ? 'Riêng của màn hình' : screen.groupPlaylist ? `Nhóm ${screen.groupName}` : '—'}{screen.ruleCount > 0 ? ` · ${screen.ruleCount} lịch` : ''}</td>
              <td className={td}><Badge tone={state.tone}>{state.label}</Badge></td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}

function Playlists({ onNew }: { onNew: () => void }) {
  const playlists = useQuery<any[]>({ queryKey: ['playlists'], queryFn: () => api.get('/api/admin/signage/playlists') });
  const can = useCan();
  if (playlists.isLoading) return <Loading />;
  if (!playlists.data?.length) return <Empty icon={<ListVideo />} title="Chưa có danh sách phát" hint="Tạo danh sách gồm video, ảnh, trang web và YouTube rồi chọn màn hình sẽ phát." action={can.operate && <Button onClick={onNew}><Plus className="size-4" /> Danh sách mới</Button>} />;
  return (
    <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
      {playlists.data.map((playlist) => (
        <Link key={playlist.id} to={`/quan-ly/bang-hieu/${playlist.id}`} className="group overflow-hidden rounded-2xl border border-line bg-card hover:border-brand">
          <div className="flex aspect-video items-center justify-center bg-raised">
            {playlist.cover ? <img src={playlist.cover} alt="" loading="lazy" className="size-full object-cover" /> : <ListVideo className="size-10 text-faint" />}
          </div>
          <div className="p-4">
            <h3 className="truncate font-bold group-hover:underline">{playlist.name}</h3>
            <p className="mt-1 text-xs text-soft">
              {playlist._count.items} mục · {playlist._count.devices} màn hình · {playlist._count.groups} nhóm{playlist._count.rules ? ` · ${playlist._count.rules} lịch` : ''}
            </p>
            <p className="text-xs text-soft">Sửa {timeAgo(playlist.updatedAt)}</p>
          </div>
        </Link>
      ))}
    </div>
  );
}

function Library() {
  const can = useCan();
  const confirm = useConfirm();
  const client = useQueryClient();
  const media = useQuery<any>({ queryKey: ['media'], queryFn: () => api.get('/api/admin/media') });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/admin/media/${id}`),
    onSuccess: () => { toast.success('Đã xóa tệp'); client.invalidateQueries({ queryKey: ['media'] }); },
    onError: notifyError,
  });
  if (media.isLoading) return <Loading />;
  const assets: any[] = media.data?.assets ?? [];
  return (
    <div className="p-5">
      <div className="mb-4 max-w-md">
        <div className="mb-1 flex justify-between text-[13px]"><span className="text-soft">Dung lượng đã dùng</span><span className="tabular-nums">{bytes(media.data?.usedBytes)} / {bytes(media.data?.quotaBytes)}</span></div>
        <Progress value={media.data ? (media.data.usedBytes / media.data.quotaBytes) * 100 : 0} />
      </div>
      {assets.length === 0 ? (
        <Empty icon={<ImageIcon />} title="Thư viện đang trống" hint="Tải lên ảnh hoặc video để dùng trong danh sách phát, không cần tự lưu trữ ở nơi khác." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {assets.map((asset) => (
            <div key={asset.id} className="overflow-hidden rounded-2xl border border-line">
              <div className="flex aspect-video items-center justify-center bg-raised">
                {asset.kind === 'image' ? <img src={asset.url} alt={asset.title} loading="lazy" className="size-full object-cover" /> : <Film className="size-9 text-faint" />}
              </div>
              <div className="p-3">
                <p className="truncate text-sm font-semibold" title={asset.fileName}>{asset.title}</p>
                <p className="text-xs text-soft">{bytes(asset.sizeBytes)} · {dateTime(asset.createdAt)}</p>
                <div className="mt-2 flex items-center gap-1">
                  <CopyButton value={asset.url} label="Chép URL" />
                  {can.operate && (
                    <Button size="sm" variant="ghost" aria-label={`Xóa ${asset.title}`} disabled={asset._count.items > 0} title={asset._count.items > 0 ? `Đang dùng trong ${asset._count.items} mục` : undefined} onClick={async () => {
                      if (await confirm({ title: `Xóa ${asset.title}?`, confirm: 'Xóa', danger: true })) remove.mutate(asset.id);
                    }}><Trash2 className="size-4" /></Button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Signage() {
  const can = useCan();
  const navigate = useNavigate();
  const client = useQueryClient();
  const [tab, setTab] = useState<'screens' | 'playlists' | 'library'>('screens');
  const [creating, setCreating] = useState<string | null>(null);

  const screens = useQuery<any[]>({ queryKey: ['signage-screens'], queryFn: () => api.get('/api/admin/signage/screens') });
  const playlists = useQuery<any[]>({ queryKey: ['playlists'], queryFn: () => api.get('/api/admin/signage/playlists') });
  const media = useQuery<any>({ queryKey: ['media'], queryFn: () => api.get('/api/admin/media') });

  const create = useMutation({
    mutationFn: () => api.post('/api/admin/signage/playlists', { name: creating }),
    onSuccess: (playlist) => { client.invalidateQueries({ queryKey: ['playlists'] }); navigate(`/quan-ly/bang-hieu/${playlist.id}`); },
    onError: notifyError,
  });

  return (
    <>
      <PageHeader
        title="Bảng hiệu số"
        hint="Màn hình của bạn phát gì, và khi nào."
        action={can.operate && (
          <>
            <UploadButton
              purpose="media"
              multiple
              accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/x-matroska,video/quicktime,.mkv,.mov"
              label="Tải tệp lên"
              finish={(id) => api.post(`/api/admin/media/finish/${id}`, {})}
              onDone={() => { client.invalidateQueries({ queryKey: ['media'] }); setTab('library'); }}
              onError={(message) => toast.error(message)}
            />
            <Button onClick={() => setCreating('')}><Plus className="size-4" /> Danh sách mới</Button>
          </>
        )}
      />
      <Tabs
        className="mb-4"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'screens', label: 'Màn hình', count: screens.data?.length ?? 0 },
          { id: 'playlists', label: 'Danh sách phát', count: playlists.data?.length ?? 0 },
          { id: 'library', label: 'Thư viện', count: media.data?.assets.length ?? 0 },
        ]}
      />
      <Card>
        {tab === 'screens' && <Screens />}
        {tab === 'playlists' && <Playlists onNew={() => setCreating('')} />}
        {tab === 'library' && <Library />}
      </Card>

      <Modal
        open={creating !== null}
        onClose={() => setCreating(null)}
        title="Danh sách phát mới"
        footer={<><Button variant="outline" onClick={() => setCreating(null)}>Hủy</Button><Button disabled={!creating?.trim()} busy={create.isPending} onClick={() => create.mutate()}>Tạo</Button></>}
      >
        <Field label="Tên danh sách"><Input autoFocus placeholder="Ví dụ: Sảnh chính, giờ hành chính" value={creating ?? ''} onChange={(e) => setCreating(e.target.value)} /></Field>
      </Modal>
    </>
  );
}
