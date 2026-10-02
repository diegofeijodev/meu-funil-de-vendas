/**
 * Núcleo da geração de criativos: monta o prompt com o Brand Brain, escolhe o provedor, roda o pipeline de
 * imagem (variações → crítico → composição) ou o vídeo, e persiste tudo (job, criativo, versão, biblioteca).
 */
import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../common/database/prisma.service';
import { todaySp } from '../../common/time/dates';
import { WorkspaceAccessService } from '../access/access.service';
import { ActivityService } from '../activity/activity.service';
import { AiService } from '../ai/ai.service';
import { AssetsService } from '../media/assets.service';
import { extFromMimeSafe } from '../media/ext';
import { errMessage, notFound, UserError } from '../media/user-error';
import { strategyBrief } from '../strategist/strategist.prompt';
import { StrategistService } from '../strategist/strategist.service';
import { ArtBrief, buildVisualPrompt, providerPrompt } from './art-director';
import { choiceForProvider, CreativeKind, GenerationRequest, GenerationResult, ProviderChoice, ServerCreativeProvider, VIDEO_TYPES } from './creative.types';
import { GenerateCreativeDto } from './creative.dto';
import { PipelineService } from './pipeline.service';
import { ChainedProvider, ProviderResolverService, providerLog } from './provider-resolver.service';
import { RefsService } from './refs.service';
import { VideoExtrasService } from './video-extras.service';
import { ArtDirection, TextLayout, Variation, VisualStyle } from './visual-style';

const FAIL_TEXT = 'Não foi possível gerar este criativo. Tente novamente.';
/** Job externo que passou disto sem terminar é dado como falho. */
const POLL_TIMEOUT_MS = 60 * 60_000;

/** Guardado em `creative_generation_jobs.options` para o poller concluir o vídeo depois (título/ângulo/texto/formato inclusos — o protótipo os perdia). */
export type VideoOptions = {
  coverWithLogo?: boolean; headline?: string | null; cta?: string | null; captionText?: string | null;
  title?: string | null; angle?: string | null; copyText?: string | null; targetFormat?: string | null;
};

export type RunGenerationInput = {
  jobId: string;
  workspaceId: string;
  brandId: string | null;
  campaignId: string | null;
  title: string;
  type: string;
  aspectRatio: string;
  prompt: string;
  finalPrompt: string;
  copyText: string;
  kind: CreativeKind;
  existingCreativeId?: string | null;
  providerChoice?: ProviderChoice;
  targetFormat?: string | null;
  angle?: string | null;
  /** Vídeo: começa pela foto real do produto/marca (imagem → vídeo). Padrão: sim, se houver foto. */
  useBrandImage?: boolean;
  /** Vídeo: capa com logo/CTA e legendas (persistido no job para o poller). */
  videoOptions?: VideoOptions | null;
};

export type GenerationOutcome = {
  jobId: string;
  creativeId: string | null;
  status: 'ready' | 'generating' | 'failed';
  assetUrl: string | null;
  provider: string;
  sandbox: boolean;
  error: string | null;
};
export type ArtOutcome = GenerationOutcome & { artDirection: ArtDirection; variations: Variation[] };

type Brand = Prisma.brandsGetPayload<object>;
type Campaign = Prisma.campaignsGetPayload<object>;

@Injectable()
export class CreativeService {
  private readonly logger = new Logger(CreativeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
    private readonly activity: ActivityService,
    private readonly ai: AiService,
    private readonly assets: AssetsService,
    private readonly refs: RefsService,
    private readonly pipeline: PipelineService,
    private readonly providers: ProviderResolverService,
    private readonly strategist: StrategistService,
    private readonly extras: VideoExtrasService,
  ) {}

  // ------------------------------------------------------------------ Brand Brain e direção de arte

  /** Campanha e marca da geração, SEMPRE dentro do workspace (id de outro workspace = 404). */
  async buildBrandBrain(workspaceId: string, input: { campaignId?: string | null; brandId?: string | null }): Promise<{ brand: Brand | null; campaign: Campaign | null }> {
    let campaign: Campaign | null = null;
    if (input.campaignId) {
      campaign = await this.prisma.campaigns.findFirst({ where: { id: input.campaignId, workspace_id: workspaceId } });
      if (!campaign) throw notFound('Campanha não encontrada.');
    }
    const brandId = input.brandId ?? campaign?.brand_id ?? null;
    let brand: Brand | null = null;
    if (brandId) {
      brand = await this.prisma.brands.findFirst({ where: { id: brandId, workspace_id: workspaceId } });
      if (!brand) throw notFound('Marca não encontrada.');
    }
    return { brand, campaign };
  }

  /** Monta (ou reaproveita, se o usuário editou) a direção de arte. */
  async directArt(
    input: {
      workspaceId: string; brand: Brand | null; campaign: Campaign | null; title: string; prompt: string; copyText: string; aspectRatio: string;
      kind: CreativeKind; visualPrompt?: string | null; artDirection?: Record<string, unknown> | null; adjust?: string | null; angle?: string | null;
    },
    providerId: string,
  ): Promise<{ ad: ArtDirection; brief: ArtBrief }> {
    const brandId = input.brand?.id;
    const products = brandId
      ? await this.prisma.products.findMany({ where: { brand_id: brandId, workspace_id: input.workspaceId }, select: { name: true, description: true }, take: 3 })
      : [];
    const productRefs = brandId
      ? await this.prisma.brand_assets.count({ where: { brand_id: brandId, workspace_id: input.workspaceId, kind: { in: ['reference', 'photo'] }, tag: 'produto' } })
      : 0;
    // A estratégia aprovada da campanha (big idea, ângulo, direção visual) orienta o diretor de arte.
    const strategy = strategyBrief(await this.strategist.currentStrategy(input.workspaceId, input.campaign?.id), input.angle);
    const brief: ArtBrief = {
      workspaceId: input.workspaceId, brand: input.brand, campaign: input.campaign, strategy, products,
      theme: input.title, hook: input.copyText || null, offer: input.campaign?.offer_product ?? null, userPrompt: input.prompt,
      aspectRatio: input.aspectRatio, kind: input.kind, provider: providerId, hasProductRef: productRefs > 0,
    };
    if (input.visualPrompt && input.artDirection && !input.adjust) {
      return { ad: { ...(input.artDirection as unknown as ArtDirection), prompt_final: input.visualPrompt }, brief };
    }
    const ad = await buildVisualPrompt(this.ai, { ...brief, adjust: input.adjust ?? null, previousPrompt: input.visualPrompt ?? null });
    return { ad, brief };
  }

  // ------------------------------------------------------------------ ações (server fns)

  private normalize(dto: GenerateCreativeDto) {
    const type = dto.type ?? 'static_image';
    return {
      type,
      title: dto.title ?? '',
      aspectRatio: dto.aspectRatio ?? '1:1',
      prompt: dto.prompt ?? '',
      copyText: dto.copyText ?? '',
      providerChoice: (dto.provider ?? 'auto') as ProviderChoice,
      layout: (dto.layout ?? 'limpo') as TextLayout,
      variations: dto.variations ?? 3,
      kind: (VIDEO_TYPES.has(type) ? 'video' : 'image') as CreativeKind,
    };
  }

  /** `previewVisualPrompt`: só o diretor de arte (uma chamada de LLM, sem gerar nada). */
  async preview(userId: string, dto: GenerateCreativeDto) {
    await this.access.require(userId, dto.workspaceId, 'write');
    const n = this.normalize(dto);
    const { brand, campaign } = await this.buildBrandBrain(dto.workspaceId, dto);
    const target = n.providerChoice === 'auto' ? 'higgsfield ou IA padrão' : n.providerChoice;
    const { ad } = await this.directArt(
      {
        workspaceId: dto.workspaceId, brand, campaign, title: n.title || campaign?.name || '', prompt: n.prompt, copyText: n.copyText,
        aspectRatio: n.aspectRatio, kind: n.kind, visualPrompt: dto.visualPrompt, artDirection: dto.artDirection, adjust: dto.adjust, angle: dto.angle,
      },
      target,
    );
    return { artDirection: ad };
  }

  /** `generateCreative`: ponta a ponta. Erros do provedor VOLTAM em `error` (status `failed`), não são lançados. */
  async generate(userId: string, dto: GenerateCreativeDto): Promise<ArtOutcome> {
    await this.access.require(userId, dto.workspaceId, 'write');
    const n = this.normalize(dto);
    const { brand, campaign } = await this.buildBrandBrain(dto.workspaceId, dto);
    const r = await this.runArtDirected({
      workspaceId: dto.workspaceId, brand, campaign, title: n.title || campaign?.name || 'Criativo sem título', type: n.type, prompt: n.prompt,
      copyText: n.copyText, aspectRatio: n.aspectRatio, targetFormat: dto.targetFormat ?? null, providerChoice: n.providerChoice, kind: n.kind,
      visualPrompt: dto.visualPrompt, artDirection: dto.artDirection, adjust: dto.adjust, layout: n.layout, variations: n.variations,
      headline: dto.headline, price: dto.price, cta: dto.cta, angle: dto.angle, useBrandImage: dto.useBrandImage, coverWithLogo: dto.coverWithLogo, userId,
    });
    if (r.status === 'ready') await this.activity.log(dto.workspaceId, userId, 'creative.generated', 'creative', { creative_id: r.creativeId, provider: r.provider });
    return r;
  }

  /** Resolve o job pelo id e exige papel de escrita no workspace DELE (quem não é membro vê "não encontrado"). */
  private async ownedJob(userId: string, jobId: string) {
    const job = await this.prisma.creative_generation_jobs.findUnique({ where: { id: jobId } });
    if (!job || !(await this.access.roleOf(userId, job.workspace_id))) throw notFound('Job de geração não encontrado.');
    await this.access.require(userId, job.workspace_id, 'write');
    return job;
  }

  /** `retryCreativeJob`: reprocessa um job que falhou, mantendo o mesmo prompt final. */
  async retry(userId: string, jobId: string): Promise<GenerationOutcome> {
    const job = await this.ownedJob(userId, jobId);
    await this.prisma.creative_generation_jobs.update({ where: { id: job.id }, data: { status: 'queued', error_message: null } });
    return this.runGeneration({
      jobId: job.id, workspaceId: job.workspace_id, brandId: job.brand_id, campaignId: job.campaign_id, title: 'Criativo (nova tentativa)', type: job.type,
      aspectRatio: job.aspect_ratio ?? '1:1', prompt: job.prompt ?? '', finalPrompt: job.final_prompt ?? job.prompt ?? '', copyText: '',
      kind: VIDEO_TYPES.has(job.type) ? 'video' : 'image', existingCreativeId: job.creative_id, providerChoice: choiceForProvider(job.provider),
    });
  }

  /** `newCreativeVersion`: nova versão de um criativo existente, pelo mesmo provedor real (nunca simulado). */
  async newVersion(userId: string, creativeId: string): Promise<GenerationOutcome> {
    const cr = await this.prisma.creatives.findUnique({ where: { id: creativeId } });
    if (!cr || !(await this.access.roleOf(userId, cr.workspace_id))) throw notFound('Criativo não encontrado.');
    await this.access.require(userId, cr.workspace_id, 'write');
    const base = cr.final_prompt || cr.prompt || cr.title || 'Criativo publicitário';
    const finalPrompt = `${base}\nNova variação (versão ${(cr.version ?? 1) + 1}): mude composição, enquadramento e cena, mantendo a identidade da marca.`;
    const providerChoice = choiceForProvider(cr.provider);
    const job = await this.prisma.creative_generation_jobs.create({
      data: {
        workspace_id: cr.workspace_id, brand_id: cr.brand_id, campaign_id: cr.campaign_id, creative_id: cr.id, provider: providerChoice, type: cr.type,
        prompt: cr.prompt, final_prompt: finalPrompt, aspect_ratio: cr.aspect_ratio, status: 'generating', created_by: userId,
      },
    });
    return this.runGeneration({
      jobId: job.id, workspaceId: cr.workspace_id, brandId: cr.brand_id, campaignId: cr.campaign_id, title: cr.title ?? 'Criativo', type: cr.type,
      aspectRatio: cr.aspect_ratio ?? '1:1', prompt: cr.prompt ?? '', finalPrompt, copyText: cr.copy_text ?? '', kind: VIDEO_TYPES.has(cr.type) ? 'video' : 'image',
      existingCreativeId: cr.id, providerChoice,
    });
  }

  /** `capcutPackage`: vídeo, legendas .srt, capa e roteiro num .zip para o CapCut/Premiere. */
  async capcutPackage(userId: string, creativeId: string): Promise<{ url: string }> {
    const cr = await this.prisma.creatives.findUnique({ where: { id: creativeId } });
    if (!cr || !(await this.access.roleOf(userId, cr.workspace_id))) throw notFound('Criativo não encontrado.');
    if (!cr.preview_url) throw new UserError('Este criativo ainda não tem arquivo.');
    const extras = (cr.extras ?? {}) as { captions_srt?: string; cover_url?: string };
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    const get = async (url: string) => {
      try {
        return (await this.assets.download(url)).bytes;
      } catch (e) {
        if (e instanceof ForbiddenException) throw new UserError(`Falha ao baixar ${url.slice(0, 60)}… (link inválido ou expirado)`);
        throw e;
      }
    };
    const isVideo = /\.(mp4|mov)(\?|$)/i.test(cr.preview_url);
    zip.file(isVideo ? 'video.mp4' : 'imagem.jpg', await get(cr.preview_url));
    if (extras.captions_srt) zip.file('legendas.srt', await get(extras.captions_srt));
    if (extras.cover_url) zip.file('capa.jpg', await get(extras.cover_url));
    const copy = cr.campaign_id
      ? await this.prisma.copies.findFirst({ where: { campaign_id: cr.campaign_id, workspace_id: cr.workspace_id }, orderBy: { version: 'desc' }, select: { content: true } })
      : null;
    const c = ((copy?.content ?? {}) as { reels?: string; headline?: string; cta?: string });
    zip.file(
      'LEIA-ME.txt',
      [
        `Criativo: ${cr.title}`,
        '',
        'Como montar no CapCut:',
        '1. Abra o CapCut e crie um projeto novo na proporção do vídeo.',
        '2. Importe video.mp4 (e capa.jpg, se houver, como primeiro quadro).',
        '3. Em Texto > Legendas > Importar legendas, escolha legendas.srt.',
        '4. Ajuste fontes e cores da marca e exporte em 1080p.',
        '',
        c.headline ? `Título: ${c.headline}` : '',
        c.cta ? `Chamada: ${c.cta}` : '',
        c.reels ? `\nRoteiro do Reels:\n${c.reels}` : '',
      ].join('\n'),
    );
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    const name = 'pacote-capcut.zip';
    return { url: await this.assets.storeForDownload(`exports/${cr.workspace_id}/${randomUUID()}-capcut.zip`, bytes, name) };
  }

  // ------------------------------------------------------------------ geração

  runGeneration(input: RunGenerationInput): Promise<GenerationOutcome> {
    return this.finalizeWith(null, input);
  }

  private failJob(jobId: string, data: Prisma.creative_generation_jobsUncheckedUpdateInput) {
    return this.prisma.creative_generation_jobs.update({ where: { id: jobId }, data: { status: 'failed', completed_at: new Date(), ...data } });
  }

  /**
   * `injected` = provedor já resolvido. `fromPoll` = o resultado já existe (poller/imagem pendente): não repete a janela
   * de 25 s nem a foto de referência do vídeo. (No protótipo `injected` fazia as duas coisas, e o vídeo da tela principal
   * esperava até 6 min na requisição e nunca usava a foto da marca.)
   */
  private async finalizeWith(injected: ServerCreativeProvider | null, input: RunGenerationInput, fromPoll = false): Promise<GenerationOutcome> {
    const ws = input.workspaceId;
    let provider: ChainedProvider;
    try {
      provider = injected ?? (await this.providers.resolve(ws, input.providerChoice));
    } catch (e) {
      const error = errMessage(e, FAIL_TEXT);
      await this.failJob(input.jobId, { provider: input.providerChoice ?? 'auto', error_message: error });
      return { jobId: input.jobId, creativeId: input.existingCreativeId ?? null, status: 'failed', assetUrl: null, provider: input.providerChoice ?? 'auto', sandbox: false, error };
    }

    await this.prisma.creative_generation_jobs.update({ where: { id: input.jobId }, data: { status: 'generating', provider: provider.id } });

    try {
      const req: GenerationRequest = { finalPrompt: input.finalPrompt, aspectRatio: input.aspectRatio, kind: input.kind };
      if (input.kind === 'video' && !fromPoll) {
        // Vídeo em segundo plano: espera até 25 s; se não terminar, o poller conclui e o criativo aparece sozinho.
        req.maxWaitMs = 25_000;
        if (input.useBrandImage !== false && input.brandId) {
          const refs = await this.refs.loadBrandRefs(ws, input.brandId, { max: 1 }).catch(() => []);
          if (refs.length) {
            req.referenceImages = refs.map((r) => ({ bytes: r.bytes, mime: r.mime }));
            req.referenceUrls = refs.map((r) => r.url);
          }
        }
      }
      const result = input.kind === 'video' ? await provider.generateVideo(req) : await provider.generateImage(req);
      await this.prisma.creative_generation_jobs.update({ where: { id: input.jobId }, data: { provider: provider.id, provider_log: providerLog(provider, result) } });

      // Geração assíncrona: guarda o job externo (vinculado a este workspace pela linha do job) e deixa o poller concluir.
      if (result.status === 'generating' && result.externalJobId) {
        await this.prisma.creative_generation_jobs.update({
          where: { id: input.jobId },
          data: { status: 'generating', provider: provider.id, external_job_id: result.externalJobId, creative_id: input.existingCreativeId ?? null },
        });
        return { jobId: input.jobId, creativeId: input.existingCreativeId ?? null, status: 'generating', assetUrl: null, provider: provider.id, sandbox: provider.sandbox, error: null };
      }
      if (result.status !== 'ready' || (!result.assetUrl && !result.bytes)) throw new UserError('O provedor não devolveu um ativo pronto.');

      // Biblioteca de mídia: padroniza no formato de destino e salva no bucket.
      let assetId: string | null = null;
      let assetUrl = result.assetUrl;
      let thumbnailUrl = result.thumbnailUrl;
      try {
        const asset = await this.assets.ingest({
          workspaceId: ws, kind: input.kind === 'video' ? 'video' : 'image', targetFormat: this.assets.guessTarget(input.aspectRatio, input.kind === 'video', input.targetFormat),
          source: provider.id, ...(result.bytes ? { bytes: new Uint8Array(result.bytes), mime: result.mime ?? null } : { sourceUrl: result.assetUrl! }),
          title: input.title, prompt: input.finalPrompt, provider: provider.id, cost: result.cost, brandId: input.brandId, campaignId: input.campaignId, angle: input.angle ?? null,
        });
        assetId = asset.id;
        assetUrl = asset.url;
        thumbnailUrl = asset.thumbnail_url ?? asset.url;
      } catch (e) {
        this.logger.error(`[creative-generation] biblioteca de mídia falhou: ${e instanceof Error ? e.message : e}`);
        // Sem a biblioteca, o arquivo do provedor ainda precisa de um endereço: guarda os bytes crus.
        if (!assetUrl && result.bytes) {
          assetUrl = await this.assets.storeBytes(`media/${ws}/${todaySp()}/raw-${randomUUID()}.${extFromMimeSafe(result.mime)}`, result.bytes);
          thumbnailUrl = assetUrl;
        }
      }

      let creativeId = input.existingCreativeId ?? null;
      let version = 1;
      if (creativeId) {
        const cr = await this.prisma.creatives.findFirst({ where: { id: creativeId, workspace_id: ws }, select: { version: true } });
        version = (cr?.version ?? 0) + 1;
        await this.prisma.creatives.update({
          where: { id: creativeId },
          data: { status: 'ready', preview_url: assetUrl, thumbnail_url: thumbnailUrl, provider: provider.id, version, error_message: null, external_job_id: result.externalJobId, real_cost: result.cost },
        });
      } else {
        const created = await this.prisma.creatives.create({
          data: {
            workspace_id: ws, campaign_id: input.campaignId, brand_id: input.brandId, title: input.title, type: input.type, prompt: input.prompt,
            final_prompt: input.finalPrompt, aspect_ratio: input.aspectRatio, copy_text: input.copyText, status: 'ready', provider: provider.id,
            estimated_cost: result.cost, real_cost: result.cost, preview_url: assetUrl, thumbnail_url: thumbnailUrl, external_job_id: result.externalJobId,
            version: 1, angle: input.angle ?? null,
          },
          select: { id: true },
        });
        creativeId = created.id;
      }
      if (assetId) await this.prisma.media_assets.update({ where: { id: assetId }, data: { creative_id: creativeId } });

      // Vídeo pronto: legendas (.vtt/.srt) e, se pedido, capa com logo e CTA.
      if (input.kind === 'video' && creativeId) {
        try {
          const opts = input.videoOptions ?? {};
          const brandRow = input.brandId
            ? await this.prisma.brands.findFirst({ where: { id: input.brandId, workspace_id: ws }, select: { id: true, primary_color: true, secondary_color: true } })
            : null;
          const coverProvider = opts.coverWithLogo ? await this.providers.resolve(ws, choiceForProvider(provider.id)).catch(() => null) : null;
          const extras = await this.extras.build({
            workspaceId: ws, brand: brandRow, provider: coverProvider, visualPrompt: input.finalPrompt, aspectRatio: input.aspectRatio,
            durationSec: provider.id === 'higgsfield' ? 10 : 8, headline: opts.headline ?? null, cta: opts.cta ?? null,
            captionText: opts.captionText ?? input.copyText ?? null, videoAssetId: assetId, campaignId: input.campaignId, title: input.title, withCover: !!opts.coverWithLogo,
          });
          await this.prisma.creatives.update({ where: { id: creativeId }, data: { extras: extras as Prisma.InputJsonObject } });
        } catch (e) {
          this.logger.error(`[video-extras] falhou: ${e instanceof Error ? e.message : e}`);
        }
      }

      await this.prisma.creative_versions.create({ data: { workspace_id: ws, creative_id: creativeId, version, prompt: input.finalPrompt, preview_url: assetUrl } });
      await this.prisma.creative_generation_jobs.update({
        where: { id: input.jobId },
        data: {
          status: 'ready', creative_id: creativeId, asset_url: assetUrl, thumbnail_url: thumbnailUrl, external_job_id: result.externalJobId,
          estimated_cost: result.cost, actual_cost: result.cost, completed_at: new Date(),
        },
      });
      return { jobId: input.jobId, creativeId, status: 'ready', assetUrl, provider: provider.id, sandbox: provider.sandbox, error: null };
    } catch (e) {
      // Detalhe técnico só no log do servidor; o usuário recebe mensagem simples.
      this.logger.error(`[creative-generation] falhou job=${input.jobId} ws=${ws} provider=${provider.id}: ${e instanceof Error ? e.stack ?? e.message : e}`);
      const error = errMessage(e, FAIL_TEXT);
      await this.failJob(input.jobId, { provider: provider.id, error_message: error, provider_log: providerLog(provider) });
      return { jobId: input.jobId, creativeId: input.existingCreativeId ?? null, status: 'failed', assetUrl: null, provider: provider.id, sandbox: provider.sandbox, error };
    }
  }

  /** Conclui jobs que ficaram `generating` com job externo (chamado pelo agendador). Cada id vem da linha do job (vínculo com o workspace). */
  async pollPendingCreatives(): Promise<{ job: string; status: string }[]> {
    const jobs = await this.prisma.creative_generation_jobs.findMany({
      where: { status: 'generating', external_job_id: { not: null } },
      orderBy: { created_at: 'asc' },
      take: 20,
    });
    const out: { job: string; status: string }[] = [];
    for (const job of jobs) {
      try {
        const provider = await this.providers.resolve(job.workspace_id, choiceForProvider(job.provider));
        const r = await provider.getGenerationStatus(job.external_job_id!);
        if (r.status === 'generating') {
          if (Date.now() - job.created_at.getTime() > POLL_TIMEOUT_MS) throw new UserError('Tempo esgotado no provedor.');
          out.push({ job: job.id, status: 'generating' });
          continue;
        }
        const assetUrl = r.assetUrl ?? (r.status === 'ready' && !r.bytes ? await provider.getAsset(job.external_job_id!) : null);
        if (r.status !== 'ready' || (!assetUrl && !r.bytes)) throw new UserError('O provedor informou falha na geração.');
        const kind: CreativeKind = VIDEO_TYPES.has(job.type ?? '') || /video|reel/i.test(job.type ?? '') ? 'video' : 'image';
        const done: GenerationResult = { ...r, status: 'ready', assetUrl, externalJobId: job.external_job_id };
        const fixed: ServerCreativeProvider = { ...provider, generateImage: async () => done, generateVideo: async () => done };
        const opts = (job.options ?? {}) as VideoOptions;
        const res = await this.finalizeWith(fixed, {
          jobId: job.id, workspaceId: job.workspace_id, brandId: job.brand_id, campaignId: job.campaign_id, title: opts.title || String(job.prompt ?? 'Criativo').slice(0, 80),
          type: job.type, aspectRatio: job.aspect_ratio ?? '1:1', targetFormat: opts.targetFormat ?? null, prompt: job.prompt ?? '', finalPrompt: job.final_prompt ?? job.prompt ?? '',
          copyText: opts.copyText ?? '', kind, angle: opts.angle ?? null, existingCreativeId: job.creative_id, videoOptions: opts,
        }, true);
        out.push({ job: job.id, status: res.status });
      } catch (e) {
        this.logger.warn(`[creative-poll] job ${job.id}: ${e instanceof Error ? e.message : e}`);
        await this.failJob(job.id, { error_message: errMessage(e, 'O provedor informou falha na geração.') });
        out.push({ job: job.id, status: 'failed' });
      }
    }
    return out;
  }

  // ------------------------------------------------------------------ imagem dirigida

  private async runArtDirected(input: {
    workspaceId: string; brand: Brand | null; campaign: Campaign | null; title: string; type: string; prompt: string; copyText: string; aspectRatio: string;
    targetFormat: string | null; providerChoice: ProviderChoice; kind: CreativeKind; visualPrompt?: string | null; artDirection?: Record<string, unknown> | null;
    adjust?: string | null; layout: TextLayout; variations: number; headline?: string | null; price?: string | null; cta?: string | null; angle?: string | null;
    useBrandImage?: boolean; coverWithLogo?: boolean; userId: string;
  }): Promise<ArtOutcome> {
    const ws = input.workspaceId;
    // Provedor indisponível ("Higgsfield não está conectado…") é lançado, como no protótipo.
    const provider = await this.providers.resolve(ws, input.providerChoice);
    const { ad, brief } = await this.directArt({ ...input, aspectRatio: input.aspectRatio }, provider.id);
    const finalPrompt = providerPrompt(ad);
    const videoOptions: VideoOptions | null =
      input.kind === 'video' ? { coverWithLogo: !!input.coverWithLogo, headline: input.headline ?? null, cta: input.cta ?? null, captionText: input.copyText || null } : null;
    const job = await this.prisma.creative_generation_jobs.create({
      data: {
        workspace_id: ws, brand_id: input.brand?.id ?? null, campaign_id: input.campaign?.id ?? null, provider: provider.id, type: input.type, prompt: input.prompt,
        final_prompt: finalPrompt, aspect_ratio: input.aspectRatio, status: 'generating', created_by: input.userId,
        options: (videoOptions ? { ...videoOptions, title: input.title || input.campaign?.name || 'Criativo sem título', angle: input.angle ?? null, copyText: input.copyText, targetFormat: input.targetFormat } : {}) as Prisma.InputJsonObject,
      },
    });

    const base: RunGenerationInput = {
      jobId: job.id, workspaceId: ws, brandId: input.brand?.id ?? null, campaignId: input.campaign?.id ?? null,
      title: input.title || input.campaign?.name || 'Criativo sem título', type: input.type, aspectRatio: input.aspectRatio, targetFormat: input.targetFormat,
      prompt: input.prompt, finalPrompt, copyText: input.copyText, kind: input.kind, providerChoice: input.providerChoice, angle: input.angle ?? null,
      useBrandImage: input.useBrandImage, videoOptions,
    };

    // Vídeo: só o prompt do diretor de arte, fluxo de sempre.
    if (input.kind === 'video') {
      const r = await this.finalizeWith(provider, base);
      return { ...r, artDirection: ad, variations: [] };
    }

    try {
      const vs = ((input.brand?.visual_style ?? {}) as VisualStyle) ?? {};
      const refs = await this.refs.loadBrandRefs(ws, input.brand?.id, { max: 4, ids: vs.referencias?.length ? vs.referencias : undefined });
      const res = await this.pipeline.run({
        workspaceId: ws, brand: input.brand, provider, ad, aspectRatio: input.aspectRatio,
        targetFormat: this.assets.guessTarget(input.aspectRatio, false, input.targetFormat), refs, variations: input.variations, layout: input.layout,
        text: { title: input.headline ?? input.copyText ?? null, price: input.price ?? null, cta: input.cta ?? null }, title: base.title, campaignId: base.campaignId,
        angle: input.angle ?? null, createdBy: input.userId,
        rebuild: (motivo) => buildVisualPrompt(this.ai, { ...brief, previousPrompt: ad.prompt_final, adjust: `Corrija este problema apontado pelo crítico: ${motivo}` }),
      });
      if (res.pending) {
        const pend = res.pending;
        const fixed: ServerCreativeProvider = { ...provider, generateImage: async () => pend };
        const r = await this.finalizeWith(fixed, base, true);
        return { ...r, artDirection: ad, variations: [] };
      }
      const created = await this.prisma.creatives.create({
        data: {
          workspace_id: ws, campaign_id: base.campaignId, brand_id: base.brandId, title: base.title, type: input.type, prompt: input.prompt, final_prompt: providerPrompt(res.ad),
          aspect_ratio: input.aspectRatio, copy_text: input.copyText, status: 'ready', provider: provider.id, estimated_cost: res.cost, real_cost: res.cost,
          preview_url: res.finalUrl, thumbnail_url: res.finalThumb, version: 1, angle: input.angle ?? null,
        },
        select: { id: true },
      });
      await this.prisma.media_assets.updateMany({
        where: { workspace_id: ws, id: { in: [res.finalAssetId, ...res.variations.map((v) => v.assetId)] } },
        data: { creative_id: created.id },
      });
      await this.prisma.creative_versions.create({ data: { workspace_id: ws, creative_id: created.id, version: 1, prompt: providerPrompt(res.ad), preview_url: res.finalUrl } });
      await this.prisma.creative_generation_jobs.update({
        where: { id: job.id },
        data: {
          status: 'ready', creative_id: created.id, final_prompt: providerPrompt(res.ad), asset_url: res.finalUrl, thumbnail_url: res.finalThumb, provider: provider.id,
          provider_log: providerLog(provider), estimated_cost: res.cost, actual_cost: res.cost, completed_at: new Date(),
        },
      });
      return { jobId: job.id, creativeId: created.id, status: 'ready', assetUrl: res.finalUrl, provider: provider.id, sandbox: false, error: null, artDirection: res.ad, variations: res.variations };
    } catch (e) {
      this.logger.error(`[art-pipeline] falhou job=${job.id}: ${e instanceof Error ? e.stack ?? e.message : e}`);
      const error = errMessage(e, FAIL_TEXT);
      await this.failJob(job.id, { provider: provider.id, error_message: error, provider_log: providerLog(provider) });
      return { jobId: job.id, creativeId: null, status: 'failed', assetUrl: null, provider: provider.id, sandbox: false, error, artDirection: ad, variations: [] };
    }
  }
}
