import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { StrategistService } from './strategist.service';

export class ByCampaignDto {
  @IsUUID() campaignId!: string;
}
export class ByStrategyDto {
  @IsUUID() strategyId!: string;
}

/** Server fns de `ai/strategist.functions.ts`: `POST /v1/ai/<nome-em-kebab>` (corpo = o `data` do protótipo). */
@ApiTags('Strategist')
@ApiBearerAuth()
@Controller('v1/ai')
export class StrategistController {
  constructor(private readonly strategist: StrategistService) {}

  @Post('generate-campaign-strategy')
  @HttpCode(200)
  generate(@CurrentUser() user: AuthUser, @Body() dto: ByCampaignDto) {
    return this.strategist.generate(user.id, dto.campaignId);
  }

  @Post('approve-campaign-strategy')
  @HttpCode(200)
  approve(@CurrentUser() user: AuthUser, @Body() dto: ByStrategyDto) {
    return this.strategist.approve(user.id, dto.strategyId);
  }

  @Post('create-ig-plan-from-strategy')
  @HttpCode(200)
  igPlan(@CurrentUser() user: AuthUser, @Body() dto: ByCampaignDto) {
    return this.strategist.createIgPlan(user.id, dto.campaignId);
  }
}
