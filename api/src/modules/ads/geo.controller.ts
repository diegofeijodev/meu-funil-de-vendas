import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ParseUuidPipe } from '../../common/ids/uuid';
import { WorkspaceAccessGuard } from '../access/workspace-access.guard';
import { MetaAdsService } from './meta-ads.service';

/** Busca de cidade da Meta para a região da campanha (Fatia 2). GET = qualquer membro. */
@ApiTags('Geo')
@ApiBearerAuth()
@UseGuards(WorkspaceAccessGuard)
@Controller('v1/workspaces/:workspaceId/geo')
export class GeoController {
  constructor(private readonly meta: MetaAdsService) {}

  @Get('search')
  search(@CurrentUser() user: AuthUser, @Param('workspaceId', ParseUuidPipe) ws: string, @Query('q') q?: string) {
    return this.meta.geoSearch(user.id, ws, q ?? '');
  }
}
