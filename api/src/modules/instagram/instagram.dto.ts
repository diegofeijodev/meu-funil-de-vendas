import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { IG_FORMATS } from './ig-types';

const ENGINES = ['auto', 'chatgpt', 'gemini'] as const;
const PROVIDERS = ['auto', 'higgsfield', 'chatgpt', 'gemini'] as const;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{1,2}:\d{2}$/;
/** ISO-8601 com fuso (`Z` ou `±hh:mm`), como `z.string().datetime({ offset: true })`. */
const ISO_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;

export class WorkspaceDto {
  @IsUUID() workspaceId!: string;
}

export class ConnectInstagramDto {
  @IsUUID() workspaceId!: string;
  @IsOptional() @IsString() @MaxLength(64) @Matches(/^\d+$/, { message: 'pageId deve conter só dígitos' }) pageId?: string;
}

export class GenerateContentCalendarDto {
  @IsUUID() workspaceId!: string;
  @IsUUID() planId!: string;
  @IsOptional() @IsInt() @Min(1) @Max(8) weeks?: number;
  @IsOptional() @IsIn(ENGINES) engine?: (typeof ENGINES)[number];
}

export class PostRefDto {
  @IsUUID() workspaceId!: string;
  @IsUUID() postId!: string;
}

export class GeneratePostAssetsDto {
  @IsUUID() workspaceId!: string;
  @IsUUID() postId!: string;
  @IsOptional() @IsIn(PROVIDERS) provider?: (typeof PROVIDERS)[number];
  @IsOptional() @IsString() @MaxLength(300) adjust?: string;
}

export class RegenerateCaptionDto {
  @IsUUID() workspaceId!: string;
  @IsUUID() postId!: string;
  @IsOptional() @IsString() @MaxLength(1000) instructions?: string;
  @IsOptional() @IsIn(ENGINES) engine?: (typeof ENGINES)[number];
}

export class RegenerateMediaDto {
  @IsUUID() workspaceId!: string;
  @IsUUID() postId!: string;
  @IsOptional() @IsString() @MaxLength(1000) instructions?: string;
  @IsOptional() @IsIn(PROVIDERS) provider?: (typeof PROVIDERS)[number];
}

export class RejectPostDto {
  @IsUUID() workspaceId!: string;
  @IsUUID() postId!: string;
  @IsString() @MinLength(1) @MaxLength(1000) reason!: string;
}

export class SchedulePostDto {
  @IsUUID() workspaceId!: string;
  @IsUUID() postId!: string;
  @IsString() @Matches(ISO_OFFSET, { message: 'scheduledAt deve ser uma data ISO com fuso' }) scheduledAt!: string;
}

export class SuggestPillarsDto {
  @IsUUID() workspaceId!: string;
  @IsOptional() @IsUUID() brandId?: string | null;
  @IsOptional() @IsString() @MaxLength(500) objective?: string;
  @IsOptional() @IsString() @MaxLength(500) tone?: string;
  @IsOptional() @IsString() @MaxLength(500) audience?: string;
}

// ---- calendário automático

class AutoScheduleBase {
  @IsString() @Matches(DATE) startDate!: string;
  @IsString() @Matches(DATE) endDate!: string;
  @IsArray() @IsInt({ each: true }) @Min(0, { each: true }) @Max(6, { each: true }) weekdays!: number[];
  @IsArray() @ArrayMaxSize(8) @IsString({ each: true }) @Matches(TIME, { each: true }) times!: string[];
  @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) @Matches(TIME, { each: true }) storyTimes!: string[];
  @IsArray() @ArrayMinSize(1) @IsIn(IG_FORMATS, { each: true }) formats!: (typeof IG_FORMATS)[number][];
  @IsOptional() @IsBoolean() asap?: boolean;
}

export class CreateAutoCalendarDto extends AutoScheduleBase {
  /** Criar exige ao menos um dia (a prévia aceita vazio e devolve 0 horários). */
  @IsArray() @ArrayMinSize(1) @IsInt({ each: true }) @Min(0, { each: true }) @Max(6, { each: true }) declare weekdays: number[];
  @IsUUID() workspaceId!: string;
  @IsOptional() @IsUUID() planId?: string | null;
  @IsOptional() @IsUUID() brandId?: string | null;
  @IsOptional() @IsUUID() campaignId?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) focus?: string;
  @IsIn(['publish', 'approval']) mode!: 'publish' | 'approval';
  @IsOptional() @IsBoolean() recurring?: boolean;
}

export class PreviewAutoCalendarDto extends AutoScheduleBase {}

export class RunRefDto {
  @IsUUID() runId!: string;
}

export class GenerateNextAutoMediaDto {
  @IsUUID() runId!: string;
  @IsOptional() @IsNumber() @Min(1) @Max(72) withinHours?: number;
}

// ---- leituras/escritas diretas

export class PatchIgPostDto {
  @IsOptional() @IsString() @MaxLength(5000) caption?: string | null;
  @IsOptional() @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) @MaxLength(100, { each: true }) hashtags?: string[];
  @IsOptional() @IsString() @MaxLength(500) cta?: string | null;
  @IsOptional() @IsString() @Matches(ISO_OFFSET, { message: 'scheduled_at deve ser uma data ISO com fuso' }) scheduled_at?: string | null;
  @IsOptional() @IsObject() creative_brief?: Record<string, unknown>;
}

const PLAN_STATUS = ['draft', 'active', 'paused'] as const;

export class CreateIgPlanDto {
  @IsString() @MinLength(1) @MaxLength(200) name!: string;
  @IsOptional() @IsUUID() brand_id?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) objective?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) tone_of_voice?: string | null;
  @IsOptional() @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) @MaxLength(300, { each: true }) content_pillars?: string[];
  @IsOptional() @IsObject() posting_frequency?: Record<string, number>;
  @IsOptional() @IsArray() @ArrayMaxSize(24) @IsString({ each: true }) @MaxLength(20, { each: true }) preferred_times?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(7) @IsInt({ each: true }) @Min(0, { each: true }) @Max(6, { each: true }) posting_days?: number[];
  @IsOptional() @IsObject() hashtag_strategy?: Record<string, unknown>;
  @IsOptional() @IsString() @MaxLength(500) cta_default?: string | null;
  @IsOptional() @IsBoolean() requires_approval?: boolean;
  @IsOptional() @IsBoolean() auto_publish?: boolean;
  @IsOptional() @IsIn(PLAN_STATUS) status?: (typeof PLAN_STATUS)[number];
}

export class PatchIgPlanDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) name?: string;
  @IsOptional() @IsUUID() brand_id?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) objective?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) tone_of_voice?: string | null;
  @IsOptional() @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) @MaxLength(300, { each: true }) content_pillars?: string[];
  @IsOptional() @IsObject() posting_frequency?: Record<string, number>;
  @IsOptional() @IsArray() @ArrayMaxSize(24) @IsString({ each: true }) @MaxLength(20, { each: true }) preferred_times?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(7) @IsInt({ each: true }) @Min(0, { each: true }) @Max(6, { each: true }) posting_days?: number[];
  @IsOptional() @IsObject() hashtag_strategy?: Record<string, unknown>;
  @IsOptional() @IsString() @MaxLength(500) cta_default?: string | null;
  @IsOptional() @IsBoolean() requires_approval?: boolean;
  @IsOptional() @IsBoolean() auto_publish?: boolean;
  @IsOptional() @IsIn(PLAN_STATUS) status?: (typeof PLAN_STATUS)[number];
}

export class IgPlansQueryDto {
  /** `true`: sem os planos arquivados (`neq status 'archived'` do diálogo de programação). */
  @IsOptional() @IsIn(['true', 'false']) exclude_archived?: string;
}

export class IgInsightsQueryDto {
  /** `YYYY-MM-DD` (o `.gte('date', …)` da tela). */
  @IsOptional() @Matches(DATE) since?: string;
}

export class IgEventsQueryDto {
  @IsOptional() @IsString() @Matches(/^\d{1,3}$/) limit?: string;
}
