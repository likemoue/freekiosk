import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { Check, LayoutGrid, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { Button, Empty, ErrorBox, Input, Loading, Notice } from '../ui';
import { AppIcon, HomeApp, HomePreview, HomeTarget } from './home-apps';

/** The apps really on these tablets, as the home screen editor shows them. Those on the kiosk come first */
function useTabletApps(target: HomeTarget | null) {
  const preview = useQuery<HomePreview>({
    queryKey: ['home-apps', JSON.stringify(target)],
    queryFn: () => api.post('/api/admin/home-apps/preview', { target }),
    enabled: !!target,
    refetchInterval: 20_000,
  });
  const apps = useMemo(() => {
    const data = preview.data;
    if (!data) return [];
    // A tablet that has not said what it has may still have what is on its screen
    return data.apps.filter((app) => app.installed > 0 || (app.onHome > 0 && data.notReporting > 0));
  }, [preview.data]);
  return { preview, apps, reporting: (preview.data?.deviceCount ?? 0) - (preview.data?.notReporting ?? 0) };
}

function PickTile({ app, picked, reporting, onClick, disabled }: { app: HomeApp; picked: boolean; reporting: number; onClick: () => void; disabled?: boolean }) {
  const note = reporting > 1 && app.installed > 0 && app.installed < reporting ? `Có trên ${app.installed}/${reporting} máy` : null;
  return (
    <button
      type="button"
      aria-pressed={picked}
      title={app.packageName}
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        'relative flex min-w-0 flex-col items-center gap-1.5 rounded-xl border p-2.5 text-center transition-colors disabled:cursor-not-allowed disabled:opacity-60',
        picked ? 'border-brand-strong bg-brand-soft/60' : 'border-line bg-card hover:bg-raised',
      )}
    >
      <AppIcon app={app} />
      <span className="line-clamp-2 w-full text-xs leading-tight font-medium break-words">{app.label}</span>
      {note && <span className="text-[11px] leading-tight text-soft">{note}</span>}
      {picked && (
        <span aria-hidden className="absolute top-1.5 right-1.5 grid size-5 place-items-center rounded-full bg-brand-strong text-white [&_svg]:size-3.5">
          <Check />
        </span>
      )}
    </button>
  );
}

function AppGrid({ apps, picked, reporting, onPick }: { apps: HomeApp[]; picked: (app: HomeApp) => boolean; reporting: number; onPick: (app: HomeApp) => void }) {
  const [search, setSearch] = useState('');
  const { onKiosk, others } = useMemo(() => {
    const query = search.trim().toLowerCase();
    const found = apps.filter((app) => !query || app.label.toLowerCase().includes(query) || app.packageName.toLowerCase().includes(query));
    return { onKiosk: found.filter((app) => app.onHome > 0), others: found.filter((app) => app.onHome === 0) };
  }, [apps, search]);

  const section = (title: string, list: HomeApp[]) => list.length > 0 && (
    <section>
      <h3 className="mb-2 text-[13px] font-bold">{title} <span className="font-normal text-soft">({list.length})</span></h3>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(92px,1fr))] gap-2">
        {list.map((app) => <PickTile key={app.packageName} app={app} picked={picked(app)} reporting={reporting} onClick={() => onPick(app)} />)}
      </div>
    </section>
  );

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="absolute top-3 left-3 size-4 text-soft" />
        <Input className="pl-9" placeholder="Tìm ứng dụng…" aria-label="Tìm ứng dụng" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      {onKiosk.length === 0 && others.length === 0 && (
        <p className="py-4 text-center text-sm text-soft">{search.trim() ? 'Không có ứng dụng nào khớp.' : 'Chưa biết ứng dụng nào trên các thiết bị này.'}</p>
      )}
      {section('Đang hiện trên kiosk', onKiosk)}
      {section('Ứng dụng khác', others)}
    </div>
  );
}

/** What stands in for the list while there is none to show. Null once there is */
function ListState({ target, preview }: { target: HomeTarget | null; preview: ReturnType<typeof useTabletApps>['preview'] }) {
  if (!target) return <p className="py-4 text-center text-sm text-soft">Chọn thiết bị hoặc nhóm để xem các ứng dụng.</p>;
  if (preview.isLoading) return <Loading />;
  if (preview.error) return <ErrorBox error={preview.error} />;
  if (!preview.data || preview.data.deviceCount === 0) return <Empty icon={<LayoutGrid />} title="Không có thiết bị nào trong lựa chọn này" />;
  return null;
}

function NotReporting({ count }: { count: number }) {
  if (count === 0) return null;
  return <Notice tone="warn">{count} thiết bị chưa gửi danh sách ứng dụng nên có thể thiếu ứng dụng ở đây. Cài bản FreeKiosk mới nhất cho thiết bị, danh sách sẽ tự hiện sau vài phút.</Notice>;
}

/** One app, by its icon rather than its package */
export function AppChoice({ target, value, onChange }: { target: HomeTarget | null; value: string; onChange: (packageName: string, label: string) => void }) {
  const { preview, apps, reporting } = useTabletApps(target);
  const state = <ListState target={target} preview={preview} />;
  if (!target || preview.isLoading || preview.error || !preview.data || preview.data.deviceCount === 0) return state;
  const chosen = apps.find((app) => app.packageName === value);
  return (
    <div className="space-y-3">
      <NotReporting count={preview.data.notReporting} />
      {/* A schedule made earlier may name an app these tablets do not have: it is not silently replaced */}
      {value && !chosen && <Notice tone="warn">Đang chọn {value}, ứng dụng này không có trên các thiết bị đã chọn.</Notice>}
      <AppGrid
        apps={apps}
        reporting={reporting}
        picked={(app) => app.packageName === value}
        onPick={(app) => (app.packageName === value ? onChange('', '') : onChange(app.packageName, app.label))}
      />
    </div>
  );
}

/**
 * Several apps. Starts with those on the kiosk ticked, once the list is known, and not again after
 * that: the list comes back every 20 seconds, and what someone unticked stays unticked.
 */
export function AppsChoice({ target, value, onChange }: { target: HomeTarget | null; value: string[] | undefined; onChange: (packages: string[], labels: string[], deviceCount: number) => void }) {
  const { preview, apps, reporting } = useTabletApps(target);
  const deviceCount = preview.data?.deviceCount ?? 0;
  const picked = useMemo(() => new Set(value ?? []), [value]);
  const labelOf = (packageName: string) => apps.find((app) => app.packageName === packageName)?.label ?? packageName;
  const send = (packages: string[]) => onChange(packages, packages.map(labelOf), deviceCount);
  const kioskApps = () => apps.filter((app) => app.onHome > 0).map((app) => app.packageName);

  const seededFor = useRef<string | null>(null);
  const key = JSON.stringify(target);
  useEffect(() => {
    if (!preview.data || seededFor.current === key) return;
    seededFor.current = key;
    send(kioskApps());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview.data, key]);

  const state = <ListState target={target} preview={preview} />;
  if (!target || preview.isLoading || preview.error || !preview.data || deviceCount === 0) return state;

  const toggle = (app: HomeApp) => send(picked.has(app.packageName) ? [...picked].filter((name) => name !== app.packageName) : [...picked, app.packageName]);
  return (
    <div className="space-y-3">
      <NotReporting count={preview.data.notReporting} />
      <AppGrid apps={apps} reporting={reporting} picked={(app) => picked.has(app.packageName)} onPick={toggle} />
      <div className="flex flex-wrap items-center gap-2 text-[13px] text-soft">
        <span>Đã chọn {picked.size} ứng dụng, trên {deviceCount} thiết bị.</span>
        <Button size="sm" variant="ghost" onClick={() => send(kioskApps())}>Chọn ứng dụng trên kiosk</Button>
        {picked.size > 0 && <Button size="sm" variant="ghost" onClick={() => send([])}>Bỏ chọn hết</Button>}
      </div>
    </div>
  );
}
