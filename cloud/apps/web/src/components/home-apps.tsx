import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Check, LayoutGrid, Minus, Plus, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { api } from '../api';
import { useCan } from '../auth';
import { Button, Empty, ErrorBox, Input, Loading, notifyError, Notice, Switch } from '../ui';

export type HomeTarget = { deviceIds?: string[]; groupId?: string; all?: boolean };

export interface HomeApp {
  packageName: string;
  label: string;
  iconUrl: string | null;
  canInstall: boolean;
  apkIncomplete: boolean;
  onHome: number;
  installed: number;
  installing: number;
}

export interface HomePreview {
  deviceCount: number;
  notReporting: number;
  notMultiApp: number;
  pending: number;
  apps: HomeApp[];
}

interface ApplyResult {
  sent: number;
  installs: number;
  skipped: Array<{ name: string; reason: string }>;
  profile: { name: string; updated: boolean } | null;
}

type Change = 'add' | 'remove';

export function AppIcon({ app }: { app: HomeApp }) {
  const [broken, setBroken] = useState(false);
  if (app.iconUrl && !broken) {
    return <img src={app.iconUrl} alt="" loading="lazy" onError={() => setBroken(true)} className="size-12 rounded-xl object-contain" />;
  }
  // Until a tablet that has the app sends its icon: the name, never the package
  return (
    <span aria-hidden className="grid size-12 place-items-center rounded-xl bg-brand-soft text-base font-bold text-brand-strong dark:text-brand">
      {app.label.trim().slice(0, 2).toUpperCase()}
    </span>
  );
}

function tileNote(app: HomeApp, deviceCount: number, reporting: number, change?: Change): string | null {
  // Only a tablet that reports what it has can be said to lack an app
  const missing = Math.max(reporting - app.installed, 0);
  if (app.installing > 0) return `Đang cài trên ${app.installing} máy`;
  if (missing > 0 && app.apkIncomplete && !app.canInstall) return 'APK thiếu phần, không cài được';
  if (change === 'add' && missing > 0) return app.canInstall ? 'Cài xong sẽ hiện' : `${missing} máy chưa cài`;
  // On the screen but not on the tablet: a tile that opens nothing, better taken off
  if (app.onHome > 0 && missing > 0) return `Chưa cài trên ${missing} máy`;
  if (app.onHome > 0 && app.onHome < deviceCount) return `Trên ${app.onHome}/${deviceCount} máy`;
  if (app.onHome === 0 && missing > 0) return app.installed > 0 ? `${missing} máy chưa cài` : 'Chưa cài';
  return null;
}

function AppTile({ app, note, change, onToggle, disabled }: { app: HomeApp; note: string | null; change?: Change; onToggle: () => void; disabled: boolean }) {

  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={change ? change === 'add' : app.onHome > 0}
      title={app.packageName}
      onClick={onToggle}
      className={clsx(
        'relative flex min-w-0 flex-col items-center gap-1.5 rounded-xl border p-2.5 text-center transition-colors disabled:cursor-not-allowed disabled:opacity-60',
        change === 'add' && 'border-ok bg-ok/10',
        change === 'remove' && 'border-bad bg-bad/10',
        !change && app.onHome > 0 && 'border-brand-strong bg-brand-soft/60',
        !change && app.onHome === 0 && 'border-line bg-card hover:bg-raised',
      )}
    >
      <span className={clsx(change === 'remove' && 'opacity-40 grayscale')}><AppIcon app={app} /></span>
      <span className={clsx('line-clamp-2 w-full text-xs leading-tight font-medium break-words', change === 'remove' && 'line-through')}>{app.label}</span>
      {note && <span className="text-[11px] leading-tight text-soft">{note}</span>}
      <span
        aria-hidden
        className={clsx(
          'absolute top-1.5 right-1.5 grid size-5 place-items-center rounded-full text-white [&_svg]:size-3.5',
          change === 'add' ? 'bg-ok' : change === 'remove' ? 'bg-bad' : app.onHome > 0 ? 'bg-brand-strong' : 'hidden',
        )}
      >
        {change === 'add' ? <Plus /> : change === 'remove' ? <Minus /> : <Check />}
      </span>
    </button>
  );
}

/**
 * Which apps show on the home screen of the tablets, chosen by icon. Sends only what changed, and
 * the server works out a list for each tablet, so tablets that differ keep what sets them apart.
 */
export function HomeAppsEditor({ target, onSent }: { target: HomeTarget | null; onSent?: () => void }) {
  const can = useCan();
  const client = useQueryClient();
  const [changes, setChanges] = useState<Record<string, Change>>({});
  const [search, setSearch] = useState('');
  const [switchToMulti, setSwitchToMulti] = useState(false);

  const key = JSON.stringify(target);
  const preview = useQuery<HomePreview>({
    queryKey: ['home-apps', key],
    queryFn: () => api.post('/api/admin/home-apps/preview', { target }),
    enabled: !!target,
    // A tablet that has just been updated reports its apps within a few minutes
    refetchInterval: 20_000,
  });

  useEffect(() => {
    setChanges({});
    setSwitchToMulti(false);
  }, [key]);

  const deviceCount = preview.data?.deviceCount ?? 0;
  const { shown, others } = useMemo(() => {
    const query = search.trim().toLowerCase();
    const apps = (preview.data?.apps ?? []).filter((app) => !query || app.label.toLowerCase().includes(query) || app.packageName.toLowerCase().includes(query));
    return { shown: apps.filter((app) => app.onHome > 0), others: apps.filter((app) => app.onHome === 0) };
  }, [preview.data, search]);

  const toggle = (app: HomeApp) => {
    setChanges((current) => {
      const next = { ...current };
      const state = next[app.packageName];
      const onAll = app.onHome === deviceCount;
      const onNone = app.onHome === 0;
      // On some tablets only, a tap can mean either: add to the rest, remove from all, or leave it
      const order: Array<Change | undefined> = onNone ? [undefined, 'add'] : onAll ? [undefined, 'remove'] : [undefined, 'add', 'remove'];
      const following = order[(order.indexOf(state) + 1) % order.length];
      if (following) next[app.packageName] = following;
      else delete next[app.packageName];
      return next;
    });
  };

  const add = Object.keys(changes).filter((packageName) => changes[packageName] === 'add');
  const remove = Object.keys(changes).filter((packageName) => changes[packageName] === 'remove');
  const nothing = !add.length && !remove.length && !switchToMulti;

  const apply = useMutation({
    mutationFn: () => api.post<ApplyResult>('/api/admin/home-apps/apply', { target, add, remove, switchToMulti }),
    onSuccess: (result) => {
      if (result.sent > 0) toast.success(`Đã gửi tới ${result.sent} thiết bị`);
      if (result.installs > 0) toast.info(`Đang cài ${result.installs} ứng dụng. Ứng dụng sẽ hiện trên màn hình sau khi cài xong.`);
      if (result.sent === 0 && result.installs === 0 && !result.skipped.length) toast.info('Các thiết bị đã đúng như vậy, không cần gửi gì');
      if (result.skipped.length) toast.warning(`Bỏ qua ${result.skipped.length} thiết bị. ${result.skipped[0].name}: ${result.skipped[0].reason}`);
      if (result.profile?.updated) toast.info(`Đã lưu vào hồ sơ ${result.profile.name}: tablet mới vào nhóm cũng nhận các ứng dụng này`);
      if (result.profile && !result.profile.updated) toast.warning(`Hồ sơ ${result.profile.name} còn dùng cho nơi khác nên chưa đổi: tablet mới vào nhóm sẽ theo hồ sơ cũ`);
      setChanges({});
      setSwitchToMulti(false);
      client.invalidateQueries({ queryKey: ['home-apps'] });
      client.invalidateQueries({ queryKey: ['commands'] });
      onSent?.();
    },
    onError: notifyError,
  });

  if (!target) return <p className="py-4 text-center text-sm text-soft">Chọn thiết bị hoặc nhóm ở trên để xem các ứng dụng.</p>;
  if (preview.isLoading) return <Loading />;
  if (preview.error) return <ErrorBox error={preview.error} />;
  const data = preview.data;
  if (!data || data.deviceCount === 0) return <Empty icon={<LayoutGrid />} title="Không có thiết bị nào trong lựa chọn này" />;

  const section = (title: string, apps: HomeApp[], hint?: string) => (
    <section>
      <h3 className="mb-2 text-[13px] font-bold">
        {title} <span className="font-normal text-soft">({apps.length})</span>
      </h3>
      {hint && <p className="mb-2 text-xs text-soft">{hint}</p>}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(92px,1fr))] gap-2">
        {apps.map((app) => (
          <AppTile
            key={app.packageName}
            app={app}
            note={tileNote(app, deviceCount, deviceCount - data.notReporting, changes[app.packageName])}
            change={changes[app.packageName]}
            onToggle={() => toggle(app)}
            disabled={!can.operate || apply.isPending}
          />
        ))}
      </div>
    </section>
  );

  return (
    <div className="space-y-4">
      {data.notReporting > 0 && (
        <Notice tone="warn">
          {data.notReporting} thiết bị chưa gửi danh sách ứng dụng nên chưa có đủ icon. Cài bản FreeKiosk mới nhất cho thiết bị, danh sách sẽ tự hiện sau vài phút.
        </Notice>
      )}
      {data.notMultiApp > 0 && (
        <Notice tone="warn">
          <p>{data.notMultiApp} thiết bị không ở chế độ nhiều ứng dụng nên chưa hiện danh sách này.</p>
          <div className="mt-2 flex items-center gap-3 font-medium">
            <Switch checked={switchToMulti} onChange={setSwitchToMulti} disabled={!can.operate} label="Chuyển sang chế độ nhiều ứng dụng" />
            <span>Chuyển các thiết bị này sang chế độ nhiều ứng dụng</span>
          </div>
        </Notice>
      )}

      <div className="relative">
        <Search className="absolute top-3 left-3 size-4 text-soft" />
        <Input className="pl-9" placeholder="Tìm ứng dụng…" aria-label="Tìm ứng dụng" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {shown.length === 0 && others.length === 0 && (
        <p className="py-4 text-center text-sm text-soft">{search.trim() ? 'Không có ứng dụng nào khớp.' : 'Chưa biết ứng dụng nào trên các thiết bị này.'}</p>
      )}
      {shown.length > 0 && section('Đang hiện trên màn hình', shown, 'Nhấn vào ứng dụng để gỡ.')}
      {others.length > 0 && section('Thêm ứng dụng', others, 'Nhấn vào ứng dụng để thêm. Máy chưa có ứng dụng thì cài từ mục Ứng dụng (APK), cài xong mới hiện.')}

      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3">
        <Button disabled={nothing || !can.operate} busy={apply.isPending} onClick={() => apply.mutate()}>
          <Check className="size-4" /> Áp dụng
        </Button>
        {!nothing && (
          <Button variant="ghost" onClick={() => { setChanges({}); setSwitchToMulti(false); }}>Bỏ chọn</Button>
        )}
        <span className="text-[13px] text-soft">
          {nothing
            ? 'Chưa có thay đổi nào'
            : [add.length ? `Thêm ${add.length}` : '', remove.length ? `Gỡ ${remove.length}` : '', `cho ${deviceCount} thiết bị`].filter(Boolean).join(', ')}
        </span>
      </div>
      <p className="text-xs text-soft">
        Thiết bị đang trực tuyến nhận trong vài giây. Bản FreeKiosk cũ hơn 2.1.0-beta.8 nhận trong tối đa 30 giây.
        {data.pending > 0 && ` Còn ${data.pending} thiết bị chưa nhận thay đổi lần trước.`}
      </p>
    </div>
  );
}
