import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { notFound, UserError } from '../media/user-error';
import { strategyBrief } from '../strategist/strategist.prompt';
import { StrategistService } from '../strategist/strategist.service';
import { ContentService } from './content.service';
import { ContentStrategyService } from './content-strategy.service';
import { brandContext, DATE_RULES, fullDate, isCreditFailure, RunStrategy, Verdict } from './content-strategy';
import { ASPECT, fmtDate, IgFormat } from './ig-types';
import { IgStore, errText } from './ig-store.service';
import { MediaGenerationService } from './media-generation.service';
import { asList, asText, normalizeHashtags } from './normalize';
import { PublishingService } from './publishing.service';
import { AutoConfig, AutoMode, CHUNK, computeSlots, MIN, plusDays, Slot, todaySP, uniqTimes } from './slots';

const ITEM = {
  type: 'object',
  additionalProperties: false,
  required: ['index', 'theme', 'pillar', 'persona', 'product_name', 'funnel_stage', 'objective_link', 'hook', 'headline', 'caption', 'hashtags', 'cta', 'image_prompt', 'slides'],
  properties: {
    index: { type: 'integer' },
    theme: { type: 'string' },
    pillar: { type: 'string' },
    // Campos novos da estratégia: o protótipo os pedia só no texto do prompt; aqui entram no esquema para o gateway devolvê-los.
    persona: { type: 'string' },
    product_name: { type: 'string' },
    objective_link: { type: 'string' },
    funnel_stage: { type: 'string', enum: ['atracao', 'consideracao', 'conversao'] },
    hook: { type: 'string' },
    headline: { type: 'string' },
    caption: { type: 'string' },
    hashtags: { type: 'array', items: { type: 'string' } },
    cta: { type: 'string' },
    image_prompt: { type: 'string' },
    slides: { type: 'array', items: { type: 'string' } },
  },
};
const SCHEMA = { type: 'object', additionalProperties: false, required: ['posts'], properties: { posts: { type: 'array', items: ITEM } } };

const FORMAT_GUIDE: Record<IgFormat, string> = {
  feed_image: 'post de imagem única: uma ideia forte; headline curta aplicada na arte',
  feed_carousel: "carrossel: 4 a 7 slides em 'slides' (1º = gancho, meio = conteúdo, último = CTA); headline do 1º slide",
  reel: 'Reels: image_prompt descreve a cena em movimento de 5 a 8 s; gancho nos 2 primeiros segundos; legenda completa',
  story_image: 'story de imagem: headline curta e direta na arte; legenda curta (stories não exibem legenda) e CTA de interação (responder, enquete, link)',
  story_video: 'story em vídeo curto: cena simples de 5 s; headline curta; CTA de interação',
};

/** Quem perdeu o lease da programação (venceu e outro worker assumiu) para de escrever: o resultado dele é descartado. */
class LeaseLost extends Error {}

/** Trava do lote: MAIOR que o timeout da IA (`AiService.gw`: 180 s) com folga para gravar; senão outro tick pegaria o mesmo lote no meio da chamada. */
export const LOCK_MS = 240_000;
const weekdayName = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { weekday: 'long', timeZone: 'America/Sao_Paulo' });
const dayOf = (d: Date) => d.toISOString().slice(0, 10);
const dateCol = (s: string) => new Date(`${s}T12:00:00Z`);

type RunCtx = {
  plan: Prisma.ig_content_plansGetPayload<object>;
  brand: NonNullable<Awaited<ReturnType<ContentService['brandFor']>>>;
  products: { id: string; name: string; description: string | null; price: number | null }[];
  personas: { name: string; age_range: string | null; pains: string | null; desires: string | null; interests: string | null }[];
  objective: string;
  campaign: unknown;
};

export type CreateAutoInput = AutoConfig & {
  planId?: string | null;
  brandId?: string | null;
  campaignId?: string | null;
  /** Objetivo do período (obrigatório, ≥ 30 caracteres): a estratégia e todos os posts partem dele. */
  focus?: string;
  mode: AutoMode;
  recurring?: boolean;
};

/**
 * Calendário automático: horários exatos (slots.ts) → estrategista em lotes (`fillAutoRun`) → criativos pelo piloto →
 * agenda na fila (`scheduleAutomated`). Os laços de tela (`drive()`) continuam no navegador; o agendador continua se a página fecha.
 */
@Injectable()
export class AutoCalendarService {
  private readonly logger = new Logger(AutoCalendarService.name);

  constructor(
    private readonly store: IgStore,
    private readonly content: ContentService,
    private readonly contentStrategy: ContentStrategyService,
    private readonly strategist: StrategistService,
    private readonly mediaGen: MediaGenerationService,
    private readonly publishing: PublishingService,
  ) {}

  private get prisma() {
    return this.store.prisma;
  }

  /** Programação do workspace; id de outra empresa = 404. */
  async runOf(runId: string) {
    const run = await this.prisma.ig_auto_runs.findUnique({ where: { id: runId }, select: { id: true, workspace_id: true } });
    if (!run) throw notFound('Programação não encontrada.');
    return run;
  }

  /** Sem plano escolhido: a estratégia cria um plano básico a partir do DNA da marca. */
  private async ensurePlan(workspaceId: string, planId: string | null | undefined, brandId: string | null | undefined, mode: AutoMode) {
    if (planId) {
      const plan = await this.prisma.ig_content_plans.findFirst({ where: { id: planId, workspace_id: workspaceId }, select: { id: true } });
      if (!plan) throw notFound('Plano de conteúdo não encontrado.');
      return planId;
    }
    if (!brandId) throw new UserError('Cadastre a marca em Brands antes.');
    const brand = await this.content.brandFor(workspaceId, brandId);
    if (!brand) throw notFound('Marca não encontrada.');
    const { pillars } = await this.content.suggestPillars(workspaceId, { brandId, tone: brand.tone_of_voice ?? undefined, audience: brand.target_audience ?? undefined });
    const plan = await this.prisma.ig_content_plans.create({
      data: {
        workspace_id: workspaceId,
        brand_id: brandId,
        name: `Instagram · ${brand.name}`,
        objective: 'Crescer audiência qualificada e gerar contatos',
        tone_of_voice: brand.tone_of_voice ?? null,
        content_pillars: pillars,
        requires_approval: mode === 'approval',
        auto_publish: false,
        status: 'active',
      },
      select: { id: true },
    });
    return plan.id;
  }

  async createAutoRun(workspaceId: string, userId: string, input: CreateAutoInput) {
    const { slots, skipped } = computeSlots(input);
    if (!slots.length)
      throw new UserError(
        skipped
          ? 'Todos os horários escolhidos já passaram ou estão a menos de 20 minutos. Escolha horários mais tarde ou marque "o quanto antes".'
          : 'Nenhum horário no período: confira os dias da semana e os horários.',
      );
    if (input.campaignId) {
      const camp = await this.prisma.campaigns.findFirst({ where: { id: input.campaignId, workspace_id: workspaceId }, select: { id: true } });
      if (!camp) throw notFound('Campanha não encontrada.');
    }
    if (!input.focus || input.focus.trim().length < 30) throw new UserError('Descreva o objetivo deste período (mínimo de 30 caracteres).');
    const planId = await this.ensurePlan(workspaceId, input.planId, input.brandId, input.mode);
    const planRow = await this.prisma.ig_content_plans.findFirst({ where: { id: planId, workspace_id: workspaceId }, select: { brand_id: true } });
    if (!planRow?.brand_id) throw new UserError('Cadastre a marca em Brands antes (e vincule-a ao plano de conteúdo).');
    const start = input.startDate < todaySP() ? todaySP() : input.startDate;
    const run = await this.prisma.ig_auto_runs.create({
      data: {
        workspace_id: workspaceId,
        plan_id: planId,
        created_by: userId,
        campaign_id: input.campaignId || null,
        start_date: dateCol(start),
        end_date: dateCol(input.endDate),
        weekdays: input.weekdays,
        times: uniqTimes(input.times),
        story_times: uniqTimes(input.storyTimes),
        formats: input.formats,
        focus: input.focus?.trim() || null,
        mode: input.mode,
        recurring: !!input.recurring,
        slots: slots as unknown as Prisma.InputJsonArray,
      },
      select: { id: true },
    });
    await this.store.logEvent({
      workspace_id: workspaceId,
      plan_id: planId,
      kind: 'generation',
      message: `Programação criada: ${slots.length} posts de ${fmtDate(slots[0]!.at)} a ${fmtDate(slots[slots.length - 1]!.at)} (${input.mode === 'publish' ? 'publica sozinho' : 'com aprovação'}).${skipped ? ` ${skipped} horário(s) já passado(s) ignorado(s).` : ''}`,
    });
    return { runId: run.id, planId, total: slots.length, skipped };
  }

  /** Estado da programação para quem não pegou a trava (ou perdeu o lease no meio do lote). */
  private async snapshot(runId: string, forceBusy = false) {
    const r = await this.prisma.ig_auto_runs.findUnique({ where: { id: runId }, select: { status: true, filled: true, slots: true, strategy_status: true } });
    return {
      filled: r?.filled ?? 0,
      total: ((r?.slots as unknown[]) ?? []).length,
      done: r?.status !== 'planning',
      busy: forceBusy || (r?.status === 'planning' && r?.strategy_status !== 'review'),
      strategyReview: r?.strategy_status === 'review',
    };
  }

  /**
   * Preenche a programação: 1) estratégia do período (revisada e aprovada pelo usuário); 2) posts em lotes, cada um validado
   * (data + IA) e regerado até 2 vezes; o reprovado entra como `needs_review`. Seguro para chamadas concorrentes: o lote é pego por
   * UPDATE condicional (lease de 240 s), o lease é renovado antes de cada chamada de IA e o resultado só vale se o lease ainda é nosso.
   */
  async fillAutoRun(runId: string) {
    const lock = { until: new Date(Date.now() + LOCK_MS) };
    const claimed = await this.prisma.ig_auto_runs.updateMany({
      where: { id: runId, status: 'planning', OR: [{ locked_until: null }, { locked_until: { lt: new Date() } }] },
      data: { locked_until: lock.until },
    });
    if (!claimed.count) return this.snapshot(runId);
    const run = (await this.prisma.ig_auto_runs.findUnique({ where: { id: runId } }))!;
    const all = (run.slots ?? []) as unknown as Slot[];
    /** Renova o lease; se outro worker o assumiu (venceu) ou a programação mudou, abandona sem escrever. */
    const keep = async () => {
      const next = new Date(Date.now() + LOCK_MS);
      const got = await this.prisma.ig_auto_runs.updateMany({ where: { id: runId, status: 'planning', locked_until: lock.until }, data: { locked_until: next } });
      if (!got.count) throw new LeaseLost();
      lock.until = next;
    };
    const release = (extra: Prisma.ig_auto_runsUpdateManyMutationInput = {}) =>
      this.prisma.ig_auto_runs.updateMany({ where: { id: runId, locked_until: lock.until }, data: { locked_until: null, ...extra } });
    try {
      const ctx = await this.runContext(run);
      // Passo "Estratégia": criada antes dos posts e revisada pelo usuário.
      if (!run.strategy || run.strategy_status === 'pending') {
        const { strategy } = await this.contentStrategy.buildRunStrategy({
          workspaceId: run.workspace_id, objective: ctx.objective, brand: ctx.brand, products: ctx.products, personas: ctx.personas, plan: ctx.plan, slots: all,
        });
        const saved = await this.prisma.ig_auto_runs.updateMany({
          where: { id: runId, locked_until: lock.until, strategy_status: run.strategy_status, filled: run.filled },
          data: { strategy: strategy as unknown as Prisma.InputJsonObject, strategy_status: 'review', locked_until: null, last_error: null, paused_reason: null },
        });
        if (!saved.count) throw new LeaseLost();
        await this.store.logEvent({ workspace_id: run.workspace_id, plan_id: run.plan_id, kind: 'generation', message: 'Estratégia do período pronta: revise e aprove para gerar os posts.' });
        return { filled: run.filled, total: all.length, done: false, busy: false, strategyReview: true };
      }
      if (run.strategy_status !== 'approved') {
        await release();
        return { filled: run.filled, total: all.length, done: false, busy: false, strategyReview: true };
      }
      // Horários que já passaram enquanto a programação esperava são descartados.
      const chunk = all.slice(run.filled, run.filled + CHUNK);
      const usable = chunk.filter((sl) => new Date(sl.at).getTime() > Date.now() + 10 * MIN);
      const rows = usable.length ? await this.writeChunk(run, usable, ctx, keep) : [];
      const filled = run.filled + chunk.length;
      const done = filled >= all.length;
      // Condicional ao `filled` lido E ao lease: se a trava venceu e outro lote já avançou a programação (ou ela foi cancelada), este resultado não a sobrescreve.
      // Atômico: o avanço (condicionado ao lease) e a inserção dos posts valem juntos — lease perdido não insere o lote duas vezes.
      const advanced = await this.prisma.$transaction(async (tx) => {
        const got = await tx.ig_auto_runs.updateMany({
          where: { id: runId, filled: run.filled, locked_until: lock.until },
          data: { filled, status: done ? 'active' : 'planning', locked_until: null, last_error: null, paused_reason: null },
        });
        if (!got.count) return false;
        if (rows.length) await tx.ig_posts.createMany({ data: rows });
        return true;
      });
      if (!advanced) return this.snapshot(runId, true);
      if (done)
        await this.store.logEvent({
          workspace_id: run.workspace_id,
          plan_id: run.plan_id,
          kind: 'generation',
          message: `Estrategista concluiu os conteúdos da programação (${all.length} posts). Criativos sendo gerados, começando pelos mais próximos.`,
        });
      return { filled, total: all.length, done, busy: false, strategyReview: false };
    } catch (e) {
      if (e instanceof LeaseLost) return this.snapshot(runId, true);
      const credit = isCreditFailure(errText(e));
      await release({ last_error: errText(e), paused_reason: credit ? 'Créditos de IA esgotados — programação pausada' : null });
      await this.store.logEvent({
        workspace_id: run.workspace_id,
        plan_id: run.plan_id,
        kind: 'failure',
        level: 'error',
        message: credit
          ? 'Créditos de IA esgotados — programação pausada. Retoma sozinha quando houver crédito.'
          : `Estrategista falhou num lote da programação (tenta de novo em 5 min): ${errText(e)}`,
      });
      throw e;
    }
  }

  /** Marca, produtos, personas, plano e objetivo da programação (tudo DENTRO do workspace). Sem marca, nada roda. */
  private async runContext(run: Prisma.ig_auto_runsGetPayload<object>) {
    const plan = await this.prisma.ig_content_plans.findFirst({ where: { id: run.plan_id, workspace_id: run.workspace_id } });
    if (!plan) throw notFound('Plano de conteúdo não encontrado.');
    if (!plan.brand_id) throw new UserError('Cadastre a marca em Brands antes.');
    const brand = await this.content.brandFor(run.workspace_id, plan.brand_id);
    if (!brand) throw new UserError('Cadastre a marca em Brands antes.');
    const [prods, personas] = await Promise.all([
      this.prisma.products.findMany({ where: { brand_id: brand.id, workspace_id: run.workspace_id }, select: { id: true, name: true, description: true, price: true }, take: 20 }),
      this.prisma.personas.findMany({ where: { brand_id: brand.id, workspace_id: run.workspace_id }, select: { name: true, age_range: true, pains: true, desires: true, interests: true }, take: 6 }),
    ]);
    // Preço como número (Decimal serializaria como texto no prompt).
    const products = prods.map((p) => ({ ...p, price: p.price == null ? null : Number(p.price) }));
    const objective = (run.focus || plan.objective || '').trim();
    if (!objective) throw new UserError('Informe o objetivo deste período na programação.');
    let campaign: unknown = null;
    if (run.campaign_id) campaign = strategyBrief(await this.strategist.currentStrategy(run.workspace_id, run.campaign_id));
    return { plan, brand, products, personas, objective, campaign };
  }

  private async askPosts(run: Prisma.ig_auto_runsGetPayload<object>, slots: Slot[], ctx: RunCtx, fixes: Map<number, string>) {
    const { plan, brand, products, personas, objective, campaign } = ctx;
    const strategy = run.strategy as unknown as RunStrategy;
    // Evita repetir temas: últimos posts da empresa + os já criados nesta programação.
    const recent = await this.prisma.ig_posts.findMany({ where: { workspace_id: run.workspace_id, theme: { not: null } }, orderBy: { created_at: 'desc' }, take: 40, select: { theme: true } });
    const used = [...new Set(recent.map((r) => r.theme as string))];
    const prompt = [
      'Você é a estrategista de conteúdo sênior de uma agência de marketing no Brasil. Escreva em português do Brasil.',
      'Escreva o conteúdo de Instagram de CADA horário abaixo. Data, horário e formato já estão definidos: não mude.',
      'ORDEM DE PRIORIDADE (nunca inverta):',
      `1. OBJETIVO DO PERÍODO (fonte principal, cada post precisa servir a ele): ${objective}`,
      `2. ESTRATÉGIA APROVADA: ${JSON.stringify(strategy.texto_editado ? { ...strategy, ajustes_do_cliente: strategy.texto_editado } : strategy)}`,
      `3. DNA DA MARCA: ${JSON.stringify(brandContext(brand))}`,
      `4. PRODUTOS (únicos preços válidos; cite pelo nome exato): ${JSON.stringify(products.map((p) => ({ nome: p.name, descricao: p.description, preco: p.price })))}`,
      `   PERSONAS: ${JSON.stringify(personas.map((p) => p.name))}`,
      `5. PLANO: tom ${plan.tone_of_voice ?? brand.tone_of_voice ?? '-'}; hashtags ${JSON.stringify(plan.hashtag_strategy)}; CTA padrão ${plan.cta_default ?? '-'}.`,
      campaign ? `CAMPANHA LIGADA: ${JSON.stringify(campaign)}` : '',
      'PROIBIDO: falar de outro negócio ou de temas fora do segmento da marca; inventar preço, promoção ou número fora dos produtos/DNA; usar palavras proibidas da marca; CTA fora da lista de CTAs da estratégia.',
      DATE_RULES,
      used.length ? `Temas já usados (não repita): ${JSON.stringify(used.slice(0, 40))}.` : '',
      'Guia por formato:',
      ...Object.entries(FORMAT_GUIDE).map(([k, v]) => `- ${k}: ${v}.`),
      "Campos: index, theme, pillar (um dos pilares da estratégia), persona, product_name (nome exato do produto citado ou vazio), funnel_stage (atracao|consideracao|conversao), objective_link (uma frase ligando o post ao objetivo), hook, headline (até 7 palavras, sem hashtags), caption (com quebras de linha), hashtags (array JSON de 10 a 15 strings sem #, ex.: ['valinhos','choppgelado']), cta (um dos CTAs da estratégia), image_prompt (briefing visual em português do que aparece, SEM texto na imagem), slides (só carrossel, senão vazio).",
      'HORÁRIOS (data real, fuso America/Sao_Paulo):',
      ...slots.map((sl) => `- index ${sl.index}: ${fullDate(sl.at)} · ${sl.format}${fixes.get(sl.index) ? ` · REFAÇA, reprovado antes por: ${fixes.get(sl.index)}` : ''}`),
      'Devolva SOMENTE JSON estrito {"posts":[...]} com um item por horário.',
    ]
      .filter(Boolean)
      .join('\n');
    const { json, provider } = await this.content.aiJson(run.workspace_id, 'auto', prompt, SCHEMA, 'ig_auto_calendar');
    const list = Array.isArray(json?.posts) ? (json.posts as any[]) : [];
    return { items: new Map<number, any>(list.filter((p) => p && typeof p === 'object').map((p) => [Number(p.index), p])), provider };
  }

  private async writeChunk(run: Prisma.ig_auto_runsGetPayload<object>, slots: Slot[], ctx: RunCtx, keep: () => Promise<void>): Promise<Prisma.ig_postsCreateManyInput[]> {
    const { plan, products } = ctx;
    const strategy = run.strategy as unknown as RunStrategy;
    const final = new Map<number, { p: any; verdict: Verdict | null; attempts: number; provider: string; issues: string[] }>();
    let pending = slots;
    const fixes = new Map<number, string>();
    // Gera, valida e regera só os reprovados (até 2 novas tentativas).
    for (let attempt = 0; attempt < 3 && pending.length; attempt++) {
      await keep();
      const r = await this.askPosts(run, pending, ctx, fixes);
      if (!r.items.size && attempt === 0) throw new UserError('A IA não devolveu conteúdos.');
      await keep();
      const verdicts = await this.contentStrategy.validatePosts({
        workspaceId: run.workspace_id,
        brand: ctx.brand,
        objective: ctx.objective,
        strategy,
        products,
        posts: pending.map((sl) => {
          const p = r.items.get(sl.index) ?? {};
          return { index: sl.index, at: sl.at, theme: asText(p.theme), hook: asText(p.hook), caption: asText(p.caption), headline: asText(p.headline), cta: asText(p.cta) };
        }),
      });
      const next: Slot[] = [];
      for (const sl of pending) {
        const p = r.items.get(sl.index);
        const v = verdicts.get(sl.index) ?? null;
        const issues = p ? [] : ['a IA não devolveu conteúdo para este horário'];
        if (p && p.hashtags != null && !Array.isArray(p.hashtags)) issues.push('hashtags vieram como texto e foram normalizadas');
        const prev = final.get(sl.index);
        final.set(sl.index, { p: p ?? prev?.p ?? {}, verdict: v, attempts: attempt + 1, provider: r.provider, issues });
        if (!p || (v && !v.aprovado)) {
          fixes.set(sl.index, v?.motivo || 'conteúdo ausente');
          next.push(sl);
        }
      }
      pending = next;
    }
    const productId = (name: unknown) => {
      const n = (asText(name) ?? '').toLowerCase();
      return n ? (products.find((x) => x.name && (x.name.toLowerCase() === n || n.includes(x.name.toLowerCase())))?.id ?? null) : null;
    };
    const stage = (v: unknown) => {
      const t = (asText(v) ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      return t.startsWith('conv') ? 'conversao' : t.startsWith('cons') || t.startsWith('cone') ? 'consideracao' : 'atracao';
    };
    const rows: Prisma.ig_postsCreateManyInput[] = slots.map((sl) => {
      const f = final.get(sl.index)!;
      const p = f.p ?? {};
      const soon = new Date(sl.at).getTime() - Date.now() < 90 * MIN;
      const rejected = !!f.verdict && !f.verdict.aprovado;
      const empty = !asText(p.caption) && !asText(p.theme);
      const needsReview = rejected || empty;
      const at = new Date().toISOString();
      return {
        workspace_id: run.workspace_id,
        plan_id: run.plan_id,
        run_id: run.id,
        automation: run.mode,
        format: sl.format,
        status: needsReview ? 'needs_review' : 'idea',
        review_reason: needsReview ? f.verdict?.motivo || 'A IA não devolveu conteúdo para este horário.' : null,
        review_score: f.verdict?.nota ?? null,
        scheduled_at: new Date(sl.at),
        theme: asText(p.theme) ?? `Post de ${weekdayName(sl.at)}`,
        hook: asText(p.hook),
        caption: asText(p.caption),
        hashtags: normalizeHashtags(p.hashtags),
        cta: asText(p.cta) || plan.cta_default || null,
        objective_link: asText(p.objective_link),
        pillar: asText(p.pillar),
        persona: asText(p.persona),
        product_id: productId(p.product_name),
        funnel_stage: stage(p.funnel_stage),
        creative_brief: {
          prompt: asText(p.image_prompt) || asText(p.theme) || '',
          slides: sl.format === 'feed_carousel' ? (asList(p.slides).slice(0, 10) as string[]) : [],
          aspect_ratio: ASPECT[sl.format],
          headline: asText(p.headline),
          pillar: asText(p.pillar),
          funnel_stage: stage(p.funnel_stage),
          product_name: asText(p.product_name),
          campaign_id: run.campaign_id ?? null,
          // Perto do horário: uma variação só, para a mídia ficar pronta a tempo.
          variations: soon ? 1 : 3,
        },
        ai_provider: f.provider,
        ai_generation_log: [
          {
            at,
            step: 'auto_calendar',
            provider: f.provider,
            run_id: run.id,
            attempts: f.attempts,
            review: f.verdict,
            ...(f.issues.length ? { warnings: f.issues } : {}),
            ...(needsReview ? { status: 'needs_review' } : {}),
          },
        ],
      };
    });
    // Última conferência do lease; a gravação em si é atômica com o avanço da programação (ver `fill`).
    await keep();
    return rows;
  }

  /** Usuário aprova (e opcionalmente ajusta em texto) a estratégia: libera a geração dos posts. */
  async approveRunStrategy(workspaceId: string, runId: string, editedText?: string | null) {
    const run = await this.prisma.ig_auto_runs.findFirst({ where: { id: runId, workspace_id: workspaceId }, select: { id: true, strategy: true } });
    if (!run?.strategy) throw new UserError('A estratégia ainda não foi gerada.');
    const prev = run.strategy as unknown as RunStrategy;
    const strategy = { ...prev, texto_editado: editedText?.trim() || prev.texto_editado || null };
    // Só programação em andamento ("planning"): uma cancelada/concluída não volta a ser aprovada.
    // Condicional ao status da estratégia: um "Refazer" que chegou antes (pending) não é desfeito por uma aprovação velha.
    const got = await this.prisma.ig_auto_runs.updateMany({
      where: { id: runId, workspace_id: workspaceId, status: 'planning', strategy_status: { in: ['review', 'approved'] } },
      data: { strategy: strategy as unknown as Prisma.InputJsonObject, strategy_status: 'approved' },
    });
    if (!got.count) {
      const cur = await this.prisma.ig_auto_runs.findFirst({ where: { id: runId, workspace_id: workspaceId }, select: { status: true, strategy_status: true } });
      if (cur?.status === 'planning' && cur.strategy_status === 'pending') throw new UserError('A estratégia foi refeita enquanto você revisava. Aguarde a nova versão e aprove de novo.');
    }
    return { ok: true };
  }

  /** Pede uma nova estratégia (descarta a atual). Recusado enquanto um lote da IA está rodando (o lease está vivo). */
  async redoRunStrategy(workspaceId: string, runId: string) {
    const got = await this.prisma.ig_auto_runs.updateMany({
      where: { id: runId, workspace_id: workspaceId, status: 'planning', OR: [{ locked_until: null }, { locked_until: { lt: new Date() } }] },
      data: { strategy: Prisma.DbNull, strategy_status: 'pending', paused_reason: null },
    });
    if (!got.count) {
      const cur = await this.prisma.ig_auto_runs.findFirst({ where: { id: runId, workspace_id: workspaceId }, select: { status: true } });
      if (cur?.status === 'planning') throw new UserError('A estratégia está sendo gerada ou os posts estão em criação agora. Tente de novo em instantes.');
      throw new UserError('Esta programação não está mais em andamento: não dá para refazer a estratégia.');
    }
    return { ok: true };
  }

  /** Gera agora o criativo do próximo post da programação que acontece nas próximas horas (laço do navegador). */
  async generateNextAutoMedia(workspaceId: string, runId: string, withinHours: number) {
    const until = new Date(Date.now() + withinHours * 3600e3);
    const list = await this.prisma.ig_posts.findMany({
      where: { run_id: runId, workspace_id: workspaceId, status: 'idea', scheduled_at: { gt: new Date(), lt: until } },
      orderBy: { scheduled_at: 'asc' },
      take: 2,
      select: { id: true },
    });
    if (!list.length) return { done: true, ok: true, remaining: 0 };
    const r = await this.mediaGen.generatePostAssets(workspaceId, list[0]!.id, 'auto');
    if (r.ok && !('pending' in r && r.pending)) await this.publishing.scheduleAutomated(list[0]!.id).catch(() => null);
    return { done: list.length < 2, ok: r.ok, error: r.ok ? null : r.error, remaining: list.length - 1 };
  }

  /** A cada 5 min (junto do piloto): preenche programações, agenda prontos, protege aprovação e renova as recorrentes. */
  async autoCalendarTick() {
    const out: Record<string, unknown> = {};

    // 1) Lotes pendentes da estrategista (o usuário pode ter fechado a página).
    const planning = await this.prisma.ig_auto_runs.findMany({ where: { status: 'planning', strategy_status: { not: 'review' } }, orderBy: { created_at: 'asc' }, take: 1, select: { id: true } });
    let filled = 0;
    for (const r of planning) await this.fillAutoRun(r.id).then(() => filled++).catch(() => null);
    out['filled'] = filled;

    // 2) Mídia pronta e ainda não agendada (ou aprovada agora): vai para a fila.
    const ready = await this.prisma.ig_posts.findMany({ where: { automation: { not: null }, status: { in: ['ready', 'approved'] } }, orderBy: { scheduled_at: 'asc' }, take: 20, select: { id: true } });
    let scheduled = 0;
    for (const p of ready) {
      const r = await this.publishing.scheduleAutomated(p.id).catch(async (e) => {
        await this.prisma.ig_posts.update({ where: { id: p.id }, data: { last_error: errText(e) } });
        return null;
      });
      if (r && 'scheduled' in r) scheduled++;
    }
    out['scheduled'] = scheduled;

    // 2b) Falha na geração do criativo: uma nova tentativa automática (volta para "ideia").
    const failed = await this.prisma.ig_posts.findMany({
      where: { automation: { not: null }, status: 'failed', scheduled_at: { gt: new Date(Date.now() - 12 * 3600e3) } },
      take: 10,
      select: { id: true, creative_brief: true },
    });
    for (const p of failed) {
      const brief = (p.creative_brief ?? {}) as Record<string, unknown>;
      if (brief['auto_retried']) continue;
      await this.prisma.ig_posts.updateMany({ where: { id: p.id, status: 'failed' }, data: { status: 'idea', creative_brief: { ...brief, auto_retried: true, variations: 1 } as Prisma.InputJsonObject } });
    }

    // 2c) Modo automático cujo criativo não ficou pronto a tempo (até 12 h): gera agora e publica em seguida.
    const overdue = await this.prisma.ig_posts.findMany({
      where: { automation: 'publish', status: 'idea', scheduled_at: { lte: new Date(), gt: new Date(Date.now() - 12 * 3600e3) } },
      orderBy: { scheduled_at: 'asc' },
      take: 1,
      select: { id: true, workspace_id: true },
    });
    for (const p of overdue) {
      const r = await this.mediaGen.generatePostAssets(p.workspace_id, p.id, 'auto');
      if (r.ok && !('pending' in r && r.pending)) await this.publishing.scheduleAutomated(p.id).catch(() => null);
    }

    // 3) Modo com aprovação: sem aprovação até 10 min antes → mesmo horário do dia seguinte.
    const late = await this.prisma.ig_posts.findMany({
      where: { automation: 'approval', status: { in: ['idea', 'generating', 'needs_review', 'pending_approval', 'ready'] }, approved_at: null, scheduled_at: { lt: new Date(Date.now() + 10 * MIN) } },
      take: 50,
      select: { id: true, workspace_id: true, plan_id: true, scheduled_at: true },
    });
    for (const p of late) {
      let next = p.scheduled_at!.getTime() + 86400e3;
      while (next < Date.now() + 30 * MIN) next += 86400e3;
      const when = new Date(next);
      await this.prisma.ig_posts.update({ where: { id: p.id }, data: { scheduled_at: when } });
      await this.store.logEvent({
        workspace_id: p.workspace_id,
        plan_id: p.plan_id,
        post_id: p.id,
        kind: 'reschedule',
        level: 'warn',
        message: `Não foi aprovado a tempo: reagendado para ${fmtDate(when)}.`,
      });
    }
    out['rescheduled'] = late.length;

    // 4) Programações recorrentes: mantém sempre a próxima semana planejada.
    out['recurring'] = await this.renewRecurring().catch((e) => ({ error: errText(e) }));

    // 5) Programações concluídas: todos os posts publicados, cancelados ou com falha.
    const active = await this.prisma.ig_auto_runs.findMany({ where: { status: 'active' }, take: 50, select: { id: true } });
    for (const r of active) {
      const open = await this.prisma.ig_posts.count({ where: { run_id: r.id, status: { notIn: ['published', 'cancelled', 'failed'] } } });
      if (open === 0) await this.prisma.ig_auto_runs.update({ where: { id: r.id }, data: { status: 'done' } });
    }
    return out;
  }

  /** Recorrente: quando faltam 7 dias para acabar, cria a semana seguinte com a mesma configuração. */
  async renewRecurring() {
    const roots = await this.prisma.ig_auto_runs.findMany({ where: { recurring: true, parent_id: null, status: { in: ['planning', 'active', 'done'] } }, take: 50 });
    let created = 0;
    for (const root of roots) {
      const kid = await this.prisma.ig_auto_runs.findFirst({ where: { parent_id: root.id }, orderBy: { end_date: 'desc' }, select: { end_date: true } });
      const lastEnd = dayOf(kid?.end_date ?? root.end_date);
      if (lastEnd >= plusDays(todaySP(), 7)) continue;
      const start = plusDays(lastEnd < todaySP() ? plusDays(todaySP(), -1) : lastEnd, 1);
      const end = plusDays(start, 6);
      try {
        const { slots } = computeSlots({ startDate: start, endDate: end, weekdays: root.weekdays, times: root.times, storyTimes: root.story_times, formats: root.formats as IgFormat[] });
        if (!slots.length) continue;
        try {
          await this.prisma.ig_auto_runs.create({
            data: {
              workspace_id: root.workspace_id,
              plan_id: root.plan_id,
              parent_id: root.id,
              created_by: root.created_by,
              campaign_id: root.campaign_id,
              start_date: dateCol(start),
              end_date: dateCol(end),
              weekdays: root.weekdays,
              times: root.times,
              story_times: root.story_times,
              formats: root.formats,
              focus: root.focus,
              // Semana repetida herda a estratégia aprovada (só redistribui os dias).
              ...(root.strategy_status === 'approved' && root.strategy ? { strategy: root.strategy as Prisma.InputJsonObject, strategy_status: 'approved' } : { strategy_status: 'pending' }),
              mode: root.mode,
              recurring: false,
              slots: slots as unknown as Prisma.InputJsonArray,
            },
          });
        } catch {
          continue; // já criada (índice único)
        }
        created++;
        await this.store.logEvent({
          workspace_id: root.workspace_id,
          plan_id: root.plan_id,
          kind: 'generation',
          message: `Programação recorrente: semana de ${start} a ${end} criada (${slots.length} posts).`,
        });
      } catch (e) {
        await this.store.logEvent({ workspace_id: root.workspace_id, plan_id: root.plan_id, kind: 'failure', level: 'error', message: `Falha ao renovar a programação recorrente: ${errText(e)}` });
      }
    }
    return { created };
  }

  /** Cancela a programação (e as semanas recorrentes dela): posts não publicados saem da fila. */
  async cancelAutoRun(workspaceId: string, runId: string) {
    const run = await this.prisma.ig_auto_runs.findFirst({ where: { id: runId, workspace_id: workspaceId }, select: { id: true, plan_id: true } });
    if (!run) throw notFound('Programação não encontrada.');
    const kids = await this.prisma.ig_auto_runs.findMany({ where: { parent_id: runId, workspace_id: workspaceId }, select: { id: true } });
    const ids = [runId, ...kids.map((k) => k.id)];
    await this.prisma.ig_auto_runs.updateMany({ where: { id: { in: ids } }, data: { status: 'cancelled', recurring: false, locked_until: null } });
    const posts = await this.prisma.ig_posts.findMany({ where: { run_id: { in: ids }, workspace_id: workspaceId, status: { notIn: ['published', 'publishing', 'cancelled'] } }, select: { id: true } });
    const postIds = posts.map((p) => p.id);
    if (postIds.length) {
      await this.prisma.publishing_jobs.updateMany({ where: { ig_post_id: { in: postIds }, status: 'pending' }, data: { status: 'cancelled', locked_at: null } });
      await this.prisma.ig_posts.updateMany({ where: { id: { in: postIds } }, data: { status: 'cancelled' } });
    }
    await this.store.logEvent({ workspace_id: workspaceId, plan_id: run.plan_id, kind: 'guardrail', message: `Programação cancelada: ${postIds.length} post(s) retirados da fila.` });
    return { cancelled: postIds.length };
  }

  /** Resumo das programações para a tela (`ig_auto_runs` raízes + semanas + contagem por status dos posts). */
  async summary(workspaceId: string) {
    const roots = await this.prisma.ig_auto_runs.findMany({ where: { workspace_id: workspaceId, parent_id: null }, orderBy: { created_at: 'desc' }, take: 8 });
    if (!roots.length) return [];
    const kids = await this.prisma.ig_auto_runs.findMany({ where: { workspace_id: workspaceId, parent_id: { in: roots.map((r) => r.id) } }, select: { id: true, parent_id: true } });
    const groups = new Map<string, string[]>(roots.map((r) => [r.id, [r.id]]));
    for (const k of kids) groups.get(k.parent_id as string)?.push(k.id);
    const posts = await this.prisma.ig_posts.findMany({ where: { workspace_id: workspaceId, run_id: { in: [...groups.values()].flat() } }, select: { run_id: true, status: true } });
    return roots.map((r) => {
      const ids = new Set(groups.get(r.id));
      const st = posts.filter((p) => p.run_id && ids.has(p.run_id)).map((p) => p.status);
      const c = (s: string[]) => st.filter((x) => s.includes(x)).length;
      return {
        ...r,
        weeks: ids.size,
        counts: {
          total: st.length,
          media: c(['pending_approval', 'ready', 'approved', 'scheduled', 'publishing', 'published']),
          waiting: c(['pending_approval']),
          scheduled: c(['scheduled', 'publishing']),
          published: c(['published']),
          failed: c(['failed']),
          review: c(['needs_review']),
        },
      };
    });
  }
}
