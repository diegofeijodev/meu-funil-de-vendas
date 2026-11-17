/** Textos e regras puras do painel "Estilo das artes" (ui.md §2; P2 e P12). Sem React, para testar sem navegador. */

export const PANEL_TEXT = {
  title: "Estilo das artes",
  description:
    "Mostre imagens de que você gosta. O Meu Funil lê as cores, a luz e o clima e usa em todas as artes, posts e vídeos desta marca. A imagem nunca aparece na arte nem é publicada.",
  field: "Link do Pinterest",
  help: "Pin, pasta ou perfil público. No Pinterest, toque em Compartilhar e em Copiar link. Com pasta ou perfil, os Pins novos entram sozinhos todo dia.",
  add: "Adicionar",
  adding: "Buscando…",
  upload: "Enviar imagem",
  uploading: "Enviando…",
  empty: "Nenhuma referência ainda. Cole o link de uma pasta do Pinterest com o estilo que você quer.",
  loading: "Carregando as referências…",
  loadError: "Não conseguimos carregar as referências. Verifique a conexão e toque em Tentar de novo.",
  retry: "Tentar de novo",
  stopConfirm: "Parar de acompanhar",
  stopCancel: "Continuar",
  sources: "Suas pastas acompanhadas",
  campaignOnly: "Pin colado aqui vale só para esta campanha. Pasta ou perfil vale para a marca inteira.",
} as const;

export type StyleRefLike = {
  source: "upload" | "pinterest";
  from_source: boolean;
  source_title: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  status: "processing" | "ready" | "failed";
  attempts: number;
  summary: string | null;
  /** `selection` = veio da Seleção do Meu Funil (P17). Ausente = própria (API antiga). */
  origin?: "own" | "selection";
};

const MAX_ATTEMPTS = 3;
const BRAND_LIMIT = 30;
const COLLAPSED = 4;

export function refOrigin(r: Pick<StyleRefLike, "source" | "from_source" | "source_title"> & { origin?: "own" | "selection" }): string {
  if (r.origin === "selection") return "Seleção do Meu Funil";
  if (r.source === "upload") return "Imagem enviada";
  if (!r.from_source) return "Pin do Pinterest";
  return r.source_title ? `Pasta ${r.source_title}` : "Pasta do Pinterest";
}

export function refScope(r: Pick<StyleRefLike, "campaign_id" | "campaign_name">): string {
  if (!r.campaign_id) return "vale para toda a marca";
  return r.campaign_name ? `só na campanha ${r.campaign_name}` : "só nesta campanha";
}

export function refStateText(
  r: Pick<StyleRefLike, "status" | "attempts" | "summary">,
  ctx: { selection: boolean; paused: boolean } = { selection: false, paused: false },
): string {
  if (r.status === "failed") {
    if (!ctx.selection) return "Não conseguimos ler esta imagem. Remova e tente outra.";
    // Seleção (ui.md §3.6): `attempts` < 3 sai sozinha no próximo sync; 3 = volta para a fila.
    return r.attempts >= MAX_ATTEMPTS
      ? "Não deu para ler agora. Tentamos de novo mais tarde, sozinhos."
      : "Não conseguimos ler esta imagem. Ela sai sozinha da seleção.";
  }
  if (r.status === "processing") {
    return r.attempts > 0
      ? `Não deu para ler agora. Tentando de novo sozinho (${Math.min(r.attempts + 1, MAX_ATTEMPTS)} de ${MAX_ATTEMPTS}).`
      : "Lendo o estilo…";
  }
  const taken = r.summary ?? "estilo lido.";
  if (ctx.selection && ctx.paused) return `Guardada: entra se você ficar com menos de 4 referências suas. O que eu peguei: ${taken}`;
  return `Em uso. O que eu peguei: ${taken}`;
}

export const removeLabel = (r: Pick<StyleRefLike, "source" | "from_source" | "source_title"> & { origin?: "own" | "selection" }): string => `Remover referência: ${refOrigin(r)}`;

export const brandCounter = (n: number): string =>
  `${n} de ${BRAND_LIMIT} referências nesta marca. Quando enche, as mais antigas das pastas dão lugar às novas.`;

export const stopSourceQuestion = (n: number): string =>
  `Parar de acompanhar esta pasta? As ${n} referências que vieram dela saem da marca.`;

export const removedToast = (r: { from_source: boolean; origin?: "own" | "selection" }): string =>
  r.origin === "selection"
    ? "Referência removida. Ela não volta; outra da seleção pode entrar no lugar."
    : r.from_source ? "Referência removida. Ela não volta, mesmo continuando na pasta." : "Referência removida.";

export const visibleRefs = <T,>(refs: T[], expanded: boolean): T[] => (expanded ? refs : refs.slice(0, COLLAPSED));

export const seeAllLabel = (n: number): string => `Ver todas (${n})`;

/** Uma frase por vez para a região viva: falha > pronta > lendo. 1ª carga (prev indefinido) não anuncia. */
export function liveAnnouncement(
  prev: { id: string; status: string }[] | undefined,
  next: { id: string; status: string }[],
): string | null {
  if (!prev) return null;
  const before = new Map(prev.map((p) => [p.id, p.status]));
  let failed = false;
  let ready = false;
  let reading = false;
  for (const n of next) {
    const was = before.get(n.id);
    if (n.status === "failed" && was !== undefined && was !== "failed") failed = true;
    else if (n.status === "ready" && was === "processing") ready = true;
    else if (n.status === "processing" && was === undefined) reading = true;
  }
  if (failed) return "Não conseguimos ler uma referência.";
  if (ready) return "Referência pronta. O estilo já está em uso.";
  if (reading) return "Lendo o estilo…";
  return null;
}

/** Bloco "Logo e fotos da sua marca" na aba Identidade visual (ui.md §1; P12). Foto própria não é "referência". */
export const BRAND_PHOTOS_TEXT = {
  title: "Logo e fotos da sua marca",
  description: "Fotos de verdade do seu negócio. Elas podem aparecer nas artes.",
  button: "Foto da sua marca",
  option: (tag: string): string => `Foto de: ${tag}`,
  selectLabel: "Tipo da foto da sua marca",
  warning:
    "Só envie aqui fotos que são suas. Imagem do Pinterest ou de outra empresa vai em Estilo das artes, na aba Guia visual.",
  guide:
    "Como as fotos da marca devem parecer. O diretor de arte usa isto em todo criativo. Envie as fotos da sua marca na aba Identidade visual.",
} as const;

export const photoLabel = (tagLabel: string | null): string =>
  tagLabel ? BRAND_PHOTOS_TEXT.option(tagLabel) : BRAND_PHOTOS_TEXT.button;

export const brandPhotosToast = (n: number): string =>
  n === 1 ? "Foto enviada. Ela pode aparecer nas artes." : `${n} fotos enviadas. Elas podem aparecer nas artes.`;

/** Convite "Estilo: …" onde a arte é vista (ui.md §5; P6, P12, P13). `null` = peça antiga ou prompt à mão: não mostra a linha. */
export type StyleRecordLike = { own: string[]; library: string[]; brand_id: string | null };

export const INVITE_CTA = "Mostrar o estilo que eu quero";

export function styleInvite(
  rec: StyleRecordLike | null | undefined,
): { text: string; cta: boolean; brandId: string | null } | null {
  if (!rec) return null;
  const n = rec.own.length;
  if (n === 0 && rec.library.length > 0) return { text: "Estilo: seguiu a Seleção do Meu Funil.", cta: true, brandId: rec.brand_id };
  if (n === 0) return { text: "Estilo: sem referências.", cta: true, brandId: rec.brand_id };
  if (rec.library.length > 0) {
    return {
      text: n === 1 ? "Estilo: seguiu 1 referência sua e a Seleção do Meu Funil." : `Estilo: seguiu ${n} referências suas e a Seleção do Meu Funil.`,
      cta: false,
      brandId: rec.brand_id,
    };
  }
  return {
    text: n === 1 ? "Estilo: seguiu 1 referência sua." : `Estilo: seguiu ${n} referências suas.`,
    cta: false,
    brandId: rec.brand_id,
  };
}

/** Pacote do piloto: uma linha só, com o maior `own` entre as peças que têm registro (P13). */
export function packageInvite(recs: (StyleRecordLike | null | undefined)[]): ReturnType<typeof styleInvite> {
  let best: StyleRecordLike | null = null;
  for (const r of recs) if (r && (!best || r.own.length > best.own.length)) best = r;
  return styleInvite(best);
}

/**
 * Intervalo da conferência da lista (ms) ou `false`. 5 s só enquanto alguma está lendo pela 1ª vez (attempts 0);
 * em tentativas espaçadas (attempts > 0, até ~3h30) 60 s, para não renovar as URLs assinadas das miniaturas a toda hora.
 */
export function refsPollInterval(refs: Pick<StyleRefLike, "status" | "attempts">[] | undefined): number | false {
  const processing = (refs ?? []).filter((r) => r.status === "processing");
  if (processing.length === 0) return false;
  return processing.some((r) => (r.attempts ?? 0) === 0) ? 5000 : 60000;
}

export const promotedToast = (kind: string): string =>
  kind === "pin"
    ? "Esse Pin já vinha da Seleção do Meu Funil. Agora ele é seu e fica mesmo se a seleção for desligada."
    : "Essa pasta já vinha da Seleção do Meu Funil. Agora ela é sua e fica mesmo se a seleção for desligada.";

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

/** Seleção do Meu Funil: textos fixos e com {n}/{ramo} (ui.md §3 v4; P34–P38). */
export const SELECTION_TEXT = {
  title: "Seleção do Meu Funil",
  explanation:
    "Quando você tem menos de 4 referências suas, o Meu Funil põe sozinho nesta marca referências de pastas públicas do Pinterest do seu ramo, escolhidas pela nossa equipe. Cada uma é lida uma vez com a chave de IA da empresa (em Integrações), e isso gasta crédito dela. São no máximo 12 por vez, e as suas vêm sempre primeiro.",
  toggle: "Usar a Seleção do Meu Funil nesta marca",
  toggleHint: "Liga e desliga na hora, sem precisar salvar.",
  viewerNote: "Só quem edita a marca pode ligar, desligar ou trocar o ramo.",
  branchAuto: (ramo: string): string => `Ramo: ${ramo}, pelo Segmento da marca (aba DNA).`,
  branchChosen: (ramo: string): string => `Ramo: ${ramo}, escolhido por você.`,
  changeBranch: "Trocar o ramo",
  chooseBranch: "Escolher o ramo",
  counter: (n: number): string => `${n} de 12 referências da seleção nesta marca.`,
  sourcesTitle: "Pastas da seleção",
  refsTitle: "Referências da seleção",
  seeAll: (n: number): string => `Ver todas da seleção (${n})`,
  retry: "Tentar de novo",
  openIntegrations: "Abrir Integrações",
  // 3.4 escolher e trocar o ramo
  pickQuestion: "Escolha o ramo mais parecido com o seu negócio:",
  noneOption: "Nenhum desses",
  currentSuffix: " (atual)",
  useBranch: "Usar este ramo",
  stayWithout: "Ficar sem seleção",
  cancel: "Cancelar",
  branchChangeConsequence: (n: number, ramo: string): string =>
    n === 1
      ? `A referência da seleção de agora sai desta marca. Entram as do ramo ${ramo}, lidas com a chave de IA da empresa.`
      : `As ${n} referências da seleção de agora saem desta marca. Entram as do ramo ${ramo}, lidas com a chave de IA da empresa.`,
  branchNoneConsequence: (n: number): string =>
    n === 1 ? "A referência da seleção sai desta marca e nada entra no lugar." : `As ${n} referências da seleção saem desta marca e nada entra no lugar.`,
  branchChosenToast: (ramo: string): string => `Ramo escolhido: ${ramo}.`,
  branchChangedToast: (ramo: string, hadRefs: boolean): string =>
    hadRefs ? `Ramo trocado para ${ramo}. As referências da seleção anterior saíram.` : `Ramo trocado para ${ramo}.`,
  branchNoneToast: "Pronto. A seleção não traz referências para esta marca.",
  branchError: "Não conseguimos trocar o ramo. Verifique a conexão e tente de novo.",
  // 3.5 ligar e desligar
  onToast: "Seleção ligada.",
  offToast: "Seleção desligada.",
  offWithRefsToast: "Seleção desligada. As referências dela saíram desta marca.",
  toggleError: "Não conseguimos mudar a seleção. Verifique a conexão e tente de novo.",
  offTitle: "Desligar a Seleção do Meu Funil?",
  offQuestion: (n: number): string =>
    n === 1
      ? "A referência da seleção sai desta marca. Se você ligar de novo, ela é lida outra vez com a chave de IA da empresa."
      : `As ${n} referências da seleção saem desta marca. Se você ligar de novo, elas são lidas outra vez com a chave de IA da empresa.`,
  offConfirm: "Desligar a seleção",
  offCancel: "Manter ligada",
  // 3.6 pasta e referência da seleção
  folderLabel: "Seleção do Meu Funil",
  folderFallbackTitle: "Pasta do Pinterest",
  folderHelp: "Para tirar, desligue a seleção ou troque o ramo.",
  folderError: "Esta pasta não respondeu agora. Tentamos de novo amanhã, sozinhos; as outras pastas da seleção continuam.",
  // 3.7 painel de cima
  ownSources: "Suas pastas acompanhadas",
  ownRefs: "Suas referências",
  emptyWithSelection:
    "Nenhuma referência sua ainda. Por enquanto as artes seguem a Seleção do Meu Funil. Cole o link de uma pasta do Pinterest com o estilo que você quer.",
  liveStarted: "A Seleção do Meu Funil está trazendo referências.",
  liveReady: "Referências da seleção prontas.",
  // 3.8 campanha
  campaignHelp: "Para tirar, desligue a Seleção do Meu Funil na marca, aba Guia visual.",
  // 3.9 erro da API (SELECTION_SOURCE)
  sourceStopError:
    "Esta pasta é da Seleção do Meu Funil e não dá para parar por aqui. Para tirar, desligue a seleção ou troque o ramo na marca, aba Guia visual.",
} as const;

/** Região viva da Seleção (ui.md §3.7): no máximo uma frase por conferência; a 1ª carga (prev indefinido) não anuncia. */
export function selectionAnnouncement(
  prev: { id: string; status: string }[] | undefined,
  next: { id: string; status: string }[],
): string | null {
  if (!prev) return null;
  const before = new Map(prev.map((p) => [p.id, p.status]));
  let started = false;
  let ready = false;
  for (const n of next) {
    const was = before.get(n.id);
    if (n.status === "ready" && was === "processing") ready = true;
    else if (n.status === "processing" && was === undefined) started = true;
  }
  if (ready) return SELECTION_TEXT.liveReady;
  if (started) return SELECTION_TEXT.liveStarted;
  return null;
}

/** Campos da vista `GET /style-refs/library` que a tabela de estados usa (P34). */
export type SelectionViewLike = {
  segment: string | null;
  segment_label: string | null;
  segment_source: "auto" | "chosen" | "none";
  brand_segment: string | null;
  enabled: boolean;
  needs_ai_key: boolean;
  ai_credit: null | "no_credit" | "daily_limit";
  daily_left: number;
  sources_count: number;
  count: number;
  reading: number;
  own_ready: number;
  in_use: boolean;
};

export type SelectionCtx = {
  loading: boolean;
  error: boolean;
  canEdit: boolean;
  /** Dono ou administrador (`useWorkspace().role`): só eles veem "Abrir Integrações". */
  isAdmin: boolean;
  /** A pessoa ligou, escolheu ou trocou o ramo nesta visita (estado 10b). */
  justChanged: boolean;
  /** Todas as pastas da seleção estão com erro, conferido pela lista (estado 9). */
  allSourcesFailed: boolean;
};

export type SelectionState = {
  id: string;
  text: string;
  tone: "muted" | "error" | "warning";
  action: null | "retry" | "choose" | "integrations";
};

const NO_CHARGE = "Até você escolher, a seleção não traz nada nem gasta a chave de IA.";

/** Linha de estado do bloco da Seleção (ui.md §3.3): vale a primeira linha da tabela que bater. */
export function selectionState(view: SelectionViewLike | null | undefined, ctx: SelectionCtx): SelectionState {
  const st = (id: string, text: string, tone: SelectionState["tone"] = "muted", action: SelectionState["action"] = null): SelectionState => ({ id, text, tone, action });
  if (ctx.loading) return st("1", "Carregando a Seleção do Meu Funil…");
  if (ctx.error || !view) return st("2", "Não conseguimos carregar a Seleção do Meu Funil. Verifique a conexão e toque em Tentar de novo.", "error", "retry");
  if (!view.enabled) return st("3", "Desligada. As artes seguem só as suas referências.");
  if (view.segment_source === "none") {
    return st(
      "4",
      "Ligada, mas sem ramo: você escolheu “Nenhum desses”, então a seleção não traz referências. Escolha um ramo ou desligue a seleção.",
      "muted",
      ctx.canEdit ? "choose" : null,
    );
  }
  if (!view.segment) {
    if (!ctx.canEdit) return st("5c", "Esta marca ainda não tem ramo para a seleção. Só quem edita a marca pode escolher.");
    const seg = view.brand_segment?.trim();
    return seg
      ? st("5", `Ainda não temos seleção para “${seg}”. Escolha o ramo mais parecido com o seu negócio:\n${NO_CHARGE}`)
      : st("5b", `Escolha o ramo do seu negócio:\n${NO_CHARGE}`);
  }
  if (view.own_ready >= 4) {
    return st(
      "6",
      "Em pausa: você já tem 4 ou mais referências suas para a marca toda, e elas bastam. A seleção para de trazer referências novas e volta sozinha se você ficar com menos de 4.",
    );
  }
  if (view.needs_ai_key) {
    return ctx.isAdmin
      ? st(
          "7",
          "Falta a chave de IA da empresa. A seleção usa essa chave para ler as referências. Cadastre uma chave do ChatGPT ou do Gemini em Integrações; até lá, a seleção não traz nada novo.",
          "warning",
          "integrations",
        )
      : st(
          "7b",
          "Falta a chave de IA da empresa. A seleção usa essa chave para ler as referências. Peça ao dono ou a um administrador para cadastrar uma chave do ChatGPT ou do Gemini em Integrações; até lá, a seleção não traz nada novo.",
          "warning",
        );
  }
  if (view.ai_credit === "no_credit") {
    return st(
      "8",
      "Sua IA está sem créditos, então a seleção parou de trazer referências novas. As que já estão aqui continuam valendo, e ela volta sozinha quando a conta tiver crédito.",
      "warning",
      ctx.isAdmin ? "integrations" : null,
    );
  }
  if (view.ai_credit === "daily_limit") {
    return st("8b", "Sua IA chegou ao limite de uso de hoje. A seleção para de trazer referências novas e continua amanhã, sozinha.", "warning");
  }
  const ramo = view.segment_label ?? view.segment;
  if (view.count === 0 && view.reading === 0) {
    if (view.sources_count > 0 && ctx.allSourcesFailed) {
      return st("9", "As pastas do Pinterest deste ramo não responderam agora. Tentamos de novo amanhã, sozinhos.", "error");
    }
    if (view.daily_left === 0) return st("10", `Trazendo as referências do ramo ${ramo}. As primeiras chegam amanhã, sozinhas.`);
    if (ctx.justChanged) return st("10b", `Trazendo as referências do ramo ${ramo}. As primeiras chegam em alguns minutos; pode sair desta tela.`);
    return st("10c", `Trazendo as referências do ramo ${ramo}. As primeiras chegam nas próximas horas, sozinhas; pode sair desta tela.`);
  }
  if (view.count === 0) {
    return st("11", `Lendo o estilo de ${view.reading} ${plural(view.reading, "referência", "referências")} da seleção… Pode sair desta tela.`);
  }
  const base = "Em uso. As suas referências vêm sempre primeiro; a seleção completa o estilo enquanto você tiver menos de 4 para a marca toda.";
  return st("12", view.reading > 0 ? `${base} Lendo o estilo de mais ${view.reading} ${plural(view.reading, "referência", "referências")}…` : base);
}
