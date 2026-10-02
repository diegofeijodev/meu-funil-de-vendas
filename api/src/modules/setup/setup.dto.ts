import { IsUUID } from 'class-validator';

export class SetupStatusDto {
  @IsUUID() workspaceId!: string;
}
