import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { CalendarClock, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { api } from '../api';
import { useCan } from '../auth';
import { COMMAND_LABELS } from '../components/commands';
import { DeviceSummary } from '../components/device';
import { dateTime, daysText, WEEKDAYS } from '../format';
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Loading, Modal, notifyError, PageHeader, Select, Switch, Table, td, th, trow, useConfirm } from '../ui';

// What can run with nobody watching: no secret to keep in a schedule, and no code to run blind
const SCHEDULABLE = [
  { type: 'reload' },
  { type: 'screen_on' },
  { type: 'screen_off' },
  { type: 'wake' },
  { type: 'reboot' },
  { type: 'screenshot' },
  { type: 'clear_cache' },
  { type: 'screensaver_on' },
  { type: 'screensaver_off' },
  { type: 'audio_stop' },
  { type: 'toast', param: 'message', paramLabel: 'Nội dung thông báo' },
  { type: 'speak', param: 'text', paramLabel: 'Văn bản cần đọc' },
  { type: 'play_sound', param: 'url', paramLabel: 'URL âm thanh' },
  { type: 'launch_app', param: 'package_name', paramLabel: 'Tên gói ứng dụng' },
];

const BLANK = { name: '', commandType: 'reload', paramValue: '', targetType: 'all', groupId: '', deviceIds: [] as string[], days: [1, 2, 3, 4, 5], time: '07:00', enabled: true };

export default function Scheduler() {
  const can = useCan();
  const confirm = useConfirm();
  const client = useQueryClient();
  const [form, setForm] = useState<(typeof BLANK & { id?: string }) | null>(null);

  const tasks = useQuery<any[]>({ queryKey: ['tasks'], queryFn: () => api.get('/api/admin/scheduler/tasks'), refetchInterval: 30_000 });
  const groups = useQuery<any[]>({ queryKey: ['groups'], queryFn: () => api.get('/api/admin/groups') });
  const devices = useQuery<DeviceSummary[]>({ queryKey: ['devices'], queryFn: () => api.get('/api/admin/devices') });
  const refresh = () => client.invalidateQueries({ queryKey: ['tasks'] });

  const spec = SCHEDULABLE.find((c) => c.type === form?.commandType);

  const body = (f: typeof BLANK) => {
    const current = SCHEDULABLE.find((c) => c.type === f.commandType);
    return {
      name: f.name,
      enabled: f.enabled,
      commandType: f.commandType,
      params: current?.param ? { [current.param]: f.paramValue } : {},
      targetType: f.targetType,
      groupId: f.targetType === 'group' ? f.groupId : undefined,
      deviceIds: f.targetType === 'devices' ? f.deviceIds : undefined,
      days: f.days,
      time: f.time,
    };
  };

  const save = useMutation({
    mutationFn: () => (form!.id ? api.put(`/api/admin/scheduler/tasks/${form!.id}`, body(form!)) : api.post('/api/admin/scheduler/tasks', body(form!))),
    onSuccess: () => { toast.success('Đã lưu lịch'); setForm(null); refresh(); },
    onError: notifyError,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/admin/scheduler/tasks/${id}`),
    onSuccess: () => { toast.success('Đã xóa lịch'); refresh(); },
    onError: notifyError,
  });

  const fromTask = (task: any) => {
    const current = SCHEDULABLE.find((c) => c.type === task.commandType);
    return { ...BLANK, id: task.id, name: task.name, commandType: task.commandType, paramValue: current?.param ? (task.params?.[current.param] ?? '') : '', targetType: task.targetType, groupId: task.groupId ?? '', deviceIds: task.deviceIds ?? [], days: task.days, time: task.time, enabled: task.enabled };
  };

  const toggle = useMutation({
    mutationFn: (task: any) => api.put(`/api/admin/scheduler/tasks/${task.id}`, body({ ...fromTask(task), enabled: !task.enabled })),
    onSuccess: refresh,
    onError: notifyError,
  });

  const targetText = (task: any) => {
    if (task.targetType === 'all') return 'Tất cả thiết bị';
    if (task.targetType === 'group') return `Nhóm ${groups.data?.find((g) => g.id === task.groupId)?.name ?? ''}`;
    return `${task.deviceIds.length} thiết bị`;
  };

  return (
    <>
      <PageHeader
        title="Lịch hẹn giờ"
        hint="Tự động gửi lệnh theo ngày và giờ, ví dụ tắt màn hình lúc tan giờ, khởi động lại mỗi đêm."
        action={can.operate && <Button onClick={() => setForm({ ...BLANK })}><Plus className="size-4" /> Lịch mới</Button>}
      />
      <Card>
        {tasks.isLoading ? <Loading /> : tasks.error ? <div className="p-4"><ErrorBox error={tasks.error} /></div> : !tasks.data?.length ? (
          <Empty icon={<CalendarClock />} title="Chưa có lịch nào" hint="Tạo lịch để các thao tác lặp lại tự chạy." action={can.operate && <Button onClick={() => setForm({ ...BLANK })}>Tạo lịch</Button>} />
        ) : (
          <Table>
            <thead><tr><th className={th}>Bật</th><th className={th}>Tên</th><th className={th}>Lệnh</th><th className={th}>Đối tượng</th><th className={th}>Thời gian</th><th className={th}>Lần chạy kế</th><th className={th} /></tr></thead>
            <tbody>
              {tasks.data.map((task) => (
                <tr key={task.id} className={trow}>
                  <td className={td}><Switch label={`Bật ${task.name}`} disabled={!can.operate} checked={task.enabled} onChange={() => toggle.mutate(task)} /></td>
                  <td className={clsx(td, 'font-semibold')}>{task.name}</td>
                  <td className={td}><Badge tone="info">{COMMAND_LABELS[task.commandType] ?? task.commandType}</Badge></td>
                  <td className={clsx(td, 'text-soft')}>{targetText(task)}</td>
                  <td className={clsx(td, 'whitespace-nowrap')}>{task.time} · {daysText(task.days)}</td>
                  <td className={clsx(td, 'text-soft')}>{task.enabled ? dateTime(task.nextRunAt) : 'Đang tắt'}</td>
                  <td className={clsx(td, 'text-right whitespace-nowrap')}>
                    {can.operate && (
                      <>
                        <button aria-label={`Sửa ${task.name}`} className="rounded-lg p-1.5 text-soft hover:bg-raised" onClick={() => setForm(fromTask(task))}><Pencil className="size-4" /></button>
                        <button aria-label={`Xóa ${task.name}`} className="rounded-lg p-1.5 text-soft hover:bg-raised hover:text-bad" onClick={async () => {
                          if (await confirm({ title: `Xóa lịch "${task.name}"?`, confirm: 'Xóa', danger: true })) remove.mutate(task.id);
                        }}><Trash2 className="size-4" /></button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Modal
        open={!!form}
        onClose={() => setForm(null)}
        title={form?.id ? 'Sửa lịch' : 'Lịch mới'}
        hint="Giờ tính theo múi giờ Việt Nam (Asia/Ho_Chi_Minh)."
        footer={<><Button variant="outline" onClick={() => setForm(null)}>Hủy</Button><Button disabled={!form?.name.trim() || !form?.days.length || (!!spec?.param && !form?.paramValue.trim()) || (form?.targetType === 'group' && !form?.groupId) || (form?.targetType === 'devices' && !form?.deviceIds.length)} busy={save.isPending} onClick={() => save.mutate()}>Lưu</Button></>}
      >
        {form && (
          <div className="space-y-4">
            <Field label="Tên lịch"><Input autoFocus placeholder="Ví dụ: Tắt màn hình cuối ngày" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Lệnh">
              <Select value={form.commandType} onChange={(e) => setForm({ ...form, commandType: e.target.value, paramValue: '' })}>
                {SCHEDULABLE.map((c) => <option key={c.type} value={c.type}>{COMMAND_LABELS[c.type] ?? c.type}</option>)}
              </Select>
            </Field>
            {spec?.param && <Field label={spec.paramLabel}><Input value={form.paramValue} onChange={(e) => setForm({ ...form, paramValue: e.target.value })} /></Field>}
            <Field label="Đối tượng">
              <Select value={form.targetType} onChange={(e) => setForm({ ...form, targetType: e.target.value })}>
                <option value="all">Tất cả thiết bị</option>
                <option value="group">Một nhóm</option>
                <option value="devices">Chọn thiết bị</option>
              </Select>
            </Field>
            {form.targetType === 'group' && (
              <Field label="Nhóm">
                <Select value={form.groupId} onChange={(e) => setForm({ ...form, groupId: e.target.value })}>
                  <option value="">Chọn nhóm…</option>
                  {groups.data?.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </Select>
              </Field>
            )}
            {form.targetType === 'devices' && (
              <div className="max-h-44 space-y-1 overflow-y-auto rounded-xl border border-line p-3">
                {devices.data?.filter((d) => !d.unenrolledAt).map((device) => (
                  <label key={device.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" className="size-4 accent-brand-strong" checked={form.deviceIds.includes(device.id)} onChange={(e) => setForm({ ...form, deviceIds: e.target.checked ? [...form.deviceIds, device.id] : form.deviceIds.filter((id) => id !== device.id) })} />
                    {device.name}
                  </label>
                ))}
              </div>
            )}
            <div>
              <span className="mb-1.5 block text-[13px] font-semibold">Các ngày</span>
              <div className="flex flex-wrap gap-1.5">
                {WEEKDAYS.map((day) => {
                  const on = form.days.includes(day.value);
                  return (
                    <button key={day.value} type="button" aria-pressed={on} aria-label={day.label} className={clsx('size-10 rounded-xl border text-[13px] font-semibold', on ? 'border-brand-strong bg-brand-strong text-white' : 'border-line hover:bg-raised')} onClick={() => setForm({ ...form, days: on ? form.days.filter((d) => d !== day.value) : [...form.days, day.value] })}>
                      {day.short}
                    </button>
                  );
                })}
              </div>
            </div>
            <Field label="Giờ chạy"><Input type="time" className="w-36" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} /></Field>
          </div>
        )}
      </Modal>
    </>
  );
}
