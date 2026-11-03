import { Logger } from '@nestjs/common';
import { createApp } from './bootstrap';
import { env } from './config/env';

async function main(): Promise<void> {
  const app = await createApp();
  await app.listen(env().port, '0.0.0.0');
  new Logger('FreeKiosk Manager').log(`API sẵn sàng tại cổng ${env().port}, địa chỉ công khai ${env().publicUrl}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
