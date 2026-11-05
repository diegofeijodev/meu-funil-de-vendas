import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ParseUuidPipe } from '../../common/ids/uuid';
import { CreateWorkspaceDto, DeleteWorkspaceDto, UpdateProfileDto, UpdateWorkspaceDto } from './dto/workspaces.dto';
import { WorkspacesService } from './workspaces.service';
import { FeaturesService } from './features.service';
import { WorkspaceDeletionService } from './workspace-deletion.service';

@ApiTags('Workspaces')
@ApiBearerAuth()
@Controller('v1')
export class WorkspacesController {
  constructor(
    private readonly workspaces: WorkspacesService,
    private readonly features: FeaturesService,
    private readonly deletion: WorkspaceDeletionService,
  ) {}

  @Get('workspaces')
  listMine(@CurrentUser() user: AuthUser) {
    return this.workspaces.listMine(user.id);
  }

  @Post('workspaces')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateWorkspaceDto) {
    return this.workspaces.create(user.id, dto.name);
  }

  @Get('workspaces/:workspaceId')
  get(@CurrentUser() user: AuthUser, @Param('workspaceId', ParseUuidPipe) id: string) {
    return this.workspaces.get(user.id, id);
  }

  @Patch('workspaces/:workspaceId')
  rename(@CurrentUser() user: AuthUser, @Param('workspaceId', ParseUuidPipe) id: string, @Body() dto: UpdateWorkspaceDto) {
    return this.workspaces.rename(user.id, id, dto.name);
  }

  /** O que "Apagar empresa" leva junto e o que impede (só o dono; contrato §31). */
  @Get('workspaces/:workspaceId/deletion-preview')
  deletionPreview(@CurrentUser() user: AuthUser, @Param('workspaceId', ParseUuidPipe) id: string) {
    return this.deletion.preview(user.id, id);
  }

  /** Apaga a empresa e tudo dela (só o dono, com o nome digitado; contrato §31). */
  @Delete('workspaces/:workspaceId')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Param('workspaceId', ParseUuidPipe) id: string, @Body() dto: DeleteWorkspaceDto): Promise<void> {
    await this.deletion.remove(user.id, id, dto.confirmName);
  }

  /** O que está liberado para esta empresa (qualquer membro). */
  @Get('workspaces/:workspaceId/features')
  featuresOf(@CurrentUser() user: AuthUser, @Param('workspaceId', ParseUuidPipe) id: string) {
    return this.features.forWorkspace(user.id, id);
  }

  @Get('workspaces/:workspaceId/members')
  members(@CurrentUser() user: AuthUser, @Param('workspaceId', ParseUuidPipe) id: string) {
    return this.workspaces.members(user.id, id);
  }

  @Get('profiles/me')
  getProfile(@CurrentUser() user: AuthUser) {
    return this.workspaces.getProfile(user.id);
  }

  @Patch('profiles/me')
  updateProfile(@CurrentUser() user: AuthUser, @Body() dto: UpdateProfileDto) {
    return this.workspaces.updateProfile(user.id, dto);
  }
}
