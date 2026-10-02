import { Module } from '@nestjs/common';
import { WebhookLedgerService } from './webhook-ledger.service';

/** Ledger/assinatura/integração dos webhooks da Meta — usado pelo Instagram (Task 5) e pelos canais do CRM (Task 8). */
@Module({ providers: [WebhookLedgerService], exports: [WebhookLedgerService] })
export class WebhooksModule {}
