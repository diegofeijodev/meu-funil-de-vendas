import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength,
} from 'class-validator';

export const TARGETS = ['ig_feed_square', 'ig_feed_portrait', 'ig_story', 'ig_reel', 'meta_ad_square', 'meta_ad_vertical', 'meta_ad_landscape', 'other'] as const;
export const MEDIA_STATUSES = ['draft', 'approved', 'rejected', 'archived'] as const;

class WorkspaceDto {
  @IsUUID() workspaceId!: string;
}

export class DownloadAssetDto extends WorkspaceDto {
  @IsUUID() assetId!: string;
  @IsOptional() @IsIn(['original', 'png', 'jpg']) format?: 'original' | 'png' | 'jpg';
}

export class ExportPdfDto extends WorkspaceDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @IsUUID('all', { each: true }) assetIds!: string[];
  @IsIn(['one_per_page', 'contact_sheet']) layout!: 'one_per_page' | 'contact_sheet';
}

export class AssetIdsDto extends WorkspaceDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @IsUUID('all', { each: true }) assetIds!: string[];
}

export class ReformatMediaDto extends WorkspaceDto {
  @IsUUID() assetId!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(8) @IsIn(TARGETS, { each: true }) targets!: (typeof TARGETS)[number][];
}

export class UseMediaInCampaignDto extends AssetIdsDto {
  @IsUUID() campaignId!: string;
}

export class AttachMediaToPostDto extends AssetIdsDto {
  @IsUUID() postId!: string;
}

export class DeleteMediaAssetsDto extends WorkspaceDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @IsUUID('all', { each: true }) assetIds!: string[];
}

export class RenameMediaTagDto extends WorkspaceDto {
  @IsString() @MinLength(1) @MaxLength(60) from!: string;
  @IsString() @MaxLength(60) to!: string;
}

export class RenameMediaFolderDto extends WorkspaceDto {
  @IsString() @MinLength(1) @MaxLength(120) from!: string;
  @IsString() @MaxLength(120) to!: string;
}

export class MediaAdResultsDto extends WorkspaceDto {
  @IsUUID() creativeId!: string;
}

/** `GET /v1/workspaces/:ws/media-assets` — mesmos filtros da tela (`.eq/.or/.contains/.gte/.order/.range`). */
export class MediaListQueryDto {
  @IsOptional() @IsString() @MaxLength(200) search?: string;
  @IsOptional() @IsUUID() brand_id?: string;
  @IsOptional() @IsUUID() campaign_id?: string;
  @IsOptional() @IsIn(['image', 'video']) kind?: string;
  @IsOptional() @IsIn(TARGETS) target_format?: string;
  /** `active` = tudo menos arquivadas (padrão da tela). */
  @IsOptional() @IsIn(['active', ...MEDIA_STATUSES]) status?: string;
  @IsOptional() @IsString() @MaxLength(60) tag?: string;
  @IsOptional() @IsString() @MaxLength(120) folder?: string;
  @IsOptional() @IsString() @MaxLength(40) source?: string;
  @IsOptional() @Type(() => Number) @IsInt() @IsIn([7, 30, 90]) period?: number;
  @IsOptional() @IsIn(['new', 'old', 'title', 'size']) sort?: 'new' | 'old' | 'title' | 'size';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) limit?: number;
}

/** `PATCH .../media-assets/bulk` — `update({status|folder}).in('id', picked)`. */
export class BulkMediaUpdateDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @ArrayUnique() @IsUUID('all', { each: true }) ids!: string[];
  @IsOptional() @IsIn(MEDIA_STATUSES) status?: (typeof MEDIA_STATUSES)[number];
  /** `null`/vazio = tira da pasta. */
  @IsOptional() @IsString() @MaxLength(120) folder?: string | null;
}

/** `PATCH .../media-assets/:id` — `update({tags}).eq('id', id)`. */
export class UpdateMediaTagsDto {
  @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) @MaxLength(60, { each: true }) tags!: string[];
}
