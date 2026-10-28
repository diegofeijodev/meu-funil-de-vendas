import { Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { UserError } from '../media/user-error';
import { fmtDate, IgFormat, NO_ACCOUNT_MSG, OVERDUE_MS, PostRow, SKIP_PREFIX, TOKEN_EXPIRED_POST_MSG } from './ig-types';
import { ClaimRefused, ContainerPending, Guardrail, IgStore, OriginUnavailable, PostLease, PublishClaimLost, RateLimited, errText, leaseFree } from './ig-store.service';
import { PUBLISH_ORIGIN_GUARDS, PublishOriginGuard } from './origin-guards';
import { EXTERNAL_FETCH, ExternalFetch, assertExternalUrl } from '../media/external-fetch';
import { MetaError, MetaGraphClient } from './meta-graph';
import { dateIssues } from './content-strategy';
import { normalizeHashtags } from './normalize';
import { CAMPAIGN_FINISHED } from '../campaigns/campaign-labels';

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

/**
 * Esperas antes de cada nova tentativa de criar um container cuja mídia a Meta não conseguiu baixar (até 3 tentativas extras,
 * dentro do mesmo job). Em produção a URL responde 200 e a Meta às vezes nem chega a buscá-la: a falha é transitória do lado dela.
 */
export const MEDIA_FETCH_RETRY_DELAYS_MS = [5_000, 15_000, 30_000] as const;
/** Teto da soma das esperas de novas tentativas numa execução da publicação (todas as mídias do post juntas). */
export const MEDIA_FETCH_RETRY_BUDGET_MS = 90_000;

const MEDIA_FETCH_TEXT = /obter a m[ií]dia|media could not be fetched|media download has failed|2207052/i;

/** O container de vídeo terminou em ERROR porque a Meta não conseguiu baixar o arquivo (aparece só no polling). */
export class MediaFetchFailed extends Error {}

/**
 * Erro "a Meta não conseguiu baixar a mídia da URL": na criação do container vem como `MetaError` código 9004 / subcódigo 2207052
 * ("Media download has failed." / "The media could not be fetched from this uri"; em pt-BR, "Não foi possível obter a mídia
 * deste URI"), com a mensagem já traduzida ("A Meta respondeu com erro: …"); no vídeo, aparece no polling (`status_code: ERROR`
 * com esse texto no `status`) e vira `MediaFetchFailed`.
 */
export function isMediaFetchError(e: unknown): boolean {
  if (e instanceof MediaFetchFailed) return true;
  if (!(e instanceof MetaError)) return false;
  if (e.code === 9004 || e.subcode === 2207052) return true;
  return MEDIA_FETCH_TEXT.test(e.message);
}

/** "14h05" no horário de Brasília. */
const hhmmSp = (d: Date) => d.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }).replace(':', 'h');
const withPeriod = (t: string) => (/[.!?…]$/.test(t.trim()) ? t.trim() : `${t.trim()}.`);

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
export class PublishingService implements OnModuleInit {
  private readonly logger = new Logger(PublishingService.name);
  /** Substituível nos testes. */
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms));
  /** Relógio dos prazos de polling; substituível nos testes junto com `sleep`. */
  now: () => number = () => Date.now();

  constructor(
    private readonly store: IgStore,
    private readonly graph: MetaGraphClient,
    @Inject(EXTERNAL_FETCH) private readonly http: ExternalFetch,
    @Optional() @Inject(PUBLISH_ORIGIN_GUARDS) private readonly guards: PublishOriginGuard | null = null,
  ) {}

  /** Prova da injeção na subida (o smoke confere o log): `@Optional()` deixaria a guarda nula em silêncio. */
  onModuleInit() {
    if (this.guards) this.logger.log('guarda de origem das vagas ativa na publicação');
    else this.logger.warn('sem guarda de origem: posts de vaga sairiam sem conferir a vaga');
  }

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
      if (r.status_code === 'ERROR' && MEDIA_FETCH_TEXT.test(r.status ?? '')) throw new MediaFetchFailed(`A Meta não processou o vídeo (${r.status_code}): ${r.status ?? ''}`);
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
      // idea / pending_approval / rejected…: mesma mensagem do guardrail de aprovação do protótipo. ClaimRefused = nada mudou no
      // post (o "publicar agora" não grava failed); a fila trata como guardrail.
      throw new ClaimRefused('Post não aprovado — publicação bloqueada.');
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

  async publishInstagramPost(postId: string, workspaceId?: string, opts: { fromQueue?: boolean; jobId?: string } = {}): Promise<PublishResult> {
    const post = await this.store.getPost(postId, workspaceId);
    const lease = await this.claim(postId, post.workspace_id, !!opts.fromQueue);
    // Pela fila: cada renovação do lease também renova a trava do job (esperas de nova tentativa não deixam a trava vencer).
    const jobId = opts.jobId;
    if (jobId) lease.afterRenew = () => this.prisma.publishing_jobs.updateMany({ where: { id: jobId, status: 'running' }, data: { locked_at: new Date() } });
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
    // Prazo do polling; cresce com as esperas das novas tentativas de mídia (senão elas comeriam o tempo do container).
    let deadline = this.now() + POLL_BUDGET_MS;
    let retryWaited = 0;
    /**
     * Roda `fn` (criar um container e, se for vídeo, esperar o processamento). Se a Meta não conseguir baixar a mídia (falha
     * transitória dela), repete a MESMA etapa até 3 vezes (5 s, 15 s, 30 s; no máximo 90 s de espera somando todo o post),
     * renovando o lease antes de cada tentativa; o que já foi criado (filhos anteriores do carrossel) fica. Qualquer outro erro, a
     * 4ª falha ou o teto de espera sobem como antes (a fila decide se repete o job).
     */
    const withMediaRetry = async <T>(what: string, fn: (attempt: number) => Promise<T>): Promise<T> => {
      for (let attempt = 0; ; attempt++) {
        await lease.renew();
        try {
          return await fn(attempt);
        } catch (e) {
          const wait = MEDIA_FETCH_RETRY_DELAYS_MS[attempt];
          if (wait === undefined || !isMediaFetchError(e) || retryWaited + wait > MEDIA_FETCH_RETRY_BUDGET_MS) throw e;
          retryWaited += wait;
          const line = `O Instagram não conseguiu baixar ${what}. Tentando de novo em ${wait / 1000} segundos (tentativa ${attempt + 2} de ${MEDIA_FETCH_RETRY_DELAYS_MS.length + 1}).`;
          this.logger.warn(`[instagram] post ${postId}: ${line} ${errText(e)}`);
          await this.store.logEvent({ workspace_id: ws, plan_id: post.plan_id, post_id: postId, kind: 'retry', level: 'warn', message: line });
          await this.sleep(wait);
          deadline += wait;
        }
      }
    };
    const mediaLabel = (format === 'reel' || format === 'story_video') ? 'o vídeo' : 'a imagem';

    // Retomada: container já criado numa execução anterior → polling + media_publish (vídeo que a Meta não baixou é recriado).
    if (acc && post.ig_creation_id && post.status === 'publishing') {
      const ig = acc.ig_user_id as string;
      const resumeId = post.ig_creation_id as string;
      if (format === 'feed_carousel') return this.finishPublish(ws, postId, ig, resumeId, deadline, lease);
      const params = this.singleParams(format, media, fullCaption(post));
      const creationId = await withMediaRetry(mediaLabel, async (attempt) => {
        const id = attempt === 0 ? resumeId : await this.createContainer(ws, ig, params, postId);
        await this.waitContainer(ws, id, deadline, lease);
        return id;
      });
      return this.finishPublish(ws, postId, ig, creationId, deadline, lease, true);
    }

    // Sem conta conectada não existe publicação: nunca marcar como publicado de mentira.
    if (!acc) throw new Guardrail(NO_ACCOUNT_GUARDRAIL);

    // Post de programação cancelada ou de campanha encerrada não sai (ficou na fila por um instante, ou foi agendado antes):
    // cancela o post e o job em vez de criar container.
    const gone = await this.cancelledOrigin(post);
    if (gone) {
      await this.prisma.ig_posts.updateMany({ where: { id: postId, status: { notIn: ['published'] } }, data: { status: 'cancelled', ig_creation_id: null } });
      await this.prisma.publishing_jobs.updateMany({ where: { ig_post_id: postId, status: 'pending' }, data: { status: 'cancelled', locked_at: null } });
      await this.store.logEvent({ workspace_id: ws, plan_id: post.plan_id, post_id: postId, kind: 'guardrail', level: 'warn', message: `Post cancelado: ${gone}` });
      throw new PublishClaimLost(`Post cancelado: ${gone}`);
    }

    const ig = acc.ig_user_id as string;
    const limit = await this.graph.graph<{ data?: { quota_usage?: number }[] }>(ws, `/${ig}/content_publishing_limit`, { params: { fields: 'quota_usage' } }).catch((e) => {
      if (e instanceof MetaError && e.code === 190) throw e;
      return null;
    });
    if ((limit?.data?.[0]?.quota_usage ?? 0) >= DAILY_LIMIT) throw new RateLimited('Limite de 25 publicações em 24h atingido.');

    await this.store.patchPost(postId, { status: 'publishing', last_error: null });
    const caption = fullCaption(post);

    if (format === 'feed_carousel') {
      const children: string[] = [];
      const items = media.slice(0, 10);
      for (const [i, m] of items.entries()) {
        const params: Record<string, unknown> = { is_carousel_item: 'true' };
        if (m.type === 'video') Object.assign(params, { media_type: 'VIDEO', video_url: m.url });
        else params['image_url'] = m.url;
        const what = `${m.type === 'video' ? 'o vídeo' : 'a imagem'} ${i + 1} de ${items.length} do carrossel`;
        const id = await withMediaRetry(what, async () => {
          const created = await this.createContainer(ws, ig, params);
          if (m.type === 'video') await this.waitContainer(ws, created, deadline, lease);
          return created;
        });
        children.push(id);
      }
      const creationId = await withMediaRetry('o carrossel', () => this.createContainer(ws, ig, { media_type: 'CAROUSEL', children: children.join(','), caption }));
      // Salva o container antes do polling para poder retomar na próxima execução.
      await this.store.patchPost(postId, { ig_creation_id: creationId });
      return this.finishPublish(ws, postId, ig, creationId, deadline, lease);
    }

    // Imagem única, reel e story: cria, salva (retomada) e espera ficar pronto; se a Meta não baixar a mídia, recria.
    const params = this.singleParams(format, media, caption);
    const creationId = await withMediaRetry(mediaLabel, async () => {
      const id = await this.createContainer(ws, ig, params, postId);
      await this.waitContainer(ws, id, deadline, lease);
      return id;
    });
    return this.finishPublish(ws, postId, ig, creationId, deadline, lease, true);
  }

  /** Parâmetros do container de mídia única (imagem do feed, reel ou story). */
  private singleParams(format: IgFormat, media: any[], caption: string): Record<string, unknown> {
    if (format === 'feed_image') return { image_url: media[0].url, caption };
    if (format === 'reel') return { media_type: 'REELS', video_url: media[0].url, caption, share_to_feed: 'true', ...(media[0].cover_url ? { cover_url: media[0].cover_url } : {}) };
    const video = format === 'story_video';
    return { media_type: 'STORIES', [video ? 'video_url' : 'image_url']: media[0].url };
  }

  /** Cria um container; com `saveTo`, grava o id no post antes do polling (a próxima execução retoma dele). */
  private async createContainer(ws: string, ig: string, params: Record<string, unknown>, saveTo?: string): Promise<string> {
    const id = (await this.graph.graph<{ id: string }>(ws, `/${ig}/media`, { method: 'POST', params })).id;
    if (saveTo) await this.store.patchPost(saveTo, { ig_creation_id: id });
    return id;
  }

  private async finishPublish(ws: string, postId: string, ig: string, creationId: string, deadline: number, lease: PostLease, ready = false): Promise<PublishResult> {
    // Imagens também passam por processamento na Meta: espera o container ficar FINISHED (se ainda não esperou).
    if (!ready) await this.waitContainer(ws, creationId, deadline, lease);
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

  /**
   * Motivo para NÃO devolver o post à agenda depois de uma falha: ele foi cancelado no meio da publicação, a programação dele foi
   * cancelada ou a campanha de origem (da programação ou do plano) foi encerrada. `null` = pode tentar de novo.
   * Post de vaga: por último, a guarda de origem (`PUBLISH_ORIGIN_GUARDS`) decide para o instante `at`; ela lança
   * `OriginUnavailable` quando a fonte está fora do ar.
   */
  private async cancelledOrigin(post: PostRow, at = new Date()): Promise<string | null> {
    if (post.status === 'cancelled') return 'o post foi cancelado.';
    const ws = post.workspace_id;
    const run = post.run_id ? await this.prisma.ig_auto_runs.findFirst({ where: { id: post.run_id, workspace_id: ws }, select: { status: true, campaign_id: true } }) : null;
    if (run?.status === 'cancelled') return 'a programação foi cancelada.';
    const plan = post.plan_id ? await this.prisma.ig_content_plans.findFirst({ where: { id: post.plan_id, workspace_id: ws }, select: { campaign_id: true } }) : null;
    const campaignIds = [run?.campaign_id, plan?.campaign_id].filter(Boolean) as string[];
    if (campaignIds.length && (await this.prisma.campaigns.count({ where: { id: { in: campaignIds }, workspace_id: ws, status: CAMPAIGN_FINISHED } }))) return 'a campanha foi encerrada.';
    if (this.guards && post.source === 'vacancy') return await this.guards.blockReason(post, at);
    return null;
  }

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
        const r = await this.publishInstagramPost(job.ig_post_id, undefined, { fromQueue: true, jobId: job.id });
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
        if (e instanceof OriginUnavailable) {
          // A fonte da origem (vitrine do Freela) está fora do ar: nada foi criado na Meta. Volta em 10 min sem contar tentativa;
          // o post (que o claim pôs em "publishing") volta para a agenda nesse horário.
          const runAt = new Date(Date.now() + 10 * 60e3);
          await this.prisma.publishing_jobs.update({
            where: { id: job.id },
            data: { status: 'pending', locked_at: null, attempts: job.attempts, run_at: runAt, log: logWith(msg) },
          });
          if (job.ig_post_id) await this.prisma.ig_posts.updateMany({ where: { id: job.ig_post_id, status: 'publishing' }, data: { status: 'scheduled', scheduled_at: runAt, ig_creation_id: null } });
          this.logger.warn(`[instagram] post ${job.ig_post_id}: origem indisponível (${msg}); nova tentativa às ${hhmmSp(runAt)}.`);
          results.push({ job: job.id, status: 'retry', error: msg });
          continue;
        }
        const attempts = job.attempts + 1;
        const rate = e instanceof RateLimited;
        const tokenExpired = e instanceof MetaError && e.code === 190;
        const blocked = e instanceof Guardrail;
        const delay = rate ? 60 * 60e3 : 5 * 60e3 * 2 ** (attempts - 1); // backoff 5, 10 min
        const post = job.ig_post_id ? await this.prisma.ig_posts.findUnique({ where: { id: job.ig_post_id } }) : null;
        // O post saiu de cena enquanto publicava (campanha encerrada, programação cancelada, vaga fechada): nada de voltar para a
        // agenda. No limite diário a guarda de origem olha o horário da próxima tentativa (a vaga pode já ter começado até lá).
        // Guarda fora do ar aqui não muda o tratamento do erro (fica só no log).
        const gone = post
          ? await this.cancelledOrigin(post, new Date(Date.now() + (rate ? delay : 0))).catch((err) => {
              this.logger.warn(`[instagram] post ${post.id}: cancelledOrigin falhou no catch da fila: ${errText(err)}`);
              return null;
            })
          : null;
        if (post && gone) {
          await this.prisma.publishing_jobs.update({ where: { id: job.id }, data: { status: 'cancelled', locked_at: null, attempts, log: logWith(`${msg} — cancelado: ${gone}`) } });
          await this.prisma.ig_posts.updateMany({ where: { id: post.id, status: { notIn: ['published'] } }, data: { status: 'cancelled', last_error: msg, ig_creation_id: null } });
          await this.store.logEvent({ workspace_id: post.workspace_id, plan_id: post.plan_id, post_id: post.id, kind: 'guardrail', level: 'warn', message: `Publicação cancelada: ${gone}` });
          results.push({ job: job.id, status: 'cancelled', error: msg });
          continue;
        }
        const retry = !tokenExpired && !blocked && (rate || attempts < MAX_ATTEMPTS);
        if (tokenExpired && post) await this.store.handleTokenExpired(post.workspace_id, msg);
        // Post da programação ou story de vaga sem conta/token: volta para "pronto" (sem refazer mídia) e é reagendado sozinho quando
        // a conta reconectar (a programação pelo calendário automático; a vaga pelo job dos stories).
        const backToReady = (!!post?.run_id || post?.source === 'vacancy') && (tokenExpired || (blocked && msg === NO_ACCOUNT_GUARDRAIL));
        if (post)
          await this.store.logEvent({
            workspace_id: post.workspace_id,
            plan_id: post.plan_id,
            post_id: post.id,
            kind: blocked ? 'guardrail' : 'failure',
            level: retry ? 'warn' : 'error',
            message: retry
              ? `Não foi possível publicar: ${withPeriod(msg)} Vamos tentar de novo às ${hhmmSp(new Date(Date.now() + delay))}.`
              : !blocked && !tokenExpired && attempts >= MAX_ATTEMPTS
                ? `Não foi possível publicar depois de ${attempts} tentativas: ${withPeriod(msg)} Abra o post no calendário e clique em Publicar agora para tentar de novo.`
                : `Não foi possível publicar: ${msg}`,
          });
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
