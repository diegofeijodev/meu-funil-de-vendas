import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsNotEmpty, IsNumber, IsObject, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

const LONG = 10_000;

export class CreateBrandDto {
  @IsString() @IsNotEmpty() @MaxLength(200) name!: string;
  @IsOptional() @IsString() @MaxLength(200) segment?: string;
}

/** Tudo que o formulário "Salvar Brand Brain" e o "Salvar guia visual" enviam (`brands.update`). */
export class UpdateBrandDto {
  @IsOptional() @IsString() @MaxLength(200) name?: string;
  @IsOptional() @IsString() @MaxLength(500) website?: string;
  @IsOptional() @IsString() @MaxLength(200) segment?: string;
  @IsOptional() @IsString() @MaxLength(500) region?: string;
  @IsOptional() @IsString() @MaxLength(LONG) description?: string;
  @IsOptional() @IsString() @MaxLength(LONG) differentials?: string;
  @IsOptional() @IsString() @MaxLength(LONG) target_audience?: string;
  @IsOptional() @IsString() @MaxLength(LONG) competitors?: string;
  @IsOptional() @IsString() @MaxLength(LONG) tone_of_voice?: string;
  @IsOptional() @IsString() @MaxLength(LONG) past_campaigns?: string;
  @IsOptional() @IsString() @MaxLength(50) primary_color?: string;
  @IsOptional() @IsString() @MaxLength(50) secondary_color?: string;
  @IsOptional() @IsString() @MaxLength(200) typography?: string;
  @IsOptional() @IsString() @MaxLength(2000) logo_url?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(200) @IsString({ each: true }) @MaxLength(200, { each: true }) preferred_words?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(200) @IsString({ each: true }) @MaxLength(200, { each: true }) banned_words?: string[];
  /** Guia visual (`VisualStyle`, jsonb). */
  @IsOptional() @IsObject() visual_style?: Record<string, unknown>;
}

export class CreateProductDto {
  @IsString() @IsNotEmpty() @MaxLength(300) name!: string;
  @IsOptional() @IsString() @MaxLength(LONG) description?: string;
  @IsOptional() @Type(() => Number) @IsNumber({ allowNaN: false, allowInfinity: false }) price?: number;
  @IsOptional() @Type(() => Number) @IsNumber({ allowNaN: false, allowInfinity: false }) margin_percent?: number;
}

export class UpdateProductDto {
  @IsOptional() @IsString() @MaxLength(300) name?: string;
  @IsOptional() @IsString() @MaxLength(LONG) description?: string;
  @IsOptional() @Type(() => Number) @IsNumber({ allowNaN: false, allowInfinity: false }) price?: number;
  @IsOptional() @Type(() => Number) @IsNumber({ allowNaN: false, allowInfinity: false }) margin_percent?: number;
}


export class CreatePersonaDto {
  @IsString() @IsNotEmpty() @MaxLength(300) name!: string;
  @IsOptional() @IsString() @MaxLength(200) age_range?: string;
  @IsOptional() @IsString() @MaxLength(500) location?: string;
  @IsOptional() @IsString() @MaxLength(LONG) interests?: string;
  @IsOptional() @IsString() @MaxLength(LONG) pains?: string;
  @IsOptional() @IsString() @MaxLength(LONG) desires?: string;
  /** O campo da tela é texto livre ("B2B/B2C"); só limitamos o tamanho. */
  @IsOptional() @IsString() @MaxLength(50) segment_type?: string;
}

export class UpdatePersonaDto {
  @IsOptional() @IsString() @MaxLength(300) name?: string;
  @IsOptional() @IsString() @MaxLength(200) age_range?: string;
  @IsOptional() @IsString() @MaxLength(500) location?: string;
  @IsOptional() @IsString() @MaxLength(LONG) interests?: string;
  @IsOptional() @IsString() @MaxLength(LONG) pains?: string;
  @IsOptional() @IsString() @MaxLength(LONG) desires?: string;
  @IsOptional() @IsString() @MaxLength(50) segment_type?: string;
}

export const ASSET_KINDS = ['logo', 'identity', 'reference', 'font', 'photo'] as const;
export const REFERENCE_TAG_KEYS = ['produto', 'ambiente', 'equipe'] as const;

/**
 * Registro de um arquivo já enviado por `POST /v1/workspaces/:ws/files?kind=brands`.
 * A `url` NUNCA vem do cliente: a API assina a `storage_path` (mesma URL de 5 anos que o protótipo guardava).
 */
export class CreateBrandAssetDto {
  @IsIn(ASSET_KINDS as unknown as string[]) kind!: (typeof ASSET_KINDS)[number];
  @IsString() @IsNotEmpty() @MaxLength(500) name!: string;
  @IsString() @IsNotEmpty() @MaxLength(1000) storage_path!: string;
  @IsOptional() @IsIn(REFERENCE_TAG_KEYS as unknown as string[]) tag?: string;
}

export class GenerateBrandGuideDto {
  @IsUUID() brandId!: string;
}

