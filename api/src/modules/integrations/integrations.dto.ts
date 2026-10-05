import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class AiKeysWorkspaceDto {
  @IsUUID() workspaceId!: string;
}

export class AiKeyVendorDto extends AiKeysWorkspaceDto {
  @IsIn(['openai', 'gemini']) vendor!: 'openai' | 'gemini';
}

export class AiKeySaveDto extends AiKeyVendorDto {
  @Transform(trim) @IsString() @MinLength(20, { message: 'Chave muito curta.' }) @MaxLength(500) apiKey!: string;
}

export class DiagnoseAiDto extends AiKeysWorkspaceDto {
  @IsOptional() @IsBoolean() withImage?: boolean;
}

export class PublishingJobsQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit?: number;
}
