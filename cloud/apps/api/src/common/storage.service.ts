import { Injectable, OnModuleInit } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { env } from '../config/env';

export type StorageArea = 'media' | 'apk' | 'screenshots' | 'tools' | 'tmp';

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly root = env().dataDir;

  async onModuleInit(): Promise<void> {
    await Promise.all(
      (['media', 'apk', 'screenshots', 'tools', 'tmp'] as StorageArea[]).map((area) =>
        mkdir(join(this.root, area), { recursive: true }),
      ),
    );
  }

  /** Absolute path of a stored file. The key comes from the database, never from a request */
  path(key: string): string {
    const full = resolve(this.root, key);
    if (!full.startsWith(this.root + sep)) throw new Error('Storage key escapes the data directory');
    return full;
  }

  tmpPath(name: string): string {
    return this.path(`tmp/${name}`);
  }

  /** Moves a finished temporary file into its area: a key is never reused, a file never replaced */
  async adopt(tmpFile: string, area: StorageArea, extension: string): Promise<string> {
    const key = `${area}/${randomUUID()}${extension}`;
    await rename(tmpFile, this.path(key));
    return key;
  }

  async remove(key: string | null | undefined): Promise<void> {
    if (!key) return;
    await rm(this.path(key), { force: true });
  }

  async size(file: string): Promise<number> {
    try {
      return (await stat(file)).size;
    } catch {
      return 0;
    }
  }

  sha256File(file: string): Promise<Buffer> {
    return new Promise((done, fail) => {
      const hash = createHash('sha256');
      createReadStream(file)
        .on('data', (chunk) => hash.update(chunk))
        .on('error', fail)
        .on('end', () => done(hash.digest()));
    });
  }
}
