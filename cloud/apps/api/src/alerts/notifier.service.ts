import { Injectable, Logger } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { createTransport } from 'nodemailer';
import type { AlertChannel } from '../generated/prisma/client';
import { CryptoService } from '../common/crypto.service';
import { PrismaService } from '../common/prisma.service';
import { SettingsService } from '../common/settings.service';

export interface EmailConfig {
  to: string[];
}
export interface WebhookConfig {
  url: string;
  secret?: string;
  format?: 'generic' | 'slack' | 'discord';
}
export interface NtfyConfig {
  server: string;
  topic: string;
  token?: string;
}

export interface Notification {
  event: 'alert.opened' | 'alert.resolved' | 'test';
  title: string;
  message: string;
  severity: string;
  alertType?: string;
  device?: { id: string; name: string } | null;
  at: Date;
}

const TIMEOUT_MS = 10_000;

@Injectable()
export class NotifierService {
  private readonly logger = new Logger(NotifierService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly settings: SettingsService,
  ) {}

  /** Tells every channel that wants this kind of alert. A failing channel never stops the others */
  async broadcast(notification: Notification): Promise<void> {
    const channels = await this.prisma.alertChannel.findMany({ where: { enabled: true } });
    await Promise.all(
      channels
        .filter((c) => !notification.alertType || c.events.length === 0 || c.events.includes(notification.alertType))
        .map((c) => this.deliver(c, notification).catch(() => {})),
    );
  }

  /** Delivers to one channel and records the outcome on it, for the settings page */
  async deliver(channel: AlertChannel, notification: Notification): Promise<void> {
    try {
      const config = this.crypto.decryptJson<Record<string, unknown>>(channel.configEnc);
      if (!config) throw new Error('Không đọc được cấu hình kênh');
      if (channel.type === 'email') await this.sendEmail(config as unknown as EmailConfig, notification);
      else if (channel.type === 'webhook') await this.sendWebhook(config as unknown as WebhookConfig, notification);
      else if (channel.type === 'ntfy') await this.sendNtfy(config as unknown as NtfyConfig, notification);
      else throw new Error(`Loại kênh không xác định: ${channel.type}`);
      await this.prisma.alertChannel.update({ where: { id: channel.id }, data: { lastSentAt: new Date(), lastError: null } });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Kênh "${channel.name}" lỗi: ${reason}`);
      await this.prisma.alertChannel.update({ where: { id: channel.id }, data: { lastError: reason.slice(0, 500) } }).catch(() => {});
      throw error;
    }
  }

  private async sendEmail(config: EmailConfig, n: Notification): Promise<void> {
    const smtp = await this.settings.smtp();
    if (!smtp) throw new Error('Chưa cấu hình máy chủ SMTP');
    const password = smtp.passwordEnc ? this.crypto.decrypt(smtp.passwordEnc) : undefined;
    const transport = createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: smtp.user ? { user: smtp.user, pass: password } : undefined,
      connectionTimeout: TIMEOUT_MS,
      socketTimeout: TIMEOUT_MS,
    });
    await transport.sendMail({
      from: smtp.from,
      to: config.to.join(', '),
      subject: `[FreeKiosk] ${n.title}`,
      text: `${n.message}\n\nThời điểm: ${n.at.toISOString()}${n.device ? `\nThiết bị: ${n.device.name}` : ''}`,
    });
  }

  private async sendWebhook(config: WebhookConfig, n: Notification): Promise<void> {
    const text = `${n.title}: ${n.message}`;
    const payload =
      config.format === 'slack'
        ? { text }
        : config.format === 'discord'
          ? { content: text }
          : {
              event: n.event,
              title: n.title,
              message: n.message,
              severity: n.severity,
              alertType: n.alertType ?? null,
              device: n.device ?? null,
              at: n.at.toISOString(),
            };
    const body = JSON.stringify(payload);
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'User-Agent': 'FreeKiosk-Manager' };
    if (config.secret) {
      headers['X-FreeKiosk-Signature'] = `sha256=${createHmac('sha256', config.secret).update(body).digest('hex')}`;
    }
    const response = await fetch(config.url, { method: 'POST', headers, body, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) throw new Error(`Webhook trả về HTTP ${response.status}`);
  }

  private async sendNtfy(config: NtfyConfig, n: Notification): Promise<void> {
    // Published as JSON: ntfy's title header cannot carry Vietnamese as it is
    const server = config.server.replace(/\/+$/, '');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (config.token) headers.Authorization = `Bearer ${config.token}`;
    const response = await fetch(server, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        topic: config.topic,
        title: n.title,
        message: n.message,
        priority: n.severity === 'critical' ? 5 : n.event === 'alert.resolved' ? 2 : 4,
        tags: [n.event === 'alert.resolved' ? 'white_check_mark' : 'warning'],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`ntfy trả về HTTP ${response.status}`);
  }
}
