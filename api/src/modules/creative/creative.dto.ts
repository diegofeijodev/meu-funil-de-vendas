import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { TARGETS } from '../media/media.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const LAYOUTS = ['limpo', 'titulo_topo', 'preco_destaque', 'cta_rodape'] as const;

/**
 * `generateInput` de `creative.functions.ts` (generateCreative e previewVisualPrompt).
 * Campos opcionais NÃO levam default aqui — os padrões (`type`, `aspectRatio`, `provider`, `layout`, `variations`…) vivem no serviço.
 */
export class GenerateCreativeDto {
  @IsUUID() workspaceId!: string;
  @IsOptional() @IsUUID() campaignId?: string | null;
  @IsOptional() @IsUUID() brandId?: string | null;
  @IsOptional() @IsString() @MaxLength(250) title?: string;
  @IsOptional() @IsString() @MaxLength(40) type?: string;
  @IsOptional() @IsString() @MaxLength(10) aspectRatio?: string;
  @IsOptional() @IsIn(TARGETS) targetFormat?: string | null;
  @IsOptional() @IsString() @MaxLength(4000) prompt?: string;
  @IsOptional() @IsString() @MaxLength(4000) copyText?: string;
  @IsOptional() @IsIn(['auto', 'higgsfield', 'chatgpt', 'gemini']) provider?: 'auto' | 'higgsfield' | 'chatgpt' | 'gemini';
  @IsOptional() @IsString() @MaxLength(4000) visualPrompt?: string | null;
  @IsOptional() @IsObject() artDirection?: Record<string, unknown> | null;
  @IsOptional() @IsString() @MaxLength(300) adjust?: string | null;
  @IsOptional() @IsIn(LAYOUTS) layout?: (typeof LAYOUTS)[number];
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(4) variations?: number;
  @IsOptional() @IsString() @MaxLength(120) headline?: string | null;
  @IsOptional() @IsString() @MaxLength(40) price?: string | null;
  @IsOptional() @IsString() @MaxLength(40) cta?: string | null;
  @IsOptional() @IsString() @MaxLength(200) angle?: string | null;
  @IsOptional() @IsBoolean() useBrandImage?: boolean;
  @IsOptional() @IsBoolean() coverWithLogo?: boolean;
}

export class RetryCreativeJobDto {
  @IsUUID() jobId!: string;
}

export class CreativeIdDto {
  @IsUUID() creativeId!: string;
}

export class WorkspaceIdDto {
  @IsUUID() workspaceId!: string;
}

export class SetCreativeStatusDto {
  @IsIn(['draft', 'ready', 'approved', 'rejected', 'published']) status!: string;
}

export class JobsQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}

// ---- Canva
const SIZES = ['square', 'portrait', 'story', 'landscape'] as const;

export class CanvaSaveAppDto {
  @IsUUID() workspaceId!: string;
  @Transform(trim) @IsString() @MinLength(4) @MaxLength(200) clientId!: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(500) clientSecret?: string | null;
}

export class CanvaSendAssetDto {
  @IsUUID() workspaceId!: string;
  @IsUUID() assetId!: string;
}

export class CanvaCreateFromBriefDto {
  @IsUUID() workspaceId!: string;
  @IsString() @MinLength(1) @MaxLength(250) title!: string;
  @IsOptional() @IsIn(SIZES) size?: (typeof SIZES)[number] | null;
  @IsOptional() @IsUUID() assetId?: string | null;
}

export class CanvaListDesignsDto {
  @IsUUID() workspaceId!: string;
  @IsOptional() @IsString() @MaxLength(100) query?: string | null;
}

export class CanvaImportDesignDto {
  @IsUUID() workspaceId!: string;
  @Transform(trim) @IsString() @MinLength(3) designId!: string;
  @IsOptional() @IsString() @MaxLength(200) title?: string | null;
  @IsOptional() @IsIn(['png', 'jpg', 'mp4']) format?: 'png' | 'jpg' | 'mp4' | null;
  @IsOptional() @IsUUID() brandId?: string | null;
  @IsOptional() @IsUUID() campaignId?: string | null;
}
