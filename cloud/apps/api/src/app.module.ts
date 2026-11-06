import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AdminController, RetentionService } from './admin/admin.controller';
import { AlertsController } from './alerts/alerts.controller';
import { AlertsService } from './alerts/alerts.service';
import { NotifierService } from './alerts/notifier.service';
import { AuthModule } from './auth/auth.module';
import { CommonModule } from './common/common.module';
import { DeviceApiController } from './device-api/device-api.controller';
import { ApkPullService } from './device-api/apk-pull.service';
import { DeviceApiService } from './device-api/device-api.service';
import { DeviceGuard } from './device-api/device.guard';
import { CommandsService } from './devices/commands.service';
import { ConfigSyncService } from './devices/config-sync.service';
import { CommandsController, ConfigController, DevicesController, ScreenshotsController } from './devices/devices.controller';
import { DevicesService } from './devices/devices.service';
import { HomeAppsController } from './devices/home-apps.controller';
import { HomeAppsService } from './devices/home-apps.service';
import { LiveController } from './devices/live.controller';
import { LiveService } from './devices/live.service';
import { LocationsController } from './devices/locations.controller';
import { ApkInspector } from './files/apk-inspector';
import { ApkLibraryService } from './files/apk-library.service';
import { ApksController, MediaController, UploadsController } from './files/files.controller';
import { UploadsService } from './files/uploads.service';
import { UsbToolController } from './files/usb-tool.controller';
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
    HomeAppsController,
    LocationsController,
    LiveController,
    ScreenshotsController,
    GroupsController,
    ProfilesController,
    EnrollmentController,
    UploadsController,
    MediaController,
    ApksController,
    UsbToolController,
    SignageController,
    SchedulerController,
    AlertsController,
  ],
  providers: [
    DeviceGuard,
    DeviceApiService,
    ApkPullService,
    LiveService,
    DevicesService,
    CommandsService,
    ConfigSyncService,
    HomeAppsService,
    ApkInspector,
    ApkLibraryService,
    SignageService,
    AlertsService,
    NotifierService,
    SchedulerService,
    UploadsService,
    RetentionService,
  ],
})
export class AppModule {}
