import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { notFound, UserError } from '../media/user-error';
import { strategyBrief } from '../strategist/strategist.prompt';
import { StrategistService } from '../strategist/strategist.service';
import { ContentService } from './content.service';
import { ASPECT, fmtDate, IgFormat } from './ig-types';
import { IgStore, errText } from './ig-store.service';
import { MediaGenerationService } from './media-generation.service';
import { asList, asText, normalizeHashtags } from './normalize';
import { PublishingService } from './publishing.service';
import { AutoConfig, AutoMode, CHUNK, computeSlots, MIN, plusDays, Slot, todaySP, uniqTimes } from './slots';

const ITEM = {
  type: 'object',
  additionalProperties: false,
  required: ['index', 'theme', 'pillar', 'funnel_stage', 'hook', 'headline', 'caption', 'hashtags', 'cta', 'image_prompt', 'slides'],
  properties: {
    index: { type: 'integer' },
    theme: { type: 'string' },
    pillar: { type: 'string' },
    funnel_stage: { type: 'string', enum: ['atracao', 'conexao', 'conversao'] },
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

const weekdayName = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { weekday: 'long', timeZone: 'America/Sao_Paulo' });
const dayOf = (d: Date) => d.toISOString().slice(0, 10);
const dateCol = (s: string) => new Date(`${s}T12:00:00Z`);

export type CreateAutoInput = AutoConfig & {
  planId?: string | null;
  brandId?: string | null;
  campaignId?: string | null;
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
    if (!brandId) throw new UserError('Escolha um plano de conteúdo ou uma marca.');
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
    const planId = await this.ensurePlan(workspaceId, input.planId, input.brandId, input.mode);
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

  /** Preenche o próximo lote de horários com conteúdo da IA estrategista. Seguro para chamadas concorrentes. */
  async fillAutoRun(runId: string) {
    const claimed = await this.prisma.ig_auto_runs.updateMany({
      where: { id: runId, status: 'planning', OR: [{ locked_until: null }, { locked_until: { lt: new Date() } }] },
      data: { locked_until: new Date(Date.now() + 150e3) },
    });
    if (!claimed.count) {
      const r = await this.prisma.ig_auto_runs.findUnique({ where: { id: runId }, select: { status: true, filled: true, slots: true } });
      return { filled: r?.filled ?? 0, total: ((r?.slots as unknown[]) ?? []).length, done: r?.status !== 'planning', busy: r?.status === 'planning' };
    }
    const run = (await this.prisma.ig_auto_runs.findUnique({ where: { id: runId } }))!;
    const all = (run.slots ?? []) as unknown as Slot[];
    // Horários que já passaram enquanto a programação esperava são descartados.
    const chunk = all.slice(run.filled, run.filled + CHUNK);
    const usable = chunk.filter((sl) => new Date(sl.at).getTime() > Date.now() + 10 * MIN);
    try {
      if (usable.length) await this.writeChunk(run, usable);
      const filled = run.filled + chunk.length;
      const done = filled >= all.length;
      await this.prisma.ig_auto_runs.update({ where: { id: runId }, data: { filled, status: done ? 'active' : 'planning', locked_until: null, last_error: null } });
      if (done)
        await this.store.logEvent({
          workspace_id: run.workspace_id,
          plan_id: run.plan_id,
          kind: 'generation',
          message: `Estrategista concluiu os conteúdos da programação (${all.length} posts). Criativos sendo gerados, começando pelos mais próximos.`,
        });
      return { filled, total: all.length, done, busy: false };
    } catch (e) {
      await this.prisma.ig_auto_runs.update({ where: { id: runId }, data: { locked_until: null, last_error: errText(e) } });
      await this.store.logEvent({
        workspace_id: run.workspace_id,
        plan_id: run.plan_id,
        kind: 'failure',
        level: 'error',
        message: `Estrategista falhou num lote da programação (tenta de novo em 5 min): ${errText(e)}`,
      });
      throw e;
    }
  }

  private async writeChunk(run: Prisma.ig_auto_runsGetPayload<object>, slots: Slot[]) {
    const plan = await this.prisma.ig_content_plans.findFirst({ where: { id: run.plan_id, workspace_id: run.workspace_id } });
    if (!plan) throw notFound('Plano de conteúdo não encontrado.');
    const brand = await this.content.brandFor(run.workspace_id, plan.brand_id);
    let strategy: unknown = null;
    if (run.campaign_id) strategy = strategyBrief(await this.strategist.currentStrategy(run.workspace_id, run.campaign_id));
    // Evita repetir temas: últimos posts da empresa + os já criados nesta programação.
    const recent = await this.prisma.ig_posts.findMany({ where: { workspace_id: run.workspace_id, theme: { not: null } }, orderBy: { created_at: 'desc' }, take: 40, select: { theme: true } });
    const used = [...new Set(recent.map((r) => r.theme as string))];
    const aiNotes = (Array.isArray(plan.ai_notes) ? plan.ai_notes : []) as { summary?: string }[];
    const notes = aiNotes.length ? aiNotes[aiNotes.length - 1]?.summary : null;
    const brandInfo = brand
      ? {
          nome: brand.name,
          descricao: brand.description,
          publico: brand.target_audience,
          diferenciais: brand.differentials,
          tom: brand.tone_of_voice,
          palavras_preferidas: brand.preferred_words,
          palavras_proibidas: brand.banned_words,
          segmento: brand.segment,
          regiao: brand.region,
        }
      : null;
    const weights = (plan.pillar_weights ?? {}) as Record<string, unknown>;
    const startDate = dayOf(run.start_date);
    const endDate = dayOf(run.end_date);
    const prompt = [
      'Você é a estrategista de conteúdo sênior de uma agência de marketing no Brasil. Escreva em português do Brasil.',
      'Planeje o conteúdo de Instagram de CADA horário abaixo. Data, horário e formato já estão definidos: não mude.',
      `Período completo da programação: ${startDate} a ${endDate}. Considere datas comemorativas, feriados e sazonalidade do Brasil que caiam nesses dias quando fizer sentido para a marca.`,
      run.focus ? `FOCO DESTE PERÍODO (prioridade máxima): ${run.focus}` : '',
      `Objetivo do plano: ${plan.objective ?? '-'}. Tom de voz: ${plan.tone_of_voice ?? brand?.tone_of_voice ?? '-'}.`,
      `Pilares: ${JSON.stringify(plan.content_pillars)}.`,
      Object.keys(weights).length ? `Pesos dos pilares (pelo desempenho real): ${JSON.stringify(weights)}.` : '',
      notes ? `Aprendizados dos resultados: ${notes}` : '',
      `Hashtags: ${JSON.stringify(plan.hashtag_strategy)}. CTA padrão: ${plan.cta_default ?? '-'}.`,
      brandInfo ? `MARCA: ${JSON.stringify(brandInfo)}` : '',
      strategy ? `ESTRATÉGIA DA CAMPANHA (siga a big idea, os ângulos e o CTA): ${JSON.stringify(strategy)}` : '',
      'Equilíbrio do funil no período: ~50% atração (alcance: dicas, tendências, educativo), ~30% conexão (bastidores, prova social, autoridade), ~20% conversão (oferta e CTA direto). Varie pilares e ganchos; nada genérico.',
      used.length ? `Temas já usados (não repita): ${JSON.stringify(used.slice(0, 40))}.` : '',
      'Guia por formato:',
      ...Object.entries(FORMAT_GUIDE).map(([k, v]) => `- ${k}: ${v}.`),
      'Campos: index (o mesmo do horário), theme, pillar, funnel_stage, hook (primeira linha da legenda), headline (texto curto aplicado por cima da arte, até 7 palavras, sem hashtags),',
      "caption (com quebras de linha), hashtags (array JSON de 10 a 15 strings sem #, ex.: ['valinhos','choppgelado']), cta, image_prompt (briefing visual em português do que aparece, SEM texto escrito na imagem — o texto é aplicado depois), slides (só carrossel, senão vazio).",
      'HORÁRIOS:',
      ...slots.map((sl) => `- index ${sl.index}: ${weekdayName(sl.at)} ${fmtDate(sl.at)} · ${sl.format}`),
      'Devolva SOMENTE JSON estrito {"posts":[...]} com um item por horário.',
    ]
      .filter(Boolean)
      .join('\n');
    const { json, provider } = await this.content.aiJson(run.workspace_id, 'auto', prompt, SCHEMA, 'ig_auto_calendar');
    const list = Array.isArray(json?.posts) ? (json.posts as any[]) : [];
    const items = new Map<number, any>(list.filter((p) => p && typeof p === 'object').map((p) => [Number(p.index), p]));
    if (!items.size) throw new UserError('A IA não devolveu conteúdos.');
    const rows: Prisma.ig_postsCreateManyInput[] = slots.map((sl) => {
      const raw = items.get(sl.index);
      const at = new Date().toISOString();
      const soon = new Date(sl.at).getTime() - Date.now() < 90 * MIN;
      const base = {
        workspace_id: run.workspace_id,
        plan_id: run.plan_id,
        run_id: run.id,
        automation: run.mode,
        format: sl.format,
        status: 'idea',
        scheduled_at: new Date(sl.at),
        ai_provider: provider,
      };
      try {
        const p = raw ?? {};
        const issues: string[] = [];
        if (!raw) issues.push('a IA não devolveu conteúdo para este horário');
        if (p.hashtags != null && !Array.isArray(p.hashtags)) issues.push('hashtags vieram como texto e foram normalizadas');
        return {
          ...base,
          theme: asText(p.theme) ?? `Post de ${weekdayName(sl.at)}`,
          hook: asText(p.hook),
          caption: asText(p.caption),
          hashtags: normalizeHashtags(p.hashtags),
          cta: asText(p.cta) || plan.cta_default || null,
          creative_brief: {
            prompt: asText(p.image_prompt) || asText(p.theme) || '',
            slides: sl.format === 'feed_carousel' ? (asList(p.slides).slice(0, 10) as string[]) : [],
            aspect_ratio: ASPECT[sl.format],
            headline: asText(p.headline),
            pillar: asText(p.pillar),
            funnel_stage: asText(p.funnel_stage),
            campaign_id: run.campaign_id ?? null,
            // Perto do horário: uma variação só, para a mídia ficar pronta a tempo.
            variations: soon ? 1 : 3,
          },
          ai_generation_log: [{ at, step: 'auto_calendar', provider, run_id: run.id, ...(issues.length ? { warnings: issues } : {}) }],
        };
      } catch (e) {
        // Um item malformado não derruba a programação: vira um post simples com o aviso no log.
        return {
          ...base,
          theme: `Post de ${weekdayName(sl.at)}`,
          hook: null,
          caption: null,
          hashtags: [],
          cta: plan.cta_default || null,
          creative_brief: { prompt: '', slides: [], aspect_ratio: ASPECT[sl.format], campaign_id: run.campaign_id ?? null, variations: 1 },
          ai_generation_log: [{ at, step: 'auto_calendar', provider, run_id: run.id, status: 'failed', error: `Item malformado da IA: ${errText(e)}` }],
        };
      }
    });
    await this.prisma.ig_posts.createMany({ data: rows });
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
    const planning = await this.prisma.ig_auto_runs.findMany({ where: { status: 'planning' }, orderBy: { created_at: 'asc' }, take: 1, select: { id: true } });
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
      where: { automation: 'approval', status: { in: ['idea', 'generating', 'pending_approval', 'ready'] }, approved_at: null, scheduled_at: { lt: new Date(Date.now() + 10 * MIN) } },
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
        },
      };
    });
  }
}
