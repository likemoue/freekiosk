import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createApp } from './bootstrap';

/** Writes docs/openapi.json, which the web app reads to know the real fields of each route */
async function main(): Promise<void> {
  process.env.PUBLIC_URL ??= 'https://example.com';
  process.env.APP_SECRET ??= 'openapi-export-only-openapi-export-only';
  // Nothing connects: the routes are read from the code
  process.env.DATABASE_URL ??= 'postgresql://build:build@localhost:5432/build';
  const app = await createApp({ logger: false });
  const config = new DocumentBuilder()
    .setTitle('FreeKiosk Manager API')
    .setVersion('1.0')
    .setDescription('API quản trị (/api/admin, cookie phiên) và API thiết bị (/api/v1, khóa Bearer riêng từng thiết bị).')
    .addBearerAuth()
    .addCookieAuth('fk_session')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  const target = resolve(__dirname, '../../../docs/openapi.json');
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`);
  console.log(`Đã ghi ${target}`);
  await app.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
