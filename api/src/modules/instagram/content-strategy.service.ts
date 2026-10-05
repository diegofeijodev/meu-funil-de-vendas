import { Injectable, Logger } from '@nestjs/common';
import { UserError } from '../media/user-error';
import { ContentService } from './content.service';
import {
  brandContext,
  DATE_RULES,
  dateIssues,
  fullDate,
  normalizeStrategy,
  periodDays,
  RunStrategy,
  STRATEGY_SCHEMA,
  Verdict,
  VERDICT_SCHEMA,
} from './content-strategy';
import { asText } from './normalize';

export type StrategyArgs = {
  workspaceId: string;
  objective: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  brand: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  products: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  personas: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  plan: any;
  slots: { at: string; format: string }[];
};

export type ReviewPost = { index: number; at: string; theme: string | null; hook: string | null; caption: string | null; headline: string | null; cta: string | null };

/**
 * Estratégia do período (gerada do objetivo digitado) e validador de posts. O validador confere cada post contra marca, objetivo,
 * produtos e a data real (dia da semana em São Paulo): as regras de data rodam em código; a IA dá o segundo olhar.
 */
@Injectable()
export class ContentStrategyService {
  private readonly logger = new Logger(ContentStrategyService.name);

  constructor(private readonly content: ContentService) {}

  async buildRunStrategy(args: StrategyArgs): Promise<{ strategy: RunStrategy; provider: string }> {
    const prompt = [
      'Você é a estrategista-chefe de conteúdo de Instagram de uma agência no Brasil. Escreva em português do Brasil.',
      'Monte a estratégia do período. ORDEM DE PRIORIDADE (nunca inverta):',
      `1. OBJETIVO DIGITADO PELO CLIENTE (fonte principal, nunca ignore): ${args.objective}`,
      `2. DNA DA MARCA: ${JSON.stringify(brandContext(args.brand))}`,
      `3. PRODUTOS: ${JSON.stringify(args.products.map((p) => ({ nome: p.name, descricao: p.description, preco: p.price })))}`,
      `   PERSONAS: ${JSON.stringify(args.personas.map((p) => ({ nome: p.name, dores: p.pains, desejos: p.desires })))}`,
      `4. PLANO: pilares ${JSON.stringify(args.plan?.content_pillars ?? [])}; CTA padrão ${args.plan?.cta_default ?? '-'}.`,
      'REGRAS: tudo precisa ser do segmento da marca (nunca fale de outro negócio, marketing de agência, Q4, construção de lista etc. se não for o negócio dela).',
      'Não invente preço, promoção ou número que não esteja nos produtos/DNA. Pilares: 3 a 5, pesos somam 100.',
      'distribuicao_por_dia: um item para CADA dia abaixo (data dd/mm/aaaa e dia da semana exatamente como informado), com o tema do dia e o momento do funil (atração, consideração ou conversão).',
      'ctas: 3 a 6 CTAs aceitos no período. proibicoes: o que NÃO pode aparecer (palavras proibidas da marca, temas fora do segmento, promessas não cadastradas, expressões fora de data).',
      DATE_RULES,
      'DIAS DO PERÍODO:',
      ...periodDays(args.slots).map((d) => `- ${d}`),
      'Devolva SOMENTE JSON exatamente neste formato: {"objetivo_resumido":"...","kpi_principal":"...","publico_foco":"...","mensagem_central":"...","pilares":[{"nome":"...","peso_percentual":40,"por_que_serve_ao_objetivo":"..."}],"distribuicao_por_dia":[{"data":"dd/mm/aaaa","dia_da_semana":"...","tema_do_dia":"...","momento_do_funil":"atração"}],"ctas":["..."],"proibicoes":["..."]}',
    ].join('\n');
    const { json, provider } = await this.content.aiJson(args.workspaceId, 'auto', prompt, STRATEGY_SCHEMA, 'ig_run_strategy');
    const strategy = normalizeStrategy(json, args.objective);
    if (!strategy.pilares.length) throw new UserError('A IA não devolveu a estratégia completa. Tentando de novo no próximo ciclo.');
    return { strategy, provider };
  }

  /** Segundo olhar da IA sobre cada post + regras de data por código (que valem mesmo sem IA). */
  async validatePosts(args: {
    workspaceId: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    brand: any;
    objective: string;
    strategy: RunStrategy | null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    products: any[];
    posts: ReviewPost[];
  }): Promise<Map<number, Verdict>> {
    const out = new Map<number, Verdict>();
    for (const p of args.posts) {
      const issues = dateIssues([p.theme, p.hook, p.caption, p.headline, p.cta].filter(Boolean).join(' \n '), p.at);
      if (issues.length) out.set(p.index, { aprovado: false, nota: 0, motivo: `Incoerência de data: ${issues.join('; ')}.` });
    }
    const rest = args.posts.filter((p) => !out.has(p.index));
    if (!rest.length) return out;
    const prompt = [
      'Você é o revisor de qualidade de uma agência. Confira cada post de Instagram abaixo e reprove se:',
      '- fala de outro negócio ou de tema genérico fora do segmento da marca;',
      '- não tem relação com o objetivo do período;',
      '- inventa preço, promoção ou número que não esteja nos produtos/DNA;',
      '- usa palavra proibida da marca;',
      '- tem incoerência com a data ou o dia da semana informados.',
      `MARCA: ${JSON.stringify(brandContext(args.brand))}`,
      `OBJETIVO: ${args.objective}`,
      args.strategy ? `ESTRATÉGIA: ${JSON.stringify({ mensagem: args.strategy.mensagem_central, ctas: args.strategy.ctas, proibicoes: args.strategy.proibicoes })}` : '',
      `PRODUTOS (únicos preços válidos): ${JSON.stringify(args.products.map((p) => ({ nome: p.name, preco: p.price })))}`,
      DATE_RULES,
      'POSTS:',
      ...rest.map((p) => `- index ${p.index} · ${fullDate(p.at)}: ${JSON.stringify({ tema: p.theme, gancho: p.hook, headline: p.headline, legenda: p.caption, cta: p.cta })}`),
      'Devolva SOMENTE JSON {"results":[{"index":0,"aprovado":true,"nota_0_10":8,"motivo":"..."}]} com um item por post; motivo curto em português.',
    ]
      .filter(Boolean)
      .join('\n');
    try {
      const { json } = await this.content.aiJson(args.workspaceId, 'auto', prompt, VERDICT_SCHEMA, 'ig_post_review');
      for (const r of Array.isArray(json?.results) ? json.results : []) {
        const i = Number(r?.index);
        if (!rest.some((p) => p.index === i)) continue;
        const nota = Math.max(0, Math.min(10, Number(r?.nota_0_10) || 0));
        out.set(i, { aprovado: r?.aprovado === true && nota >= 6, nota, motivo: asText(r?.motivo) ?? '' });
      }
    } catch (e) {
      // Revisor indisponível: não bloqueia a programação; os posts seguem para a aprovação normal.
      this.logger.warn(`[ig-review] revisor falhou: ${e instanceof Error ? e.message : String(e)}`);
    }
    return out;
  }
}
