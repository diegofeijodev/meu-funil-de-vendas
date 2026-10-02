import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsNotEmpty, IsObject, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';

const KINDS = ['meta_lead_ads', 'whatsapp', 'instagram', 'site_form', 'email', 'calendar'];
const PROVIDERS = ['meta', 'whatsapp_cloud', 'zapi', 'evolution', 'site', 'resend', 'calcom'];

export class WsDto { @IsUUID() workspaceId!: string; }
export class KindDto extends WsDto { @IsIn(KINDS) kind!: string; }
export class SaveIntegrationDto extends KindDto {
  @IsIn(PROVIDERS) provider!: string;
  @IsOptional() @IsObject() config?: Record<string, unknown>;
  @IsOptional() @IsObject() fieldMapping?: Record<string, string>;
  @IsOptional() @IsIn(['disconnected', 'connecting', 'connected']) status?: string;
}
export class FormFieldsDto extends WsDto { @IsString() @MaxLength(40) formId!: string; }
export class SendWhatsAppDto extends WsDto {
  @IsUUID() leadId!: string;
  @IsIn(['text', 'image', 'audio', 'template']) kind!: 'text' | 'image' | 'audio' | 'template';
  @IsOptional() @IsString() @MaxLength(4096) body?: string;
  @IsOptional() @IsString() @MaxLength(2000) mediaUrl?: string;
  @IsOptional() @IsString() @MaxLength(200) templateName?: string;
  @IsOptional() @IsString() @MaxLength(20) templateLanguage?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) templateParams?: string[];
}
export class SecretDto extends WsDto { @IsString() key!: string; @IsString() @MaxLength(4000) value!: string; }
export class EventDto extends WsDto { @IsUUID() eventId!: string; }
export class SendInstagramDto extends WsDto { @IsUUID() leadId!: string; @IsString() @IsNotEmpty() @MaxLength(1000) body!: string; }
export class SendEmailDto extends WsDto {
  @IsUUID() leadId!: string;
  @IsString() @IsNotEmpty() @MaxLength(300) subject!: string;
  @IsString() @IsNotEmpty() @MaxLength(20000) body!: string;
}

export class WindowDto {
  @IsArray() @IsInt({ each: true }) days!: number[];
  @IsString() @MaxLength(5) start!: string;
  @IsString() @MaxLength(5) end!: string;
}
export class StepDto {
  @IsIn(['wa_text', 'wa_template', 'email', 'call_task']) channel!: 'wa_text' | 'wa_template' | 'email' | 'call_task';
  @IsInt() @Min(0) @Max(525600) delay_minutes!: number;
  @IsOptional() @ValidateNested() @Type(() => WindowDto) window?: WindowDto;
  @IsOptional() @IsString() @MaxLength(4096) message?: string;
  @IsOptional() @IsString() @MaxLength(300) subject?: string;
  @IsOptional() @IsString() @MaxLength(200) template_name?: string;
  @IsOptional() @IsString() @MaxLength(20) template_language?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) template_params?: string[];
  @IsOptional() @IsString() @MaxLength(200) fallback_template?: string;
}
export class ExitRulesDto {
  @IsOptional() @IsBoolean() on_reply?: boolean;
  @IsOptional() @IsBoolean() on_stage_change?: boolean;
  @IsOptional() @IsBoolean() on_won_lost?: boolean;
  @IsOptional() @IsBoolean() on_opt_out?: boolean;
  @IsOptional() @IsBoolean() on_human_takeover?: boolean;
}
export class SaveCadenceDto extends WsDto {
  @IsOptional() @IsUUID() id?: string | null;
  @IsString() @MaxLength(200) name!: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsIn(['source', 'campaign', 'stage', 'tag', 'manual']) triggerType!: string;
  @IsOptional() @IsString() @MaxLength(200) triggerValue?: string | null;
  @IsBoolean() isActive!: boolean;
  @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => StepDto) steps!: StepDto[];
  @ValidateNested() @Type(() => ExitRulesDto) exitRules!: ExitRulesDto;
  @IsOptional() @IsString() @MaxLength(100) templateKey?: string | null;
}
export class DeleteCadenceDto extends WsDto { @IsUUID() id!: string; }
export class EnrollDto extends WsDto { @IsUUID() cadenceId!: string; @IsArray() @ArrayMaxSize(500) @IsUUID('all', { each: true }) leadIds!: string[]; }
export class StopLeadDto extends WsDto { @IsUUID() leadId!: string; }

export class QuestionDto { @IsString() @MaxLength(100) key!: string; @IsString() @MaxLength(1000) question!: string; @IsInt() @Min(0) @Max(1000) weight!: number; }
export class HoursDto {
  @IsString() @MaxLength(60) timezone!: string;
  @IsArray() @IsInt({ each: true }) days!: number[];
  @IsString() @MaxLength(5) start!: string;
  @IsString() @MaxLength(5) end!: string;
}
export class SaveSdrDto extends WsDto {
  @IsBoolean() isActive!: boolean;
  @IsString() @MaxLength(200) name!: string;
  @IsString() @MaxLength(4000) persona!: string;
  @IsString() @MaxLength(500) tone!: string;
  @IsString() @MaxLength(4000) goal!: string;
  @IsString() @MaxLength(100000) knowledgeText!: string;
  @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => QuestionDto) questions!: QuestionDto[];
  @IsInt() @Min(0) @Max(100) minScore!: number;
  @IsOptional() @IsString() @MaxLength(1000) schedulingLink!: string | null;
  @IsArray() @ArrayMaxSize(100) @IsString({ each: true }) availableSlots!: string[];
  @ValidateNested() @Type(() => HoursDto) businessHours!: HoursDto;
  @IsString() @MaxLength(1000) offhoursMessage!: string;
  @IsInt() @Min(1) @Max(1000) maxMessages!: number;
  @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) handoffTriggers!: string[];
  @IsOptional() @IsString() @MaxLength(100) model?: string;
}
export class UploadSdrDocDto extends WsDto {
  @IsString() @MaxLength(255) fileName!: string;
  @IsString() @MaxLength(100) mimeType!: string;
  @IsString() @MaxLength(7_200_000) contentBase64!: string;
}
export class DeleteSdrDocDto extends WsDto { @IsUUID() documentId!: string; }
export class TurnDto { @IsIn(['user', 'assistant']) role!: 'user' | 'assistant'; @IsString() @MaxLength(4000) content!: string; }
export class TestSdrDto extends WsDto { @IsArray() @ArrayMaxSize(60) @ValidateNested({ each: true }) @Type(() => TurnDto) history!: TurnDto[]; }
