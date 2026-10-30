import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service';
import { CampaignsService } from '../../campaigns/campaigns.service';
import { buildCopyBrief } from '../../copy-ai/copy-brief';
import { CopyAiService } from '../../copy-ai/copy-ai.service';
import type { PilotStep, StepResult } from '../pilot-runner.service';
import type { PilotRunRow } from '../pilot.types';

/** Textos do anúncio: a copy de sempre, com marca e briefing montados no servidor. Copy feita depois da aprovação (à mão ou não) = feito. */
@Injectable()
export class CopiesStep implements PilotStep {
  constructor(
    private readonly prisma: PrismaService,
    private readonly copyAi: CopyAiService,
    private readonly campaigns: CampaignsService,
  ) {}

  async run(run: PilotRunRow): Promise<StepResult> {
    const ws = run.workspace_id;
    const existing = await this.prisma.copies.findFirst({
      where: { workspace_id: ws, campaign_id: run.campaign_id, ...(run.approved_at ? { created_at: { gte: run.approved_at } } : {}) },
      select: { id: true },
    });
    if (existing) return { kind: 'done', ref: existing.id, note: 'Já havia textos depois da aprovação.' };
    const campaign = await this.prisma.campaigns.findFirst({ where: { id: run.campaign_id, workspace_id: ws } });
    if (!campaign) return { kind: 'skipped', note: 'Campanha não encontrada.' };
    const brandRow = campaign.brand_id ? await this.prisma.brands.findFirst({ where: { id: campaign.brand_id, workspace_id: ws } }) : null;
    const { brand, brief } = buildCopyBrief(campaign, brandRow);
    const { content } = await this.copyAi.generateAsSystem({ workspaceId: ws, brand, brief, campaignId: campaign.id, seed: 0 });
    const copy = await this.campaigns.createCopy(null, ws, campaign.id, { content });
    return { kind: 'done', ref: copy.id, note: 'Textos prontos.' };
  }
}
