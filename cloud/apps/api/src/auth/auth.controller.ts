import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { User } from '../generated/prisma/client';
import { AuthedRequest, clientIp, CurrentUser, Public, Roles } from '../common/http';
import { rateLimit } from '../common/rate-limit';
import { PrismaService } from '../common/prisma.service';
import { env } from '../config/env';
import { ChangePasswordDto, CreateUserDto, DisableTotpDto, LoginDto, TotpCodeDto, UpdateProfileDto, UpdateUserDto } from './auth.dto';
import { AuthService, SESSION_COOKIE } from './auth.service';

@ApiTags('Đăng nhập')
@Controller('api/admin/auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
  ) {}

  private cookieOptions(expires?: Date) {
    return { httpOnly: true, secure: env().cookieSecure, sameSite: 'lax' as const, path: '/', expires };
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response) {
    const ip = clientIp(req) ?? 'unknown';
    rateLimit(`login:${ip}`, 20, 5 * 60_000, 'Quá nhiều lần đăng nhập. Thử lại sau vài phút.');
    const result = await this.auth.login(dto, req);
    if ('requires2fa' in result) return { requires2fa: true };
    res.cookie(SESSION_COOKIE, result.token, this.cookieOptions(result.expiresAt));
    return { user: this.auth.toPublic(result.user) };
  }

  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response) {
    if (req.sessionId) await this.auth.logout(req.sessionId);
    res.clearCookie(SESSION_COOKIE, this.cookieOptions());
    return { ok: true };
  }

  @Get('me')
  me(@CurrentUser() user: User) {
    return this.auth.toPublic(user);
  }

  @Patch('me')
  async updateMe(@CurrentUser() user: User, @Body() dto: UpdateProfileDto) {
    const updated = await this.prisma.user.update({ where: { id: user.id }, data: { name: dto.name.trim() } });
    return this.auth.toPublic(updated);
  }

  @Post('password')
  @HttpCode(200)
  async changePassword(@CurrentUser() user: User, @Body() dto: ChangePasswordDto, @Req() req: AuthedRequest) {
    await this.auth.changePassword(user, dto.currentPassword, dto.newPassword, req.sessionId!);
    return { ok: true };
  }

  @Post('2fa/setup')
  @HttpCode(200)
  setupTotp(@CurrentUser() user: User) {
    return this.auth.startTotpSetup(user);
  }

  @Post('2fa/enable')
  @HttpCode(200)
  enableTotp(@CurrentUser() user: User, @Body() dto: TotpCodeDto) {
    return this.auth.enableTotp(user, dto.code);
  }

  @Post('2fa/disable')
  @HttpCode(200)
  async disableTotp(@CurrentUser() user: User, @Body() dto: DisableTotpDto) {
    await this.auth.disableTotp(user, dto.password);
    return { ok: true };
  }
}

@ApiTags('Thành viên')
@Controller('api/admin/users')
@Roles('ADMIN')
export class UsersController {
  constructor(private readonly auth: AuthService) {}

  @Get()
  list() {
    return this.auth.listUsers();
  }

  @Post()
  create(@Body() dto: CreateUserDto, @CurrentUser() actor: User) {
    return this.auth.createUser(dto, actor);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto, @CurrentUser() actor: User) {
    return this.auth.updateUser(id, dto, actor);
  }

  @Post(':id/reset-password')
  @HttpCode(200)
  resetPassword(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: User) {
    return this.auth.resetPassword(id, actor);
  }

  @Delete(':id')
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: User) {
    await this.auth.deleteUser(id, actor);
    return { ok: true };
  }
}
