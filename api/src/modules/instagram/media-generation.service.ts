import { Prisma } from '@prisma/client';
import { Injectable, Logger } from '@nestjs/common';
import { AiService } from '../ai/ai.service';
import { buildVisualPrompt, providerPrompt } from '../creative/art-director';
import { composeCreative } from '../creative/compose';
import { choiceForProvider, GenerationResult, ProviderChoice, ServerCreativeProvider } from '../creative/creative.types';
import { PipelineService } from '../creative/pipeline.service';
import { ChainedProvider, ProviderResolverService, providerLog } from '../creative/provider-resolver.service';
import { RefsService } from '../creative/refs.service';
import { VideoExtrasService } from '../creative/video-extras.service';
import { TextLayout, VisualStyle } from '../creative/visual-style';
import { AssetsService } from '../media/assets.service';
import { targetForIgFormat } from '../media/formats';
import { ImageService } from '../media/image.service';
import { UserError } from '../media/user-error';
import { ContentService } from './content.service';
import { ASPECT, IgFormat, isVideoFormat, PostRow } from './ig-types';
import { IgStore, PostLease, PublishClaimLost, errText, leaseFree } from './ig-store.service';
import { PublishingService } from './publishing.service';

const MAX_UPLOAD = 100 * 1024 * 1024;
const PENDING_TIMEOUT_MS = 60 * 60e3;
/**
 * Lease do post durante a geração síncrona e a conclusão de um job assíncrono. Renovado a cada slide/etapa longa; o TTL cobre a maior
 * etapa única (chamada de IA 180 s, vídeo até 6 min de espera, ingestão 120 s) com folga > 2x. Vencido = o processo morreu.
 */
const MEDIA_LEASE_MS = 30 * 60e3;
export const GENERATION_INTERRUPTED = 'Geração da mídia interrompida — tente gerar de novo.';

type PendingJob = {
  provider: string;
  jobId: string;
  index: number;
  prompts: string[];
  media: any[];
  cost: number;
  instructions?: string | null;
  started_at: string;
};

type Src = { sourceUrl?: string; bytes?: Uint8Array; mime?: string };
type RefImages = { referenceImages?: { bytes: Uint8Array; mime: string }[]; referenceUrls?: string[] };

/** Geração da mídia dos posts (imagem única com pipeline, carrossel, Reels/Stories em vídeo) e envio da própria mídia. */
/** Post que o validador mandou para revisão: o claim troca o status para "generating", mas `review_reason` permanece. */
const wasFlagged = (post: PostRow) => post.status === 'needs_review' || !!post.review_reason;

@Injectable()
export class MediaGenerationService {
  private readonly logger = new Logger(MediaGenerationService.name);

  constructor(
    private readonly store: IgStore,
    private readonly ai: AiService,
    private readonly providers: ProviderResolverService,
    private readonly refs: RefsService,
    private readonly pipeline: PipelineService,
    private readonly extras: VideoExtrasService,
    private readonly assets: AssetsService,
    private readonly content: ContentService,
    private readonly publishing: PublishingService,
    private readonly images: ImageService,
  ) {}

  private get prisma() {
    return this.store.prisma;
  }

  private async brandIdOfPost(post: PostRow): Promise<string | null> {
    if (post._brandId !== undefined) return post._brandId;
    let brandId: string | null = null;
    if (post.plan_id) {
      const plan = await this.prisma.ig_content_plans.findFirst({ where: { id: post.plan_id, workspace_id: post.workspace_id }, select: { brand_id: true } });
      brandId = plan?.brand_id ?? null;
    }
    post._brandId = brandId;
    return brandId;
  }

  /**
   * Salva a mídia na Biblioteca (padronizada no formato do post) e devolve o item de mídia do post
   * com largura/altura/duração reais. Toda mídia do Instagram fica ligada à marca do plano.
   */
  private async libraryItem(post: PostRow, src: Src, order: number, provider: string, prompt: string | null, cost = 0, title?: string) {
    const video = src.mime ? src.mime.startsWith('video/') : isVideoFormat(post.format);
    const a = await this.assets.ingest({
      brandId: await this.brandIdOfPost(post),
      workspaceId: post.workspace_id,
      kind: video ? 'video' : 'image',
      targetFormat: targetForIgFormat(post.format),
      source: provider,
      ...(src.bytes ? { bytes: src.bytes } : { sourceUrl: src.sourceUrl! }),
      mime: src.mime ?? null,
      title: title ?? post.theme ?? 'Post do Instagram',
      prompt,
      provider,
      cost,
      igPostId: post.id,
    });
    return {
      url: a.url,
      type: a.kind,
      order,
      width: a.width,
      height: a.height,
      duration: a.duration_seconds == null ? null : Number(a.duration_seconds),
      asset_id: a.id,
      ig_ready: a.ig_ready,
      issues: ((a.quality_report as { issues?: string[] } | null)?.issues ?? []) as string[],
    };
  }

  /** Bytes (ou URL) que o provedor devolveu. */
  private srcOf(r: GenerationResult): Src {
    return r.bytes ? { bytes: new Uint8Array(r.bytes), mime: r.mime ?? undefined } : { sourceUrl: r.assetUrl! };
  }

  /** Texto e logo aplicados por cima nos slides do carrossel (gancho no 1º, CTA no último, logo em todos). */
  private async composeSlide(post: PostRow, r: GenerationResult, index: number, total: number): Promise<Uint8Array | null> {
    if (post.creative_brief?.compose === false) return null;
    try {
      const brandId = await this.brandIdOfPost(post);
      const brand = await this.content.brandFor(post.workspace_id, brandId);
      const image = r.bytes ? new Uint8Array(r.bytes) : (await this.assets.download(r.assetUrl!)).bytes;
      const [font, logo] = await Promise.all([this.refs.loadFont(post.workspace_id, brand?.id ?? null), this.refs.loadLogo(post.workspace_id, brand?.id ?? null)]);
      const first = index === 0;
      const last = index === total - 1 && total > 1;
      const slideText = (post.creative_brief?.slide_texts as string[] | undefined)?.[index] ?? null;
      return await composeCreative(this.images, {
        image,
        aspectRatio: ASPECT[post.format as IgFormat],
        layout: last ? 'cta_rodape' : first || slideText ? 'titulo_topo' : 'limpo',
        title: first ? (post.hook ?? post.theme ?? null) : slideText,
        cta: last ? (post.cta ?? null) : null,
        logo,
        font,
        primary: brand?.primary_color ?? null,
        secondary: brand?.secondary_color ?? null,
      });
    } catch (e) {
      this.logger.warn(`[instagram] composição do slide falhou: ${errText(e)}`);
      return null;
    }
  }

  /** Reels/Stories em vídeo: capa com logo, gancho e CTA (usada como capa do Reels) + legendas. */
  private async videoCover(post: PostRow, provider: ServerCreativeProvider, prompt: string, assetId: string | null) {
    if (post.creative_brief?.compose === false) return {};
    try {
      const brandId = await this.brandIdOfPost(post);
      const brand = brandId ? await this.prisma.brands.findFirst({ where: { id: brandId, workspace_id: post.workspace_id }, select: { id: true, primary_color: true, secondary_color: true } }) : null;
      const x = await this.extras.build({
        workspaceId: post.workspace_id,
        brand,
        provider,
        visualPrompt: prompt,
        aspectRatio: '9:16',
        durationSec: 8,
        headline: post.hook ?? post.theme ?? null,
        cta: post.cta ?? null,
        captionText: post.hook ?? null,
        videoAssetId: assetId,
        campaignId: null,
        title: post.theme ?? 'Reels',
        withCover: true,
      });
      return { cover_url: x.cover_url ?? null, captions_srt: x.captions_srt ?? null };
    } catch (e) {
      this.logger.warn(`[instagram] capa do vídeo falhou: ${errText(e)}`);
      return {};
    }
  }

  /**
   * Gera (ou continua gerando) a mídia a partir do slide `start`. Se o provedor responder "generating",
   * salva `creative_brief.pending_job` e mantém o post em "generating".
   */
  private async continueAssets(
    post: PostRow,
    provider: ChainedProvider,
    prompts: string[],
    start: number,
    media: any[],
    cost: number,
    instructions?: string | null,
    extra: RefImages = {},
    lease?: PostLease,
  ): Promise<{ ok: true; items: number; provider: string; pending?: boolean }> {
    const format = post.format as IgFormat;
    for (let i = start; i < prompts.length; i++) {
      await lease?.renew();
      const req = {
        finalPrompt: `${prompts[i]} ${format === 'feed_carousel' ? `(imagem ${i + 1} de ${prompts.length} do carrossel)` : ''}`.trim(),
        aspectRatio: ASPECT[format],
        kind: (isVideoFormat(format) ? 'video' : 'image') as 'image' | 'video',
        ...(isVideoFormat(format) ? {} : extra),
      };
      const r = isVideoFormat(format) ? await provider.generateVideo(req) : await provider.generateImage(req);
      if (r.status === 'generating' && r.externalJobId) {
        const pending: PendingJob = { provider: provider.id, jobId: r.externalJobId, index: i, prompts, media, cost, instructions: instructions ?? null, started_at: new Date().toISOString() };
        await this.store.patchPost(post.id, {
          status: 'generating',
          ai_provider: provider.id,
          creative_brief: { ...(post.creative_brief ?? {}), pending_job: pending },
        });
        return { ok: true, items: media.length, provider: provider.id, pending: true };
      }
      if (r.status !== 'ready' || (!r.assetUrl && !r.bytes)) throw new UserError('O provedor não devolveu a mídia pronta.');
      cost += r.cost;
      const composed = format === 'feed_carousel' ? await this.composeSlide(post, r, i, prompts.length) : null;
      const item: Record<string, any> = await this.libraryItem(post, composed ? { bytes: composed, mime: 'image/jpeg' } : this.srcOf(r), i, provider.id, req.finalPrompt, r.cost);
      if (isVideoFormat(format)) Object.assign(item, await this.videoCover(post, provider, req.finalPrompt, item['asset_id']));
      media = [...media, item];
    }
    const requires = await this.store.approvalRequired(post);
    const { pending_job: _drop, ...brief } = post.creative_brief ?? {};
    await this.store.patchPost(post.id, {
      media,
      creative_brief: brief,
      // Post reprovado pelo validador (needs_review) NUNCA vai direto para "ready": mesmo no automático ('publish') exige aprovação humana.
      // O review_reason fica (a pessoa vê o motivo); só approvePost o limpa.
      status: requires === false && !wasFlagged(post) ? 'ready' : 'pending_approval',
      last_error: null,
      ai_provider: provider.id,
      ai_generation_log: this.store.appendLog(post, { step: 'media', provider: provider.id, provider_log: providerLog(provider), items: media.length, cost, instructions }),
    });
    return { ok: true, items: media.length, provider: provider.id };
  }

  async generatePostAssets(
    workspaceId: string,
    postId: string,
    providerChoice: ProviderChoice = 'auto',
    instructions?: string,
  ): Promise<{ ok: true; items: number; provider: string; pending?: boolean } | { ok: false; error: string }> {
    const post = await this.store.getPost(postId, workspaceId);
    const format = post.format as IgFormat;
    const brandId = await this.brandIdOfPost(post);
    const brand = await this.content.brandFor(workspaceId, brandId);
    post._brandId = brand?.id ?? null;
    // Claim atômico: dois processos (editor, tick do cron, laço do navegador) nunca geram o mesmo post.
    const lease = await this.store.claimLease(
      postId,
      workspaceId,
      { status: { in: ['idea', 'failed', 'needs_review', 'pending_approval', 'ready', 'approved', 'scheduled', 'cancelled'] } },
      { status: 'generating', last_error: null },
      MEDIA_LEASE_MS,
    );
    if (!lease) return { ok: false, error: 'Este post já está com a mídia sendo gerada (ou já foi publicado).' };
    try {
    let used: ChainedProvider | null = null;
    try {
      const provider = await this.providers.resolve(workspaceId, providerChoice);
      used = provider;
      const brief = post.creative_brief ?? {};
      const vs = (brand?.visual_style ?? {}) as VisualStyle;
      const refs = isVideoFormat(format) ? [] : await this.refs.loadBrandRefs(workspaceId, brand?.id, { max: 4, ids: vs.referencias?.length ? vs.referencias : undefined });
      const base = brief.prompt || post.theme || 'Post de Instagram';
      const briefs: string[] = format === 'feed_carousel' ? (brief.slides?.length ? brief.slides : [base, base, base]).slice(0, 10) : [base];
      const artBrief = (userPrompt: string, i: number) => ({
        workspaceId,
        brand,
        theme: post.theme,
        hook: post.hook,
        offer: post.cta,
        userPrompt,
        aspectRatio: ASPECT[format],
        kind: (isVideoFormat(format) ? 'video' : 'image') as 'image' | 'video',
        provider: provider.id,
        hasProductRef: refs.some((r) => r.tag === 'produto'),
        adjust: instructions ?? null,
        previousPrompt: instructions ? (brief.visual_prompt ?? null) : null,
        slide: format === 'feed_carousel' ? { index: i, total: briefs.length } : null,
      });
      // Prompt editado pelo usuário (sem novo ajuste) vale para o post de mídia única.
      // Prompts antigos em inglês não devem continuar sendo enviados ao gerador.
      const legacyEnglish = (value: unknown) => typeof value === 'string' && /\b(photorealistic|still frame|no text|use the product|commercial photograph|natural lighting|frozen layers)\b/i.test(value);
      const override = !instructions && format !== 'feed_carousel' && brief.visual_prompt_override && !legacyEnglish(brief.visual_prompt_override);
      const ads = await Promise.all(
        briefs.map(async (p, i) => (override && brief.art_direction ? { ...brief.art_direction, prompt_final: String(brief.visual_prompt_override) } : buildVisualPrompt(this.ai, artBrief(p, i)))),
      );
      const prompts = ads.map((ad) => providerPrompt(ad));
      post.creative_brief = {
        ...brief,
        art_direction: ads[0],
        art_directions: format === 'feed_carousel' ? ads : undefined,
        visual_prompt: ads[0]!.prompt_final,
      };
      await this.store.patchPost(postId, { creative_brief: post.creative_brief });
      await lease.renew();

      // Imagem única: variações + crítico + composição.
      if (!isVideoFormat(format) && format !== 'feed_carousel' && !provider.sandbox) {
        const layout = (brief.layout ?? 'limpo') as TextLayout;
        const res = await this.pipeline.run({
          workspaceId,
          brand,
          provider,
          ad: ads[0]!,
          aspectRatio: ASPECT[format],
          targetFormat: targetForIgFormat(format),
          refs,
          variations: typeof brief.variations === 'number' ? brief.variations : 3,
          layout,
          text: { title: brief.headline ?? post.hook ?? null, price: brief.price ?? null, cta: post.cta ?? null },
          title: post.theme ?? 'Post do Instagram',
          igPostId: post.id,
          onStage: () => lease.renew(),
          rebuild: (motivo) => buildVisualPrompt(this.ai, { ...artBrief(base, 0), previousPrompt: ads[0]!.prompt_final, adjust: `Corrija: ${motivo}` }),
        });
        if (!res.pending) {
          const requires = await this.store.approvalRequired(post);
          const media = [{ url: res.finalUrl, type: 'image', order: 0, width: res.width, height: res.height, duration: null, asset_id: res.finalAssetId, ig_ready: res.igReady, issues: [] }];
          await this.store.patchPost(postId, {
            media,
            creative_brief: { ...post.creative_brief, art_direction: res.ad, visual_prompt: res.ad.prompt_final, variations: res.variations },
            status: requires === false && !wasFlagged(post) ? 'ready' : 'pending_approval',
            last_error: null,
            ai_provider: provider.id,
            ai_generation_log: this.store.appendLog(post, {
              step: 'media',
              provider: provider.id,
              provider_log: providerLog(provider),
              items: 1,
              variations: res.variations.length,
              best_score: res.winner.score?.total ?? null,
              cost: res.cost,
              instructions,
            }),
          });
          return { ok: true, items: 1, provider: provider.id };
        }
        // Provedor assíncrono: segue o fluxo de pendência de sempre.
        return await this.continueAssets(post, provider, prompts, 0, [], 0, instructions, {}, lease);
      }
      return await this.continueAssets(
        post,
        provider,
        prompts,
        0,
        [],
        0,
        instructions,
        {
          referenceImages: refs.map((r) => ({ bytes: r.bytes, mime: r.mime })),
          referenceUrls: refs.map((r) => r.url),
        },
        lease,
      );
    } catch (e) {
      // Lease perdido: outro processo é dono do post agora — não marcar `failed` nem sobrescrever `last_error` por cima do trabalho dele.
      if (e instanceof PublishClaimLost) {
        this.logger.warn(`[instagram] geração de mídia interrompida (post assumido por outro processo): ${e.message}`);
        return { ok: false, error: errText(e) };
      }
      this.logger.error(`[instagram] mídia falhou: ${e instanceof Error ? e.stack ?? e.message : e}`);
      await this.store.patchPost(postId, {
        status: 'failed',
        last_error: errText(e),
        ai_generation_log: this.store.appendLog(post, {
          step: 'media',
          status: 'failed',
          provider: used?.id ?? null,
          provider_log: used ? providerLog(used) : null,
          error: errText(e),
        }),
      });
      return { ok: false, error: errText(e) };
    }
    } finally {
      await lease.release();
    }
  }

  /**
   * Varredor: post `generating` SEM `pending_job` (a geração síncrona morreu no meio) e sem lease vivo vai para `failed` com aviso.
   * Posts com `pending_job` são do poller (que tem o próprio timeout de 1 h) e não são tocados.
   */
  async sweepStaleGenerating() {
    // Só os sem job (o resto é do poller), os mais antigos primeiro: posts pulados não matam de fome os realmente parados.
    const posts = await this.prisma.ig_posts.findMany({
      where: { status: 'generating', creative_brief: { path: ['pending_job'], equals: Prisma.DbNull }, ...leaseFree() },
      orderBy: { updated_at: 'asc' },
      take: 50,
    });
    const swept: string[] = [];
    for (const post of posts as PostRow[]) {
      if ((post.creative_brief as { pending_job?: unknown } | null)?.pending_job) continue;
      const got = await this.prisma.ig_posts.updateMany({
        where: { id: post.id, status: 'generating', AND: [leaseFree()] },
        data: { status: 'failed', last_error: GENERATION_INTERRUPTED, lease_until: null },
      });
      if (!got.count) continue;
      swept.push(post.id);
      await this.store.logEvent({ workspace_id: post.workspace_id, plan_id: post.plan_id, post_id: post.id, kind: 'failure', level: 'error', message: GENERATION_INTERRUPTED });
    }
    return swept;
  }

  /** Consulta os provedores para posts com geração assíncrona pendente e conclui os prontos. */
  async pollPendingMedia() {
    await this.sweepStaleGenerating().catch((e) => this.logger.error(`[instagram] varredor de geração falhou: ${errText(e)}`));
    const posts = await this.prisma.ig_posts.findMany({ where: { status: 'generating', ...leaseFree() }, orderBy: { updated_at: 'asc' }, take: 20 });
    const out: { post: string; status: string; error?: string }[] = [];
    for (const snap of posts as PostRow[]) {
      const snapJob = (snap.creative_brief?.pending_job as PendingJob | undefined)?.jobId;
      if (!snapJob) continue;
      // Lease do ciclo: só um poller conclui o job; um ciclo que começa enquanto outro ainda ingere (vídeo longo) não pega o post.
      const lease = await this.store.claimLease(snap.id, null, { status: 'generating' }, {}, MEDIA_LEASE_MS);
      if (!lease) continue;
      let post: PostRow = snap;
      try {
        // O resultado da leitura acima pode estar velho (outro ciclo andou o job enquanto esperávamos na fila): relê já com o lease.
        const fresh = (await this.prisma.ig_posts.findFirst({ where: { id: snap.id, status: 'generating' } })) as PostRow | null;
        const pjFresh = fresh?.creative_brief?.pending_job as PendingJob | undefined;
        if (!fresh || !pjFresh?.jobId || pjFresh.jobId !== snapJob) continue; // já concluído/avançado por outro ciclo; finally solta o lease
        post = fresh;
        const pj = pjFresh;
        // O id do job só chega ao provedor se estiver gravado neste post/workspace (vínculo no ProviderResolver).
        const provider = await this.providers.resolve(post.workspace_id, choiceForProvider(pj.provider));
        const r = await provider.getGenerationStatus(pj.jobId);
        if (r.status === 'generating') {
          if (Date.now() - new Date(pj.started_at).getTime() > PENDING_TIMEOUT_MS) throw new UserError('O provedor não concluiu a mídia em 1 hora.');
          out.push({ post: post.id, status: 'generating' });
          continue;
        }
        const assetUrl = r.assetUrl ?? (r.status === 'ready' && !r.bytes ? await provider.getAsset(pj.jobId) : null);
        if (r.status !== 'ready' || (!assetUrl && !r.bytes)) throw new UserError('O provedor informou falha na geração da mídia.');
        const media = [
          ...pj.media,
          await this.libraryItem(post, this.srcOf({ ...r, assetUrl }), pj.index, pj.provider, pj.prompts[pj.index] ?? null, r.cost ?? 0),
        ];
        await lease.renew();
        const res = await this.continueAssets(post, provider, pj.prompts, pj.index + 1, media, pj.cost + (r.cost ?? 0), pj.instructions, {}, lease);
        if (res.pending) {
          out.push({ post: post.id, status: 'generating' });
          continue;
        }
        await this.afterMediaReady(post);
        out.push({ post: post.id, status: 'ready' });
      } catch (e) {
        if (e instanceof PublishClaimLost) continue; // o lease foi assumido por outro ciclo: ele conclui o job
        const { pending_job: _drop, ...brief } = post.creative_brief ?? {};
        await this.store.patchPost(post.id, { status: 'failed', last_error: errText(e), creative_brief: brief });
        out.push({ post: post.id, status: 'failed', error: errText(e) });
      } finally {
        await lease.release();
      }
    }
    return out;
  }

  /** Após mídia assíncrona pronta: no piloto automático sem aprovação, agenda no horário previsto. */
  private async afterMediaReady(post: PostRow) {
    if (post.automation) {
      await this.publishing.scheduleAutomated(post.id).catch((e) => this.logger.error(`[instagram] agenda automática falhou: ${errText(e)}`));
      return;
    }
    if (!post.plan_id) return;
    const plan = await this.prisma.ig_content_plans.findUnique({ where: { id: post.plan_id }, select: { auto_publish: true, requires_approval: true, status: true } });
    await this.store.logEvent({ workspace_id: post.workspace_id, plan_id: post.plan_id, post_id: post.id, kind: 'media', message: 'Mídia assíncrona concluída.' });
    if (plan?.auto_publish && !plan.requires_approval && post.scheduled_at && new Date(post.scheduled_at) > new Date()) {
      await this.publishing.schedulePost(post.workspace_id, post.id, post.scheduled_at).catch(() => null);
    }
  }

  /** Mídia enviada pelo usuário (imagem ou vídeo); no carrossel acrescenta, nos demais substitui. */
  async uploadOwnMedia(workspaceId: string, postId: string, file: { filename: string; mimetype: string; bytes: Buffer }) {
    const post = await this.store.getPost(postId, workspaceId);
    const video = file.mimetype.startsWith('video/');
    if (!video && !file.mimetype.startsWith('image/')) throw new UserError('Envie uma imagem ou um vídeo MP4.');
    if (file.bytes.length > MAX_UPLOAD) throw new UserError('Arquivo acima de 100 MB.');
    const format = post.format as IgFormat;
    const current: any[] = format === 'feed_carousel' ? (post.media ?? []) : [];
    const item = await this.libraryItem(post, { bytes: new Uint8Array(file.bytes), mime: file.mimetype }, current.length, 'upload', null, 0, file.filename.replace(/\.[^.]+$/, ''));
    const media = [...current, item];
    await this.store.patchPost(postId, {
      media,
      status: post.status === 'idea' || post.status === 'failed' ? 'pending_approval' : post.status,
      ai_generation_log: this.store.appendLog(post, { step: 'upload', file: file.filename }),
    });
    return { ok: true };
  }
}
