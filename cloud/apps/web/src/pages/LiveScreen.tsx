import { useMutation, useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowLeft, ChevronLeft, CornerDownLeft, Delete, Home, Square, Sun } from 'lucide-react';
import { PointerEvent, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { api } from '../api';
import { useCan } from '../auth';
import { DeviceState, DeviceSummary } from '../components/device';
import { LiveImage, liveProblem, useLive } from '../components/live';
import { timeAgo } from '../format';
import { Button, Card, ErrorBox, Input, Loading, notifyError, Notice, PageHeader } from '../ui';

/** A press shorter and shorter than this is a tap; a longer one, a long press; a moved one, a swipe */
const MOVE_FRACTION = 0.02;
const LONG_PRESS_MS = 600;

/**
 * One screen, live, with a hand on it. The tablet sends about one picture a second (Android lets its
 * accessibility service take no more), so what a tap does shows a second or two later.
 */
export default function LiveScreen() {
  const { id = '' } = useParams();
  const can = useCan();
  const image = useRef<HTMLImageElement>(null);
  const pressed = useRef<{ x: number; y: number; at: number } | null>(null);
  const [dot, setDot] = useState<{ x: number; y: number; key: number } | null>(null);
  const [text, setText] = useState('');

  const device = useQuery<DeviceSummary>({ queryKey: ['device', id], queryFn: () => api.get(`/api/admin/devices/${id}`), refetchInterval: 10_000 });
  const { byDevice, statuses } = useLive(id ? [id] : [], 'detail');
  const status = byDevice.get(id);

  const input = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post(`/api/admin/live/${id}/input`, body),
    onError: notifyError,
  });
  const screenOn = useMutation({
    mutationFn: () => api.post('/api/admin/commands', { type: 'screen_on', target: { deviceIds: [id] } }),
    onSuccess: () => toast.success('Đã gửi lệnh bật màn hình'),
    onError: notifyError,
  });

  const where = (event: PointerEvent) => {
    const box = image.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)),
      y: Math.min(1, Math.max(0, (event.clientY - box.top) / box.height)),
    };
  };
  const onDown = (event: PointerEvent) => {
    if (!control) return;
    event.preventDefault();
    pressed.current = { ...where(event), at: Date.now() };
  };
  const onUp = (event: PointerEvent) => {
    const start = pressed.current;
    pressed.current = null;
    if (!start || !control) return;
    const end = where(event);
    const moved = Math.hypot(end.x - start.x, end.y - start.y) > MOVE_FRACTION;
    const held = Date.now() - start.at;
    setDot({ x: start.x, y: start.y, key: Date.now() });
    if (moved) input.mutate({ type: 'swipe', x: start.x, y: start.y, x2: end.x, y2: end.y, ms: Math.min(Math.max(held, 120), 1_500) });
    else input.mutate({ type: held >= LONG_PRESS_MS ? 'long_press' : 'tap', x: start.x, y: start.y });
  };

  if (device.isLoading) return <Loading />;
  if (device.error) return <ErrorBox error={device.error} />;
  const d = device.data!;
  const problem = liveProblem(status, d.online);
  const control = can.operate && !!status?.control && !problem;
  const key = (name: string) => input.mutate({ type: 'key', key: name });

  return (
    <>
      <PageHeader
        back={<Link to="/quan-ly/anh-man-hinh" className="inline-flex items-center gap-1 text-sm text-soft hover:text-ink"><ArrowLeft className="size-4" /> Ảnh màn hình</Link>}
        title={d.name}
        hint={
          <span className="flex flex-wrap items-center gap-2">
            <DeviceState device={d} />
            {status?.at ? <span>Ảnh lúc {timeAgo(new Date(status.at).toISOString())}</span> : null}
          </span>
        }
      />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
        <Card className="flex min-h-[320px] items-center justify-center overflow-hidden bg-black p-2">
          {status?.seq ? (
            <div className="relative inline-block max-w-full touch-none select-none">
              <LiveImage
                imgRef={image}
                deviceId={id}
                seq={status.seq}
                alt={`Màn hình của ${d.name}`}
                className={clsx('block max-h-[75vh] w-auto max-w-full', control ? 'cursor-pointer' : 'cursor-default', problem && 'opacity-40')}
              />
              {/* Over the picture, not on it: the image is replaced every second */}
              <div className="absolute inset-0" onPointerDown={onDown} onPointerUp={onUp} onPointerLeave={() => (pressed.current = null)} />
              {dot && (
                <span
                  key={dot.key}
                  className="pointer-events-none absolute size-6 -translate-x-1/2 -translate-y-1/2 animate-ping rounded-full bg-brand/70"
                  style={{ left: `${dot.x * 100}%`, top: `${dot.y * 100}%` }}
                />
              )}
              {problem && <div className="absolute inset-x-0 bottom-0 bg-black/70 px-3 py-2 text-center text-sm text-white">{problem}</div>}
            </div>
          ) : (
            <div className="px-6 py-16 text-center text-sm text-white/80">{statuses.error ? 'Không hỏi được máy chủ' : problem ?? 'Đang chờ ảnh đầu tiên…'}</div>
          )}
        </Card>

        <div className="space-y-4">
          {status?.problem === 'screen_off' && can.operate && (
            <Button className="w-full" busy={screenOn.isPending} onClick={() => screenOn.mutate()}>
              <Sun className="size-4" /> Bật màn hình
            </Button>
          )}
          {can.operate && status && !status.control && !problem && (
            <Notice tone="warn">
              Chỉ xem được: dịch vụ trợ năng FreeKiosk trên máy chưa có quyền thao tác. Tắt rồi bật lại FreeKiosk trong Cài đặt Android, Hỗ trợ tiếp cận,
              hoặc cài lại máy bằng công cụ USB.
            </Notice>
          )}
          <Card className="space-y-3 p-4">
            <div className="text-sm font-semibold">Phím</div>
            <div className="grid grid-cols-3 gap-2">
              <Button variant="outline" disabled={!control} onClick={() => key('back')} title="Quay lại"><ChevronLeft className="size-4" /></Button>
              <Button variant="outline" disabled={!control} onClick={() => key('home')} title="Màn hình chính"><Home className="size-4" /></Button>
              <Button variant="outline" disabled={!control} onClick={() => key('recents')} title="Ứng dụng gần đây"><Square className="size-4" /></Button>
            </div>
            <p className="text-xs text-soft">Chế độ kiosk có thể không cho Màn hình chính và Ứng dụng gần đây.</p>
          </Card>
          <Card className="space-y-3 p-4">
            <div className="text-sm font-semibold">Gõ chữ</div>
            <p className="text-xs text-soft">Chạm vào ô cần nhập trên màn hình trước, rồi gửi chữ.</p>
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (!text) return;
                input.mutate({ type: 'text', text });
                setText('');
              }}
            >
              <Input value={text} onChange={(event) => setText(event.target.value)} disabled={!control} placeholder="Nội dung" maxLength={500} />
              <Button type="submit" disabled={!control || !text}>Gửi</Button>
            </form>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" size="sm" disabled={!control} onClick={() => key('backspace')}><Delete className="size-4" /> Xóa lùi</Button>
              <Button variant="outline" size="sm" disabled={!control} onClick={() => key('enter')}><CornerDownLeft className="size-4" /> Enter</Button>
            </div>
          </Card>
          <p className="text-xs text-soft">
            Chạm vào ảnh để chạm trên máy, kéo để vuốt, giữ lâu để nhấn giữ. Ảnh cập nhật khoảng mỗi giây nên kết quả hiện sau một đến hai giây. Lần mở màn hình này được ghi vào Nhật ký hoạt động.
          </p>
        </div>
      </div>
    </>
  );
}
