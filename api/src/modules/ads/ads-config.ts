/**
 * Configuração de publicação na Meta e regras automáticas (compartilhado entre telas e servidor).
 */
export const CTA_OPTIONS: Record<string, string> = {
  LEARN_MORE: "Saiba mais",
  SHOP_NOW: "Comprar agora",
  ORDER_NOW: "Peça agora",
  SIGN_UP: "Cadastre-se",
  CONTACT_US: "Fale conosco",
  GET_QUOTE: "Pedir orçamento",
  SUBSCRIBE: "Assinar",
  BOOK_NOW: "Reservar",
  DOWNLOAD: "Baixar",
  WHATSAPP_MESSAGE: "Enviar mensagem no WhatsApp",
};

export const PLACEMENTS: Record<string, { label: string; platform: "facebook" | "instagram"; position: string }> = {
  facebook_feed: { label: "Facebook · Feed", platform: "facebook", position: "feed" },
  facebook_reels: { label: "Facebook · Reels", platform: "facebook", position: "facebook_reels" },
  facebook_stories: { label: "Facebook · Stories", platform: "facebook", position: "story" },
  instagram_feed: { label: "Instagram · Feed", platform: "instagram", position: "stream" },
  instagram_stories: { label: "Instagram · Stories", platform: "instagram", position: "story" },
  instagram_reels: { label: "Instagram · Reels", platform: "instagram", position: "reels" },
  instagram_explore: { label: "Instagram · Explorar", platform: "instagram", position: "explore" },
};

export type AdsStructure = "single" | "per_audience" | "per_angle";

export type AdsConfig = {
  /** single = 1 conjunto; per_audience = 1 conjunto por público da estratégia; per_angle = teste A/B por ângulo. */
  structure: AdsStructure;
  cta: string;
  placements: "auto" | string[];
  /** Público Advantage+: a Meta expande o público quando achar melhor. */
  advantageAudience: boolean;
  /** Junta as imagens aprovadas num único anúncio carrossel. */
  carousel: boolean;
  customAudienceIds: string[];
  excludeAudienceIds: string[];
  /** Público de origem para criar lookalike 1% no Brasil. */
  lookalikeSourceId: string | null;
  /** Usa os interesses dos públicos sugeridos pela estratégia. */
  useStrategyAudiences: boolean;
};

export const DEFAULT_ADS_CONFIG: AdsConfig = {
  structure: "single",
  cta: "LEARN_MORE",
  placements: "auto",
  advantageAudience: false,
  carousel: false,
  customAudienceIds: [],
  excludeAudienceIds: [],
  lookalikeSourceId: null,
  useStrategyAudiences: true,
};

export function readAdsConfig(v: unknown): AdsConfig {
  const o = (v && typeof v === "object" ? v : {}) as Partial<AdsConfig>;
  return {
    ...DEFAULT_ADS_CONFIG,
    ...o,
    customAudienceIds: Array.isArray(o.customAudienceIds) ? o.customAudienceIds : [],
    excludeAudienceIds: Array.isArray(o.excludeAudienceIds) ? o.excludeAudienceIds : [],
  };
}

export type AutomationRules = {
  enabled: boolean;
  /** Pausa o anúncio quando o CPL passa deste valor (R$)… */
  maxCpl: number | null;
  /** …depois de gastar pelo menos isto (R$) no anúncio. Também pausa se gastar isto sem nenhum lead. */
  minSpendToJudge: number;
  /** Aumenta a verba do conjunto quando o CPL dos últimos 3 dias está abaixo deste valor (R$). */
  scaleBelowCpl: number | null;
  /** Percentual de aumento por dia (máx. 30). */
  scaleStepPct: number;
  /** Teto de verba diária por conjunto (R$). */
  maxDailyBudget: number | null;
};

export const DEFAULT_RULES: AutomationRules = {
  enabled: false,
  maxCpl: null,
  minSpendToJudge: 30,
  scaleBelowCpl: null,
  scaleStepPct: 20,
  maxDailyBudget: null,
};

export function readRules(v: unknown): AutomationRules {
  const o = (v && typeof v === "object" ? v : {}) as Partial<AutomationRules>;
  const r = { ...DEFAULT_RULES, ...o };
  r.scaleStepPct = Math.min(30, Math.max(5, Number(r.scaleStepPct) || 20));
  r.minSpendToJudge = Math.max(5, Number(r.minSpendToJudge) || 30);
  return r;
}

// ---------------------------------------------------------------------------------------------------------------
// Saneamento do que o navegador manda em `saveCampaignAdsSettings` (o protótipo gravava o objeto como veio, com chaves
// extras e ids quaisquer). Aqui só entram as chaves conhecidas, com tipo e formato certos — os ids de público vão para
// o corpo das chamadas à Graph, então precisam ser numéricos.
// ---------------------------------------------------------------------------------------------------------------
const digitsId = (v: unknown): v is string => typeof v === 'string' && /^\d{3,25}$/.test(v);
const idList = (v: unknown): string[] => [...new Set((Array.isArray(v) ? v : []).filter(digitsId))].slice(0, 50);
const numOrNull = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : null);

export function sanitizeAdsConfig(raw: unknown): AdsConfig {
  const o = readAdsConfig(raw);
  const placements = o.placements === 'auto' ? 'auto' : (Array.isArray(o.placements) ? o.placements : []).filter((k) => typeof k === 'string' && k in PLACEMENTS);
  return {
    structure: (['single', 'per_audience', 'per_angle'] as const).includes(o.structure) ? o.structure : 'single',
    cta: typeof o.cta === 'string' && o.cta in CTA_OPTIONS ? o.cta : 'LEARN_MORE',
    placements: placements === 'auto' || placements.length ? placements : 'auto',
    advantageAudience: o.advantageAudience === true,
    carousel: o.carousel === true,
    customAudienceIds: idList(o.customAudienceIds),
    excludeAudienceIds: idList(o.excludeAudienceIds),
    lookalikeSourceId: digitsId(o.lookalikeSourceId) ? o.lookalikeSourceId : null,
    useStrategyAudiences: o.useStrategyAudiences !== false,
  };
}

export function sanitizeRules(raw: unknown): AutomationRules {
  const r = readRules(raw);
  return {
    enabled: r.enabled === true,
    maxCpl: numOrNull(r.maxCpl),
    minSpendToJudge: r.minSpendToJudge,
    scaleBelowCpl: numOrNull(r.scaleBelowCpl),
    scaleStepPct: r.scaleStepPct,
    maxDailyBudget: numOrNull(r.maxDailyBudget),
  };
}
