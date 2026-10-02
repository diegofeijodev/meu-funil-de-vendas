import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ApplyAiInheritanceToAllDto, SetAiInheritanceDto } from './agency.dto';
import { AgencyService } from './agency.service';

/** Ações de `agency.functions.ts`. Sem workspace na URL: valem para todas as empresas do usuário. */
@ApiTags('Agency')
@ApiBearerAuth()
@Controller('v1/agency')
export class AgencyController {
  constructor(private readonly agency: AgencyService) {}

  @Post('overview')
  @HttpCode(200)
  overview(@CurrentUser() user: AuthUser) {
    return this.agency.overview(user.id);
  }

  /** Exige owner|admin da empresa E da origem (impede emprestar chaves BYO de outro cliente). */
  @Post('set-ai-inheritance')
  @HttpCode(200)
  set(@CurrentUser() user: AuthUser, @Body() dto: SetAiInheritanceDto) {
    return this.agency.setInheritance(user.id, dto.workspaceId, dto.sourceId ?? null);
  }

  @Post('apply-ai-inheritance-to-all')
  @HttpCode(200)
  applyAll(@CurrentUser() user: AuthUser, @Body() dto: ApplyAiInheritanceToAllDto) {
    return this.agency.applyToAll(user.id, dto.sourceId);
  }
}
