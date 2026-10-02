/** Shared cadence types (client + server safe). */
export type CadenceChannel = "wa_text" | "wa_template" | "email" | "call_task";

export type CadenceStep = {
  channel: CadenceChannel;
  delay_minutes: number;
  /** Sending window: weekdays (0=Dom … 6=Sáb) and HH:MM range, São Paulo time. */
  window?: { days: number[]; start: string; end: string };
  message?: string;
  subject?: string;
  template_name?: string;
  template_language?: string;
  template_params?: string[];
  /** Template used when the 24h window is closed on a wa_text step. */
  fallback_template?: string;
};

export type ExitRules = {
  on_reply?: boolean;
  on_stage_change?: boolean;
  on_won_lost?: boolean;
  on_opt_out?: boolean;
  on_human_takeover?: boolean;
};

export const CHANNEL_LABELS: Record<CadenceChannel, string> = {
  wa_text: "WhatsApp texto",
  wa_template: "WhatsApp template",
  email: "E-mail",
  call_task: "Tarefa de ligação",
};

export const TRIGGER_LABELS: Record<string, string> = {
  source: "Novo lead por origem",
  campaign: "Novo lead por campanha",
  stage: "Entrada em etapa",
  tag: "Tag adicionada",
  manual: "Inclusão manual",
};

export const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
