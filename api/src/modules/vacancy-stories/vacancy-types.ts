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
  publishedAt: string;
  isUpcoming?: boolean;
};

export type ExpectedValues = {
  cents: number;
  day: number;
  month: number;
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
};
