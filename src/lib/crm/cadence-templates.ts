/** Ready-made cadence templates (client + server safe). */
import type { CadenceStep, ExitRules } from "./cadence-types";

export type CadenceTemplate = {
  key: string;
  name: string;
  description: string;
  trigger_type: "source" | "campaign" | "stage" | "tag" | "manual";
  trigger_value: string | null;
  steps: CadenceStep[];
};

const BUSINESS = { days: [1, 2, 3, 4, 5], start: "08:00", end: "20:00" };
const WIDE = { days: [0, 1, 2, 3, 4, 5, 6], start: "08:00", end: "21:00" };

export const DEFAULT_EXIT_RULES: ExitRules = {
  on_reply: true,
  on_stage_change: true,
  on_won_lost: true,
  on_opt_out: true,
  on_human_takeover: true,
};

export const CADENCE_TEMPLATES: CadenceTemplate[] = [
  {
    key: "novo_lead_meta",
    name: "Novo lead Meta",
    description: "Imediato, +1h, +1 dia, +3 dias e +7 dias para leads vindos do Meta Lead Ads.",
    trigger_type: "source",
    trigger_value: "meta_lead_ads",
    steps: [
      {
        channel: "wa_text",
        delay_minutes: 0,
        window: WIDE,
        message: "Oi {{nome}}! Aqui é o time da nossa equipe. Vi seu interesse e quero te ajudar. Posso te enviar os detalhes?",
      },
      {
        channel: "wa_text",
        delay_minutes: 60,
        window: WIDE,
        message: "{{nome}}, consegui separar as informações para {{cidade}}. Quer que eu te mande agora?",
      },
      {
        channel: "wa_text",
        delay_minutes: 60 * 24,
        window: BUSINESS,
        message: "Oi {{nome}}, tudo bem? Ainda faz sentido conversarmos sobre a oportunidade?",
      },
      {
        channel: "call_task",
        delay_minutes: 60 * 24 * 2,
        window: BUSINESS,
        message: "Ligar para entender o momento do lead.",
      },
      {
        channel: "wa_text",
        delay_minutes: 60 * 24 * 4,
        window: BUSINESS,
        message: "{{nome}}, vou encerrar o contato por aqui. Se quiser retomar, é só me chamar. Falo com {{responsavel}} sempre que precisar.",
      },
    ],
  },
  {
    key: "no_show",
    name: "No-show de reunião",
    description: "Retomada rápida quando o lead não comparece à reunião agendada.",
    trigger_type: "stage",
    trigger_value: null,
    steps: [
      {
        channel: "wa_text",
        delay_minutes: 15,
        window: BUSINESS,
        message: "{{nome}}, não consegui te encontrar na nossa reunião. Quer remarcar para outro horário?",
      },
      {
        channel: "wa_text",
        delay_minutes: 60 * 4,
        window: BUSINESS,
        message: "Tenho horários livres amanhã. Prefere de manhã ou à tarde?",
      },
      {
        channel: "call_task",
        delay_minutes: 60 * 24,
        window: BUSINESS,
        message: "Ligar para remarcar a reunião.",
      },
    ],
  },
  {
    key: "reativacao_perdidos",
    name: "Reativação de perdidos após 30 dias",
    description: "Reaquece leads marcados como perdidos há mais de 30 dias.",
    trigger_type: "manual",
    trigger_value: null,
    steps: [
      {
        channel: "wa_template",
        delay_minutes: 0,
        window: BUSINESS,
        template_name: "reativacao_30_dias",
        template_language: "pt_BR",
        template_params: ["{{nome}}"],
        message: "Oi {{nome}}, temos novidades desde a nossa última conversa. Posso te atualizar?",
      },
      {
        channel: "wa_text",
        delay_minutes: 60 * 24 * 3,
        window: BUSINESS,
        message: "{{nome}}, as condições mudaram para {{cidade}}. Quer que eu te mande o resumo?",
      },
      {
        channel: "wa_text",
        delay_minutes: 60 * 24 * 7,
        window: BUSINESS,
        message: "Última tentativa por aqui, {{nome}}. Se fizer sentido no futuro, é só responder.",
      },
    ],
  },
  {
    key: "pos_proposta",
    name: "Pós-proposta sem resposta",
    description: "Follow-up para leads que receberam proposta e não responderam.",
    trigger_type: "stage",
    trigger_value: null,
    steps: [
      {
        channel: "wa_text",
        delay_minutes: 60 * 24,
        window: BUSINESS,
        message: "{{nome}}, conseguiu analisar a proposta? Posso esclarecer qualquer ponto.",
      },
      {
        channel: "call_task",
        delay_minutes: 60 * 24 * 2,
        window: BUSINESS,
        message: "Ligar para destravar a proposta.",
      },
      {
        channel: "wa_text",
        delay_minutes: 60 * 24 * 4,
        window: BUSINESS,
        message: "{{nome}}, a proposta vence em breve. Quer que eu reserve sua condição?",
      },
      {
        channel: "email",
        delay_minutes: 60 * 24 * 7,
        window: BUSINESS,
        subject: "Proposta ainda disponível",
        message: "Reenviar a proposta por e-mail com resumo dos benefícios.",
      },
    ],
  },
];
