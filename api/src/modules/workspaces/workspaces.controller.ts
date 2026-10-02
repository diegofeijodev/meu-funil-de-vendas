import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ParseUuidPipe } from '../../common/ids/uuid';
import { CreateWorkspaceDto, UpdateProfileDto, UpdateWorkspaceDto } from './dto/workspaces.dto';
import { WorkspacesService } from './workspaces.service';

@ApiTags('Workspaces')
@ApiBearerAuth()
@Controller('v1')
export class WorkspacesController {
  constructor(private readonly workspaces: WorkspacesService) {}

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
