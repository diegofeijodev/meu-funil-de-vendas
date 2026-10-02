import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class CreateWorkspaceDto {
  // Validado no serviço ("nome obrigatório", igual ao RPC create_workspace).
  @IsOptional() @IsString() name?: string;
}

export class UpdateWorkspaceDto {
  @IsOptional() @IsString() @MaxLength(200) name?: string;
}

export class UpdateProfileDto {
  @IsOptional() @IsString() @MaxLength(200) full_name?: string;
  @IsOptional() @IsString() @MaxLength(2000) @Matches(/^(https?:\/\/\S+|\/(?!\/)\S*)$/, { message: 'avatar_url deve ser http(s) ou caminho relativo' }) avatar_url?: string;
}
