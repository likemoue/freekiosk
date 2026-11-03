import { HttpException, HttpStatus } from '@nestjs/common';

interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();

/**
 * A small in-memory limiter: this server runs as one process. It protects the routes a
 * stranger can reach without an account (sign-in, enrollment).
 */
export function rateLimit(key: string, limit: number, windowMs: number, message: string): void {
  const now = Date.now();
  if (windows.size > 10_000) {
    for (const [k, w] of windows) if (w.resetAt <= now) windows.delete(k);
  }
  const current = windows.get(key);
  if (!current || current.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  current.count += 1;
  if (current.count > limit) {
    throw new HttpException({ error: message, message }, HttpStatus.TOO_MANY_REQUESTS);
  }
}

export function resetRateLimits(): void {
  windows.clear();
}
