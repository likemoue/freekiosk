import { BadRequestException, Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { User } from '../generated/prisma/client';
import { Prisma } from '../generated/prisma/client';
import { ActivityService } from '../common/activity.service';
import { CryptoService, enrollmentCode, normalizeCode, sha256 } from '../common/crypto.service';
import { CurrentUser, Roles } from '../common/http';
import { PrismaService } from '../common/prisma.service';
import { SettingsService } from '../common/settings.service';
import { env } from '../config/env';
import { ConfigSyncService, SensitiveValues } from '../devices/config-sync.service';
import { CreateGroupDto, CreateTokenDto, SaveProfileDto, UpdateGroupDto } from '../devices/devices.dto';
import { SignageService } from '../signage/signage.service';

@ApiTags('Nhóm')
@Controller('api/admin/groups')
export class GroupsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configSync: ConfigSyncService,
    private readonly signage: SignageService,
    private readonly activity: ActivityService,
  ) {}

  @Get()
  async list() {
    const groups = await this.prisma.group.findMany({
      orderBy: { name: 'asc' },
      include: {
        profile: { select: { id: true, name: true } },
        playlist: { select: { id: true, name: true } },
        devices: { where: { unenrolledAt: null }, select: { online: true } },
      },
    });
    return groups.map(({ devices, ...group }) => ({
      ...group,
      deviceCount: devices.length,
      onlineCount: devices.filter((d) => d.online).length,
    }));
  }

  private async assertNameFree(name: string, id?: string): Promise<void> {
    const taken = await this.prisma.group.findFirst({ where: { name, id: id ? { not: id } : undefined } });
    if (taken) throw new BadRequestException('Tên nhóm đã tồn tại');
  }

  @Post()
  @Roles('ADMIN', 'OPERATOR')
  async create(@Body() dto: CreateGroupDto, @CurrentUser() actor: User) {
    const name = dto.name.trim();
    await this.assertNameFree(name);
    const group = await this.prisma.group.create({ data: { ...dto, name } });
    await this.activity.log({ action: 'group.created', message: `${actor.email} đã tạo nhóm ${name}`, user: actor });
    return group;
  }

  @Patch(':id')
  @Roles('ADMIN', 'OPERATOR')
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateGroupDto, @CurrentUser() actor: User) {
    const before = await this.prisma.group.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Không tìm thấy nhóm');
    const name = dto.name?.trim();
    if (name) await this.assertNameFree(name, id);
    const group = await this.prisma.group.update({ where: { id }, data: { ...dto, name } });
    if (dto.profileId && dto.profileId !== before.profileId) await this.configSync.pushProfile(dto.profileId);
    if (dto.playlistId !== undefined) this.signage.invalidate();
    await this.activity.log({ action: 'group.updated', message: `${actor.email} đã cập nhật nhóm ${group.name}`, user: actor });
    return group;
  }

  @Delete(':id')
  @Roles('ADMIN', 'OPERATOR')
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: User) {
    const group = await this.prisma.group.findUnique({ where: { id } });
    if (!group) throw new NotFoundException('Không tìm thấy nhóm');
    await this.prisma.group.delete({ where: { id } });
    this.signage.invalidate();
    await this.activity.log({ action: 'group.deleted', severity: 'warning', message: `${actor.email} đã xóa nhóm ${group.name}`, user: actor });
    return { ok: true };
  }
}

@ApiTags('Hồ sơ cấu hình')
@Controller('api/admin/profiles')
export class ProfilesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly configSync: ConfigSyncService,
    private readonly activity: ActivityService,
  ) {}

  private view<T extends { sensitiveEnc: string | null }>(profile: T) {
    const { sensitiveEnc, ...rest } = profile;
    const secret = this.crypto.decryptJson<SensitiveValues>(sensitiveEnc);
    return {
      ...rest,
      secrets: {
        pin: !!secret?.pin,
        mqttPassword: !!secret?.mqttPassword,
        restApiKey: !!secret?.restApiKey,
        httpBasicAuthPassword: !!secret?.httpBasicAuthPassword,
      },
    };
  }

  @Get()
  async list() {
    const profiles = await this.prisma.configProfile.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { devices: true, groups: true } } },
    });
    return profiles.map((p) => this.view(p));
  }

  @Post()
  @Roles('ADMIN', 'OPERATOR')
  async create(@Body() dto: SaveProfileDto, @CurrentUser() actor: User) {
    const name = dto.name.trim();
    if (await this.prisma.configProfile.findUnique({ where: { name } })) throw new BadRequestException('Tên hồ sơ đã tồn tại');
    const profile = await this.prisma.configProfile.create({
      data: {
        name,
        description: dto.description,
        config: dto.config as Prisma.InputJsonValue,
        sensitiveEnc: dto.sensitive && Object.keys(dto.sensitive).length ? this.crypto.encryptJson(dto.sensitive) : null,
      },
    });
    await this.activity.log({ action: 'profile.created', message: `${actor.email} đã tạo hồ sơ ${name}`, user: actor });
    return this.view(profile);
  }

  /** A profile is live: saving it sends the change to every device that uses it */
  @Put(':id')
  @Roles('ADMIN', 'OPERATOR')
  async save(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SaveProfileDto, @CurrentUser() actor: User) {
    const before = await this.prisma.configProfile.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Không tìm thấy hồ sơ');
    const name = dto.name.trim();
    const taken = await this.prisma.configProfile.findFirst({ where: { name, id: { not: id } } });
    if (taken) throw new BadRequestException('Tên hồ sơ đã tồn tại');
    // A secret left empty in the form keeps its value
    const secret = { ...this.crypto.decryptJson<SensitiveValues>(before.sensitiveEnc), ...dto.sensitive };
    const profile = await this.prisma.configProfile.update({
      where: { id },
      data: {
        name,
        description: dto.description,
        config: dto.config as Prisma.InputJsonValue,
        sensitiveEnc: Object.keys(secret).length ? this.crypto.encryptJson(secret) : null,
      },
    });
    const count = await this.configSync.pushProfile(id);
    await this.activity.log({ action: 'profile.updated', message: `${actor.email} đã lưu hồ sơ ${name}, áp dụng cho ${count} thiết bị`, user: actor });
    return { ...this.view(profile), appliedTo: count };
  }

  @Delete(':id')
  @Roles('ADMIN', 'OPERATOR')
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: User) {
    const profile = await this.prisma.configProfile.findUnique({ where: { id } });
    if (!profile) throw new NotFoundException('Không tìm thấy hồ sơ');
    await this.prisma.configProfile.delete({ where: { id } });
    await this.activity.log({ action: 'profile.deleted', severity: 'warning', message: `${actor.email} đã xóa hồ sơ ${profile.name}`, user: actor });
    return { ok: true };
  }
}

@ApiTags('Đăng ký thiết bị')
@Controller('api/admin/enrollment')
export class EnrollmentController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly settings: SettingsService,
    private readonly activity: ActivityService,
  ) {}

  private view(row: Prisma.EnrollmentTokenGetPayload<{ include: { group: { select: { id: true; name: true } }; profile: { select: { id: true; name: true } } } }>) {
    const { tokenHash: _hash, tokenEnc, ...rest } = row;
    const active = !row.revokedAt && row.expiresAt > new Date() && row.usedCount < row.maxUses;
    return { ...rest, active, token: active ? this.crypto.decrypt(tokenEnc) : null };
  }

  @Get('tokens')
  @Roles('ADMIN', 'OPERATOR')
  async tokens() {
    const rows = await this.prisma.enrollmentToken.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { group: { select: { id: true, name: true } }, profile: { select: { id: true, name: true } } },
    });
    return rows.map((r) => this.view(r));
  }

  @Post('tokens')
  @Roles('ADMIN', 'OPERATOR')
  async create(@Body() dto: CreateTokenDto, @CurrentUser() actor: User) {
    const token = normalizeCode(enrollmentCode());
    const row = await this.prisma.enrollmentToken.create({
      data: {
        label: dto.label?.trim() || null,
        tokenHash: sha256(token),
        tokenEnc: this.crypto.encrypt(token),
        groupId: dto.groupId,
        profileId: dto.profileId,
        maxUses: dto.maxUses ?? 1,
        expiresAt: new Date(Date.now() + (dto.validHours ?? env().enrollmentTokenHours) * 3_600_000),
        createdById: actor.id,
      },
      include: { group: { select: { id: true, name: true } }, profile: { select: { id: true, name: true } } },
    });
    await this.activity.log({ action: 'token.created', message: `${actor.email} đã tạo mã đăng ký thiết bị`, user: actor });
    return this.view(row);
  }

  @Post('tokens/:id/revoke')
  @HttpCode(200)
  @Roles('ADMIN', 'OPERATOR')
  async revoke(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: User) {
    await this.prisma.enrollmentToken.update({ where: { id }, data: { revokedAt: new Date() } });
    await this.activity.log({ action: 'token.revoked', message: `${actor.email} đã thu hồi một mã đăng ký`, user: actor });
    return { ok: true };
  }

  /**
   * The contents of the QR codes for this token. `app` is read by the scanner in the app (it fills
   * both fields of the enrollment form). `provisioning` is read by the Android setup wizard on a
   * new or factory-reset tablet: it downloads the APK, checks it against the checksum, makes
   * FreeKiosk the Device Owner, and hands the extras bundle to DeviceAdminReceiver.
   */
  @Get('tokens/:id/qr')
  @Roles('ADMIN', 'OPERATOR')
  async qr(@Param('id', ParseUUIDPipe) id: string) {
    const row = await this.prisma.enrollmentToken.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Không tìm thấy mã đăng ký');
    const token = this.crypto.decrypt(row.tokenEnc);
    const { publicUrl } = env();
    const [organization, apk] = await Promise.all([
      this.settings.organization(),
      this.prisma.apkPackage.findFirst({ where: { isProvisioning: true }, orderBy: { createdAt: 'desc' } }),
    ]);
    return {
      serverUrl: publicUrl,
      token,
      adb: `adb shell am start -n com.freekiosk/.MainActivity --es pin "1234" --es cloud_url "${publicUrl}" --es cloud_token "${token}"`,
      app: JSON.stringify({ url: publicUrl, token }),
      provisioning: apk
        ? JSON.stringify({
            'android.app.extra.PROVISIONING_DEVICE_ADMIN_COMPONENT_NAME': 'com.freekiosk/.DeviceAdminReceiver',
            'android.app.extra.PROVISIONING_DEVICE_ADMIN_PACKAGE_DOWNLOAD_LOCATION': `${publicUrl}/dpc-apk-download/`,
            'android.app.extra.PROVISIONING_DEVICE_ADMIN_PACKAGE_CHECKSUM': apk.checksumBase64,
            'android.app.extra.PROVISIONING_LEAVE_ALL_SYSTEM_APPS_ENABLED': true,
            'android.app.extra.PROVISIONING_SKIP_ENCRYPTION': true,
            'android.app.extra.PROVISIONING_ADMIN_EXTRAS_BUNDLE': { enroll_token: token, cloud_url: publicUrl, org_id: organization.id },
          })
        : null,
      provisioningApk: apk ? { id: apk.id, fileName: apk.fileName, versionName: apk.versionName } : null,
    };
  }
}
