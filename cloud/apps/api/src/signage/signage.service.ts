import { Injectable } from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { MediaAsset, PlaylistItem } from '../generated/prisma/client';
import { CryptoService, sha256 } from '../common/crypto.service';
import { PrismaService } from '../common/prisma.service';
import { StorageService } from '../common/storage.service';
import { env } from '../config/env';
import { readVideoDurationMs } from '../files/media-duration';

type ItemWithAsset = PlaylistItem & { mediaAsset: MediaAsset | null };

export interface ManifestItem {
  id: string;
  kind: string;
  url: string;
  title?: string;
  duration_seconds?: number;
  /** A video of the library: the same number for every screen, which keeps them in step */
  duration_ms?: number;
  video_id?: string;
}

export interface Manifest {
  version: string | null;
  playlist: { id: string; name: string } | null;
  items: ManifestItem[];
  /** When the playlist began: where a screen should be now follows from this, the same on all of them */
  sync_epoch_ms?: number;
  schedule?: {
    default_playlist: string | null;
    playlists: Record<string, { name: string; items: ManifestItem[]; sync_epoch_ms: number }>;
    rules: Array<{
      playlist: string;
      days: number[];
      start: string | null;
      end: string | null;
      from: string | null;
      to: string | null;
      priority: number;
    }>;
  } | null;
}

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const VERSION_CACHE_MS = 60_000;

/** A YouTube address in any of its usual forms, or a bare video id */
export function parseYoutubeId(input: string): string | null {
  const value = input.trim();
  if (YOUTUBE_ID.test(value)) return value;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www\.|m\.|music\.)/, '');
  let id: string | null = null;
  if (host === 'youtu.be') id = url.pathname.split('/')[1] ?? null;
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (url.pathname === '/watch') id = url.searchParams.get('v');
    else {
      const match = /^\/(embed|shorts|live|v)\/([^/]+)/.exec(url.pathname);
      id = match ? match[2] : null;
    }
  }
  return id && YOUTUBE_ID.test(id) ? id : null;
}

export function mediaFileName(asset: { id: string; fileName: string }): string {
  const dot = asset.fileName.lastIndexOf('.');
  const extension = dot > 0 ? asset.fileName.slice(dot).toLowerCase().replace(/[^.a-z0-9]/g, '') : '';
  const base = (dot > 0 ? asset.fileName.slice(0, dot) : asset.fileName)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${base || 'media'}${extension}`;
}

function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  const ip = address.toLowerCase();
  if (ip.startsWith('::ffff:')) return isPrivateAddress(ip.slice(7));
  return ip === '::1' || ip === '::' || ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80');
}

@Injectable()
export class SignageService {
  private versions = new Map<string, { version: string | null; at: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly storage: StorageService,
  ) {}

  /** Any change to a playlist, an item, a rule or an assignment */
  invalidate(): void {
    this.versions.clear();
  }

  mediaUrl(asset: { id: string; fileName: string }): string {
    // The address never changes and is never reused, so the offline cache of a device keeps
    // its copy for good. Only the path carries the token: the query would look like another file.
    const token = this.crypto.sign('media', asset.id);
    return `${env().publicUrl}/media/${asset.id}/${token}/${mediaFileName(asset)}`;
  }

  youtubePlayerUrl(videoId: string): string {
    return `${env().publicUrl}/player/youtube/?v=${videoId}`;
  }

  private toManifestItem(item: ItemWithAsset): ManifestItem | null {
    const out: ManifestItem = { id: item.id, kind: item.kind, url: '' };
    if (item.title) out.title = item.title;
    if (item.durationSeconds) out.duration_seconds = item.durationSeconds;
    if (item.kind === 'video' && item.mediaAsset?.durationMs) out.duration_ms = item.mediaAsset.durationMs;
    if (item.kind === 'youtube') {
      if (!item.videoId) return null;
      out.video_id = item.videoId;
      out.url = this.youtubePlayerUrl(item.videoId);
      return out;
    }
    const url = item.mediaAsset ? this.mediaUrl(item.mediaAsset) : item.url;
    if (!url) return null;
    out.url = url;
    return out;
  }

  /** Reads each video once. Kept as 0 when the file does not say, so it is not read again */
  private async fillDurations(items: ItemWithAsset[]): Promise<void> {
    for (const item of items) {
      const asset = item.mediaAsset;
      if (item.kind !== 'video' || !asset || asset.durationMs !== null) continue;
      const ms = await readVideoDurationMs(this.storage.path(asset.storageKey)).catch(() => null);
      asset.durationMs = ms ?? 0;
      await this.prisma.mediaAsset.update({ where: { id: asset.id }, data: { durationMs: asset.durationMs } });
    }
  }

  /**
   * What a device must play. The rules arrive in order of precedence, which is what the app
   * expects: highest priority, then a rule on the screen before one on its group, then the
   * most recent. The version is a hash of the content, so any real change gives a new one.
   */
  async manifestFor(deviceId: string): Promise<Manifest> {
    const device = await this.prisma.device.findUnique({
      where: { id: deviceId },
      select: { playlistId: true, groupId: true, group: { select: { playlistId: true } } },
    });
    if (!device) return { version: null, playlist: null, items: [] };

    const defaultId = device.playlistId ?? device.group?.playlistId ?? null;
    const rules = await this.prisma.scheduleRule.findMany({
      where: { OR: [{ deviceId }, ...(device.groupId ? [{ groupId: device.groupId }] : [])] },
    });
    if (!defaultId && rules.length === 0) return { version: null, playlist: null, items: [] };

    rules.sort(
      (a, b) =>
        b.priority - a.priority ||
        Number(!!b.deviceId) - Number(!!a.deviceId) ||
        b.createdAt.getTime() - a.createdAt.getTime() ||
        a.id.localeCompare(b.id),
    );

    const ids = [...new Set([...(defaultId ? [defaultId] : []), ...rules.map((r) => r.playlistId)])].sort();
    const playlists = await this.prisma.playlist.findMany({
      where: { id: { in: ids } },
      include: { items: { orderBy: { position: 'asc' }, include: { mediaAsset: true } } },
    });
    const byId = new Map(playlists.map((p) => [p.id, p]));
    await this.fillDurations(playlists.flatMap((p) => p.items));
    const epochOf = (id: string): number => {
      const playlist = byId.get(id);
      return (playlist?.syncEpochAt ?? playlist?.createdAt ?? new Date(0)).getTime();
    };
    const itemsOf = (id: string) =>
      (byId.get(id)?.items ?? []).map((i) => this.toManifestItem(i)).filter((i): i is ManifestItem => i !== null);

    const defaultPlaylist = defaultId ? byId.get(defaultId) ?? null : null;
    const body: Omit<Manifest, 'version'> = {
      playlist: defaultPlaylist ? { id: defaultPlaylist.id, name: defaultPlaylist.name } : null,
      items: defaultPlaylist ? itemsOf(defaultPlaylist.id) : [],
      ...(defaultPlaylist ? { sync_epoch_ms: epochOf(defaultPlaylist.id) } : {}),
      schedule: rules.length
        ? {
            default_playlist: defaultPlaylist?.id ?? null,
            playlists: Object.fromEntries(ids.map((id) => [id, { name: byId.get(id)?.name ?? '', items: itemsOf(id), sync_epoch_ms: epochOf(id) }])),
            rules: rules.map((r) => ({
              playlist: r.playlistId,
              days: r.days,
              start: r.start,
              end: r.end,
              from: r.from,
              to: r.to,
              priority: r.priority,
            })),
          }
        : null,
    };
    return { version: sha256(JSON.stringify(body)).slice(0, 32), ...body };
  }

  /** Asked at every heartbeat: kept a moment, and dropped as soon as anything changes */
  async versionFor(deviceId: string): Promise<string | null> {
    const cached = this.versions.get(deviceId);
    if (cached && Date.now() - cached.at < VERSION_CACHE_MS) return cached.version;
    const { version } = await this.manifestFor(deviceId);
    this.versions.set(deviceId, { version, at: Date.now() });
    return version;
  }

  forget(deviceId: string): void {
    this.versions.delete(deviceId);
  }

  /**
   * Whether a site lets itself be shown inside another page. The player shows web pages in a
   * frame, and a refusal only appears there as an empty frame, so it is better said up front.
   * Called with an address someone typed: internal addresses are refused, and no redirect
   * is followed, so this cannot be used to read the network behind the server.
   */
  async checkFraming(rawUrl: string): Promise<{ reachable: boolean; warning: string | null }> {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      return { reachable: false, warning: 'URL không hợp lệ' };
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { reachable: false, warning: 'URL phải bắt đầu bằng http:// hoặc https://' };
    }
    try {
      const addresses = await lookup(url.hostname, { all: true });
      if (addresses.some((a) => isPrivateAddress(a.address))) {
        return { reachable: false, warning: 'Địa chỉ nội bộ: máy chủ không kiểm tra, hãy thử trực tiếp trên màn hình' };
      }
      const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(6000) });
      const frameOptions = response.headers.get('x-frame-options');
      const csp = response.headers.get('content-security-policy') ?? '';
      const ancestors = /frame-ancestors\s+([^;]+)/i.exec(csp)?.[1]?.trim();
      if (frameOptions && /deny|sameorigin/i.test(frameOptions)) {
        return { reachable: true, warning: 'Trang này cấm hiển thị trong khung (X-Frame-Options): màn hình sẽ trống' };
      }
      if (ancestors && ancestors !== '*') {
        return { reachable: true, warning: 'Trang này cấm hiển thị trong khung (CSP frame-ancestors): màn hình sẽ trống' };
      }
      return { reachable: true, warning: null };
    } catch {
      return { reachable: false, warning: 'Không truy cập được trang này từ máy chủ' };
    }
  }
}
