import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

const HHMM = /^\d{2}:\d{2}$/;
export const LEAD_OPTIONS = [60, 120, 240, 360] as const;
export const VENDORS = ['openai', 'gemini'] as const;

/** `PATCH …/vacancy-stories/settings`. Sem default: campo ausente = não muda. Ligar/desligar e postar sozinho têm rotas próprias. */
export class UpdateVacancySettingsDto {
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) @MaxLength(80, { each: true }) cities?: string[];
  @IsOptional() @IsInt() @Min(1) @Max(20) daily_cap?: number;
  @IsOptional() @IsString() @Matches(HHMM, { message: 'Horário no formato HH:MM.' }) window_start?: string;
  @IsOptional() @IsString() @Matches(HHMM, { message: 'Horário no formato HH:MM.' }) window_end?: string;
  @IsOptional() @IsIn(LEAD_OPTIONS) min_lead_minutes?: (typeof LEAD_OPTIONS)[number];
  @IsOptional() @IsIn(VENDORS) vendor?: (typeof VENDORS)[number];
}

/** `POST …/vacancy-stories/auto-publish`. */
export class AutoPublishDto {
  @IsBoolean() auto_publish!: boolean;
}
