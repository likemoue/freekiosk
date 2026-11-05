import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../generated/prisma/client';
import { CryptoService, deepMerge } from '../common/crypto.service';
import { DeviceWakeService } from '../common/device-wake.service';
import { PrismaService } from '../common/prisma.service';
import { APPLY_PROFILE_COMMAND, THROUGH_CONFIG_DAYS } from './catalog';
import { withoutDisplayMode } from './profile-state';

export interface SensitiveValues {
  pin?: string;
  mqttPassword?: string;
  restApiKey?: string;
  httpBasicAuthPassword?: string;
}

/** The line a push leaves in the history of commands, for the heartbeat that confirms it to close */
export interface PushRecord {
  type: string;
  params?: Record<string, unknown>;
  actor?: { id: string | null; email: string | null } | null;
  batchId?: string | null;
  source?: string;
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
  async push(deviceIds: string[], config: Record<string, unknown>, sensitive?: SensitiveValues | null, record?: PushRecord): Promise<number> {
    const secret = this.clean(sensitive);
    if (!deviceIds.length || (!Object.keys(config).length && !secret)) return 0;

    const devices = await this.prisma.device.findMany({
      where: { id: { in: deviceIds } },
      select: { id: true, pendingConfig: true, pendingSensitiveEnc: true },
    });
    const now = new Date();
    await this.prisma.$transaction([
      ...devices.map((device) => {
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
      // Together with the change: a tablet confirms within a second, and a line written after that would stay open
      ...(record
        ? [
            this.prisma.command.createMany({
              data: devices.map((device) => ({
                deviceId: device.id,
                type: record.type,
                params: (record.params ?? {}) as Prisma.InputJsonValue,
                status: 'SENT' as const,
                batchId: record.batchId,
                source: record.source ?? 'manual',
                createdById: record.actor?.id,
                createdBy: record.actor?.email,
                sentAt: now,
                expiresAt: new Date(now.getTime() + THROUGH_CONFIG_DAYS * 86_400_000),
              })),
            }),
          ]
        : []),
    ]);
    this.wake.notify(devices.map((device) => device.id), 'config');
    return devices.length;
  }

  /** A profile for these devices. One playing a list stays in the player, or the list would stop */
  async pushProfileTo(deviceIds: string[], config: Record<string, unknown>, sensitive?: SensitiveValues | null, record?: PushRecord): Promise<number> {
    const devices = await this.prisma.device.findMany({ where: { id: { in: deviceIds } }, select: { id: true, signagePlaylistVersion: true } });
    const playing = devices.filter((d) => d.signagePlaylistVersion).map((d) => d.id);
    const others = devices.filter((d) => !d.signagePlaylistVersion).map((d) => d.id);
    const line = record ? { ...record, batchId: record.batchId ?? randomUUID() } : undefined;
    return (await this.push(others, config, sensitive, line)) + (await this.push(playing, withoutDisplayMode(config), sensitive, line));
  }

  /** The devices a profile applies to: assigned directly, or through their group */
  async pushProfile(profileId: string, actor?: { id: string; email: string }): Promise<number> {
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
    return this.pushProfileTo(
      devices.map((d) => d.id),
      profile.config as Record<string, unknown>,
      this.crypto.decryptJson<SensitiveValues>(profile.sensitiveEnc),
      actor ? { type: APPLY_PROFILE_COMMAND, params: { profile: profile.name }, actor } : undefined,
    );
  }
}
