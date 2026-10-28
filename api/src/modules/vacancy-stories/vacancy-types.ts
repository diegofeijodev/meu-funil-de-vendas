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
