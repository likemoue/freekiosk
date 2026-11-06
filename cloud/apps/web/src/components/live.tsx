import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef } from 'react';
import { api } from '../api';

/** One screen as the server last heard of it (LiveService in the API) */
export interface LiveStatus {
  deviceId: string;
  streaming: boolean;
  seq: number;
  at: number | null;
  width: number | null;
  height: number | null;
  problem: string | null;
  control: boolean;
  /** Why the server does not even ask this tablet: offline, or an app too old to send pictures */
  reason: 'offline' | 'old_app' | null;
}

function newViewer(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Says to the server, every few seconds, which screens this page shows: the tablets send pictures only
 * while someone looks. Every five seconds for the grid, every second for one screen opened full size.
 */
export function useLive(deviceIds: string[], mode: 'grid' | 'detail') {
  const viewer = useMemo(newViewer, []);
  const key = deviceIds.join(',');
  const statuses = useQuery<LiveStatus[]>({
    queryKey: ['live', viewer, mode, key],
    queryFn: () => api.post('/api/admin/live/watch', { viewer, deviceIds, mode }),
    enabled: deviceIds.length > 0,
    refetchInterval: mode === 'detail' ? 1_000 : 3_000,
    refetchIntervalInBackground: false,
  });
  // Leaving the page lets the tablets stop at once rather than in fifteen seconds
  useEffect(() => () => {
    void fetch('/api/admin/live/unwatch', {
      method: 'POST',
      keepalive: true,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'freekiosk-manager' },
      body: JSON.stringify({ viewer }),
    }).catch(() => {});
  }, [viewer]);
  const byDevice = useMemo(() => new Map((statuses.data ?? []).map((status) => [status.deviceId, status])), [statuses.data]);
  return { byDevice, statuses };
}

/** What a tablet says when it sends no picture, in words */
export function liveProblem(status: LiveStatus | undefined, online: boolean): string | null {
  if (!online || status?.reason === 'offline') return 'Thiết bị đang ngoại tuyến';
  if (status?.reason === 'old_app') return 'Cần FreeKiosk bản mới nhất';
  if (!status) return 'Đang kết nối…';
  const problem = status.problem;
  if (!problem) return status.seq === 0 ? 'Đang chờ ảnh đầu tiên…' : null;
  if (problem === 'screen_off') return 'Màn hình đang tắt';
  if (problem === 'starting') return 'FreeKiosk đang khởi động';
  if (problem === 'no_frame') return 'Chưa có ảnh';
  if (/Device Owner policy/i.test(problem)) return 'Máy đang chặn chụp màn hình: bật "Cho phép chụp màn hình từ xa" trong Bảo mật của máy hoặc trong hồ sơ cấu hình';
  if (/Accessibility service is not enabled/i.test(problem)) return 'Chưa bật dịch vụ trợ năng FreeKiosk trên máy: chỉ thấy màn hình khi FreeKiosk ở trên cùng';
  if (/no screenshot capability/i.test(problem)) return 'Cần tắt rồi bật lại dịch vụ trợ năng FreeKiosk trên máy';
  if (/Android 11/i.test(problem)) return 'Cần Android 11 trở lên để thấy ứng dụng khác';
  return problem;
}

/** The picture, reloaded only when a newer one has come */
export function LiveImage({ deviceId, seq, className, alt, imgRef }: { deviceId: string; seq: number; className?: string; alt: string; imgRef?: React.Ref<HTMLImageElement> }) {
  const last = useRef(0);
  if (seq > last.current) last.current = seq;
  if (!last.current) return null;
  return <img ref={imgRef} src={`/api/admin/live/${deviceId}/frame?seq=${last.current}`} alt={alt} draggable={false} className={className} />;
}
