import { Prisma } from '@prisma/client';
import { Injectable, Logger } from '@nestjs/common';
import { AiService } from '../ai/ai.service';
import { buildVisualPrompt, providerPrompt, threadOf, VisualThread, withVisualThread } from '../creative/art-director';
import { MIN_SCORE, scoreCreative } from '../creative/critic';
import { composeCreative } from '../creative/compose';
import { choiceForProvider, GenerationRequest, GenerationResult, ProviderChoice, ServerCreativeProvider } from '../creative/creative.types';
import { directVideo, resolveAudio, stillPrompt, VIDEO_PROMPT_MAX_CHARS, VIDEO_SECONDS, VideoAudio, VideoDirection } from '../creative/video-director';
import { VideoQualityService, VideoScore } from '../creative/video-quality.service';
import { PipelineService } from '../creative/pipeline.service';
import { ChainedProvider, ProviderResolverService, providerLog } from '../creative/provider-resolver.service';
import { BrandRef, RefsService } from '../creative/refs.service';
import { VideoExtrasService } from '../creative/video-extras.service';
import { AiScore, ArtDirection, listField, TextLayout, VisualStyle } from '../creative/visual-style';
import { AssetsService, MediaAsset } from '../media/assets.service';
import { VideoConformService } from '../media/video-conform.service';
import { targetForIgFormat } from '../media/formats';
import { ImageService } from '../media/image.service';
import { UserError } from '../media/user-error';
import { ContentService } from './content.service';
import { ASPECT, IgFormat, isVideoFormat, PostRow } from './ig-types';
import { IgStore, PostLease, PublishClaimLost, errText, leaseFree } from './ig-store.service';
import { PublishingService } from './publishing.service';
import { firstFrameRef, orderRefsForProduct } from '../creative/creative-context';
import { PostContextService } from './post-context.service';

const MAX_UPLOAD = 100 * 1024 * 1024;
const PENDING_TIMEOUT_MS = 60 * 60e3;
/**
 * Lease do post durante a geração síncrona e a conclusão de um job assíncrono. Renovado a cada slide/etapa longa; o TTL cobre a maior
 * etapa única (chamada de IA 180 s, vídeo até 6 min de espera, ingestão 120 s) com folga > 2x. Vencido = o processo morreu.
 */
const MEDIA_LEASE_MS = 30 * 60e3;
export const GENERATION_INTERRUPTED = 'Geração da mídia interrompida — tente gerar de novo.';
/** Quanto a geração de vídeo espera dentro da requisição/tick (como o Estúdio); depois disso o poller (`instagram-queue`) conclui. */
export const VIDEO_WAIT_MS = 25_000;
/** Primeiro quadro do vídeo (9:16): a foto do produto/marca encaixada sem distorcer, sobras na cor dominante. */
const FIRST_FRAME_W = 720;
const FIRST_FRAME_H = 1280;
/** Prompts antigos em inglês não devem continuar sendo enviados ao gerador. */
const legacyEnglish = (value: unknown) =>
  typeof value === 'string' && /\b(photorealistic|still frame|no text|use the product|commercial photograph|natural lighting|frozen layers)\b/i.test(value);

type VideoScoreEntry = { attempt: number; total: number | null; motivo: string | null; error?: string };
type VideoCandidate = { item: Record<string, any>; score: number | null; attempt: number; prompt: string; direction: VideoDirection | null };
/** Estado do vídeo entre a 1ª geração e a refação (vai no `pending_job` quando o provedor é assíncrono). */
type VideoState = { attempt: 1 | 2; best: VideoCandidate | null; scores: VideoScoreEntry[] };
type StoredVideoDirection = { direction: VideoDirection | null; prompt: string; audio: VideoAudio; first_frame_ref: string | null; scores?: VideoScoreEntry[]; winner_attempt?: number };
type VideoOutcome = { ok: true; items: number; provider: string; pending?: boolean };

type PendingJob = {
  provider: string;
  jobId: string;
  index: number;
  prompts: string[];
  media: any[];
  cost: number;
  instructions?: string | null;
  started_at: string;
  video?: VideoState;
};

type Src = { sourceUrl?: string; bytes?: Uint8Array; mime?: string };
type RefImages = { referenceImages?: { bytes: Uint8Array; mime: string }[]; referenceUrls?: string[] };
/** Carrossel: o que o crítico por slide precisa para refazer 1 slide (direções, referências, paleta e a reconstrução com o motivo). */
type SlideQa = {
  ads: ArtDirection[];
  refs: BrandRef[];
  palette: string[];
  extra: RefImages;
  rebuild: (i: number, motivo: string) => Promise<ArtDirection>;
};

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
    private readonly postContext: PostContextService,
    private readonly quality: VideoQualityService,
    private readonly conform: VideoConformService,
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

  /** Salva a mídia na Biblioteca (padronizada no formato do post), sempre ligada à marca do plano. */
  private async ingestAsset(post: PostRow, src: Src, provider: string, prompt: string | null, cost = 0, title?: string): Promise<MediaAsset> {
    const video = src.mime ? src.mime.startsWith('video/') : isVideoFormat(post.format);
    return this.assets.ingest({
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
  }

  /** Item de mídia do post com largura/altura/duração reais. */
  private mediaItem(a: MediaAsset, order: number) {
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

  private async libraryItem(post: PostRow, src: Src, order: number, provider: string, prompt: string | null, cost = 0, title?: string) {
    return this.mediaItem(await this.ingestAsset(post, src, provider, prompt, cost, title), order);
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
  private async videoCover(post: PostRow, provider: ServerCreativeProvider, prompt: string, assetId: string | null, durationSec: number) {
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
        durationSec,
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
    qa?: SlideQa,
  ): Promise<{ ok: true; items: number; provider: string; pending?: boolean }> {
    const format = post.format as IgFormat;
    const slideScores: { slide: number; total: number | null; motivo: string | null; retried: boolean }[] = [];
    const notes: string[] = [];
    for (let i = start; i < prompts.length; i++) {
      await lease?.renew();
      const req = {
        finalPrompt: `${prompts[i]} ${format === 'feed_carousel' ? `(imagem ${i + 1} de ${prompts.length} do carrossel)` : ''}`.trim(),
        aspectRatio: ASPECT[format],
        kind: (isVideoFormat(format) ? 'video' : 'image') as 'image' | 'video',
        ...(isVideoFormat(format) ? { maxWaitMs: VIDEO_WAIT_MS } : extra),
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
      let result = r;
      let itemPrompt = req.finalPrompt;
      let score: AiScore | null = null;
      if (format === 'feed_carousel' && qa) {
        const checked = await this.criticSlide(post, provider, r, i, prompts.length, qa, lease);
        result = checked.result;
        score = checked.score;
        cost += checked.cost;
        if (checked.prompt) itemPrompt = checked.prompt;
        slideScores.push({ slide: i + 1, total: score?.total ?? null, motivo: score?.motivo ?? null, retried: checked.retried });
      }
      if (result.note && !notes.includes(result.note)) notes.push(result.note);
      const composed = format === 'feed_carousel' ? await this.composeSlide(post, result, i, prompts.length) : null;
      const item: Record<string, any> = await this.libraryItem(post, composed ? { bytes: composed, mime: 'image/jpeg' } : this.srcOf(result), i, provider.id, itemPrompt, result.cost);
      if (format === 'feed_carousel' && qa) item['score'] = score?.total ?? null;
      if (isVideoFormat(format)) Object.assign(item, await this.videoCover(post, provider, req.finalPrompt, item['asset_id'], Number(item['duration']) || VIDEO_SECONDS));
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
      failure_kind: null,
      ai_provider: provider.id,
      ai_generation_log: this.store.appendLog(post, { step: 'media', provider: provider.id, provider_log: providerLog(provider), items: media.length, cost, instructions, ...(slideScores.length ? { slide_scores: slideScores } : {}), ...(notes.length ? { notes } : {}) }),
    });
    return { ok: true, items: media.length, provider: provider.id };
  }

  /** Carrossel: nota do crítico no slide; abaixo de MIN_SCORE refaz 1× com o motivo e fica a de maior nota. Crítico fora do ar não bloqueia. */
  private async criticSlide(post: PostRow, provider: ChainedProvider, first: GenerationResult, i: number, total: number, qa: SlideQa, lease?: PostLease) {
    const bytesOf = async (r: GenerationResult) => (r.bytes ? new Uint8Array(r.bytes) : (await this.assets.download(r.assetUrl!)).bytes);
    const score = async (r: GenerationResult): Promise<AiScore | null> => {
      try {
        return await scoreCreative(this.ai, this.images, {
          workspaceId: post.workspace_id, image: await bytesOf(r), refs: qa.refs, palette: qa.palette, aspectRatio: ASPECT.feed_carousel, subject: qa.ads[i]?.subject ?? post.theme ?? 'post',
        });
      } catch (e) {
        this.logger.warn(`[instagram] crítico do slide ${i + 1} falhou: ${errText(e)}`);
        return null;
      }
    };
    let best: { result: GenerationResult; score: AiScore | null; prompt: string | null } = { result: first, score: await score(first), prompt: null };
    let cost = 0;
    let retried = false;
    const firstTotal = best.score?.total ?? null;
    if (best.score && firstTotal !== null && firstTotal < MIN_SCORE) {
      try {
        await lease?.renew();
        const ad = await qa.rebuild(i, best.score.motivo);
        qa.ads[i] = ad;
        const finalPrompt = `${providerPrompt(ad)} (imagem ${i + 1} de ${total} do carrossel)`;
        const again = await provider.generateImage({ finalPrompt, aspectRatio: ASPECT.feed_carousel, kind: 'image', ...qa.extra });
        if (again.status === 'ready' && (again.bytes || again.assetUrl)) {
          retried = true;
          cost += again.cost;
          const s2 = await score(again);
          if ((s2?.total ?? -1) > firstTotal) best = { result: again, score: s2, prompt: finalPrompt };
        }
      } catch (e) {
        if (e instanceof PublishClaimLost) throw e;
        this.logger.warn(`[instagram] nova tentativa do slide ${i + 1} falhou: ${errText(e)}`);
      }
    }
    return { ...best, cost, retried };
  }

  /** Áudio do vídeo: o do post (`creative_brief.audio`) sobrepõe o da programação (`ig_auto_runs.video_audio`). */
  private async audioFor(post: PostRow): Promise<VideoAudio> {
    const run = post.run_id ? await this.prisma.ig_auto_runs.findFirst({ where: { id: post.run_id, workspace_id: post.workspace_id }, select: { video_audio: true } }) : null;
    return resolveAudio(run?.video_audio, post.creative_brief?.audio);
  }

  /**
   * Reels/Story em vídeo: diretor de vídeo (roteiro por tomada) → primeiro quadro (foto do produto/marca em 9:16) → vídeo com o áudio
   * configurado (espera curta; o poller conclui) → `finishVideo`. `criticNote` = refação pedida pelo crítico (2ª tentativa).
   */
  private async startVideo(post: PostRow, provider: ChainedProvider, instructions: string | null, lease: PostLease, state: VideoState, criticNote: string | null = null, cost = 0): Promise<VideoOutcome> {
    const ws: string = post.workspace_id;
    const brand = await this.content.brandFor(ws, await this.brandIdOfPost(post));
    const vs = (brand?.visual_style ?? {}) as VisualStyle;
    const ctx = await this.postContext.build(post, brand?.id ?? null);
    const audio = await this.audioFor(post);
    const refs = await this.refs.loadBrandRefs(ws, brand?.id, { max: 4, ids: vs.referencias?.length ? vs.referencias : undefined });
    const ref = firstFrameRef(refs, ctx.product?.name ?? null);
    const frame = ref
      ? await this.images.padToAspect(ref.bytes, FIRST_FRAME_W, FIRST_FRAME_H).catch((e) => {
          this.logger.warn(`[instagram] primeiro quadro falhou (segue só com o texto): ${errText(e)}`);
          return null;
        })
      : null;
    const brief = post.creative_brief ?? {};
    const prev = brief.video_direction as StoredVideoDirection | undefined;
    const override =
      !instructions && !criticNote && typeof brief.visual_prompt_override === 'string' && brief.visual_prompt_override.trim() && !legacyEnglish(brief.visual_prompt_override)
        ? String(brief.visual_prompt_override).trim().slice(0, VIDEO_PROMPT_MAX_CHARS)
        : null;
    await lease.renew();
    let direction: VideoDirection | null = prev?.direction ?? null;
    let prompt: string;
    if (override) prompt = override;
    else {
      const r = await directVideo(this.ai, {
        workspaceId: ws, brand, context: ctx, format: post.format === 'story_video' ? 'story_video' : 'reel',
        theme: post.theme ?? null, hook: post.hook ?? null, cta: post.cta ?? null, userPrompt: (brief.prompt as string | undefined) ?? null,
        audio, hasFirstFrame: !!frame, provider: provider.id, adjust: instructions, previousPrompt: instructions || criticNote ? (prev?.prompt ?? null) : null, criticNote,
      });
      direction = r.direction;
      prompt = r.prompt;
    }
    const stored: StoredVideoDirection = { direction, prompt, audio, first_frame_ref: frame && ref ? ref.id : null, scores: state.scores };
    post.creative_brief = { ...brief, video_direction: stored, visual_prompt: prompt };
    await this.store.patchPost(post.id, { creative_brief: post.creative_brief });
    await lease.renew();
    const req: GenerationRequest = {
      finalPrompt: prompt, aspectRatio: '9:16', kind: 'video', maxWaitMs: VIDEO_WAIT_MS, audio: audio.modo !== 'sem_audio',
      ...(frame ? { referenceImages: [frame] } : {}),
      ...(frame && ref && /^https:\/\//i.test(ref.url) ? { referenceUrls: [ref.url] } : {}),
    };
    const r = await provider.generateVideo(req);
    if (r.status === 'generating' && r.externalJobId) {
      const { pending_job: _old, ...rest } = post.creative_brief;
      const pending: PendingJob = { provider: provider.id, jobId: r.externalJobId, index: 0, prompts: [prompt], media: [], cost, instructions, started_at: new Date().toISOString(), video: state };
      post.creative_brief = { ...rest, pending_job: pending };
      await this.store.patchPost(post.id, { status: 'generating', ai_provider: provider.id, creative_brief: post.creative_brief });
      return { ok: true, items: 0, provider: provider.id, pending: true };
    }
    if (r.status !== 'ready' || (!r.assetUrl && !r.bytes)) throw new UserError('O provedor não devolveu a mídia pronta.');
    return this.finishVideo(post, provider, r, state, cost + r.cost, instructions, lease);
  }

  /** Vídeo pronto (síncrono ou pelo poller): biblioteca → padrão do Instagram (ffmpeg) → nota do crítico → no máximo 1 refação. */
  private async finishVideo(post: PostRow, provider: ChainedProvider, r: GenerationResult, state: VideoState, cost: number, instructions: string | null, lease: PostLease): Promise<VideoOutcome> {
    const stored = (post.creative_brief?.video_direction ?? {}) as StoredVideoDirection;
    const audio = resolveAudio(stored.audio);
    await lease.renew();
    const raw = await this.ingestAsset(post, this.srcOf(r), provider.id, stored.prompt ?? null, r.cost);
    await lease.renew();
    const asset = await this.conform.ensureIgReady(
      raw,
      { workspaceId: post.workspace_id, brandId: await this.brandIdOfPost(post), igPostId: post.id, title: post.theme ?? 'Reels', provider: provider.id },
      { silent: audio.modo === 'sem_audio' },
    );
    const { score, error } = await this.scoreVideo(post, asset, stored, lease);
    const scores: VideoScoreEntry[] = [...state.scores, { attempt: state.attempt, total: score?.total ?? null, motivo: score?.motivo ?? null, ...(error ? { error } : {}) }];
    const candidate: VideoCandidate = { item: this.mediaItem(asset, 0), score: score?.total ?? null, attempt: state.attempt, prompt: stored.prompt ?? '', direction: stored.direction ?? null };
    const best = !state.best || (candidate.score ?? -1) > (state.best.score ?? -1) ? candidate : state.best;
    if (score && score.total < this.quality.minScore && state.attempt === 1) {
      await this.store.logEvent({
        workspace_id: post.workspace_id, plan_id: post.plan_id, post_id: post.id, kind: 'video_regenerated', level: 'warn',
        message: `Vídeo refeito: nota ${score.total}/50, abaixo de ${this.quality.minScore} (${score.motivo || 'sem motivo'}).`,
      });
      try {
        return await this.startVideo(post, provider, instructions, lease, { attempt: 2, best, scores }, score.motivo || 'nota baixa do crítico', cost);
      } catch (e) {
        if (e instanceof PublishClaimLost) throw e;
        this.logger.warn(`[instagram] refação do vídeo falhou; fica o primeiro: ${errText(e)}`);
        return this.completeVideo(post, provider, best, [...scores, { attempt: 2, total: null, motivo: null, error: errText(e) }], cost, instructions, lease);
      }
    }
    return this.completeVideo(post, provider, best, scores, cost, instructions, lease);
  }

  /** Nota do crítico de vídeo; fora do ar não bloqueia (segue com o vídeo e registra). */
  private async scoreVideo(post: PostRow, asset: MediaAsset, stored: StoredVideoDirection, lease: PostLease): Promise<{ score: VideoScore | null; error: string | null }> {
    try {
      const { bytes } = await this.assets.readBytes(asset);
      await lease.renew();
      const brand = await this.content.brandFor(post.workspace_id, await this.brandIdOfPost(post));
      const vs = (brand?.visual_style ?? {}) as VisualStyle;
      const palette = listField(vs.paleta_hex).length ? listField(vs.paleta_hex) : ([brand?.primary_color, brand?.secondary_color].filter(Boolean) as string[]);
      const score = await this.quality.score(post.workspace_id, bytes, {
        durationSec: Number(asset.duration_seconds) || VIDEO_SECONDS, script: stored.prompt ?? '', subject: stored.direction?.sujeito || post.theme || 'o produto da marca', palette,
      });
      return { score, error: null };
    } catch (e) {
      if (e instanceof PublishClaimLost) throw e;
      this.logger.warn(`[instagram] crítico do vídeo indisponível (segue com o vídeo): ${errText(e)}`);
      return { score: null, error: `crítico indisponível: ${errText(e)}` };
    }
  }

  /** Fecha o vídeo com o de maior nota: capa (duração real), roteiro do vencedor, notas no log; status como o resto da geração. */
  private async completeVideo(post: PostRow, provider: ChainedProvider, best: VideoCandidate, scores: VideoScoreEntry[], cost: number, instructions: string | null, lease: PostLease): Promise<VideoOutcome> {
    const stored = (post.creative_brief?.video_direction ?? {}) as StoredVideoDirection;
    await lease.renew();
    const still = best.direction ? stillPrompt(best.direction) : best.prompt || post.theme || 'Reels';
    const cover = await this.videoCover(post, provider, still, best.item['asset_id'] ?? null, Number(best.item['duration']) || VIDEO_SECONDS);
    const media = [{ ...best.item, ...cover }];
    const requires = await this.store.approvalRequired(post);
    const { pending_job: _drop, ...brief } = post.creative_brief ?? {};
    const regenError = scores.find((x) => x.attempt === 2 && x.error)?.error ?? null;
    await this.store.patchPost(post.id, {
      media,
      creative_brief: { ...brief, visual_prompt: best.prompt, video_direction: { ...stored, direction: best.direction, prompt: best.prompt, scores, winner_attempt: best.attempt } },
      // Post reprovado pelo validador (needs_review) NUNCA vai direto para "ready" (ver `wasFlagged`).
      status: requires === false && !wasFlagged(post) ? 'ready' : 'pending_approval',
      last_error: null,
      failure_kind: null,
      ai_provider: provider.id,
      ai_generation_log: this.store.appendLog(post, {
        step: 'media', provider: provider.id, provider_log: providerLog(provider), items: 1, cost, instructions,
        video_scores: scores, regenerated: scores.length > 1, winner_attempt: best.attempt, ...(regenError ? { regen_error: regenError } : {}),
      }),
    });
    return { ok: true, items: 1, provider: provider.id };
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
      // Reels/Story em vídeo: caminho próprio (roteiro detalhado, primeiro quadro, áudio, nota de qualidade, conversão).
      if (isVideoFormat(format)) return await this.startVideo(post, provider, instructions ?? null, lease, { attempt: 1, best: null, scores: [] });
      const brief = post.creative_brief ?? {};
      const vs = (brand?.visual_style ?? {}) as VisualStyle;
      // Contexto completo do post (produto, pilar, persona, funil, estratégia da execução, campanha) — montado num lugar só.
      const ctx = await this.postContext.build(post, brand?.id ?? null);
      // Fotos de referência com a do produto do post em primeiro lugar.
      const refs = isVideoFormat(format)
        ? []
        : orderRefsForProduct(await this.refs.loadBrandRefs(workspaceId, brand?.id, { max: 4, ids: vs.referencias?.length ? vs.referencias : undefined }), ctx.product?.name ?? null);
      const base = brief.prompt || post.theme || 'Post de Instagram';
      const briefs: string[] = format === 'feed_carousel' ? (brief.slides?.length ? brief.slides : [base, base, base]).slice(0, 10) : [base];
      const artBrief = (userPrompt: string, i: number) => ({
        workspaceId,
        brand,
        theme: post.theme,
        hook: post.hook,
        offer: post.cta,
        context: ctx,
        products: ctx.product ? [ctx.product] : undefined,
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
      const override = !instructions && format !== 'feed_carousel' && brief.visual_prompt_override && !legacyEnglish(brief.visual_prompt_override);
      let thread: VisualThread | null = null;
      let ads: ArtDirection[];
      if (format === 'feed_carousel') {
        // Fio visual único: a direção do 1º slide define paleta, estilo fotográfico e luz; os demais slides repetem.
        const first = await buildVisualPrompt(this.ai, artBrief(briefs[0]!, 0));
        const t = threadOf(first);
        thread = t;
        const rest = await Promise.all(briefs.slice(1).map((p, k) => buildVisualPrompt(this.ai, { ...artBrief(p, k + 1), visualThread: t })));
        ads = [first, ...rest].map((ad) => withVisualThread(ad, t));
      } else {
        ads = await Promise.all(
          briefs.map(async (p, i) => (override && brief.art_direction ? { ...brief.art_direction, prompt_final: String(brief.visual_prompt_override) } : buildVisualPrompt(this.ai, artBrief(p, i)))),
        );
      }
      const prompts = ads.map((ad) => providerPrompt(ad));
      post.creative_brief = {
        ...brief,
        art_direction: ads[0],
        art_directions: format === 'feed_carousel' ? ads : undefined,
        visual_prompt: ads[0]!.prompt_final,
        ...(thread ? { visual_thread: thread } : {}),
      };
      await this.store.patchPost(postId, { creative_brief: post.creative_brief });
      await lease.renew();

      // Imagem única: variações + crítico + composição.
      if (!isVideoFormat(format) && format !== 'feed_carousel' && !provider.sandbox) {
        // Headline na arte: com headline o padrão é o título no topo; sem headline, limpo. O editor pode trocar o layout.
        const layout = (brief.layout ?? (brief.headline ? 'titulo_topo' : 'limpo')) as TextLayout;
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
            failure_kind: null,
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
              ...(res.notes?.length ? { notes: res.notes } : {}),
            }),
          });
          return { ok: true, items: 1, provider: provider.id };
        }
        // Provedor assíncrono: segue o fluxo de pendência de sempre.
        return await this.continueAssets(post, provider, prompts, 0, [], 0, instructions, {}, lease);
      }
      const extra: RefImages = { referenceImages: refs.map((r) => ({ bytes: r.bytes, mime: r.mime })), referenceUrls: refs.map((r) => r.url) };
      const palette = listField(vs.paleta_hex).length ? listField(vs.paleta_hex) : ([brand?.primary_color, brand?.secondary_color].filter(Boolean) as string[]);
      const qa: SlideQa | undefined =
        format === 'feed_carousel'
          ? {
              ads, refs, palette, extra,
              rebuild: (i, motivo) =>
                buildVisualPrompt(this.ai, { ...artBrief(briefs[i]!, i), visualThread: thread, previousPrompt: ads[i]!.prompt_final, adjust: `Corrija: ${motivo}` }).then((ad) => (thread ? withVisualThread(ad, thread) : ad)),
            }
          : undefined;
      return await this.continueAssets(post, provider, prompts, 0, [], 0, instructions, extra, lease, qa);
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
        failure_kind: 'media',
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
        data: { status: 'failed', last_error: GENERATION_INTERRUPTED, lease_until: null, failure_kind: 'media' },
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
        // Refação do vídeo que não deu certo (falhou ou passou de 1 h): fica o primeiro vídeo — o post nunca prende nem falha por isso.
        const keepBest = async (error: string) => {
          const v = pj.video!;
          await this.completeVideo(post, provider, v.best!, [...v.scores, { attempt: v.attempt, total: null, motivo: null, error }], pj.cost, pj.instructions ?? null, lease);
          await this.afterMediaReady(post);
          out.push({ post: post.id, status: 'ready' });
        };
        const r = await provider.getGenerationStatus(pj.jobId);
        if (r.status === 'generating') {
          if (Date.now() - new Date(pj.started_at).getTime() > PENDING_TIMEOUT_MS) {
            if (pj.video?.best) {
              await keepBest('O provedor não concluiu a refação em 1 hora.');
              continue;
            }
            throw new UserError('O provedor não concluiu a mídia em 1 hora.');
          }
          out.push({ post: post.id, status: 'generating' });
          continue;
        }
        const assetUrl = r.assetUrl ?? (r.status === 'ready' && !r.bytes ? await provider.getAsset(pj.jobId) : null);
        if (r.status !== 'ready' || (!assetUrl && !r.bytes)) {
          if (pj.video?.best) {
            await keepBest('O provedor informou falha na refação do vídeo.');
            continue;
          }
          throw new UserError('O provedor informou falha na geração da mídia.');
        }
        // Vídeo do caminho novo (roteiro + crítico): conversão, nota e, se preciso, a refação (que pode ficar pendente de novo).
        if (pj.video && isVideoFormat(post.format)) {
          const res = await this.finishVideo(post, provider, { ...r, assetUrl }, pj.video, pj.cost + (r.cost ?? 0), pj.instructions ?? null, lease);
          if (res.pending) {
            out.push({ post: post.id, status: 'generating' });
            continue;
          }
          await this.afterMediaReady(post);
          out.push({ post: post.id, status: 'ready' });
          continue;
        }
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
        // Refação do vídeo que deu erro (rede, download, conversão…): o primeiro vídeo, já pago e com nota, fica — nunca `failed`.
        const pjNow = post.creative_brief?.pending_job as PendingJob | undefined;
        if (pjNow?.video?.best && isVideoFormat(post.format)) {
          try {
            const provider = await this.providers.resolve(post.workspace_id, choiceForProvider(pjNow.provider));
            const scores = [...pjNow.video.scores, { attempt: pjNow.video.attempt, total: null, motivo: null, error: errText(e) }];
            await this.completeVideo(post, provider, pjNow.video.best, scores, pjNow.cost, pjNow.instructions ?? null, lease);
            await this.afterMediaReady(post);
            out.push({ post: post.id, status: 'ready' });
            continue;
          } catch (e2) {
            if (e2 instanceof PublishClaimLost) continue;
            this.logger.warn(`[instagram] não deu para manter o primeiro vídeo: ${errText(e2)}`);
          }
        }
        const { pending_job: _drop, ...brief } = post.creative_brief ?? {};
        await this.store.patchPost(post.id, { status: 'failed', last_error: errText(e), failure_kind: 'media', creative_brief: brief });
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
    let asset = await this.ingestAsset(post, { bytes: new Uint8Array(file.bytes), mime: file.mimetype }, 'upload', null, 0, file.filename.replace(/\.[^.]+$/, ''));
    if (video && !asset.ig_ready) {
      // Vídeo do usuário fora do padrão do Instagram: converte (ffmpeg); se não der, fica o original com os avisos (como antes).
      const original = asset;
      asset = await this.conform
        .ensureIgReady(original, { workspaceId, brandId: await this.brandIdOfPost(post), igPostId: post.id, title: original.title ?? 'Vídeo', provider: 'upload' }, { silent: false })
        .catch((e) => {
          this.logger.warn(`[instagram] conversão do vídeo enviado falhou: ${errText(e)}`);
          return original;
        });
    }
    const media = [...current, this.mediaItem(asset, current.length)];
    await this.store.patchPost(postId, {
      media,
      status: post.status === 'idea' || post.status === 'failed' ? 'pending_approval' : post.status,
      ai_generation_log: this.store.appendLog(post, { step: 'upload', file: file.filename }),
    });
    return { ok: true };
  }
}
