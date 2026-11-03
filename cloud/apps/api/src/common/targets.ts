import { ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsBoolean, IsOptional, IsUUID } from 'class-validator';

/** Which devices an action reaches: some devices, a group, or the whole fleet */
export class TargetDto {
  @ApiPropertyOptional({ type: [String] })
  @IsOptional() @IsArray() @ArrayMaxSize(5000) @IsUUID(undefined, { each: true })
  deviceIds?: string[];

  @ApiPropertyOptional() @IsOptional() @IsUUID() groupId?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() all?: boolean;
}

/** The devices still enrolled among those a target names */
export function targetWhere(target: TargetDto): { unenrolledAt: null; id?: { in: string[] }; groupId?: string } | null {
  if (target.all) return { unenrolledAt: null };
  if (target.groupId) return { unenrolledAt: null, groupId: target.groupId };
  if (target.deviceIds?.length) return { unenrolledAt: null, id: { in: target.deviceIds } };
  return null;
}
