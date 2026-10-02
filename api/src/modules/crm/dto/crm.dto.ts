import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';

/** Teto de linhas por importação de CSV (o protótipo mandava tudo num único insert, sem limite). */
export const MAX_IMPORT_ROWS = 5000;
/** Teto de leads por ação em massa. */
export const MAX_BULK_IDS = 5000;

const COLOR = /^#[0-9a-fA-F]{3,8}$/;
const TASK_STATUSES = ['open', 'done', 'canceled'] as const;

// ------------------------------------------------------------------ etapas

export class CreateStageDto {
  @IsUUID() pipeline_id!: string;
  @IsString() @IsNotEmpty() @MaxLength(200) name!: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(-100000) @Max(100000) position?: number;
  @IsOptional() @IsString() @Matches(COLOR) color?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100000) sla_hours?: number;
}

export class UpdateStageDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(200) name?: string;
  @IsOptional() @IsString() @Matches(COLOR) color?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(-100000) @Max(100000) position?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100000) sla_hours?: number;
}

// ------------------------------------------------------------------ leads

export class CreateLeadDto {
  @IsOptional() @IsUUID() pipeline_id?: string | null;
  @IsOptional() @IsUUID() stage_id?: string | null;
  @IsString() @IsNotEmpty() @MaxLength(300) name!: string;
  @IsOptional() @IsString() @MaxLength(60) phone?: string | null;
  @IsOptional() @IsString() @MaxLength(320) email?: string | null;
  @IsOptional() @IsString() @MaxLength(200) city?: string | null;
  @IsOptional() @IsString() @MaxLength(60) source?: string;
}

export class ImportLeadRowDto {
  @IsString() @MaxLength(300) name!: string;
  @IsOptional() @IsString() @MaxLength(60) phone?: string | null;
  @IsOptional() @IsString() @MaxLength(320) email?: string | null;
  @IsOptional() @IsString() @MaxLength(200) city?: string | null;
}

export class ImportLeadsDto {
  @IsOptional() @IsUUID() pipeline_id?: string | null;
  @IsOptional() @IsUUID() stage_id?: string | null;
  /** O teto de 5000 (com mensagem pt-BR limpa) é conferido no serviço; este é só o limite duro do parser. */
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50_000)
  @ValidateNested({ each: true }) @Type(() => ImportLeadRowDto) rows!: ImportLeadRowDto[];
}

/** O que a ficha do lead e as telas gravam em `crm_leads` (o protótipo aceitava qualquer coluna; aqui só estas). */
export class UpdateLeadDto {
  @IsOptional() @IsUUID() stage_id?: string;
  @IsOptional() @IsDateString() stage_entered_at?: string;
  @IsOptional() @IsUUID() owner_id?: string | null;
  @IsOptional() @IsBoolean() ai_active?: boolean;
  @IsOptional() @IsDateString() last_interaction_at?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) @MaxLength(100, { each: true }) tags?: string[];
}

export class BulkLeadsDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(MAX_BULK_IDS) @IsUUID('all', { each: true }) ids!: string[];
  @IsOptional() @IsUUID() stage_id?: string;
  /** `null` desatribui. */
  @IsOptional() @IsUUID() owner_id?: string | null;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(100) add_tag?: string;
}

export class MoveLeadDto {
  @IsUUID() stage_id!: string;
}

export class AddNoteDto {
  @IsString() @IsNotEmpty() @MaxLength(10_000) content!: string;
}

export class AiToggleDto {
  @IsBoolean() active!: boolean;
}

export class CreateTaskDto {
  @IsString() @IsNotEmpty() @MaxLength(500) title!: string;
  @IsOptional() @IsDateString() due_at?: string;
}

export class UpdateTaskDto {
  @IsIn(TASK_STATUSES as unknown as string[]) status!: (typeof TASK_STATUSES)[number];
}

// ------------------------------------------------------------------ configurações

export class SaveSettingsDto {
  @IsIn(['round_robin', 'fixed']) distribution!: 'round_robin' | 'fixed';
  @IsOptional() @IsUUID() default_owner_id?: string | null;
}

export class CreateNamedDto {
  @IsString() @IsNotEmpty() @MaxLength(200) name!: string;
}

export class CreateTagDto {
  @IsString() @IsNotEmpty() @MaxLength(100) name!: string;
  @IsOptional() @IsString() @Matches(COLOR) color?: string;
}

