import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { Request } from 'express';
import type { User } from '../generated/prisma/client';
import { ActivityService } from '../common/activity.service';
import { CryptoService, randomToken, sha256 } from '../common/crypto.service';
import { clientIp } from '../common/http';
import { PrismaService } from '../common/prisma.service';
import { env } from '../config/env';
import { CreateUserDto, LoginDto, UpdateUserDto } from './auth.dto';

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
export const SESSION_COOKIE = 'fk_session';

export type PublicUser = ReturnType<AuthService['toPublic']>;

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly activity: ActivityService,
  ) {}

  /** The first administrator comes from the environment, so no sign-up page is ever open */
  async onModuleInit(): Promise<void> {
    if ((await this.prisma.user.count()) > 0) return;
    const { adminEmail, adminPassword } = env();
    if (!adminEmail || !adminPassword) {
      this.logger.warn('Chưa có người dùng nào: đặt ADMIN_EMAIL và ADMIN_PASSWORD rồi khởi động lại');
      return;
    }
    await this.prisma.user.create({
      data: {
        email: adminEmail,
        name: 'Quản trị viên',
        role: 'ADMIN',
        mustChangePassword: true,
        passwordHash: await this.crypto.hashPassword(adminPassword),
      },
    });
    this.logger.log(`Đã tạo tài khoản quản trị đầu tiên: ${adminEmail}`);
  }

  toPublic(user: User) {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      isActive: user.isActive,
      totpEnabled: user.totpEnabled,
      mustChangePassword: user.mustChangePassword,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
    };
  }

  /**
   * Signs in. `requires2fa` tells the page to ask for the code and send everything again:
   * nothing is kept between the two calls, so the code never stands in for the password.
   */
  async login(dto: LoginDto, req: Request): Promise<{ requires2fa: true } | { token: string; expiresAt: Date; user: User }> {
    const email = dto.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });
    const ip = clientIp(req);
    const refused = new UnauthorizedException('Email hoặc mật khẩu không đúng');

    if (!user || !user.isActive) {
      // Same work as a real account, so the answer time does not reveal which emails exist
      await this.crypto.hashPassword(dto.password);
      await this.activity.log({ action: 'user.login_failed', severity: 'warning', message: `Đăng nhập thất bại: ${email}`, ip });
      throw refused;
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new ForbiddenException(`Tài khoản tạm khóa do nhập sai nhiều lần. Thử lại sau ${LOCK_MINUTES} phút.`);
    }

    if (!(await this.crypto.verifyPassword(dto.password, user.passwordHash))) {
      await this.recordFailure(user, ip);
      throw refused;
    }

    if (user.totpEnabled) {
      if (!dto.code) return { requires2fa: true };
      if (!(await this.checkSecondFactor(user, dto.code))) {
        await this.recordFailure(user, ip);
        throw new UnauthorizedException('Mã xác thực không đúng');
      }
    }

    const token = randomToken();
    const days = dto.remember ? 30 : env().sessionDays;
    const expiresAt = new Date(Date.now() + days * 86_400_000);
    await this.prisma.$transaction([
      this.prisma.session.create({
        data: {
          tokenHash: sha256(token),
          userId: user.id,
          expiresAt,
          ip,
          userAgent: req.headers['user-agent']?.slice(0, 300),
        },
      }),
      this.prisma.user.update({
        where: { id: user.id },
        data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() },
      }),
    ]);
    await this.activity.log({ action: 'user.login', message: `${user.email} đã đăng nhập`, user, ip });
    return { token, expiresAt, user };
  }

  private async recordFailure(user: User, ip: string | null): Promise<void> {
    const failedLogins = user.failedLogins + 1;
    const locked = failedLogins >= MAX_FAILED_LOGINS;
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        failedLogins: locked ? 0 : failedLogins,
        lockedUntil: locked ? new Date(Date.now() + LOCK_MINUTES * 60_000) : undefined,
      },
    });
    await this.activity.log({
      action: locked ? 'user.locked' : 'user.login_failed',
      severity: 'warning',
      message: locked ? `Tài khoản ${user.email} bị tạm khóa do nhập sai nhiều lần` : `Đăng nhập thất bại: ${user.email}`,
      user,
      ip,
    });
  }

  private async checkSecondFactor(user: User, code: string): Promise<boolean> {
    const secret = user.totpSecretEnc ? this.crypto.decrypt(user.totpSecretEnc) : null;
    if (secret && this.crypto.verifyTotp(secret, code)) return true;
    const hash = sha256(code.trim().toLowerCase());
    if (!user.recoveryCodes.includes(hash)) return false;
    await this.prisma.user.update({
      where: { id: user.id },
      data: { recoveryCodes: user.recoveryCodes.filter((c) => c !== hash) },
    });
    return true;
  }

  async userFromToken(token: string | undefined): Promise<{ user: User; sessionId: string } | null> {
    if (!token) return null;
    const session = await this.prisma.session.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
    if (!session || session.expiresAt < new Date() || !session.user.isActive) return null;
    // Once a minute is enough, and spares a write on every poll of the dashboard
    if (Date.now() - session.lastSeenAt.getTime() > 60_000) {
      await this.prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } }).catch(() => {});
    }
    return { user: session.user, sessionId: session.id };
  }

  async logout(sessionId: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { id: sessionId } });
  }

  async changePassword(user: User, current: string, next: string, keepSessionId: string): Promise<void> {
    if (!(await this.crypto.verifyPassword(current, user.passwordHash))) {
      throw new BadRequestException('Mật khẩu hiện tại không đúng');
    }
    if (current === next) throw new BadRequestException('Mật khẩu mới phải khác mật khẩu hiện tại');
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await this.crypto.hashPassword(next), mustChangePassword: false },
    });
    // Any other browser signed in with the old password is signed out
    await this.prisma.session.deleteMany({ where: { userId: user.id, id: { not: keepSessionId } } });
    await this.activity.log({ action: 'user.password_changed', message: `${user.email} đã đổi mật khẩu`, user });
  }

  async startTotpSetup(user: User): Promise<{ secret: string; otpauthUrl: string }> {
    if (user.totpEnabled) throw new BadRequestException('Xác thực hai lớp đang bật');
    const secret = this.crypto.newTotpSecret();
    await this.prisma.user.update({ where: { id: user.id }, data: { totpSecretEnc: this.crypto.encrypt(secret) } });
    const label = encodeURIComponent(`FreeKiosk Manager:${user.email}`);
    return { secret, otpauthUrl: `otpauth://totp/${label}?secret=${secret}&issuer=FreeKiosk%20Manager&digits=6&period=30` };
  }

  async enableTotp(user: User, code: string): Promise<{ recoveryCodes: string[] }> {
    if (user.totpEnabled) throw new BadRequestException('Xác thực hai lớp đang bật');
    const secret = user.totpSecretEnc ? this.crypto.decrypt(user.totpSecretEnc) : null;
    if (!secret || !this.crypto.verifyTotp(secret, code)) throw new BadRequestException('Mã xác thực không đúng');
    const recoveryCodes = Array.from({ length: 8 }, () => randomBytes(5).toString('hex'));
    await this.prisma.user.update({
      where: { id: user.id },
      data: { totpEnabled: true, recoveryCodes: recoveryCodes.map(sha256) },
    });
    await this.activity.log({ action: 'user.2fa_enabled', message: `${user.email} đã bật xác thực hai lớp`, user });
    return { recoveryCodes };
  }

  async disableTotp(user: User, password: string): Promise<void> {
    if (!(await this.crypto.verifyPassword(password, user.passwordHash))) {
      throw new BadRequestException('Mật khẩu không đúng');
    }
    await this.prisma.user.update({
      where: { id: user.id },
      data: { totpEnabled: false, totpSecretEnc: null, recoveryCodes: [] },
    });
    await this.activity.log({ action: 'user.2fa_disabled', severity: 'warning', message: `${user.email} đã tắt xác thực hai lớp`, user });
  }

  // ─── Team ─────────────────────────────────────────────────────────────────

  async listUsers() {
    const users = await this.prisma.user.findMany({ orderBy: { createdAt: 'asc' } });
    return users.map((u) => this.toPublic(u));
  }

  private tempPassword(): string {
    return randomBytes(12).toString('base64url');
  }

  /** The temporary password is shown once, to the administrator who created the account */
  async createUser(dto: CreateUserDto, actor: User): Promise<{ user: PublicUser; temporaryPassword: string }> {
    const email = dto.email.trim().toLowerCase();
    if (await this.prisma.user.findUnique({ where: { email } })) {
      throw new BadRequestException('Email này đã có tài khoản');
    }
    const temporaryPassword = this.tempPassword();
    const user = await this.prisma.user.create({
      data: {
        email,
        name: dto.name.trim(),
        role: dto.role,
        mustChangePassword: true,
        passwordHash: await this.crypto.hashPassword(temporaryPassword),
      },
    });
    await this.activity.log({ action: 'user.created', message: `${actor.email} đã thêm thành viên ${email}`, user: actor });
    return { user: this.toPublic(user), temporaryPassword };
  }

  private async assertAnotherAdminRemains(id: string): Promise<void> {
    const others = await this.prisma.user.count({ where: { role: 'ADMIN', isActive: true, id: { not: id } } });
    if (others === 0) throw new BadRequestException('Phải còn ít nhất một quản trị viên đang hoạt động');
  }

  async updateUser(id: string, dto: UpdateUserDto, actor: User): Promise<PublicUser> {
    const target = await this.prisma.user.findUnique({ where: { id } });
    if (!target) throw new NotFoundException('Không tìm thấy người dùng');
    const losesAdmin = target.role === 'ADMIN' && ((dto.role && dto.role !== 'ADMIN') || dto.isActive === false);
    if (losesAdmin) await this.assertAnotherAdminRemains(id);
    const user = await this.prisma.user.update({ where: { id }, data: dto });
    if (dto.isActive === false) await this.prisma.session.deleteMany({ where: { userId: id } });
    await this.activity.log({ action: 'user.updated', message: `${actor.email} đã cập nhật thành viên ${user.email}`, user: actor, data: { ...dto } });
    return this.toPublic(user);
  }

  async resetPassword(id: string, actor: User): Promise<{ temporaryPassword: string }> {
    const target = await this.prisma.user.findUnique({ where: { id } });
    if (!target) throw new NotFoundException('Không tìm thấy người dùng');
    const temporaryPassword = this.tempPassword();
    await this.prisma.user.update({
      where: { id },
      data: {
        passwordHash: await this.crypto.hashPassword(temporaryPassword),
        mustChangePassword: true,
        failedLogins: 0,
        lockedUntil: null,
      },
    });
    await this.prisma.session.deleteMany({ where: { userId: id } });
    await this.activity.log({ action: 'user.password_reset', severity: 'warning', message: `${actor.email} đã đặt lại mật khẩu của ${target.email}`, user: actor });
    return { temporaryPassword };
  }

  async deleteUser(id: string, actor: User): Promise<void> {
    if (id === actor.id) throw new BadRequestException('Không thể tự xóa tài khoản của mình');
    const target = await this.prisma.user.findUnique({ where: { id } });
    if (!target) throw new NotFoundException('Không tìm thấy người dùng');
    if (target.role === 'ADMIN') await this.assertAnotherAdminRemains(id);
    await this.prisma.user.delete({ where: { id } });
    await this.activity.log({ action: 'user.deleted', severity: 'warning', message: `${actor.email} đã xóa thành viên ${target.email}`, user: actor });
  }
}
