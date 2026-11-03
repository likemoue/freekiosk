import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AdminController, RetentionService } from './admin/admin.controller';
import { AlertsController } from './alerts/alerts.controller';
import { AlertsService } from './alerts/alerts.service';
import { NotifierService } from './alerts/notifier.service';
import { AuthModule } from './auth/auth.module';
import { CommonModule } from './common/common.module';
import { DeviceApiController } from './device-api/device-api.controller';
import { DeviceApiService } from './device-api/device-api.service';
import { DeviceGuard } from './device-api/device.guard';
import { CommandsService } from './devices/commands.service';
import { ConfigSyncService } from './devices/config-sync.service';
import { CommandsController, ConfigController, DevicesController, ScreenshotsController } from './devices/devices.controller';
import { DevicesService } from './devices/devices.service';
import { ApksController, MediaController, UploadsController } from './files/files.controller';
import { UploadsService } from './files/uploads.service';
import { EnrollmentController, GroupsController, ProfilesController } from './fleet/fleet.controller';
import { PublicController } from './public/public.controller';
import { SchedulerController, SchedulerService } from './scheduler/scheduler.controller';
import { SignageController } from './signage/signage.controller';
import { SignageService } from './signage/signage.service';

@Module({
  imports: [ScheduleModule.forRoot(), CommonModule, AuthModule],
  controllers: [
    PublicController,
    DeviceApiController,
    AdminController,
    DevicesController,
    ConfigController,
    CommandsController,
    ScreenshotsController,
    GroupsController,
    ProfilesController,
    EnrollmentController,
    UploadsController,
    MediaController,
    ApksController,
    SignageController,
    SchedulerController,
    AlertsController,
  ],
  providers: [
    DeviceGuard,
    DeviceApiService,
    DevicesService,
    CommandsService,
    ConfigSyncService,
    SignageService,
    AlertsService,
    NotifierService,
    SchedulerService,
    UploadsService,
    RetentionService,
  ],
})
export class AppModule {}
