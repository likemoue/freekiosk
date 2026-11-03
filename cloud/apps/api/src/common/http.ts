import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { Device, User } from '../generated/prisma/client';
import { env } from '../config/env';

export type AuthedRequest = Request & { user?: User; device?: Device; sessionId?: string };

/** The address of the person or tablet: Cloudflare says it, then whatever the proxies add */
export function clientIp(req: Request): string | null {
  if (env().trustCloudflareHeader) {
    const cf = req.headers['cf-connecting-ip'];
    if (typeof cf === 'string' && cf) return cf;
  }
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded) return forwarded.split(',')[0].trim();
  return req.socket?.remoteAddress ?? null;
}

export const PUBLIC_ROUTE = 'public-route';
/** No session needed (the login page, for instance) */
export const Public = () => SetMetadata(PUBLIC_ROUTE, true);

export const ROLES = 'required-roles';
/** Who may call this route; without it, every signed-in user may */
export const Roles = (...roles: Array<'ADMIN' | 'OPERATOR' | 'VIEWER'>) => SetMetadata(ROLES, roles);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest<AuthedRequest>().user;
});

export const CurrentDevice = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest<AuthedRequest>().device;
});

/**
 * Sends a stored file, with Range and conditional requests. The path comes from the database,
 * so a leading dot somewhere in the data directory is not a reason to refuse it. A file missing
 * from the disk is a 404, not a hanging request; a client leaving mid-download is nothing at all.
 */
export function sendStoredFile(res: Response, file: string): void {
  res.sendFile(file, { dotfiles: 'allow' }, (error) => {
    if (error && !res.headersSent) res.status(404).json({ message: 'Không tìm thấy tệp' });
  });
}

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text = value instanceof Date ? value.toISOString() : String(value);
  // A cell starting like a formula runs as one when the file is opened in a spreadsheet
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
