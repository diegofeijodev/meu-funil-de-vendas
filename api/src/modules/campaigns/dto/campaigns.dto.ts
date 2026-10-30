import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsDateString, IsNotEmpty, IsNumber, IsObject, IsOptional, IsString, IsUUID, Max, MaxLength } from 'class-validator';

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

/** Corpo de `PATCH :id/landing-url` (a validação de http(s) fica no serviço, com mensagem em português). */
export class SetLandingUrlDto {
  @IsString() @MaxLength(2000) landing_url!: string;
}

/** Verba em reais. A conferência de "maior que zero" e do teto fica no serviço (frase pronta para a tela). */
export class SetBudgetDto {
  @Type(() => Number) @IsNumber(num) @Max(100000) budget_daily!: number;
  @IsOptional() @Type(() => Number) @IsNumber(num) @Max(10000000) budget_total?: number | null;
}

export class SetLocationDto {
  @IsString() @MaxLength(200) location!: string;
}
