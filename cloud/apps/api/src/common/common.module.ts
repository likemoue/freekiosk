import { Global, Module } from '@nestjs/common';
import { ActivityService } from './activity.service';
import { CryptoService } from './crypto.service';
import { DeviceWakeService } from './device-wake.service';
import { PrismaService } from './prisma.service';
import { SettingsService } from './settings.service';
import { StorageService } from './storage.service';

@Global()
@Module({
  providers: [PrismaService, CryptoService, StorageService, ActivityService, DeviceWakeService, SettingsService],
  exports: [PrismaService, CryptoService, StorageService, ActivityService, DeviceWakeService, SettingsService],
})
export class CommonModule {}
