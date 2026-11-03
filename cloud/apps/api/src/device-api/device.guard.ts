import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { sha256 } from '../common/crypto.service';
import { AuthedRequest } from '../common/http';
import { PrismaService } from '../common/prisma.service';

/**
 * Each device has its own API key, kept here only as a hash. The app takes a refusal seriously
 * (it wipes its enrollment once refused for 30 minutes), so this only ever refuses a key that
 * does not exist or a device id that is not its own: anything else fails with a 5xx instead.
 */
@Injectable()
export class DeviceGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const match = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? '');
    if (!match) throw new UnauthorizedException({ error: 'Thiếu khóa API' });

    const device = await this.prisma.device.findUnique({ where: { apiKeyHash: sha256(match[1].trim()) } });
    if (!device) throw new UnauthorizedException({ error: 'Khóa API không hợp lệ' });

    const claimedId = req.params.deviceId;
    if (claimedId && claimedId !== device.id) throw new ForbiddenException({ error: 'Khóa API không thuộc thiết bị này' });

    req.device = device;
    return true;
  }
}
