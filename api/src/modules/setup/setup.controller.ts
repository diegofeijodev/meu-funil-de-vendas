import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SetupStatusDto } from './setup.dto';
import { SetupService } from './setup.service';

/** Ação `setupStatus` (setup.functions.ts): `POST /v1/setup/status` `{ workspaceId }` → `{ items: SetupItem[] }`. Qualquer membro. */
@ApiTags('Setup')
@ApiBearerAuth()
@Controller('v1/setup')
export class SetupController {
  constructor(private readonly setup: SetupService) {}

  @Post('status')
  @HttpCode(200)
  status(@CurrentUser() user: AuthUser, @Body() dto: SetupStatusDto) {
    return this.setup.status(user.id, dto.workspaceId);
  }
}
