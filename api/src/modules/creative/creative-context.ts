/**
 * Contexto completo de um post para a direção de arte e o roteiro de vídeo (puro). O serviço do Instagram o monta num lugar só
 * (`PostContextService`); os diretores só leem. Nada daqui vira texto na imagem: tudo é traduzido em cena.
 */
export type PostCreativeContext = {
  product: { name: string; description: string | null; price: number | null } | null;
  pillar: string | null;
  persona: { name: string; pains: string | null; desires: string | null } | null;
  funnelStage: string | null;
  /** Objetivo do período (execução) ou do plano. */
  objective: string | null;
  /** Estratégia da execução (mensagem central, público, proibições). */
  strategy: { mensagem_central: string; publico_foco: string; proibicoes: string[] } | null;
  /** Campanha ligada: oferta + estratégia aprovada (`strategyBrief`). */
  campaign: { offer: string | null; promise: string | null; brief: unknown } | null;
  /** Horário do post (ISO): data e estação do ano para a cena. */
  scheduledAt: string | null;
};

const SP = 'America/Sao_Paulo';
const FUNNEL: Record<string, string> = {
  atracao: 'atração — parar o scroll e apresentar a marca',
  consideracao: 'consideração — mostrar detalhe, uso e prova',
  conversao: 'conversão — produto em destaque e convite claro',
};

/** Estação do ano no Brasil (hemisfério sul) pelo mês em São Paulo (UTC-3 fixo). */
export function seasonOf(iso: string): 'verão' | 'outono' | 'inverno' | 'primavera' {
  const m = new Date(new Date(iso).getTime() - 3 * 3600e3).getUTCMonth() + 1;
  return m === 12 || m <= 2 ? 'verão' : m <= 5 ? 'outono' : m <= 8 ? 'inverno' : 'primavera';
}

const dateBr = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString('pt-BR', { weekday: 'long', timeZone: SP })}, ${d.toLocaleDateString('pt-BR', { timeZone: SP, day: '2-digit', month: '2-digit', year: 'numeric' })}`;
};

/** Contexto como JSON curto para os prompts. */
export function contextForPrompt(ctx: PostCreativeContext | null | undefined): Record<string, unknown> | null {
  if (!ctx) return null;
  return {
    produto: ctx.product ? { nome: ctx.product.name, descricao: ctx.product.description, preco: ctx.product.price } : null,
    pilar: ctx.pillar,
    persona: ctx.persona ? { nome: ctx.persona.name, dores: ctx.persona.pains, desejos: ctx.persona.desires } : null,
    etapa_do_funil: ctx.funnelStage ? (FUNNEL[ctx.funnelStage] ?? ctx.funnelStage) : null,
    objetivo_do_periodo: ctx.objective,
    mensagem_central: ctx.strategy?.mensagem_central || null,
    publico: ctx.strategy?.publico_foco || null,
    campanha: ctx.campaign ? { oferta: ctx.campaign.offer, promessa: ctx.campaign.promise, estrategia: ctx.campaign.brief } : null,
    data: ctx.scheduledAt ? `${dateBr(ctx.scheduledAt)} (${seasonOf(ctx.scheduledAt)})` : null,
  };
}

/** Proibições da estratégia da execução (entram no prompt e no negativo). */
export const contextProhibitions = (ctx: PostCreativeContext | null | undefined): string[] =>
  (ctx?.strategy?.proibicoes ?? []).map((p) => String(p).trim()).filter(Boolean).slice(0, 12);

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Foto que vira o primeiro quadro do vídeo (e a primeira referência da arte): a foto de produto cujo nome de arquivo contém o nome
 * do produto do post; senão outra foto de produto; senão a primeira referência da marca (a lista já vem com produto primeiro).
 */
export function firstFrameRef<T extends { tag: string | null; name?: string | null }>(refs: T[], productName: string | null): T | null {
  if (productName) {
    const p = norm(productName);
    const named = p ? refs.find((r) => r.tag === 'produto' && norm(r.name ?? '').includes(p)) : undefined;
    if (named) return named;
    const anyProduct = refs.find((r) => r.tag === 'produto');
    if (anyProduct) return anyProduct;
  }
  return refs[0] ?? null;
}

/** Referências com a foto do produto do post em primeiro lugar (o resto na ordem original). */
export function orderRefsForProduct<T extends { tag: string | null; name?: string | null }>(refs: T[], productName: string | null): T[] {
  const first = productName ? firstFrameRef(refs, productName) : null;
  return first ? [first, ...refs.filter((r) => r !== first)] : refs;
}
