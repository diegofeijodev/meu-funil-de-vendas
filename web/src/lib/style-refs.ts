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
  sources: "Pastas acompanhadas",
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
};

const MAX_ATTEMPTS = 3;
const BRAND_LIMIT = 30;
const COLLAPSED = 4;

export function refOrigin(r: Pick<StyleRefLike, "source" | "from_source" | "source_title">): string {
  if (r.source === "upload") return "Imagem enviada";
  if (!r.from_source) return "Pin do Pinterest";
  return r.source_title ? `Pasta ${r.source_title}` : "Pasta do Pinterest";
}

export function refScope(r: Pick<StyleRefLike, "campaign_id" | "campaign_name">): string {
  if (!r.campaign_id) return "vale para toda a marca";
  return r.campaign_name ? `só na campanha ${r.campaign_name}` : "só nesta campanha";
}

export function refStateText(r: Pick<StyleRefLike, "status" | "attempts" | "summary">): string {
  if (r.status === "failed") return "Não conseguimos ler esta imagem. Remova e tente outra.";
  if (r.status === "processing") {
    return r.attempts > 0
      ? `Não deu para ler agora. Tentando de novo sozinho (${Math.min(r.attempts + 1, MAX_ATTEMPTS)} de ${MAX_ATTEMPTS}).`
      : "Lendo o estilo…";
  }
  return `Em uso. O que eu peguei: ${r.summary ?? "estilo lido."}`;
}

export const removeLabel = (r: Pick<StyleRefLike, "source" | "from_source" | "source_title">): string => `Remover referência: ${refOrigin(r)}`;

export const brandCounter = (n: number): string =>
  `${n} de ${BRAND_LIMIT} referências nesta marca. Quando enche, as mais antigas das pastas dão lugar às novas.`;

export const stopSourceQuestion = (n: number): string =>
  `Parar de acompanhar esta pasta? As ${n} referências que vieram dela saem da marca.`;

export const removedToast = (r: { from_source: boolean }): string =>
  r.from_source ? "Referência removida. Ela não volta, mesmo continuando na pasta." : "Referência removida.";

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
  if (n === 0) return { text: "Estilo: sem referências.", cta: true, brandId: rec.brand_id };
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
