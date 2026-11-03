import { Controller, Get, Header, NotFoundException, Param, ParseUUIDPipe, Res, ServiceUnavailableException } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { CryptoService } from '../common/crypto.service';
import { Public, sendStoredFile } from '../common/http';
import { PrismaService } from '../common/prisma.service';
import { SettingsService } from '../common/settings.service';
import { StorageService } from '../common/storage.service';

/**
 * The page the media player of the app shows a YouTube video in. YouTube refuses to play for a
 * page with no origin, which is what the player page is, so the video plays here and the page
 * repeats what the YouTube player says, in the shape the player listens for (onStateChange,
 * onError; see loadYoutube in MediaPlayerComponent.tsx).
 */
const YOUTUBE_PAGE = `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Trình phát</title>
<style>html,body,#player{margin:0;width:100%;height:100%;background:#000;overflow:hidden}</style>
</head><body><div id="player"></div>
<script>
var query = new URLSearchParams(location.search);
var videoId = query.get('v') || '';
var muted = query.get('mute') === '1';
function tell(event, info) { parent.postMessage(JSON.stringify({ event: event, info: info }), '*'); }
if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
  tell('onError', 2);
} else {
  window.onYouTubeIframeAPIReady = function () {
    new YT.Player('player', {
      width: '100%', height: '100%', videoId: videoId,
      playerVars: { autoplay: 1, controls: 0, disablekb: 1, fs: 0, rel: 0, iv_load_policy: 3, playsinline: 1, mute: muted ? 1 : 0, origin: location.origin },
      events: {
        onReady: function (e) { if (muted) e.target.mute(); e.target.playVideo(); },
        onStateChange: function (e) { tell('onStateChange', e.data); },
        onError: function (e) { tell('onError', e.data); }
      }
    });
  };
  var api = document.createElement('script');
  api.src = 'https://www.youtube.com/iframe_api';
  api.onerror = function () { tell('onError', 0); };
  document.head.appendChild(api);
}
</script></body></html>`;

@ApiExcludeController()
@Public()
@Controller()
export class PublicController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly storage: StorageService,
    private readonly settings: SettingsService,
  ) {}

  @Get('healthz')
  async health() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException({ status: 'database_unreachable' });
    }
    return { status: 'ok' };
  }

  @Get('api/public/info')
  async info() {
    const [organization, provisioning] = await Promise.all([
      this.settings.organization(),
      this.prisma.apkPackage.findFirst({ where: { isProvisioning: true }, select: { versionName: true } }),
    ]);
    return { organization: organization.name, apkAvailable: !!provisioning, apkVersion: provisioning?.versionName ?? null };
  }

  @Get('player/youtube')
  @Header('Content-Type', 'text/html; charset=utf-8')
  // Shown inside the player of the app, so no frame restriction here, unlike the rest of the site
  @Header('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-inline' https://www.youtube.com; frame-src https://www.youtube.com https://www.youtube-nocookie.com; style-src 'unsafe-inline'; img-src https: data:")
  @Header('Cache-Control', 'public, max-age=3600')
  youtube() {
    return YOUTUBE_PAGE;
  }

  /**
   * Media of a playlist. The token in the path is what opens it: a tablet's media player and its
   * offline cache cannot send a key. Range and conditional requests come with sendFile, which is
   * what lets a cut download resume and an unchanged file stay as it is.
   */
  @Get('media/:id/:token/:name')
  async media(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('token') token: string,
    @Res() res: Response,
  ) {
    if (!this.crypto.verify('media', id, token)) throw new NotFoundException();
    const asset = await this.prisma.mediaAsset.findUnique({ where: { id } });
    if (!asset) throw new NotFoundException();
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.type(asset.mimeType);
    sendStoredFile(res, this.storage.path(asset.storageKey));
  }

  /**
   * The APK the Android setup wizard downloads during QR provisioning. It has to be public: the
   * wizard has no account and no key, and all it can do is check the file against the checksum
   * carried by the QR code.
   */
  @Get('dpc-apk-download')
  async provisioningApk(@Res() res: Response) {
    const apk = await this.prisma.apkPackage.findFirst({ where: { isProvisioning: true }, orderBy: { createdAt: 'desc' } });
    if (!apk) throw new NotFoundException('Chưa chọn APK cấp phát');
    res.type('application/vnd.android.package-archive');
    res.setHeader('Content-Disposition', `attachment; filename="FreeKiosk-${apk.versionName ?? 'latest'}.apk"`);
    sendStoredFile(res, this.storage.path(apk.storageKey));
  }
}
