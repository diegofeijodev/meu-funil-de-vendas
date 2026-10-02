import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsDateString, IsNotEmpty, IsNumber, IsObject, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

const num = { allowNaN: false, allowInfinity: false } as const;

/**
 * Corpo do INSERT que o wizard fazia em `campaigns` (`status` NÃO é aceito: sempre nasce `draft`,
 * o que também mantém o gatilho de aprovação de pé).
 */
export class CreateCampaignDto {
  @IsUUID() brand_id!: string;
  @IsString() @IsNotEmpty() @MaxLength(300) name!: string;
  @IsString() @MaxLength(50) objective!: string;
  @IsOptional() @IsString() @MaxLength(500) offer_product?: string | null;
  @IsOptional() @Type(() => Number) @IsNumber(num) offer_price?: number | null;
  @IsOptional() @IsString() @MaxLength(5000) offer_promise?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) landing_url?: string | null;
  @IsOptional() @IsDateString() start_date?: string | null;
  @IsOptional() @IsDateString() end_date?: string | null;
  @IsObject() audience!: Record<string, unknown>;
  @IsOptional() @Type(() => Number) @IsNumber(num) budget_total?: number | null;
  @IsOptional() @Type(() => Number) @IsNumber(num) budget_daily?: number | null;
  @IsOptional() @Type(() => Number) @IsNumber(num) goal_leads?: number | null;
  @IsOptional() @Type(() => Number) @IsNumber(num) goal_sales?: number | null;
  @IsOptional() @Type(() => Number) @IsNumber(num) avg_ticket?: number | null;
  @IsOptional() @Type(() => Number) @IsNumber(num) margin_percent?: number | null;
  @IsOptional() @Type(() => Number) @IsNumber(num) max_cac?: number | null;
  @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(50, { each: true }) formats!: string[];
}

/** INSERT em `copies` (`content` jsonb = `CopyContent`; status/versão são do servidor). */
export class CreateCopyDto {
  @IsObject() content!: Record<string, unknown>;
}
