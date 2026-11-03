import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from 'dotenv';
import { defineConfig } from 'prisma/config';

// Prisma 7 does not read .env by itself. `prisma generate` needs no database but the
// config still asks for a URL, hence the placeholder at image build time.
const envFile = resolve(__dirname, '../../.env');
if (existsSync(envFile)) config({ path: envFile, quiet: true });

export default defineConfig({
  schema: './prisma/schema.prisma',
  datasource: {
    url: process.env.DATABASE_URL ?? 'postgresql://build:build@localhost:5432/build',
  },
  migrations: {
    path: './prisma/migrations',
  },
});
