import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CopyAiService } from './copy-ai.service';

export class GenerateCopyDto {
  @IsUUID() workspaceId!: string;
  @IsOptional() @IsIn(['auto', 'chatgpt', 'gemini']) engine?: 'auto' | 'chatgpt' | 'gemini';
  @IsObject() brand!: Record<string, unknown>;
  @IsObject() brief!: Record<string, unknown>;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(1000) seed?: number;
  @IsOptional() @IsUUID() campaignId?: string | null;
  @IsOptional() @IsString() @MaxLength(200) angle?: string | null;
}

/** Server fn `generateCopyWithAI` (`copy-ai.functions.ts`): `POST /v1/copy-ai/generate-copy-with-ai`. */
@ApiTags('Copy')
@ApiBearerAuth()
@Controller('v1/copy-ai')
export class CopyAiController {
  constructor(private readonly copy: CopyAiService) {}

  @Post('generate-copy-with-ai')
  @HttpCode(200)
  generate(@CurrentUser() user: AuthUser, @Body() dto: GenerateCopyDto) {
    return this.copy.generate(user.id, dto);
  }
}
