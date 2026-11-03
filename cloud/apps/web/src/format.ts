const DATE_TIME = new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' });

export function dateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  return DATE_TIME.format(new Date(value));
}

export function timeAgo(value: string | Date | null | undefined): string {
  if (!value) return 'chưa có';
  const seconds = Math.round((Date.now() - new Date(value).getTime()) / 1000);
  if (seconds < 0) return dateTime(value);
  if (seconds < 10) return 'vừa xong';
  if (seconds < 60) return `${seconds} giây trước`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} phút trước`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} giờ trước`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} ngày trước`;
  return dateTime(value);
}

export function bytes(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = value;
  let unit = -1;
  do {
    size /= 1024;
    unit += 1;
  } while (size >= 1024 && unit < units.length - 1);
  return `${size >= 10 ? Math.round(size) : size.toFixed(1)} ${units[unit]}`;
}

export function megabytes(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : bytes(value * 1024 * 1024);
}

export function duration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '—';
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days) return `${days} ngày ${hours} giờ`;
  if (hours) return `${hours} giờ ${minutes} phút`;
  return `${minutes} phút`;
}

export const WEEKDAYS: Array<{ value: number; short: string; label: string }> = [
  { value: 1, short: 'T2', label: 'Thứ Hai' },
  { value: 2, short: 'T3', label: 'Thứ Ba' },
  { value: 3, short: 'T4', label: 'Thứ Tư' },
  { value: 4, short: 'T5', label: 'Thứ Năm' },
  { value: 5, short: 'T6', label: 'Thứ Sáu' },
  { value: 6, short: 'T7', label: 'Thứ Bảy' },
  { value: 7, short: 'CN', label: 'Chủ nhật' },
];

export function daysText(days: number[]): string {
  if (days.length === 7) return 'Mỗi ngày';
  if (days.length === 5 && [1, 2, 3, 4, 5].every((d) => days.includes(d))) return 'Ngày thường';
  if (days.length === 2 && days.includes(6) && days.includes(7)) return 'Cuối tuần';
  return WEEKDAYS.filter((d) => days.includes(d.value)).map((d) => d.short).join(', ');
}

export const COMMAND_STATUS: Record<string, { label: string; tone: 'ok' | 'bad' | 'warn' | 'info' | 'neutral' }> = {
  PENDING: { label: 'Đang chờ', tone: 'neutral' },
  SENT: { label: 'Đã gửi', tone: 'info' },
  SUCCESS: { label: 'Thành công', tone: 'ok' },
  ERROR: { label: 'Lỗi', tone: 'bad' },
  EXPIRED: { label: 'Hết hạn', tone: 'warn' },
  CANCELLED: { label: 'Đã hủy', tone: 'neutral' },
};
