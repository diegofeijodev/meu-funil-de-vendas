import { Injectable } from '@nestjs/common';
import { PostCreativeContext } from '../creative/creative-context';
import { strategyBrief } from '../strategist/strategist.prompt';
import { StrategistService } from '../strategist/strategist.service';
import { RunStrategy } from './content-strategy';
import { PostRow } from './ig-types';
import { IgStore } from './ig-store.service';

/** Monta o `PostCreativeContext` de um post — tudo DENTRO da empresa do post (id de outra empresa nunca entra no prompt). */
@Injectable()
export class PostContextService {
  constructor(
    private readonly store: IgStore,
    private readonly strategist: StrategistService,
  ) {}

  async build(post: PostRow, brandId: string | null): Promise<PostCreativeContext> {
    const prisma = this.store.prisma;
    const ws: string = post.workspace_id;
    const brief = (post.creative_brief ?? {}) as Record<string, unknown>;
    const [product, persona, run, plan] = await Promise.all([
      post.product_id ? prisma.products.findFirst({ where: { id: post.product_id, workspace_id: ws }, select: { name: true, description: true, price: true } }) : null,
      post.persona && brandId ? prisma.personas.findFirst({ where: { workspace_id: ws, brand_id: brandId, name: post.persona }, select: { name: true, pains: true, desires: true } }) : null,
      post.run_id ? prisma.ig_auto_runs.findFirst({ where: { id: post.run_id, workspace_id: ws }, select: { focus: true, strategy: true, campaign_id: true } }) : null,
      post.plan_id ? prisma.ig_content_plans.findFirst({ where: { id: post.plan_id, workspace_id: ws }, select: { objective: true } }) : null,
    ]);
    const campaignId = run?.campaign_id ?? (typeof brief['campaign_id'] === 'string' ? (brief['campaign_id'] as string) : null);
    const campaign = campaignId ? await prisma.campaigns.findFirst({ where: { id: campaignId, workspace_id: ws }, select: { id: true, offer_product: true, offer_promise: true } }) : null;
    const approved = campaign ? strategyBrief(await this.strategist.currentStrategy(ws, campaign.id).catch(() => null)) : null;
    const s = (run?.strategy ?? null) as Partial<RunStrategy> | null;
    const productName = typeof brief['product_name'] === 'string' ? (brief['product_name'] as string).trim() : '';
    const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
    return {
      product: product
        ? { name: product.name, description: product.description, price: product.price == null ? null : Number(product.price) }
        : productName
          ? { name: productName, description: null, price: null }
          : null,
      pillar: text(post.pillar) ?? text(brief['pillar']),
      persona: persona ?? (text(post.persona) ? { name: text(post.persona)!, pains: null, desires: null } : null),
      funnelStage: text(post.funnel_stage) ?? text(brief['funnel_stage']),
      objective: text(run?.focus) ?? text(plan?.objective),
      strategy: s ? { mensagem_central: s.mensagem_central ?? '', publico_foco: s.publico_foco ?? '', proibicoes: Array.isArray(s.proibicoes) ? s.proibicoes : [] } : null,
      campaign: campaign ? { offer: campaign.offer_product, promise: campaign.offer_promise, brief: approved } : null,
      scheduledAt: post.scheduled_at ? new Date(post.scheduled_at).toISOString() : null,
    };
  }
}
