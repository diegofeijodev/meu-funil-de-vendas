import { Inject, Injectable, Logger } from '@nestjs/common';
import { UserError } from '../media/user-error';
import { fmtDate, IgFormat, NO_ACCOUNT_MSG, OVERDUE_MS, PostRow, SKIP_PREFIX, TOKEN_EXPIRED_POST_MSG } from './ig-types';
import { ContainerPending, Guardrail, IgStore, PostLease, PublishClaimLost, RateLimited, errText, leaseFree } from './ig-store.service';
import { EXTERNAL_FETCH, ExternalFetch, assertExternalUrl } from '../media/external-fetch';
import { MetaError, MetaGraphClient } from './meta-graph';
import { dateIssues } from './content-strategy';
import { normalizeHashtags } from './normalize';

const MAX_ATTEMPTS = 3;
const DAILY_LIMIT = 25;
const POLL_BUDGET_MS = 40_000;
const STALE_LOCK_MS = 15 * 60e3;
/**
 * Lease do post durante a publicação. O trabalho é renovado a cada etapa (cada sondagem de URL, criação de container e rodada de
 * polling), então o TTL só precisa cobrir a MAIOR ETAPA ÚNICA: sondagem da URL (até 4 saltos × 15 s), chamada Graph (60 s) ou rodada
 * de polling (≤ 5 s + 60 s). Quinze minutos dão folga de > 10x e batem com o STALE_LOCK_MS da fila (job travado há 15 min volta a pending).
 */
const PUBLISH_LEASE_MS = 15 * 60e3;
export const PUBLISH_INTERRUPTED = 'Publicação interrompida — tente publicar de novo.';
/** Guardrail de publicação sem conta (texto do protótipo). Post da programação com ele volta para "pronto" em vez de falhar. */
export const NO_ACCOUNT_GUARDRAIL = 'Nenhuma conta do Instagram conectada nesta empresa. Conecte em Instagram → Visão geral e agende de novo.';

export type PublishResult = { ok: boolean; sandbox: boolean; permalink?: string | null; error?: string };

/** Mídia do gerador simulado (picsum) ou marcada como mock — nunca vai ao ar. */
export const isMockMedia = (m: { url?: string | null; provider?: string | null; source?: string | null }) =>
  m.provider === 'mock' || m.source === 'mock' || /picsum\.photos/i.test(m.url ?? '');

export function fullCaption(post: PostRow) {
  const tags = normalizeHashtags(post.hashtags)
    .map((h) => `#${h}`)
    .join(' ');
  return [post.caption, post.cta, tags].filter(Boolean).join('\n\n').slice(0, 2200);
}

/**
 * Agenda, fila de publicação (`publishing_jobs`, `channel=instagram_organic`) e publicação pela Graph API.
 * A fila usa lock otimista (UPDATE … WHERE status='pending'), reset de lock vencido (15 min) e no máximo 3 tentativas.
 * O post em si é protegido por um lease (`ig_posts.lease_until`): quem publica o pega e o renova; lease vencido = processo morto.
 * `sweepStalePublishing` (no início de cada ciclo da fila) leva a `failed` o post `publishing` sem lease vivo e sem job pending/running.
 */
@Injectable()
export class PublishingService {
  private readonly logger = new Logger(PublishingService.name);
  /** Substituível nos testes. */
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms));
  /** Relógio dos prazos de polling; substituível nos testes junto com `sleep`. */
  now: () => number = () => Date.now();

  constructor(
    private readonly store: IgStore,
    private readonly graph: MetaGraphClient,
    @Inject(EXTERNAL_FETCH) private readonly http: ExternalFetch,
  ) {}

  private get prisma() {
    return this.store.prisma;
  }

  // ------------------------------------------------------------------ agenda

  async schedulePost(workspaceId: string, postId: string, scheduledAt: string | Date) {
    const post = await this.store.getPost(postId, workspaceId);
    if (!post.media?.length) throw new UserError('Gere a mídia antes de agendar.');
    if (!['approved', 'ready', 'scheduled', 'failed'].includes(post.status)) throw new UserError('O post precisa estar aprovado para ser agendado.');
    if ((await this.store.approvalRequired(post)) && !post.approved_at && post.status !== 'approved') throw new UserError('Este post exige aprovação antes de agendar.');
    const when = new Date(scheduledAt);
    // Checagem final de alinhamento com a estratégia (posts da programação com IA): reprovado vai para revisão e NÃO é agendado.
    if (post.run_id) {
      const problems = await this.alignmentProblems(post, when);
      if (problems.length) {
        const reason = `Checagem final: ${problems.join('; ')}.`;
        // Condicional ao status: um post que já virou publishing/generating no meio do caminho não é sobrescrito.
        const flagged = await this.prisma.ig_posts.updateMany({ where: { id: postId, workspace_id: workspaceId, status: { in: ['approved', 'ready', 'scheduled', 'failed'] } }, data: { status: 'needs_review', review_reason: reason } });
        // O job de um agendamento anterior sai da fila junto (senão a fila o tentaria e o guardrail o reprovaria).
        if (flagged.count) await this.prisma.publishing_jobs.updateMany({ where: { ig_post_id: postId, status: 'pending' }, data: { status: 'cancelled' } });
        throw new UserError(`Post enviado para revisão: ${problems.join('; ')}.`);
      }
    }
    const acc = await this.store.liveAccount(workspaceId);
    await this.prisma.$transaction([
      this.prisma.publishing_jobs.updateMany({ where: { ig_post_id: postId, status: 'pending' }, data: { status: 'cancelled' } }),
      this.prisma.publishing_jobs.create({
        data: { workspace_id: workspaceId, channel: 'instagram_organic', ig_post_id: postId, target: 'instagram', status: 'pending', mode: acc ? 'live' : 'mock', run_at: when },
      }),
      this.prisma.ig_posts.update({ where: { id: postId }, data: { status: 'scheduled', scheduled_at: when, last_error: null, failure_kind: null } }),
    ]);
    return { ok: true, sandbox: !acc };
  }

  /**
   * Problemas que impedem agendar um post da programação: sem ligação com objetivo/pilar/persona (só quando a programação tem
   * estratégia — posts de programações antigas não têm esses campos), expressão incoerente com a data, CTA fora dos CTAs da
   * estratégia e preço fora do cadastro de produtos da marca.
   */
  async alignmentProblems(post: PostRow, when: Date): Promise<string[]> {
    const ws: string = post.workspace_id;
    const run = await this.prisma.ig_auto_runs.findFirst({ where: { id: post.run_id, workspace_id: ws }, select: { strategy: true } });
    const problems: string[] = [];
    if (run?.strategy && (!post.objective_link || !post.pillar || !post.persona)) problems.push('faltam ligação com o objetivo, pilar ou persona');
    problems.push(...dateIssues([post.theme, post.hook, post.caption, post.cta].filter(Boolean).join(' '), when.toISOString()));
    const ctas: string[] = (((run?.strategy as { ctas?: string[] } | null)?.ctas ?? []) as string[]).map((c) => c.toLowerCase().trim());
    const norm = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '').trim();
    if (ctas.length && post.cta && !ctas.some((c) => norm(c) === norm(post.cta) || norm(post.cta).includes(norm(c)) || norm(c).includes(norm(post.cta)))) problems.push('CTA fora dos CTAs da estratégia');
    const plan = post.plan_id ? await this.prisma.ig_content_plans.findFirst({ where: { id: post.plan_id, workspace_id: ws }, select: { brand_id: true } }) : null;
    if (plan?.brand_id) {
      const prods = await this.prisma.products.findMany({ where: { brand_id: plan.brand_id, workspace_id: ws }, select: { price: true } });
      const valid = new Set(prods.map((p) => Number(p.price)).filter((n) => n > 0).map((n) => n.toFixed(2)));
      const prices = [...`${post.caption ?? ''} ${post.creative_brief?.headline ?? ''}`.matchAll(/R\$\s?(\d{1,5}(?:[.,]\d{2})?)/g)].map((m) => Number(m[1]!.replace(',', '.')).toFixed(2));
      if (prices.some((p) => !valid.has(p))) problems.push('preço fora do cadastro de produtos');
    }
    return problems;
  }

  /**
   * Agenda um post automático com mídia pronta. No modo "approval" só agenda depois de aprovado.
   * Sem conta do Instagram conectada: nada de job simulado — o post fica pronto com o aviso e o tick o agenda quando a conta conectar.
   * Mídia pronta depois do horário: publica o quanto antes (até 12 h de atraso); passou disso, o modo "publish" pula o horário
   * (o cronograma é respeitado) e o modo "approval" passa para o mesmo horário do dia seguinte.
   */
  async scheduleAutomated(postId: string): Promise<{ skipped: string } | { scheduled: string }> {
    const post = await this.prisma.ig_posts.findUnique({ where: { id: postId } });
    const media = (post?.media ?? []) as unknown[];
    if (!post?.automation || !Array.isArray(media) || !media.length) return { skipped: 'sem mídia' };
    if (!['ready', 'approved'].includes(post.status)) return { skipped: post.status };
    if (post.automation === 'approval' && !post.approved_at) return { skipped: 'aguardando aprovação' };
    if (!(await this.store.liveAccount(post.workspace_id))) {
      if (post.last_error !== NO_ACCOUNT_MSG && post.last_error !== TOKEN_EXPIRED_POST_MSG) {
        await this.prisma.ig_posts.updateMany({ where: { id: postId, status: post.status }, data: { last_error: NO_ACCOUNT_MSG } });
      }
      return { skipped: 'sem conta' };
    }
    const MIN = 60e3;
    let at = post.scheduled_at ? post.scheduled_at.getTime() : Date.now();
    const late = Date.now() - at;
    let msg: string;
    if (late <= 0) msg = `Agendado para ${fmtDate(new Date(at))}.`;
    else if (late <= OVERDUE_MS) {
      at = Date.now() + MIN;
      msg = 'A mídia ficou pronta depois do horário: publicando agora.';
    } else if (post.automation === 'publish') {
      const reason = 'o horário passou há mais de 12 h.';
      const got = await this.prisma.ig_posts.updateMany({ where: { id: postId, status: post.status }, data: { status: 'cancelled', last_error: `${SKIP_PREFIX}${reason}` } });
      if (got.count) await this.store.logEvent({ workspace_id: post.workspace_id, plan_id: post.plan_id, post_id: postId, kind: 'post_skipped', level: 'warn', message: `Horário pulado: ${reason}` });
      return { skipped: 'prazo vencido' };
    } else {
      while (at < Date.now() + 30 * MIN) at += 86400e3;
      msg = `Horário perdido: reagendado para ${fmtDate(new Date(at))}.`;
    }
    await this.schedulePost(post.workspace_id, postId, new Date(at));
    await this.store.logEvent({ workspace_id: post.workspace_id, plan_id: post.plan_id, post_id: postId, kind: 'schedule', message: msg });
    return { scheduled: new Date(at).toISOString() };
  }

  // ------------------------------------------------------------------ publicação

  private async waitContainer(workspaceId: string, containerId: string, deadline: number, lease?: PostLease) {
    while (this.now() < deadline) {
      await lease?.renew();
      const r = await this.graph.graph<{ status_code?: string; status?: string }>(workspaceId, `/${containerId}`, { params: { fields: 'status_code,status' } });
      if (r.status_code === 'FINISHED') return;
      if (r.status_code === 'ERROR' || r.status_code === 'EXPIRED') throw new Error(`A Meta não processou o vídeo (${r.status_code}): ${r.status ?? ''}`);
      await this.sleep(Math.min(r.status_code === 'IN_PROGRESS' ? 5_000 : 3_000, Math.max(0, deadline - this.now())));
    }
    throw new ContainerPending('A Meta ainda está processando a mídia; nova verificação em 2 minutos.');
  }

  /**
   * Confere que a URL da mídia responde publicamente (HEAD; alguns servidores só aceitam GET com Range). Passa pelo fetch guardado
   * (DNS verificado; nunca rede interna) e os redirecionamentos são seguidos à mão, cada um revalidado.
   */
  private async assertPublicUrl(url: string, lease?: PostLease) {
    await lease?.renew();
    if (!/^https:\/\//i.test(url ?? '')) throw new Guardrail('Mídia sem URL pública válida (HTTPS).');
    const probe = async (init: RequestInit): Promise<Response | null> => {
      let cur = url;
      for (let hop = 0; hop < 4; hop++) {
        try {
          cur = assertExternalUrl(cur, false, 'endereço da mídia');
        } catch {
          throw new Guardrail('Mídia sem URL pública válida (HTTPS).');
        }
        const res = await this.http(cur, { ...init, redirect: 'manual', signal: AbortSignal.timeout(15_000) }).catch(() => null);
        const loc = res?.headers.get('location');
        if (res && res.status >= 300 && res.status < 400 && loc) {
          cur = new URL(loc, cur).toString();
          continue;
        }
        return res;
      }
      return null;
    };
    let res = await probe({ method: 'HEAD' });
    if (!res || res.status === 405 || res.status === 403) res = await probe({ method: 'GET', headers: { Range: 'bytes=0-0' } });
    if (!res || !(res.ok || res.status === 206)) throw new Guardrail(`A mídia não está acessível publicamente (HTTP ${res?.status ?? 'sem resposta'}).`);
  }

  /**
   * Pega o post de forma atômica (UPDATE condicional + lease) para que a fila e o "publicar agora" nunca publiquem o mesmo post ao
   * mesmo tempo. Pega: status publicável, OU `publishing` com lease livre (nunca pego/vencido = o processo anterior morreu ou a fila
   * voltou depois do ContainerPending; o container já criado é retomado). `publishing` com lease vivo = outro processo está publicando.
   */
  private async claim(postId: string, workspaceId: string, resume: boolean): Promise<PostLease> {
    const lease = await this.store.claimLease(
      postId,
      workspaceId,
      { OR: [{ status: { in: ['approved', 'ready', 'scheduled', 'failed'] } }, { status: 'publishing' }] },
      { status: 'publishing' },
      PUBLISH_LEASE_MS,
    );
    if (!lease) {
      const cur = await this.prisma.ig_posts.findFirst({ where: { id: postId, workspace_id: workspaceId }, select: { status: true } });
      if (cur?.status === 'publishing') throw new PublishClaimLost('Este post já está sendo publicado.');
      if (cur?.status === 'published') throw new PublishClaimLost('Este post já foi publicado.');
      if (cur?.status === 'generating') throw new PublishClaimLost('A mídia deste post ainda está sendo gerada.');
      if (!cur || cur.status === 'cancelled') throw new PublishClaimLost('Este post foi cancelado.');
      // idea / pending_approval / rejected…: mesma mensagem do guardrail de aprovação do protótipo.
      throw new Guardrail('Post não aprovado — publicação bloqueada.');
    }
    // "publicar agora": os jobs pendentes do post saem da fila (a fila só se retoma sozinha).
    if (!resume) {
      try {
        await this.prisma.publishing_jobs.updateMany({ where: { ig_post_id: postId, status: 'pending' }, data: { status: 'cancelled' } });
      } catch (e) {
        await lease.release();
        throw e;
      }
    }
    return lease;
  }

  async publishInstagramPost(postId: string, workspaceId?: string, opts: { fromQueue?: boolean } = {}): Promise<PublishResult> {
    const post = await this.store.getPost(postId, workspaceId);
    const lease = await this.claim(postId, post.workspace_id, !!opts.fromQueue);
    try {
      return await this.publishInner(postId, { ...post, status: post.status }, lease);
    } finally {
      await lease.release();
    }
  }

  /**
   * Varredor: post `publishing` sem lease vivo (processo morto ou lease vencido) e sem job pending/running (nada vai retomá-lo)
   * vai para `failed` com mensagem clara; o usuário pode publicar de novo. Post com container pendente na Meta tem job pending
   * (a fila volta em 2 min) e não é tocado; post com lease vivo (publicação em andamento, mesmo vídeo longo) também não.
   */
  async sweepStalePublishing() {
    const posts = await this.prisma.ig_posts.findMany({ where: { status: 'publishing', publishing_jobs: { none: { status: { in: ['pending', 'running'] } } }, ...leaseFree() }, select: { id: true, workspace_id: true, plan_id: true }, orderBy: { updated_at: 'asc' }, take: 50 });
    const swept: string[] = [];
    for (const p of posts) {
      const active = await this.prisma.publishing_jobs.count({ where: { ig_post_id: p.id, status: { in: ['pending', 'running'] } } });
      if (active) continue;
      const got = await this.prisma.ig_posts.updateMany({
        where: { id: p.id, status: 'publishing', AND: [leaseFree()] },
        data: { status: 'failed', last_error: PUBLISH_INTERRUPTED, lease_until: null, failure_kind: 'publish' },
      });
      if (!got.count) continue;
      swept.push(p.id);
      await this.store.logEvent({ workspace_id: p.workspace_id, plan_id: p.plan_id, post_id: p.id, kind: 'failure', level: 'error', message: PUBLISH_INTERRUPTED });
    }
    return swept;
  }

  private async publishInner(postId: string, post: PostRow, lease: PostLease): Promise<PublishResult> {
    const ws: string = post.workspace_id;
    const format = post.format as IgFormat;
    const media: any[] = [...(post.media ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    if (!media.length) throw new Guardrail('Post sem mídia.');

    // Guardrail: nunca publicar sem aprovação quando o plano exige.
    if ((await this.store.approvalRequired(post)) && !post.approved_at) throw new Guardrail('Post não aprovado — publicação bloqueada.');
    // Guardrail: no máximo 25 publicações em 24h por conta (contagem local).
    const count = await this.prisma.ig_posts.count({ where: { workspace_id: ws, status: 'published', published_at: { gte: new Date(Date.now() - 24 * 3600e3) } } });
    if (count >= DAILY_LIMIT) throw new RateLimited('Limite de 25 publicações em 24h atingido.');
    // Guardrail: mídia reprovada na validação de qualidade do Instagram não é publicada.
    const assetIds = media.map((m) => m.asset_id).filter(Boolean);
    const MOCK_MSG = 'Mídia simulada (sem IA real) não pode ser publicada. Gere a mídia de novo com um provedor conectado.';
    if (assetIds.length) {
      const assets = await this.prisma.media_assets.findMany({
        where: { id: { in: assetIds }, workspace_id: ws },
        select: { id: true, ig_ready: true, quality_report: true, provider: true, source: true, url: true },
      });
      if (assets.some(isMockMedia)) throw new Guardrail(MOCK_MSG);
      const bad = assets.find((a) => !a.ig_ready);
      if (bad) throw new Guardrail(`Mídia fora do padrão do Instagram: ${((bad.quality_report as { issues?: string[] } | null)?.issues ?? []).join(' ') || 'validação pendente.'}`);
    } else {
      const bad = media.find((m) => m.ig_ready === false);
      if (bad) throw new Guardrail(`Mídia fora do padrão do Instagram: ${(bad.issues ?? []).join(' ')}`);
    }
    // Guardrail: nunca publicar imagem simulada (foto aleatória de banco de imagens).
    if (media.some(isMockMedia)) throw new Guardrail(MOCK_MSG);
    // Guardrail: toda mídia precisa de URL pública válida.
    for (const m of media) await this.assertPublicUrl(m.url, lease);

    const acc = await this.store.liveAccount(ws);
    const deadline = this.now() + POLL_BUDGET_MS;

    // Retomada: container já criado numa execução anterior → só polling + media_publish.
    if (acc && post.ig_creation_id && post.status === 'publishing') return this.finishPublish(ws, postId, acc.ig_user_id as string, post.ig_creation_id, deadline, lease);

    // Sem conta conectada não existe publicação: nunca marcar como publicado de mentira.
    if (!acc) throw new Guardrail(NO_ACCOUNT_GUARDRAIL);

    const ig = acc.ig_user_id as string;
    const limit = await this.graph.graph<{ data?: { quota_usage?: number }[] }>(ws, `/${ig}/content_publishing_limit`, { params: { fields: 'quota_usage' } }).catch((e) => {
      if (e instanceof MetaError && e.code === 190) throw e;
      return null;
    });
    if ((limit?.data?.[0]?.quota_usage ?? 0) >= DAILY_LIMIT) throw new RateLimited('Limite de 25 publicações em 24h atingido.');

    await this.store.patchPost(postId, { status: 'publishing', last_error: null });
    const caption = fullCaption(post);
    const create = async (params: Record<string, unknown>) => {
      await lease.renew();
      return (await this.graph.graph<{ id: string }>(ws, `/${ig}/media`, { method: 'POST', params })).id;
    };
    let creationId: string;

    if (format === 'feed_image') {
      creationId = await create({ image_url: media[0].url, caption });
    } else if (format === 'feed_carousel') {
      const children: string[] = [];
      for (const m of media.slice(0, 10)) {
        const params: Record<string, unknown> = { is_carousel_item: 'true' };
        if (m.type === 'video') Object.assign(params, { media_type: 'VIDEO', video_url: m.url });
        else params['image_url'] = m.url;
        const id = await create(params);
        if (m.type === 'video') await this.waitContainer(ws, id, deadline, lease);
        children.push(id);
      }
      creationId = await create({ media_type: 'CAROUSEL', children: children.join(','), caption });
    } else if (format === 'reel') {
      creationId = await create({ media_type: 'REELS', video_url: media[0].url, caption, share_to_feed: 'true', ...(media[0].cover_url ? { cover_url: media[0].cover_url } : {}) });
    } else {
      const video = format === 'story_video';
      creationId = await create({ media_type: 'STORIES', [video ? 'video_url' : 'image_url']: media[0].url });
    }

    // Salva o container antes do polling para poder retomar na próxima execução.
    await this.store.patchPost(postId, { ig_creation_id: creationId });
    return this.finishPublish(ws, postId, ig, creationId, deadline, lease);
  }

  private async finishPublish(ws: string, postId: string, ig: string, creationId: string, deadline: number, lease: PostLease): Promise<PublishResult> {
    // Imagens também passam por processamento na Meta: espera o container ficar FINISHED.
    await this.waitContainer(ws, creationId, deadline, lease);
    await lease.renew();
    const published = await this.graph.graph<{ id: string }>(ws, `/${ig}/media_publish`, { method: 'POST', params: { creation_id: creationId } });
    const info = await this.graph.graph<{ permalink?: string }>(ws, `/${published.id}`, { params: { fields: 'permalink' } }).catch(() => ({ permalink: undefined }));
    await this.store.patchPost(postId, {
      status: 'published',
      published_at: new Date(),
      ig_media_id: published.id,
      ig_permalink: info.permalink ?? null,
      ig_creation_id: null,
      last_error: null,
      failure_kind: null,
    });
    return { ok: true, sandbox: false, permalink: info.permalink ?? null };
  }

  // ------------------------------------------------------------------ fila

  async runPublishingQueue() {
    const now = new Date();
    // Libera travas antigas (execução interrompida).
    await this.prisma.publishing_jobs.updateMany({
      where: { channel: 'instagram_organic', status: 'running', locked_at: { lt: new Date(Date.now() - STALE_LOCK_MS) } },
      data: { status: 'pending', locked_at: null },
    });
    // Posts presos em `publishing` (processo morto, sem job para retomar) → failed com aviso.
    await this.sweepStalePublishing().catch((e) => this.logger.error(`[instagram] varredor de publicação falhou: ${errText(e)}`));
    const jobs = await this.prisma.publishing_jobs.findMany({
      where: { channel: 'instagram_organic', status: 'pending', run_at: { lte: now } },
      orderBy: { run_at: 'asc' },
      // Poucos por execução: cada publicação pode levar até ~40 s de processamento na Meta.
      take: 4,
      select: { id: true, ig_post_id: true, attempts: true, log: true },
    });

    const results: { job: string; status: string; error?: string }[] = [];
    for (const job of jobs) {
      // Lock otimista: só segue se ninguém pegou antes.
      const locked = await this.prisma.publishing_jobs.updateMany({
        where: { id: job.id, status: 'pending' },
        data: { status: 'running', locked_at: new Date(), attempts: job.attempts + 1 },
      });
      if (!locked.count) continue;
      const stamp = new Date().toISOString();
      const logWith = (line: string) => `${job.log ?? ''}\n[${stamp}] ${line}`.trim();
      try {
        if (!job.ig_post_id) throw new Guardrail('Job sem post.');
        const r = await this.publishInstagramPost(job.ig_post_id, undefined, { fromQueue: true });
        await this.prisma.publishing_jobs.update({
          where: { id: job.id },
          data: { status: 'done', locked_at: null, mode: r.sandbox ? 'mock' : 'live', log: logWith(`publicado ${r.permalink ?? ''}`) },
        });
        const pub = await this.prisma.ig_posts.findUnique({ where: { id: job.ig_post_id } });
        if (pub) await this.store.logEvent({ workspace_id: pub.workspace_id, plan_id: pub.plan_id, post_id: pub.id, kind: 'publish', message: `Publicado no Instagram ${r.permalink ?? ''}`.trim() });
        results.push({ job: job.id, status: 'done' });
      } catch (e) {
        const msg = errText(e);
        if (e instanceof PublishClaimLost) {
          // Outro processo está publicando (volta em 2 min) ou o post já saiu/foi cancelado (o job é encerrado). Não conta tentativa.
          const cur = job.ig_post_id ? await this.prisma.ig_posts.findUnique({ where: { id: job.ig_post_id }, select: { status: true } }) : null;
          const over = !cur || ['published', 'cancelled'].includes(cur.status);
          await this.prisma.publishing_jobs.update({
            where: { id: job.id },
            data: { status: over ? 'cancelled' : 'pending', locked_at: null, attempts: job.attempts, ...(over ? {} : { run_at: new Date(Date.now() + 2 * 60e3) }), log: logWith(msg) },
          });
          results.push({ job: job.id, status: over ? 'skipped' : 'processing' });
          continue;
        }
        if (e instanceof ContainerPending) {
          await this.prisma.publishing_jobs.update({
            where: { id: job.id },
            data: { status: 'pending', locked_at: null, attempts: job.attempts, run_at: new Date(Date.now() + 2 * 60e3), log: logWith(msg) },
          });
          results.push({ job: job.id, status: 'processing' });
          continue;
        }
        const attempts = job.attempts + 1;
        const rate = e instanceof RateLimited;
        const tokenExpired = e instanceof MetaError && e.code === 190;
        const blocked = e instanceof Guardrail;
        const retry = !tokenExpired && !blocked && (rate || attempts < MAX_ATTEMPTS);
        const post = job.ig_post_id ? await this.prisma.ig_posts.findUnique({ where: { id: job.ig_post_id } }) : null;
        if (tokenExpired && post) await this.store.handleTokenExpired(post.workspace_id, msg);
        // Post da programação sem conta/token: volta para "pronto" (sem refazer mídia) e é reagendado sozinho quando a conta reconectar.
        const backToReady = !!post?.run_id && (tokenExpired || (blocked && msg === NO_ACCOUNT_GUARDRAIL));
        if (post)
          await this.store.logEvent({
            workspace_id: post.workspace_id,
            plan_id: post.plan_id,
            post_id: post.id,
            kind: blocked ? 'guardrail' : 'failure',
            level: retry ? 'warn' : 'error',
            message: `${retry ? 'Falha (nova tentativa)' : 'Falha'} ao publicar: ${msg}`,
          });
        const delay = rate ? 60 * 60e3 : 5 * 60e3 * 2 ** (attempts - 1); // backoff 5, 10 min
        await this.prisma.publishing_jobs.update({
          where: { id: job.id },
          data: {
            status: retry ? 'pending' : 'failed',
            locked_at: null,
            attempts: rate ? job.attempts : attempts,
            ...(retry ? { run_at: new Date(Date.now() + delay) } : {}),
            log: logWith(msg),
          },
        });
        if (post)
          await this.store.patchPost(
            post.id,
            backToReady
              ? { status: 'ready', last_error: tokenExpired ? TOKEN_EXPIRED_POST_MSG : NO_ACCOUNT_MSG, ig_creation_id: null }
              : {
                  status: retry ? 'scheduled' : 'failed',
                  last_error: msg,
                  retry_count: (post.retry_count ?? 0) + (rate ? 0 : 1),
                  ...(retry ? { scheduled_at: new Date(Date.now() + delay) } : { failure_kind: 'publish' }),
                },
          );
        results.push({ job: job.id, status: backToReady ? 'waiting_account' : retry ? 'retry' : 'failed', error: msg });
      }
    }
    return results;
  }
}
