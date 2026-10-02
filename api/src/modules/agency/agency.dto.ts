import { IsUUID, ValidateIf } from 'class-validator';

export class SetAiInheritanceDto {
  @IsUUID() workspaceId!: string;
  /** `null` = só as chaves/conexões próprias. */
  @ValidateIf((o: SetAiInheritanceDto) => o.sourceId !== null) @IsUUID() sourceId!: string | null;
}

export class ApplyAiInheritanceToAllDto {
  @IsUUID() sourceId!: string;
}
