import { Global, Module } from '@nestjs/common';
import { CrmDefaultsService } from './crm-defaults.service';

@Global()
@Module({ providers: [CrmDefaultsService], exports: [CrmDefaultsService] })
export class CrmDefaultsModule {}
