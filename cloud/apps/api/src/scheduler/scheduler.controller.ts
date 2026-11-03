import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Injectable, Logger, NotFoundException, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import type { ScheduledTask, User } from '../generated/prisma/client';
import { Prisma } from '../generated/prisma/client';
import { ActivityService } from '../common/activity.service';
import { CurrentUser, Roles } from '../common/http';
import { PrismaService } from '../common/prisma.service';
import { COMMANDS } from '../devices/catalog';
import { CommandsService } from '../devices/commands.service';
import { computeNextRun, isValidTimeZone } from './next-run';

export class SaveTaskDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(120) name: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() enabled?: boolean;
  @ApiProperty() @IsString() commandType: string;
  @ApiPropertyOptional() @IsOptional() @IsObject() params?: Record<string, unknown>;
  @ApiProperty({ enum: ['all', 'group', 'devices'] }) @IsIn(['all', 'group', 'devices']) targetType: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() groupId?: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(5000) @IsUUID(undefined, { each: true }) deviceIds?: string[];
  @ApiProperty({ type: [Number] }) @IsArray() @ArrayMinSize(1) @IsInt({ each: true }) @Min(1, { each: true }) @Max(7, { each: true }) days: number[];
  @ApiProperty({ example: '06:30' }) @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) time: string;
  @ApiPropertyOptional({ example: 'Asia/Ho_Chi_Minh' }) @IsOptional() @IsString() timezone?: string;
}

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly commands: CommandsService,
  ) {}

  private target(task: ScheduledTask) {
    if (task.targetType === 'all') return { all: true };
    if (task.targetType === 'group' && task.groupId) return { groupId: task.groupId };
    return { deviceIds: task.deviceIds };
  }

  /** A task late because the server was down runs once, not once per missed day */
  @Interval(30_000)
  async runDue(now: Date = new Date()): Promise<void> {
    const due = await this.prisma.scheduledTask.findMany({ where: { enabled: true, nextRunAt: { lte: now } } });
    for (const task of due) {
      try {
        const nextRunAt = computeNextRun(task.days, task.time, task.timezone, now);
        await this.prisma.scheduledTask.update({ where: { id: task.id }, data: { lastRunAt: now, nextRunAt } });
        await this.commands.send({
          type: task.commandType,
          params: task.params as Record<string, unknown>,
          target: this.target(task),
          ttlMinutes: 30,
          source: `schedule:${task.id}`,
        });
      } catch (error) {
        this.logger.warn(`Lịch "${task.name}" lỗi: ${String(error)}`);
      }
    }
  }
}

@ApiTags('Lịch hẹn giờ')
@Controller('api/admin/scheduler')
export class SchedulerController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
  ) {}

  @Get('tasks')
  tasks() {
    return this.prisma.scheduledTask.findMany({ orderBy: { createdAt: 'desc' } });
  }

  private data(dto: SaveTaskDto) {
    const spec = COMMANDS[dto.commandType];
    if (!spec) throw new BadRequestException('Lệnh không được hỗ trợ');
    // A secret would sit in the schedule for good, and code would run with nobody watching
    if (spec.secretParams || spec.adminOnly) throw new BadRequestException('Không thể hẹn giờ lệnh này');
    const problem = spec.validate?.(dto.params ?? {});
    if (problem) throw new BadRequestException(problem);
    if (dto.targetType === 'group' && !dto.groupId) throw new BadRequestException('Chưa chọn nhóm');
    if (dto.targetType === 'devices' && !dto.deviceIds?.length) throw new BadRequestException('Chưa chọn thiết bị');
    const timezone = dto.timezone || 'Asia/Ho_Chi_Minh';
    if (!isValidTimeZone(timezone)) throw new BadRequestException('Múi giờ không hợp lệ');
    const days = [...new Set(dto.days)].sort();
    const enabled = dto.enabled ?? true;
    return {
      name: dto.name.trim(),
      enabled,
      commandType: dto.commandType,
      params: (dto.params ?? {}) as Prisma.InputJsonValue,
      targetType: dto.targetType,
      groupId: dto.targetType === 'group' ? dto.groupId : null,
      deviceIds: dto.targetType === 'devices' ? dto.deviceIds : [],
      days,
      time: dto.time,
      timezone,
      nextRunAt: enabled ? computeNextRun(days, dto.time, timezone) : null,
    };
  }

  @Post('tasks')
  @Roles('ADMIN', 'OPERATOR')
  async create(@Body() dto: SaveTaskDto, @CurrentUser() actor: User) {
    const task = await this.prisma.scheduledTask.create({ data: { ...this.data(dto), createdById: actor.id } });
    await this.activity.log({ action: 'schedule.task_created', message: `${actor.email} đã tạo lịch "${task.name}"`, user: actor });
    return task;
  }

  @Put('tasks/:id')
  @Roles('ADMIN', 'OPERATOR')
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SaveTaskDto, @CurrentUser() actor: User) {
    const task = await this.prisma.scheduledTask.update({ where: { id }, data: this.data(dto) });
    await this.activity.log({ action: 'schedule.task_updated', message: `${actor.email} đã sửa lịch "${task.name}"`, user: actor });
    return task;
  }

  @Delete('tasks/:id')
  @HttpCode(200)
  @Roles('ADMIN', 'OPERATOR')
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: User) {
    const task = await this.prisma.scheduledTask.findUnique({ where: { id } });
    if (!task) throw new NotFoundException('Không tìm thấy lịch');
    await this.prisma.scheduledTask.delete({ where: { id } });
    await this.activity.log({ action: 'schedule.task_deleted', message: `${actor.email} đã xóa lịch "${task.name}"`, user: actor });
    return { ok: true };
  }
}
