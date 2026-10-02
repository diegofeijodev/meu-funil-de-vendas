import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsIn, IsUUID } from 'class-validator';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ConversionEvent, CrmConversionService } from './crm-conversion.service';

export class NotifyMetaConversionDto {
  @IsUUID() workspaceId!: string;
  @IsUUID() leadId!: string;
  @IsIn(['Qualificado', 'Ganho']) event!: ConversionEvent;
}

/** `notifyMetaConversion` (arquivo `crm-integrations.functions` do protótipo): `POST /v1/crm-integrations/notify-meta-conversion`. */
@ApiTags('CRM')
@ApiBearerAuth()
@Controller('v1/crm-integrations')
export class CrmConversionController {
  constructor(private readonly conversion: CrmConversionService) {}

  @Post('notify-meta-conversion') @HttpCode(200)
  notify(@CurrentUser() u: AuthUser, @Body() d: NotifyMetaConversionDto) {
    return this.conversion.notify(u.id, d.workspaceId, d.leadId, d.event);
  }
}
