import { Injectable } from '@nestjs/common';
import { MetaAdsService } from './meta-ads.service';
import { MetaOpsService } from './meta-ops.service';

/**
 * Porta estreita da Meta para o piloto do estrategista (Fatia 4): só montar o anúncio PAUSADO e saber se faltam credenciais.
 * O piloto não recebe o `MetaAdsService` inteiro — ligar verba (`setStatus`) fica fora do alcance dele por construção (§2.0 #1).
 */
@Injectable()
export class MetaPilotPublisher {
  constructor(
    private readonly meta: MetaAdsService,
    private readonly ops: MetaOpsService,
  ) {}

  publishPaused(ws: string, campaignId: string, via: { runId: string }) {
    return this.meta.publishAsSystem(ws, campaignId, via);
  }

  missingCredentials(ws: string): Promise<string[]> {
    return this.ops.missing(ws);
  }
}
