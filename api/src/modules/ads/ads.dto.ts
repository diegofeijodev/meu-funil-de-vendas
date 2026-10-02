import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsObject, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class WorkspaceDto {
  @IsUUID() workspaceId!: string;
}

/** `metaAdsSaveCredentials` — mensagens do zod do protótipo; ids só com dígitos (entram em caminho da Graph). */
export class MetaSaveCredentialsDto {
  @IsUUID() workspaceId!: string;
  @Transform(trim) @IsString() @MinLength(4, { message: 'Informe o ID do app.' }) @MaxLength(100) appId!: string;
  @Transform(trim) @IsString() @MinLength(8, { message: 'Informe a chave secreta do app.' }) @MaxLength(200) appSecret!: string;
  @Transform(trim) @IsString() @MinLength(20, { message: 'Informe o token do usuário do sistema.' }) @MaxLength(1000) systemUserToken!: string;
  @Transform(trim) @IsString() @MinLength(4, { message: 'Informe o ID da conta de anúncios (act_...).' }) @Matches(/^(act_)?\d+$/, { message: 'O ID da conta de anúncios deve ser act_ + números.' }) @MaxLength(40) adAccountId!: string;
  @Transform(trim) @IsString() @MinLength(4, { message: 'Informe o ID da Página do Facebook.' }) @Matches(/^\d+$/, { message: 'O ID da Página deve conter só números.' }) @MaxLength(30) pageId!: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @Transform(trim) @IsString() @Matches(/^(\d+)?$/, { message: 'O ID do Instagram deve conter só números.' }) @MaxLength(30) instagramId?: string | null;
}

export class MetaInsightsDto {
  @IsUUID() workspaceId!: string;
  @IsString() @Matches(DATE) since!: string;
  @IsString() @Matches(DATE) until!: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() campaignId?: string | null;
}

export class MetaCampaignDto {
  @IsUUID() workspaceId!: string;
  @IsUUID() campaignId!: string;
}

export class MetaSetStatusDto {
  @IsUUID() workspaceId!: string;
  @IsUUID() campaignId!: string;
  @IsIn(['ACTIVE', 'PAUSED']) status!: 'ACTIVE' | 'PAUSED';
}

export class MetaSaveAppDto {
  @IsUUID() workspaceId!: string;
  @Transform(trim) @IsString() @MinLength(4) @MaxLength(100) appId!: string;
  @Transform(trim) @IsString() @MinLength(8) @MaxLength(200) appSecret!: string;
}

/** `origin` é aceito (o web manda `window.location.origin`) mas NÃO decide nada: o redirect sai de PUBLIC_URL/APP_URL. */
export class MetaLoginUrlDto {
  @IsUUID() workspaceId!: string;
  @IsOptional() @IsString() @MaxLength(300) origin?: string;
}

export class MetaSaveAssetsDto {
  @IsUUID() workspaceId!: string;
  @IsString() @MinLength(4) @Matches(/^(act_)?\d+$/, { message: 'O ID da conta de anúncios deve ser act_ + números.' }) @MaxLength(40) adAccountId!: string;
  @IsString() @MinLength(4) @Matches(/^\d+$/, { message: 'O ID da Página deve conter só números.' }) @MaxLength(30) pageId!: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @Matches(/^\d+$/, { message: 'O ID do Instagram deve conter só números.' }) @MaxLength(30) instagramId?: string | null;
}

// ---------------------------------------------------------------------------------------------- ads-ops

export class GenerateRecommendationsDto {
  @IsUUID() workspaceId!: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() campaignId?: string | null;
}

export class DecideRecommendationDto {
  @IsUUID() id!: string;
  @IsIn(['apply', 'dismiss']) decision!: 'apply' | 'dismiss';
}

export class SaveCampaignAdsSettingsDto {
  @IsUUID() campaignId!: string;
  @IsObject() adsConfig!: Record<string, unknown>;
  @IsObject() rules!: Record<string, unknown>;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(2000) privacyUrl?: string | null;
}

export class SyncCrmAudienceDto {
  @IsUUID() workspaceId!: string;
  @IsOptional() @IsBoolean() onlyWon?: boolean;
}

// ---------------------------------------------------------------------------------------------- canais

const CHANNELS = ['google', 'tiktok'] as const;
export type AdsChannel = (typeof CHANNELS)[number];

export class ChannelDto {
  @IsUUID() workspaceId!: string;
  @IsIn(CHANNELS) channel!: AdsChannel;
}

export class SaveChannelAppDto {
  @IsUUID() workspaceId!: string;
  @IsIn(CHANNELS) channel!: AdsChannel;
  /** record<string, string trim ≤ 500>; só as chaves da lista do canal são gravadas (resto é descartado, como no protótipo). */
  @IsObject() values!: Record<string, string>;
}

export class ChannelLoginUrlDto {
  @IsUUID() workspaceId!: string;
  @IsIn(CHANNELS) channel!: AdsChannel;
  @IsOptional() @IsString() @MaxLength(300) origin?: string;
}

export class LinkExternalCampaignDto {
  @IsUUID() campaignId!: string;
  @IsIn(CHANNELS) channel!: AdsChannel;
  @Transform(trim) @IsString() @MaxLength(40) externalId!: string;
}

export class CreateExternalCampaignDto {
  @IsUUID() campaignId!: string;
  @IsIn(CHANNELS) channel!: AdsChannel;
}

export class SetExternalStatusDto {
  @IsUUID() campaignId!: string;
  @IsIn(CHANNELS) channel!: AdsChannel;
  @IsBoolean() active!: boolean;
}

export class AdsCronDto {
  @IsOptional() @IsIn(['sync', 'rules']) task?: 'sync' | 'rules';
}

export class RecommendationsQueryDto {
  @IsOptional() @Type(() => Number) limit?: number;
}
