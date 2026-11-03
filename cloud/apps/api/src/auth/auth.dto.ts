import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsEnum, IsOptional, IsString, Length, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty() @IsEmail() email: string;
  @ApiProperty() @IsString() @MaxLength(200) password: string;
  @ApiPropertyOptional({ description: 'Mã 2FA 6 số hoặc mã khôi phục' })
  @IsOptional() @IsString() @MaxLength(32) code?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() remember?: boolean;
}

export class ChangePasswordDto {
  @ApiProperty() @IsString() @MaxLength(200) currentPassword: string;
  @ApiProperty() @IsString() @MinLength(10) @MaxLength(200) newPassword: string;
}

export class TotpCodeDto {
  @ApiProperty() @IsString() @Length(6, 8) code: string;
}

export class DisableTotpDto {
  @ApiProperty() @IsString() @MaxLength(200) password: string;
}

export class UpdateProfileDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(120) name: string;
}

export enum RoleDto {
  ADMIN = 'ADMIN',
  OPERATOR = 'OPERATOR',
  VIEWER = 'VIEWER',
}

export class CreateUserDto {
  @ApiProperty() @IsEmail() email: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(120) name: string;
  @ApiProperty({ enum: RoleDto }) @IsEnum(RoleDto) role: RoleDto;
}

export class UpdateUserDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name?: string;
  @ApiPropertyOptional({ enum: RoleDto }) @IsOptional() @IsEnum(RoleDto) role?: RoleDto;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
