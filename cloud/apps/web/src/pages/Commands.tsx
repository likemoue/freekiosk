import { useQuery } from '@tanstack/react-query';
import { FolderClosed, ListChecks, Smartphone } from 'lucide-react';
import { useState } from 'react';
import { api } from '../api';
import { CommandHistory, CommandPicker, DeviceSelect, Target } from '../components/commands';
import { DeviceSummary } from '../components/device';
import { Card, PageHeader, Pills, Select } from '../ui';

export default function Commands() {
  const [scope, setScope] = useState<'device' | 'group' | 'all'>('device');
  const [deviceId, setDeviceId] = useState('');
  const [groupId, setGroupId] = useState('');

  const devices = useQuery<DeviceSummary[]>({ queryKey: ['devices'], queryFn: () => api.get('/api/admin/devices') });
  const groups = useQuery<any[]>({ queryKey: ['groups'], queryFn: () => api.get('/api/admin/groups') });
  const enrolled = (devices.data ?? []).filter((d) => !d.unenrolledAt);

  const target: Target | null =
    scope === 'all' ? { all: true } : scope === 'group' ? (groupId ? { groupId } : null) : deviceId ? { deviceIds: [deviceId] } : null;
  const one = scope === 'device' ? enrolled.filter((d) => d.id === deviceId) : undefined;

  return (
    <>
      <PageHeader title="Lệnh" hint="Gửi một thao tác tới một thiết bị, một nhóm, hoặc toàn bộ." />
      <Card className="p-5">
        <h2 className="mb-3 text-[15px] font-bold">Chọn đối tượng</h2>
        <Pills
          value={scope}
          onChange={setScope}
          options={[
            { id: 'device', label: 'Một thiết bị', icon: <Smartphone className="size-4" /> },
            { id: 'group', label: 'Một nhóm', icon: <FolderClosed className="size-4" /> },
            { id: 'all', label: `Tất cả (${enrolled.length})`, icon: <ListChecks className="size-4" /> },
          ]}
        />
        <div className="mt-3 max-w-md">
          {scope === 'device' && <DeviceSelect value={deviceId} onChange={setDeviceId} devices={enrolled} />}
          {scope === 'group' && (
            <Select aria-label="Chọn nhóm" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
              <option value="">Chọn nhóm…</option>
              {groups.data?.map((g) => <option key={g.id} value={g.id}>{g.name} ({g.deviceCount})</option>)}
            </Select>
          )}
        </div>
        {scope === 'device' && enrolled.length === 0 && <p className="mt-2 text-[13px] text-warn">Bạn chưa có thiết bị nào.</p>}
      </Card>

      <Card className="mt-5 p-5">
        <h2 className="mb-3 text-[15px] font-bold">Lệnh</h2>
        <CommandPicker target={target} devices={one} />
      </Card>

      <Card className="mt-5">
        <CommandHistory showDevice />
      </Card>
    </>
  );
}
