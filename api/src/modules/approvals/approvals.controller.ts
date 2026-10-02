import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ParseUuidPipe } from '../../common/ids/uuid';
import { WorkspaceAccessGuard } from '../access/workspace-access.guard';
import { ApprovalsService } from './approvals.service';
import { DecideApprovalDto } from './dto/approvals.dto';

/** Leituras diretas da tela `/approvals` (GET = read). */
@ApiTags('Approvals')
@ApiBearerAuth()
@UseGuards(WorkspaceAccessGuard)
@Controller('v1/workspaces/:workspaceId')
export class ApprovalsReadController {
  constructor(private readonly approvals: ApprovalsService) {}

  @Get('approvals')
  list(@Param('workspaceId', ParseUuidPipe) ws: string) {
    return this.approvals.list(ws);
  }

  @Get('activity-logs')
  logs(@Param('workspaceId', ParseUuidPipe) ws: string, @Query('limit') limit?: string) {
    return this.approvals.logs(ws, limit === undefined ? 30 : Number(limit));
  }
}

/** Server fn `decideApproval` (`approvals.functions.ts`): `POST /v1/approvals/decide-approval`. O workspace vem do pedido. */
@ApiTags('Approvals')
@ApiBearerAuth()
@Controller('v1/approvals')
export class ApprovalsActionController {
  constructor(private readonly approvals: ApprovalsService) {}

  @Post('decide-approval')
  @HttpCode(200)
  decide(@CurrentUser() user: AuthUser, @Body() dto: DecideApprovalDto) {
    return this.approvals.decide(user.id, dto.approvalId, dto.decision);
  }
}
