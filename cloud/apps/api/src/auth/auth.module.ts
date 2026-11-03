import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthController, UsersController } from './auth.controller';
import { AuthService } from './auth.service';
import { SessionGuard } from './session.guard';

@Module({
  controllers: [AuthController, UsersController],
  providers: [AuthService, { provide: APP_GUARD, useClass: SessionGuard }],
  exports: [AuthService],
})
export class AuthModule {}
