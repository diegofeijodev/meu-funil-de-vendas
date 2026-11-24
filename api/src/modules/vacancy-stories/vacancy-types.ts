import type { Prisma } from '@prisma/client';

export type FreelaVacancy = {
  id: string;
  title: string | null;
  serviceType: string | null;
  city: string | null;
  date: string | null;
  startTime: string;
  endTime: string;
  amountInCents: number | null;
  contractorName: string | null;
  /** Bairro (sem rua nem número) e descrição: só quando a vitrine do Freela os envia. */
  neighborhood?: string | null;
  description?: string | null;
  publishedAt: string;
  isUpcoming?: boolean;
};

/** Vaga fixa (CLT) da vitrine pública do Freela (`GET /v1/fixed-jobs/public/*`, ADR-028 do Freela): nunca traz contato nem endereço. */
export type FreelaFixedJob = {
  id: string;
  title: string;
  role: string;
  category: string | null;
  companyName: string | null;
  /** Nome canônico de `shared.cities` (nunca pedaço do endereço) e a UF; null quando o Freela não achou. */
  city: string | null;
  uf: string | null;
  salary: { minInCents: number; maxInCents: number } | null;
  workSchedule: string | null;
  workScheduleSlots: { day: string; start: string; end: string }[];
  benefits: string[];
  description: string | null;
  publishedAt: string;
  expiresAt: string | null;
};

/** Fonte da linha da fila (`vacancy_stories.source`). */
export type VacancySourceId = 'freela' | 'freela_clt';

/** Campos da arte "Vaga fixa CLT" (UI §3.4): null = o cartão sai. */
export type CltFields = {
  cargo: string;
  empresa: string | null;
  salario: string;
  escala: string | null;
  cidade: string | null;
  beneficios: string | null;
};

export type ExpectedValues = {
  cents: number;
  day: number;
  month: number;
  /** Dia da semana de Brasília (0 = domingo): "Sex, 29/10" numa quinta reprova (I3). */
  weekday: number;
  startMin: number;
  endMin: number;
};

export type VacancyFields = {
  funcao: string;
  estabelecimento: string | null;
  data: string;
  horario: string;
  valor: string;
  cidade: string;
  /** Bairro limpo (o cartão mostra "bairro, cidade"); null = cartão só com a cidade. */
  regiao?: string | null;
  /** Descrição limpa; null quando não veio ou trazia contato, link ou endereço. */
  descricao?: string | null;
  expected: ExpectedValues;
};

/** O que a leitura às cegas (IA) viu na arte gerada. */
export type ArtRead = {
  textos: string[];
  funcao: string | null;
  estabelecimento: string | null;
  data: string | null;
  inicio: string | null;
  fim: string | null;
  valor: string | null;
  cidade: string | null;
};

export type FieldKey = 'funcao' | 'valor' | 'data' | 'inicio' | 'fim' | 'cidade' | 'estabelecimento';

export type FieldCheck = { key: FieldKey; label: string; ok: boolean; read: string | null; expected: string | null };

export type ArtCheck = { ok: boolean; fields: FieldCheck[]; forbidden: string[]; hint: string | null };

export type AttemptLog = {
  n: number;
  at: string;
  kind: 'ai' | 'fallback_photo' | 'fallback_plain';
  ok: boolean;
  wrong: FieldKey[];
  forbidden: string[];
  error?: string;
  /** Só em tentativa da IA reprovada: o que a leitura viu em cada campo errado. */
  read?: Partial<Record<FieldKey, string | null>>;
  /** Só em tentativa da IA reprovada: os textos que a leitura listou (cortados). */
  textos?: string[];
};

/** Linhas do banco (configuração por empresa e fila de stories). */
export type SettingsRow = Prisma.vacancy_story_settingsGetPayload<object>;
export type StoryRow = Prisma.vacancy_storiesGetPayload<object>;
