import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/database/prisma.service';
import { AiService } from '../ai/ai.service';
import { AiError } from '../ai/ai-error';
import { notFound } from '../media/user-error';
import { ASPECT, Engine, IG_FORMATS, IgFormat } from './ig-types';
import { IgStore } from './ig-store.service';
import { asList, asText, normalizeHashtags } from './normalize';

const POST_ITEM = {
  type: 'object',
  additionalProperties: false,
  required: ['format', 'scheduled_at', 'theme', 'hook', 'caption', 'hashtags', 'cta', 'image_prompt', 'slides'],
  properties: {
    format: { type: 'string', enum: IG_FORMATS },
    scheduled_at: { type: 'string' },
    theme: { type: 'string' },
    hook: { type: 'string' },
    caption: { type: 'string' },
    hashtags: { type: 'array', items: { type: 'string' } },
    cta: { type: 'string' },
    image_prompt: { type: 'string' },
    slides: { type: 'array', items: { type: 'string' } },
  },
};
const CALENDAR_SCHEMA = { type: 'object', additionalProperties: false, required: ['posts'], properties: { posts: { type: 'array', items: POST_ITEM } } };
const CAPTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['caption', 'hashtags', 'cta'],
  properties: { caption: { type: 'string' }, hashtags: { type: 'array', items: { type: 'string' } }, cta: { type: 'string' } },
};
const PILLARS_SCHEMA = { type: 'object', additionalProperties: false, required: ['pillars'], properties: { pillars: { type: 'array', items: { type: 'string' } } } };

/** IA de texto do Instagram: calendário de conteúdo, legenda e pilares (`aiJson` + `generateContentCalendar` do protótipo). */
@Injectable()
export class ContentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly store: IgStore,
  ) {}

  /** Chaves do cliente primeiro; se falharem (sem crédito, inválida), segue para a próxima opção → gateway do app. */
  async aiJson(workspaceId: string, engine: Engine, prompt: string, schema: Record<string, unknown>, name: string): Promise<{ json: any; provider: string }> {
    const r = await this.ai.jsonWithEngine<any>(workspaceId, { prompt, schema, name, engine });
    const provider = r.engine === 'Sua conta OpenAI' ? 'openai_own' : r.engine === 'Sua conta Gemini' ? 'gemini_own' : 'lovable_ai';
    return { json: r.content, provider };
  }

  /** Marca SEMPRE dentro do workspace (um `brand_id` de outra empresa não vaza para o prompt). */
  async brandFor(workspaceId: string, brandId: string | null | undefined) {
    if (!brandId) return null;
    return this.prisma.brands.findFirst({ where: { id: brandId, workspace_id: workspaceId } });
  }

  async generateContentCalendar(workspaceId: string, planId: string, weeks: number, engine: Engine) {
    const plan = await this.prisma.ig_content_plans.findFirst({ where: { id: planId, workspace_id: workspaceId } });
    if (!plan) throw notFound('Plano de conteúdo não encontrado.');
    const brand = await this.brandFor(workspaceId, plan.brand_id);
    const start = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10);
    const postingDays = plan.posting_days;
    const weights = (plan.pillar_weights ?? {}) as Record<string, unknown>;
    const prompt = [
      'Você é estrategista de conteúdo de Instagram no Brasil. Escreva em português do Brasil.',
      `Crie o calendário de ${weeks} semana(s) começando em ${start} (fuso America/Sao_Paulo, use ISO 8601 com -03:00).`,
      `Frequência semanal por formato: ${JSON.stringify(plan.posting_frequency)} (feed = feed_image ou feed_carousel; reels = reel; stories = story_image ou story_video).`,
      `Horários preferidos: ${JSON.stringify(plan.preferred_times)}.`,
      postingDays.length && postingDays.length < 7 ? `Publique SOMENTE nestes dias da semana (0 = domingo): ${JSON.stringify(postingDays)}.` : '',
      'Para cada post: format, scheduled_at, theme, hook, caption (com quebras de linha), hashtags (array JSON de 10 a 15 strings sem #, ex.: [\'valinhos\',\'choppgelado\'], misturando nicho, amplas e locais),',
      'cta, image_prompt (briefing visual curto em português: o que deve aparecer; o diretor de arte transforma no prompt final), slides (3 a 7 prompts só para feed_carousel, senão vazio).',
      'Proporções: 1:1 feed, 4:5 carrossel, 9:16 reels/stories.',
      `Objetivo: ${plan.objective ?? '-'}. Tom de voz: ${plan.tone_of_voice ?? '-'}. Pilares: ${JSON.stringify(plan.content_pillars)}.`,
      Object.keys(weights).length ? `Distribua os posts entre os pilares proporcionalmente a estes pesos (definidos pelo desempenho): ${JSON.stringify(weights)}.` : '',
      `Estratégia de hashtags: ${JSON.stringify(plan.hashtag_strategy)}. CTA padrão: ${plan.cta_default ?? '-'}.`,
      brand ? `MARCA: ${JSON.stringify(brand)}` : '',
      'Devolva SOMENTE JSON estrito no formato {"posts":[...]}.',
    ]
      .filter(Boolean)
      .join('\n');
    const { json, provider } = await this.aiJson(workspaceId, engine, prompt, CALENDAR_SCHEMA, 'ig_calendar');
    const days: number[] = postingDays.length ? postingDays : [0, 1, 2, 3, 4, 5, 6];
    // Garante os dias escolhidos no plano mesmo se a IA errar (dia da semana em São Paulo).
    const posts = (Array.isArray(json?.posts) ? json.posts : []).filter((p: any) => {
      const t = new Date(p?.scheduled_at).getTime();
      return isNaN(t) || days.includes(new Date(t - 3 * 3600e3).getUTCDay());
    });
    if (!posts.length) throw new AiError('A IA não devolveu posts.');
    const rows: Prisma.ig_postsCreateManyInput[] = posts.map((p: any) => {
      const format = (IG_FORMATS as string[]).includes(p.format) ? (p.format as IgFormat) : 'feed_image';
      const d = new Date(p.scheduled_at);
      return {
        workspace_id: workspaceId,
        plan_id: planId,
        format,
        status: 'idea',
        scheduled_at: isNaN(d.getTime()) ? null : d,
        theme: asText(p.theme),
        hook: asText(p.hook),
        caption: asText(p.caption),
        hashtags: normalizeHashtags(p.hashtags),
        cta: asText(p.cta) ?? plan.cta_default ?? null,
        creative_brief: { prompt: asText(p.image_prompt) ?? '', slides: asList(p.slides).slice(0, 10), aspect_ratio: ASPECT[format] },
        ai_provider: provider,
        ai_generation_log: [{ at: new Date().toISOString(), step: 'calendar', provider }],
      };
    });
    const res = await this.prisma.ig_posts.createMany({ data: rows });
    return { created: res.count, provider };
  }

  async regenerateCaption(workspaceId: string, postId: string, instructions: string | undefined, engine: Engine) {
    const post = await this.store.getPost(postId, workspaceId);
    const plan = post.plan_id ? await this.prisma.ig_content_plans.findFirst({ where: { id: post.plan_id, workspace_id: workspaceId } }) : null;
    const brand = await this.brandFor(workspaceId, plan?.brand_id);
    const prompt = [
      'Reescreva a legenda deste post de Instagram em português do Brasil.',
      `Formato: ${post.format}. Tema: ${post.theme ?? '-'}. Hook: ${post.hook ?? '-'}.`,
      `Legenda atual: ${post.caption ?? '-'}`,
      instructions ? `Instruções: ${instructions}` : '',
      plan ? `Tom: ${plan.tone_of_voice ?? '-'}. Hashtags: ${JSON.stringify(plan.hashtag_strategy)}.` : '',
      brand ? `MARCA: ${JSON.stringify(brand)}` : '',
      'Devolva SOMENTE JSON {"caption":"...","hashtags":["valinhos","choppgelado"] (array de 10 a 15 strings sem #),"cta":"..."}.',
    ]
      .filter(Boolean)
      .join('\n');
    const { json, provider } = await this.aiJson(workspaceId, engine, prompt, CAPTION_SCHEMA, 'ig_caption');
    await this.store.patchPost(postId, {
      caption: asText(json.caption),
      hashtags: normalizeHashtags(json.hashtags),
      cta: json.cta ?? post.cta,
      ai_generation_log: this.store.appendLog(post, { step: 'caption', provider, instructions }),
    });
    return { ok: true };
  }

  async suggestPillars(workspaceId: string, input: { brandId?: string | null; objective?: string; tone?: string; audience?: string }) {
    let brand = null;
    if (input.brandId) {
      brand = await this.brandFor(workspaceId, input.brandId);
      if (!brand) throw notFound('Marca não encontrada.');
    }
    const prompt = [
      'Sugira 5 pilares de conteúdo para Instagram, em português do Brasil, curtos (2 a 4 palavras).',
      `Objetivo: ${input.objective ?? '-'}. Tom: ${input.tone ?? '-'}. Público: ${input.audience ?? '-'}.`,
      brand ? `MARCA: ${JSON.stringify(brand)}` : '',
      'Devolva SOMENTE JSON {"pillars":["..."]}.',
    ]
      .filter(Boolean)
      .join('\n');
    const { json } = await this.aiJson(workspaceId, 'auto', prompt, PILLARS_SCHEMA, 'ig_pillars');
    return { pillars: ((json?.pillars ?? []) as string[]).slice(0, 5) };
  }
}
