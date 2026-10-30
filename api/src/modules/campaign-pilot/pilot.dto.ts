import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsBoolean, IsDefined, IsIn, IsInt, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateNested,
} from 'class-validator';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const FORMATS = ['feed_image', 'feed_carousel', 'reel', 'story_image', 'story_video'] as const;

export class PilotInstagramDto {
  @IsBoolean() enabled!: boolean;
  @IsIn(['approval', 'publish']) mode!: 'approval' | 'publish';
  @IsInt({ each: true }) @Min(0, { each: true }) @Max(6, { each: true }) @ArrayMinSize(1) @ArrayMaxSize(7) weekdays!: number[];
  @IsString({ each: true }) @Matches(HHMM, { each: true }) @ArrayMaxSize(6) times!: string[];
  @IsString({ each: true }) @Matches(HHMM, { each: true }) @ArrayMaxSize(6) story_times!: string[];
  @IsIn(FORMATS, { each: true }) @ArrayMinSize(1) @ArrayMaxSize(5) formats!: (typeof FORMATS)[number][];
}

export class PilotMetaDto {
  @IsBoolean() enabled!: boolean;
  @IsBoolean() review_creatives!: boolean;
}

/** Pacote do piloto. Nada aqui tem padrão: o que muda gasto ou publicação vem explícito da tela. */
export class PilotOptionsDto {
  @IsInt() @Min(1) @Max(5) max_angles!: number;
  @IsInt() @Min(1) @Max(3) images_per_angle!: number;
  @IsInt() @Min(1) @Max(3) variations!: number;
  @IsInt() @Min(0) @Max(2) videos!: number;
  @IsDefined() @ValidateNested() @Type(() => PilotInstagramDto) instagram!: PilotInstagramDto;
  @IsDefined() @ValidateNested() @Type(() => PilotMetaDto) meta!: PilotMetaDto;
  @IsNumber() @Min(1) @Max(500) max_credits!: number;
}

export class CreatePilotDto {
  @IsString() @MinLength(8) @MaxLength(100) idempotency_key!: string;
}

export class EstimatePilotDto {
  @IsDefined() @ValidateNested() @Type(() => PilotOptionsDto) options!: PilotOptionsDto;
}

export class ApprovePilotDto {
  @IsInt() @Min(1) strategy_version!: number;
  /** Dono/admin: aprova o pedido do anúncio na hora (um toque). Sem ele, o pedido fica em Approvals. */
  @IsOptional() @IsBoolean() approve_now?: boolean;
  @IsDefined() @ValidateNested() @Type(() => PilotOptionsDto) options!: PilotOptionsDto;
}

export class ResumePilotDto {
  @IsIn(['retry', 'proceed_partial', 'raise_cap']) action!: 'retry' | 'proceed_partial' | 'raise_cap';
  @IsOptional() @IsNumber() @Min(1) @Max(500) max_credits?: number;
}

export class CancelPilotDto {
  @IsBoolean() cancel_instagram!: boolean;
}
