export const LEAD_SOURCES: Record<string, string> = {
  meta_lead_ads: "Meta Lead Ads",
  click_to_whatsapp: "Click-to-WhatsApp",
  site: "Site",
  whatsapp: "WhatsApp",
  manual: "Manual",
  import: "Importação",
};

export const TEMPERATURES: Record<string, string> = {
  frio: "Frio",
  morno: "Morno",
  quente: "Quente",
};

export const INTERACTION_KINDS: Record<string, string> = {
  message_in: "Mensagem recebida",
  message_out: "Mensagem enviada",
  note: "Nota",
  call: "Ligação",
  stage_change: "Mudança de etapa",
  ai_action: "Ação da IA",
};

export const AUTHOR_TYPES: Record<string, string> = {
  user: "Usuário",
  ai: "IA",
  system: "Sistema",
};

export const TASK_STATUS: Record<string, string> = {
  open: "Aberta",
  done: "Concluída",
  canceled: "Cancelada",
};

export type Stage = {
  id: string;
  name: string;
  color: string;
  position: number;
  sla_hours: number;
  is_won: boolean;
  is_lost: boolean;
  pipeline_id: string;
};

export type Lead = {
  id: string;
  workspace_id: string;
  pipeline_id: string | null;
  stage_id: string | null;
  name: string;
  phone: string | null;
  email: string | null;
  city: string | null;
  source: string;
  campaign_name: string | null;
  adset_name: string | null;
  ad_name: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  owner_id: string | null;
  score: number;
  temperature: string;
  estimated_value: number;
  tags: string[];
  loss_reason: string | null;
  lgpd_consent: boolean;
  lgpd_consent_at: string | null;
  unsubscribed: boolean;
  ai_active: boolean;
  stage_entered_at: string;
  last_interaction_at: string | null;
  first_response_at: string | null;
  created_at: string;
};

export const hoursSince = (iso: string | null | undefined) => {
  if (!iso) return 0;
  return (Date.now() - new Date(iso).getTime()) / 3_600_000;
};

export const slaBroken = (lead: Lead, stage?: Stage | null) =>
  !!stage && !stage.is_won && !stage.is_lost && hoursSince(lead.stage_entered_at) > stage.sla_hours;

export const humanDuration = (hours: number) => {
  if (!isFinite(hours) || hours <= 0) return "—";
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  if (hours < 48) return `${hours.toFixed(1)} h`;
  return `${(hours / 24).toFixed(1)} d`;
};
