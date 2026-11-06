import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { env } from '../config/env';
import type { UsbToolRelease } from '../files/usb-tool';
import { PrismaService } from './prisma.service';

export interface OrganizationSettings {
  name: string;
  /** Sent in the provisioning QR, so a tablet can tell which organization it joined */
  id: string;
}

export interface AlertSettings {
  offlineMinutes: number;
  batteryLow: number;
  batteryCritical: number;
  storageLowMb: number;
  notifyResolved: boolean;
  /** The kinds of alert switched off */
  disabled: string[];
}

export interface SmtpSettings {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  passwordEnc: string | null;
  from: string;
}

export interface LocationSettings {
  /** Tablets report where they are, for the map. On unless switched off */
  enabled: boolean;
}

/** Read at every heartbeat of every tablet: kept here for a short while rather than asked each time */
const LOCATION_CACHE_MS = 10_000;

const ALERT_DEFAULTS: AlertSettings = {
  offlineMinutes: 5,
  batteryLow: 20,
  batteryCritical: 10,
  storageLowMb: 500,
  notifyResolved: true,
  disabled: [],
};

@Injectable()
export class SettingsService {
  private locationCache: { value: LocationSettings; at: number } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  private async read<T>(key: string): Promise<T | null> {
    const row = await this.prisma.appSetting.findUnique({ where: { key } });
    return (row?.value as T | undefined) ?? null;
  }

  private async write(key: string, value: unknown): Promise<void> {
    const json = value as Prisma.InputJsonValue;
    await this.prisma.appSetting.upsert({
      where: { key },
      create: { key, value: json },
      update: { value: json },
    });
  }

  async organization(): Promise<OrganizationSettings> {
    const stored = await this.read<OrganizationSettings>('organization');
    if (stored) return stored;
    const created = { name: env().orgName, id: crypto.randomUUID() };
    await this.write('organization', created);
    return created;
  }

  async saveOrganization(name: string): Promise<OrganizationSettings> {
    const next = { ...(await this.organization()), name };
    await this.write('organization', next);
    return next;
  }

  async alerts(): Promise<AlertSettings> {
    return { ...ALERT_DEFAULTS, ...(await this.read<Partial<AlertSettings>>('alerts')) };
  }

  async saveAlerts(settings: Partial<AlertSettings>): Promise<AlertSettings> {
    const next = { ...(await this.alerts()), ...settings };
    await this.write('alerts', next);
    return next;
  }

  async location(): Promise<LocationSettings> {
    const cached = this.locationCache;
    if (cached && Date.now() - cached.at < LOCATION_CACHE_MS) return cached.value;
    const value = { enabled: true, ...(await this.read<Partial<LocationSettings>>('location')) };
    this.locationCache = { value, at: Date.now() };
    return value;
  }

  async saveLocation(settings: LocationSettings): Promise<LocationSettings> {
    const value = { enabled: settings.enabled };
    await this.write('location', value);
    this.locationCache = { value, at: Date.now() };
    return value;
  }

  /** The newest USB install tool uploaded, which every copy of the tool updates itself to */
  usbTool(): Promise<UsbToolRelease | null> {
    return this.read<UsbToolRelease>('usbTool');
  }

  saveUsbTool(release: UsbToolRelease): Promise<void> {
    return this.write('usbTool', release);
  }

  smtp(): Promise<SmtpSettings | null> {
    return this.read<SmtpSettings>('smtp');
  }

  async saveSmtp(settings: SmtpSettings | null): Promise<void> {
    if (settings) await this.write('smtp', settings);
    else await this.prisma.appSetting.deleteMany({ where: { key: 'smtp' } });
  }
}
