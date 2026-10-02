import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/database/prisma.service';

/**
 * `/overview`: as cinco leituras diretas que a tela fazia em um `Promise.all` (mesmos filtros, ordem e colunas).
 * Os cálculos (KPIs, agrupamentos) continuam no navegador (`lib/metrics.ts`).
 */
@Injectable()
export class OverviewService {
  constructor(private readonly prisma: PrismaService) {}

  async get(workspaceId: string) {
    const [performance_daily, campaigns, campaign_costs, ai_recommendations, creatives] = await Promise.all([
      // select * eq workspace_id, neq source 'demo' (todas as linhas, sem filtro de data)
      this.prisma.performance_daily.findMany({ where: { workspace_id: workspaceId, source: { not: 'demo' } } }),
      this.prisma.campaigns.findMany({ where: { workspace_id: workspaceId } }),
      this.prisma.campaign_costs.findMany({ where: { workspace_id: workspaceId }, select: { amount: true } }),
      // eq status 'pending', order severity (asc)
      this.prisma.ai_recommendations.findMany({ where: { workspace_id: workspaceId, status: 'pending' }, orderBy: [{ severity: 'asc' }, { created_at: 'asc' }] }),
      this.prisma.creatives.findMany({ where: { workspace_id: workspaceId }, select: { id: true, title: true } }),
    ]);
    return { performance_daily, campaigns, campaign_costs, ai_recommendations, creatives };
  }
}
