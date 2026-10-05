/**
 * Pipeline de direção de arte para imagens: variações → Biblioteca → crítico visual → melhor escolhida
 * (1 nova tentativa se < 28/50) → composição com logo e textos (jimp + opentype.js; nunca gerados pela IA).
 */
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../common/database/prisma.service';
import { AiService } from '../ai/ai.service';
import { AssetsService, MediaAsset } from '../media/assets.service';
import { TargetFormat } from '../media/formats';
import { ImageService } from '../media/image.service';
import { UserError } from '../media/user-error';
import { providerPrompt } from './art-director';
import { composeCreative } from './compose';
import { MIN_SCORE, scoreCreative } from './critic';
import { GenerationResult, ServerCreativeProvider } from './creative.types';
import { BrandRef, RefsService } from './refs.service';
import { AiScore, ArtDirection, listField, TextLayout, Variation, VisualStyle } from './visual-style';

export type PipelineInput = {
  workspaceId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  brand: any | null;
  provider: ServerCreativeProvider;
  ad: ArtDirection;
  aspectRatio: string;
  targetFormat: TargetFormat;
  refs: BrandRef[];
  variations: number;
  layout: TextLayout;
  text: { title?: string | null; price?: string | null; cta?: string | null };
  title: string;
  campaignId?: string | null;
  angle?: string | null;
  igPostId?: string | null;
  createdBy?: string | null;
  /** Reescreve a direção de arte a partir do motivo do crítico. */
  rebuild?: (motivo: string) => Promise<ArtDirection>;
  /** Chamado entre as etapas (rodada, nova tentativa, composição): quem chama renova o lease do post; se lançar, o pipeline aborta. */
  onStage?: () => Promise<void>;
};

export type PipelineResult =
  | { pending: GenerationResult; ad: ArtDirection }
  | {
      pending: null;
      ad: ArtDirection;
      variations: Variation[];
      winner: Variation;
      finalAssetId: string;
      finalUrl: string;
      finalThumb: string | null;
      width: number | null;
      height: number | null;
      igReady: boolean;
      cost: number;
    };

type PoolItem = { asset: MediaAsset; bytes: Uint8Array; score: AiScore | null; prompt: string };

@Injectable()
export class PipelineService {
  private readonly logger = new Logger(PipelineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly assets: AssetsService,
    private readonly images: ImageService,
    private readonly refsSvc: RefsService,
  ) {}

  private patchReport(asset: MediaAsset, extra: Record<string, unknown>) {
    return this.prisma.media_assets.update({
      where: { id: asset.id },
      data: { quality_report: { ...((asset.quality_report as object) ?? {}), ...extra } as Prisma.InputJsonObject },
    });
  }

  async run(inp: PipelineInput): Promise<PipelineResult> {
    const group = randomUUID();
    let ad = inp.ad;
    let cost = 0;
    const pool: PoolItem[] = [];
    const vs = (inp.brand?.visual_style ?? {}) as VisualStyle;
    const palette = listField(vs.paleta_hex).length ? listField(vs.paleta_hex) : [inp.brand?.primary_color, inp.brand?.secondary_color].filter(Boolean);

    const round = async (n: number): Promise<GenerationResult | null> => {
      const req = {
        finalPrompt: providerPrompt(ad),
        aspectRatio: inp.aspectRatio,
        kind: 'image' as const,
        referenceImages: inp.refs.map((r) => ({ bytes: r.bytes, mime: r.mime })),
        referenceUrls: inp.refs.map((r) => r.url).filter(Boolean),
      };
      const settled = await Promise.allSettled(Array.from({ length: n }, () => inp.provider.generateImage(req)));
      const ok = settled.filter((s): s is PromiseFulfilledResult<GenerationResult> => s.status === 'fulfilled').map((s) => s.value);
      const pending = ok.find((r) => r.status === 'generating' && r.externalJobId);
      if (pending && !ok.some((r) => r.status === 'ready')) return pending;
      const ready = ok.filter((r) => r.status === 'ready' && (r.assetUrl || r.bytes));
      if (!ready.length) {
        const err = settled.find((s) => s.status === 'rejected') as PromiseRejectedResult | undefined;
        const failed = ok.find((r) => r.status === 'failed');
        // O erro real do provedor (classe incluída, p.ex. AiError 402/429) é preservado; sem ele, o motivo vem do resultado.
        if (err?.reason instanceof Error) throw err.reason;
        const reason = err?.reason ? String(err.reason) : null;
        throw new UserError(reason || failed?.raw || `O provedor não devolveu uma imagem pronta (${ok.map((r) => r.status).join(', ') || 'sem resposta'}).`);
      }
      await Promise.all(
        ready.map(async (r) => {
          cost += r.cost;
          const asset = await this.assets.ingest({
            workspaceId: inp.workspaceId, kind: 'image', targetFormat: inp.targetFormat, source: inp.provider.id,
            ...(r.bytes ? { bytes: new Uint8Array(r.bytes), mime: r.mime ?? null } : { sourceUrl: r.assetUrl! }),
            title: `${inp.title} (limpa)`, prompt: ad.prompt_final, provider: inp.provider.id, cost: r.cost,
            brandId: inp.brand?.id ?? null, campaignId: inp.campaignId ?? null, angle: inp.angle ?? null,
            igPostId: inp.igPostId ?? null, createdBy: inp.createdBy ?? null,
          });
          const { bytes } = await this.assets.readBytes(asset);
          let score: AiScore | null = null;
          try {
            score = await scoreCreative(this.ai, this.images, {
              workspaceId: inp.workspaceId, image: bytes, refs: inp.refs, palette, aspectRatio: inp.aspectRatio, subject: ad.subject,
            });
          } catch (e) {
            this.logger.warn(`[critic] falhou: ${e instanceof Error ? e.message : e}`);
          }
          pool.push({ asset, bytes, score, prompt: ad.prompt_final });
        }),
      );
      return null;
    };

    // O post também guarda `variations` como lista de imagens anteriores; esse valor não é uma contagem.
    // NaN aqui criava zero chamadas ao provedor e o erro enganoso "não devolveu imagens".
    const count = Number.isFinite(inp.variations) ? Math.max(1, Math.min(4, inp.variations)) : 3;
    const pending = await round(count);
    if (pending) return { pending, ad };
    await inp.onStage?.();

    const best = () => [...pool].sort((a, b) => (b.score?.total ?? -1) - (a.score?.total ?? -1))[0]!;
    const top = best();
    if (inp.rebuild && top.score && top.score.total < MIN_SCORE) {
      try {
        ad = await inp.rebuild(top.score.motivo);
        await round(1);
      } catch (e) {
        this.logger.warn(`[pipeline] nova tentativa falhou: ${e instanceof Error ? e.message : e}`);
      }
    }
    await inp.onStage?.();
    const win = best();

    await Promise.all(pool.map((p) => this.patchReport(p.asset, { ai_score: p.score, winner: p === win, variation_group: group, version: 'clean' })));

    // Composição final (texto e logo por cima). "Limpo" sem logo = a própria vencedora.
    let final: MediaAsset = win.asset;
    const logoPos = vs.posicao_logo ?? 'none';
    const needsCompose = inp.layout !== 'limpo' || logoPos !== 'none';
    if (needsCompose) {
      try {
        const [font, logo] = await Promise.all([this.refsSvc.loadFont(inp.workspaceId, inp.brand?.id), this.refsSvc.loadLogo(inp.workspaceId, inp.brand?.id)]);
        const composed = await composeCreative(this.images, {
          image: win.bytes, aspectRatio: inp.aspectRatio, layout: inp.layout, title: inp.text.title, price: inp.text.price, cta: inp.text.cta,
          logo, logoPosition: logoPos, font, primary: palette[0] ?? null, secondary: palette[1] ?? null,
        });
        final = await this.assets.ingest({
          workspaceId: inp.workspaceId, kind: 'image', targetFormat: inp.targetFormat, source: inp.provider.id, bytes: composed, mime: 'image/jpeg',
          title: inp.title, prompt: win.prompt, provider: inp.provider.id, brandId: inp.brand?.id ?? null, campaignId: inp.campaignId ?? null,
          angle: inp.angle ?? null, igPostId: inp.igPostId ?? null, parentId: win.asset.id, createdBy: inp.createdBy ?? null,
        });
        await this.patchReport(final, { ai_score: win.score, winner: true, variation_group: group, version: 'final', layout: inp.layout });
      } catch (e) {
        this.logger.error(`[compose] falhou; usando a imagem limpa: ${e instanceof Error ? e.message : e}`);
      }
    }

    const variations: Variation[] = pool.map((p) => ({ assetId: p.asset.id, url: p.asset.url ?? '', score: p.score, winner: p === win }));
    return {
      pending: null,
      ad,
      variations,
      winner: variations.find((v) => v.winner)!,
      finalAssetId: final.id,
      finalUrl: final.url ?? '',
      finalThumb: final.thumbnail_url ?? final.url,
      width: final.width,
      height: final.height,
      igReady: final.ig_ready,
      cost,
    };
  }
}
