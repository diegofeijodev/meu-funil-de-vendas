import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { ENV } from '../../common/config/env.module';
import type { Env } from '../../common/config/env.validation';
import { overrideBase } from '../../common/config/test-overrides';
import type { FreelaFixedJob, FreelaVacancy } from './vacancy-types';

export const FREELA_VACANCIES_FETCH = Symbol('FREELA_VACANCIES_FETCH');
export type FreelaFetch = (url: string, init?: RequestInit) => Promise<Response>;

export class FeedDownError extends Error {
  constructor(message = 'Não conseguimos consultar as vagas do Freela.') {
    super(message);
    this.name = 'FeedDownError';
  }
}

/** Vitrine das vagas fixas fora do ar (a mensagem vai para `clt_last_poll_error`, sem sujar a das diárias). */
export const CLT_FEED_DOWN = 'Não conseguimos consultar as vagas fixas do Freela.';

const TIMEOUT_MS = 15_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_BASE = 'https://api.freelaservicosapp.com.br';
const nullableStr = z.string().nullish().transform((x) => x ?? null);

const itemSchema = z.object({
  id: z.string().min(1),
  title: nullableStr,
  serviceType: nullableStr,
  city: nullableStr,
  date: nullableStr,
  startTime: z.string().min(1),
  endTime: z.string().min(1),
  amountInCents: z.number().nullish().transform((x) => x ?? null),
  contractorName: nullableStr,
  neighborhood: nullableStr,
  description: nullableStr,
  publishedAt: z.string().min(1),
  isUpcoming: z.boolean().optional(),
});

function parseItem(raw: unknown): FreelaVacancy | null {
  const r = itemSchema.safeParse(raw);
  return r.success ? (r.data as FreelaVacancy) : null;
}

const cents = z.number().int().positive().max(100_000_000);
const slotSchema = z.object({ day: z.string().min(1).max(30), start: z.string().regex(/^\d{2}:\d{2}$/), end: z.string().regex(/^\d{2}:\d{2}$/) });
/** Itens fora do formato saem da lista sem derrubar a vaga (a vitrine já filtra; aqui é a borda). */
const listOf = <T>(item: z.ZodType<T>) =>
  z.array(z.unknown()).nullish().transform((xs) => (xs ?? []).flatMap((x) => { const r = item.safeParse(x); return r.success ? [r.data] : []; }));

/** `PublicFixedJob` da vitrine do Freela (ADR-028): o que não bater com o formato descarta a vaga inteira. */
export const cltItemSchema = z.object({
  id: z.string().min(1),
  title: z.string().nullish().transform((x) => (x ?? '').trim()),
  role: z.string().trim().min(1),
  category: nullableStr,
  companyName: nullableStr,
  city: nullableStr,
  uf: nullableStr,
  salary: z.object({ minInCents: cents, maxInCents: cents }).nullish().transform((x) => x ?? null),
  workSchedule: nullableStr,
  workScheduleSlots: listOf(slotSchema),
  benefits: listOf(z.string().trim().min(1).max(80)),
  description: nullableStr,
  publishedAt: z.string().min(1).refine((x) => !Number.isNaN(Date.parse(x))),
  expiresAt: z.string().nullish().transform((x) => x ?? null).refine((x) => x === null || !Number.isNaN(Date.parse(x))),
});

function parseCltItem(raw: unknown): FreelaFixedJob | null {
  const r = cltItemSchema.safeParse(raw);
  return r.success ? (r.data as FreelaFixedJob) : null;
}

/** Cidades da resposta com a contagem, as mais frequentes primeiro (empate: ordem de chegada) — `settings.recent_cities`. */
export function countCities(list: FreelaVacancy[]): { city: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const v of list) {
    const c = (v.city ?? '').trim();
    if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  return [...counts.entries()].map(([city, count]) => ({ city, count })).sort((a, b) => b.count - a.count);
}

/** Leitura da vitrine pública do Freela (vagas recentes e vaga por id). */
@Injectable()
export class VacancyFeedClient {
  private readonly base: string;
  /** Base da página pública da vaga fixa (`FREELA_FIXED_JOB_PAGE_URL`); null = a página ainda não está no ar. */
  readonly fixedJobPageBase: string | null;

  constructor(
    @Inject(ENV) env: Pick<Env, 'NODE_ENV' | 'FREELA_PUBLIC_API_URL'> & Partial<Pick<Env, 'FREELA_FIXED_JOB_PAGE_URL'>>,
    @Inject(FREELA_VACANCIES_FETCH) private readonly fetchFn: FreelaFetch,
  ) {
    this.base = overrideBase(env, env.FREELA_PUBLIC_API_URL, DEFAULT_BASE);
    this.fixedJobPageBase = env.FREELA_FIXED_JOB_PAGE_URL || null;
  }

  /** Página pública da vaga fixa (link "Abrir a vaga fixa no site"); null sem a página no ar ou com id que não é UUID. */
  fixedJobPage(id: string): string | null {
    return this.fixedJobPageBase && UUID.test(id) ? `${this.fixedJobPageBase}${id.toLowerCase()}` : null;
  }

  /** Link do QR da arte CLT: a página + `?o=ig` (origem); null = arte sem QR. */
  fixedJobQrLink(id: string): string | null {
    const page = this.fixedJobPage(id);
    return page ? `${page}?o=ig` : null;
  }

  private async get(path: string): Promise<Response> {
    try {
      return await this.fetchFn(`${this.base}${path}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      throw new FeedDownError();
    }
  }

  private async json(res: Response): Promise<unknown> {
    try {
      return await res.json();
    } catch {
      throw new FeedDownError();
    }
  }

  async recent(): Promise<FreelaVacancy[]> {
    const res = await this.get('/v1/bars-restaurants/public/vacancies/recent?limit=24');
    if (!res.ok) throw new FeedDownError();
    const body = (await this.json(res)) as { data?: unknown } | null;
    if (!body || !Array.isArray(body.data)) throw new FeedDownError();
    return body.data.map(parseItem).filter((v): v is FreelaVacancy => v !== null);
  }

  async byId(id: string): Promise<FreelaVacancy | null> {
    const res = await this.get(`/v1/bars-restaurants/public/vacancies/${encodeURIComponent(id)}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new FeedDownError();
    const body = (await this.json(res)) as { data?: unknown } | null;
    return parseItem(body?.data);
  }

  /** Vagas fixas abertas (todas numa chamada: o Freela tem ~50 abertas e o teto da rota é 100). Fora do ar → `FeedDownError(CLT_FEED_DOWN)`. */
  async recentClt(): Promise<FreelaFixedJob[]> {
    const down = () => new FeedDownError(CLT_FEED_DOWN);
    const res = await this.get('/v1/fixed-jobs/public/recent?limit=100').catch(() => Promise.reject(down()));
    if (!res.ok) throw down();
    const body = (await this.json(res).catch(() => Promise.reject(down()))) as { data?: unknown } | null;
    if (!body || !Array.isArray(body.data)) throw down();
    return body.data.map(parseCltItem).filter((v): v is FreelaFixedJob => v !== null);
  }

  /** Vaga fixa por id: 404 (fechada, vencida ou inexistente) → null; resposta fora do formato → null (não dá para conferir = não sai). */
  async cltById(id: string): Promise<FreelaFixedJob | null> {
    const down = () => new FeedDownError(CLT_FEED_DOWN);
    const res = await this.get(`/v1/fixed-jobs/public/${encodeURIComponent(id)}`).catch(() => Promise.reject(down()));
    if (res.status === 404) return null;
    if (!res.ok) throw down();
    const body = (await this.json(res).catch(() => Promise.reject(down()))) as { data?: unknown } | null;
    return parseCltItem(body?.data);
  }
}
