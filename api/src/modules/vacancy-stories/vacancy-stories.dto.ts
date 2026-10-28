import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

const HHMM = /^\d{2}:\d{2}$/;
const HHMM_MSG = 'Use um horário como 08:00.';
export const LEAD_OPTIONS = [60, 120, 240, 360] as const;
export const VENDORS = ['openai', 'gemini'] as const;

/** `PATCH …/vacancy-stories/settings`. Sem default: campo ausente = não muda. Ligar/desligar e postar sozinho têm rotas próprias. */
export class UpdateVacancySettingsDto {
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) @MaxLength(80, { each: true }) cities?: string[];
  @IsOptional() @IsInt() @Min(1) @Max(20) daily_cap?: number;
  @IsOptional() @IsString() @Matches(HHMM, { message: HHMM_MSG }) window_start?: string;
  @IsOptional() @IsString() @Matches(HHMM, { message: HHMM_MSG }) window_end?: string;
  @IsOptional() @IsIn(LEAD_OPTIONS) min_lead_minutes?: (typeof LEAD_OPTIONS)[number];
  @IsOptional() @IsIn(VENDORS) vendor?: (typeof VENDORS)[number];
}

/** `POST …/vacancy-stories/auto-publish`. */
export class AutoPublishDto {
  @IsBoolean() auto_publish!: boolean;
}

export const STORY_FILTERS = ['all', 'live', 'not_posted'] as const;
export type StoryFilter = (typeof STORY_FILTERS)[number];
/** Chips depois do "Não postar": "Texto errado · Foto estranha · Não quero divulgar esta vaga". */
export const STORY_FEEDBACKS = ['texto_errado', 'foto_estranha', 'nao_divulgar'] as const;
export type StoryFeedback = (typeof STORY_FEEDBACKS)[number];

/** `GET …/vacancy-stories/stories?filter=`. Ausente = todas. */
export class ListStoriesQuery {
  @IsOptional() @IsIn(STORY_FILTERS) filter?: StoryFilter;
}

/** `POST …/vacancy-stories/stories/:id/dont-post`. Sem motivo obrigatório (D6); o feedback vem dos chips, numa 2ª chamada. */
export class DontPostDto {
  @IsOptional() @IsIn(STORY_FEEDBACKS) feedback?: StoryFeedback;
}
