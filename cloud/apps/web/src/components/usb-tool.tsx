import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Usb } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../api';
import { useCan } from '../auth';
import { bytes, dateTime } from '../format';
import { Button, Card, CardTitle, Empty, ErrorBox, Loading, Notice } from '../ui';
import { UploadButton } from './upload';

interface UsbToolRelease {
  version: string;
  apkVersion: string | null;
  sizeBytes: number;
  sha256: string;
  fileName: string;
  uploadedAt: string;
  uploadedBy: string | null;
}

/** "2026.11.06.1530" as a date a person reads */
function versionDate(version: string): string {
  const match = /^(\d{4})\.(\d{2})\.(\d{2})\.(\d{2})(\d{2})$/.exec(version);
  return match ? `${match[4]}:${match[5]} ngày ${match[3]}/${match[2]}/${match[1]}` : version;
}

/**
 * The tool every installing PC runs (scripts/cai-tablet-usb). Each copy asks for this version when it
 * opens and updates itself, checking the signature its build left in the archive.
 */
export function UsbTool() {
  const can = useCan();
  const client = useQueryClient();
  const current = useQuery<{ release: UsbToolRelease | null }>({ queryKey: ['usb-tool'], queryFn: () => api.get('/api/admin/usb-tool') });
  const release = current.data?.release ?? null;

  return (
    <div className="space-y-5">
      <Notice>
        Công cụ cài tablet qua USB tự hỏi website này mỗi khi mở. Có bản mới hơn thì công cụ tự tải về, kiểm tra chữ ký rồi thay chính nó và
        mở lại, nên máy tính nào đang dùng công cụ cũng nhận bản mới mà không phải chép lại thư mục. Tệp tải lên là tệp
        {' '}<code>CaiTablet-USB-….zip</code> do <code>scripts/cai-tablet-usb/build.ps1</code> tạo ra, ký bằng khóa trên máy build: công cụ từ chối
        mọi tệp khác, kể cả khi website bị chiếm. Kiểm tra cần TLS 1.3, tức Windows 11; trên Windows 10 công cụ vẫn chạy bằng bản đang có.
      </Notice>
      <Card>
        <CardTitle
          title="Bản đang phát hành"
          hint={release ? `Tải lên lúc ${dateTime(release.uploadedAt)}${release.uploadedBy ? ` bởi ${release.uploadedBy}` : ''}` : undefined}
          action={
            <div className="flex flex-wrap gap-2">
              {release && (
                <a href="/usb-tool-download" className="inline-flex">
                  <Button variant="outline">
                    <Download className="size-4" /> Tải về
                  </Button>
                </a>
              )}
              {can.admin && (
                <UploadButton
                  purpose="usb_tool"
                  accept=".zip,application/zip"
                  label="Tải bản mới lên"
                  finish={(id) => api.post(`/api/admin/usb-tool/finish/${id}`, {})}
                  onDone={() => client.invalidateQueries({ queryKey: ['usb-tool'] })}
                  onError={(message) => toast.error(message)}
                />
              )}
            </div>
          }
        />
        <div className="px-5 pb-5">
          {current.isLoading ? (
            <Loading />
          ) : current.error ? (
            <ErrorBox error={current.error} />
          ) : !release ? (
            <Empty
              icon={<Usb />}
              title="Chưa có bản nào"
              hint="Công cụ đang dùng bản trong thư mục của nó. Tải lên tệp .zip do build.ps1 tạo ra để các máy tính tự cập nhật."
            />
          ) : (
            <dl className="grid gap-4 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-xs text-soft">Phiên bản công cụ</dt>
                <dd className="font-semibold">{release.version}</dd>
                <dd className="text-xs text-soft">Build lúc {versionDate(release.version)}</dd>
              </div>
              <div>
                <dt className="text-xs text-soft">FreeKiosk đi kèm</dt>
                <dd className="font-semibold">{release.apkVersion ?? 'Không rõ'}</dd>
                <dd className="text-xs text-soft">Tablet cài qua USB nhận đúng bản này</dd>
              </div>
              <div>
                <dt className="text-xs text-soft">Tệp</dt>
                <dd className="truncate font-semibold" title={release.fileName}>{release.fileName}</dd>
                <dd className="font-mono text-[11px] text-faint" title={`SHA-256 ${release.sha256}`}>
                  {bytes(release.sizeBytes)} · {release.sha256.slice(0, 16)}…
                </dd>
              </div>
            </dl>
          )}
        </div>
      </Card>
    </div>
  );
}
