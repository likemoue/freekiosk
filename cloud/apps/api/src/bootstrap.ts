import 'reflect-metadata';
import { BadRequestException, INestApplication, ValidationError, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { json, NextFunction, raw, Request, Response, urlencoded } from 'express';
import { AppModule } from './app.module';
import { AuthService, SESSION_COOKIE } from './auth/auth.service';

// Sizes are stored as BigInt, which JSON cannot carry; a file size fits a number with no loss
(BigInt.prototype as unknown as { toJSON: () => number }).toJSON = function (this: bigint) {
  return Number(this);
};

export const UPLOAD_PART_LIMIT = '64mb';

const FIELD_NAMES: Record<string, string> = {
  email: 'Email',
  password: 'Mật khẩu',
  currentPassword: 'Mật khẩu hiện tại',
  newPassword: 'Mật khẩu mới (ít nhất 10 ký tự)',
  name: 'Tên',
  pin: 'Mã PIN (ít nhất 4 ký tự)',
  url: 'URL',
  server: 'Máy chủ ntfy',
  to: 'Danh sách email',
  from: 'Địa chỉ gửi',
  host: 'Máy chủ SMTP',
  port: 'Cổng',
  time: 'Giờ chạy',
  days: 'Các ngày',
  start: 'Giờ bắt đầu',
  end: 'Giờ kết thúc',
};

function invalidFields(errors: ValidationError[]): string[] {
  return errors.flatMap((e) => (e.children?.length ? invalidFields(e.children) : [e.property]));
}

/** The page shows this as it is: class-validator's own messages are in English, and name code */
function describeField(field: string): string {
  return `${FIELD_NAMES[field] ?? `Trường "${field}"`} không hợp lệ`;
}

/** The same app for the server, the tests and the OpenAPI export */
export async function createApp(options: { logger?: false } = {}): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
    ...(options.logger === false ? { logger: false } : {}),
  });
  app.disable('x-powered-by');
  app.use(cookieParser());
  // Nothing behind a session or a device key belongs in a shared cache; a route may still override it
  app.use('/api', (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  // Checked here rather than left to the guard: guards run after the body is read, and this one
  // holds 64 MB in memory. Someone with no account should not get to make the server do that.
  const auth = app.get(AuthService);
  app.use('/api/admin/uploads/:id/part', async (req: Request, res: Response, next: NextFunction) => {
    const session = await auth.userFromToken(req.cookies?.[SESSION_COOKIE]).catch(() => null);
    if (!session) {
      res.status(401).json({ message: 'Phiên đăng nhập đã hết hạn' });
      return;
    }
    if (session.user.role === 'VIEWER') {
      res.status(403).json({ message: 'Tài khoản không có quyền thực hiện thao tác này' });
      return;
    }
    next();
  });
  app.use('/api/admin/uploads/:id/part', raw({ type: () => true, limit: UPLOAD_PART_LIMIT }));
  // A heartbeat carries the whole configuration of the tablet, playlists and all
  app.use(json({ limit: '10mb' }));
  app.use(urlencoded({ extended: false, limit: '1mb' }));
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      stopAtFirstError: true,
      exceptionFactory: (errors) => new BadRequestException(invalidFields(errors).map(describeField).join('. ')),
    }),
  );
  app.enableShutdownHooks();
  return app;
}
