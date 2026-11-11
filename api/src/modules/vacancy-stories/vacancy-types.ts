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
