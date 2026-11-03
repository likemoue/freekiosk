import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthedRequest, PUBLIC_ROUTE, ROLES } from '../common/http';
import { AuthService, SESSION_COOKIE } from './auth.service';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Guards the whole dashboard API (/api/admin). A plain HTML form on another site can post
 * with the session cookie but cannot set a custom header without a CORS preflight, which
 * this server never answers: that header is the CSRF protection, next to SameSite=Lax.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    if (!req.path.startsWith('/api/admin')) return true;

    if (!SAFE_METHODS.has(req.method) && req.headers['x-requested-with'] !== 'freekiosk-manager') {
      throw new ForbiddenException('Thiếu tiêu đề bảo vệ CSRF');
    }

    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, targets)) return true;

    const session = await this.auth.userFromToken(req.cookies?.[SESSION_COOKIE]);
    if (!session) throw new UnauthorizedException('Phiên đăng nhập đã hết hạn');
    req.user = session.user;
    req.sessionId = session.sessionId;

    // Until the first password is replaced, only the routes that replace it are open
    const allowedDuringChange = ['/api/admin/auth/me', '/api/admin/auth/password', '/api/admin/auth/logout'];
    if (session.user.mustChangePassword && !allowedDuringChange.includes(req.path.replace(/\/$/, ''))) {
      throw new ForbiddenException({ message: 'Cần đổi mật khẩu trước khi tiếp tục', code: 'PASSWORD_CHANGE_REQUIRED' });
    }

    const roles = this.reflector.getAllAndOverride<string[] | undefined>(ROLES, targets);
    if (roles && !roles.includes(session.user.role)) {
      throw new ForbiddenException('Tài khoản không có quyền thực hiện thao tác này');
    }
    return true;
  }
}
