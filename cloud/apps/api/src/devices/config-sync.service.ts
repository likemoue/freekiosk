import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { CryptoService, deepMerge } from '../common/crypto.service';
import { DeviceWakeService } from '../common/device-wake.service';
import { PrismaService } from '../common/prisma.service';

export interface SensitiveValues {
  pin?: string;
  mqttPassword?: string;
  restApiKey?: string;
  httpBasicAuthPassword?: string;
}

/**
 * Configuration push: what the dashboard wants a device to change, until the device confirms it.
 *
 * Only the changed keys are sent, never the whole configuration: the app applies what it
 * receives (StorageService.importConfig) and leaves the rest alone, so a setting changed on the
 * tablet a few seconds earlier is not overwritten by an older copy. Several changes made before
 * the device comes back are merged. The device confirms by sending the new `config_version`
 * in a heartbeat, which clears what was pending.
 */
@Injectable()
export class ConfigSyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly wake: DeviceWakeService,
  ) {}

  private clean(sensitive: SensitiveValues | null | undefined): SensitiveValues | null {
    if (!sensitive) return null;
    const out: SensitiveValues = {};
    for (const key of ['pin', 'mqttPassword', 'restApiKey', 'httpBasicAuthPassword'] as const) {
      const value = sensitive[key];
      if (typeof value === 'string' && (key !== 'pin' || value.length > 0)) out[key] = value;
    }
    return Object.keys(out).length ? out : null;
  }

  /** Queues a change for these devices. Returns how many it reached */
  async push(deviceIds: string[], config: Record<string, unknown>, sensitive?: SensitiveValues | null): Promise<number> {
    const secret = this.clean(sensitive);
    if (!deviceIds.length || (!Object.keys(config).length && !secret)) return 0;

    const devices = await this.prisma.device.findMany({
      where: { id: { in: deviceIds } },
      select: { id: true, pendingConfig: true, pendingSensitiveEnc: true },
    });
    await this.prisma.$transaction(
      devices.map((device) => {
        const pendingSecret = { ...this.crypto.decryptJson<SensitiveValues>(device.pendingSensitiveEnc), ...secret };
        return this.prisma.device.update({
          where: { id: device.id },
          data: {
            pendingConfig: deepMerge(device.pendingConfig, config) as Prisma.InputJsonValue,
            pendingSensitiveEnc: Object.keys(pendingSecret).length ? this.crypto.encryptJson(pendingSecret) : null,
            configVersion: { increment: 1 },
          },
        });
      }),
    );
    this.wake.notify(devices.map((device) => device.id), 'config');
    return devices.length;
  }

  /** The devices a profile applies to: assigned directly, or through their group */
  async pushProfile(profileId: string): Promise<number> {
    const profile = await this.prisma.configProfile.findUnique({ where: { id: profileId } });
    if (!profile) return 0;
    const devices = await this.prisma.device.findMany({
      where: {
        OR: [
          { profileId },
          // A profile set on the device itself wins over the one of its group
          { profileId: null, group: { profileId } },
        ],
      },
      select: { id: true },
    });
    return this.push(
      devices.map((d) => d.id),
      profile.config as Record<string, unknown>,
      this.crypto.decryptJson<SensitiveValues>(profile.sensitiveEnc),
    );
  }
}
