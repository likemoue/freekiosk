import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsObject, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { TargetDto } from '../common/targets';
import { PACKAGE_NAME } from './home-apps';

export class SensitiveDto {
  @ApiPropertyOptional({ description: 'Mã PIN mới của thiết bị' })
  @IsOptional() @IsString() @Length(4, 64) pin?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) mqttPassword?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) restApiKey?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) httpBasicAuthPassword?: string;
}

export class UpdateDeviceDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) notes?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsUUID() groupId?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsUUID() profileId?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsUUID() playlistId?: string | null;
}

export class UpdateConfigDto {
  @ApiPropertyOptional({ description: 'Chỉ gồm các khóa cần đổi, cùng cấu trúc với cấu hình của app' })
  @IsOptional() @IsObject() config?: Record<string, unknown>;
  @ApiPropertyOptional({ type: SensitiveDto })
  @IsOptional() @ValidateNested() @Type(() => SensitiveDto) sensitive?: SensitiveDto;
}

export class ApplyConfigDto extends UpdateConfigDto {
  @ApiProperty({ type: TargetDto }) @ValidateNested() @Type(() => TargetDto) target: TargetDto;
}

export class SendCommandDto {
  @ApiProperty({ example: 'reload' }) @IsString() @MaxLength(40) type: string;
  @ApiPropertyOptional() @IsOptional() @IsObject() params?: Record<string, unknown>;
  @ApiProperty({ type: TargetDto }) @ValidateNested() @Type(() => TargetDto) target: TargetDto;
  @ApiPropertyOptional({ description: 'Thời hạn của lệnh, tính bằng phút (mặc định 60)' })
  @IsOptional() @IsInt() @Min(1) @Max(10080) ttlMinutes?: number;
}

export class ListCommandsQuery {
  @IsOptional() @IsUUID() deviceId?: string;
  @IsOptional() @IsUUID() batchId?: string;
}

export class CreateGroupDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(120) name: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) description?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @Matches(/^#[0-9a-fA-F]{6}$/) color?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsUUID() profileId?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsUUID() playlistId?: string | null;
}

export class UpdateGroupDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) description?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @Matches(/^#[0-9a-fA-F]{6}$/) color?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsUUID() profileId?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsUUID() playlistId?: string | null;
}

export class SaveProfileDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(120) name: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) description?: string | null;
  @ApiProperty() @IsObject() config: Record<string, unknown>;
  @ApiPropertyOptional({ type: SensitiveDto })
  @IsOptional() @ValidateNested() @Type(() => SensitiveDto) sensitive?: SensitiveDto;
  @ApiPropertyOptional({ description: 'Chép thông tin bí mật thiết bị này đã báo cáo vào hồ sơ. Giá trị trong sensitive được ưu tiên.' })
  @IsOptional() @IsUUID() copySecretsFromDeviceId?: string;
}

export class CreateTokenDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) label?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() groupId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() profileId?: string;
  @ApiPropertyOptional({ description: 'Số thiết bị được dùng mã này (mặc định 1)' })
  @IsOptional() @IsInt() @Min(1) @Max(1000) maxUses?: number;
  @ApiPropertyOptional({ description: 'Thời hạn, tính bằng giờ' })
  @IsOptional() @IsInt() @Min(1) @Max(720) validHours?: number;
}

export class HomeAppsPreviewDto {
  @ApiProperty({ type: TargetDto }) @ValidateNested() @Type(() => TargetDto) target: TargetDto;
}

export class ApplyHomeAppsDto {
  @ApiProperty({ type: TargetDto }) @ValidateNested() @Type(() => TargetDto) target: TargetDto;
  @ApiPropertyOptional({ type: [String], description: 'Tên gói cần thêm vào màn hình chính' })
  @IsOptional() @IsArray() @ArrayMaxSize(200) @Matches(PACKAGE_NAME, { each: true, message: 'Tên gói không hợp lệ' }) add?: string[];
  @ApiPropertyOptional({ type: [String], description: 'Tên gói cần gỡ khỏi màn hình chính' })
  @IsOptional() @IsArray() @ArrayMaxSize(200) @Matches(PACKAGE_NAME, { each: true, message: 'Tên gói không hợp lệ' }) remove?: string[];
  @ApiPropertyOptional({ description: 'Chuyển các thiết bị chưa ở chế độ nhiều ứng dụng sang chế độ này' })
  @IsOptional() @IsBoolean() switchToMulti?: boolean;
}
