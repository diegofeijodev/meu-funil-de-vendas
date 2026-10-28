import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { ENV } from '../../common/config/env.module';
import type { Env } from '../../common/config/env.validation';
import { overrideBase } from '../../common/config/test-overrides';
import type { FreelaVacancy } from './vacancy-types';

export const FREELA_VACANCIES_FETCH = Symbol('FREELA_VACANCIES_FETCH');
export type FreelaFetch = (url: string, init?: RequestInit) => Promise<Response>;

export class FeedDownError extends Error {
  constructor(message = 'Não conseguimos consultar as vagas do Freela.') {
    super(message);
    this.name = 'FeedDownError';
  }
}

const TIMEOUT_MS = 15_000;
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
  publishedAt: z.string().min(1),
  isUpcoming: z.boolean().optional(),
});

function parseItem(raw: unknown): FreelaVacancy | null {
  const r = itemSchema.safeParse(raw);
  return r.success ? (r.data as FreelaVacancy) : null;
}

/** Leitura da vitrine pública do Freela (vagas recentes e vaga por id). */
@Injectable()
export class VacancyFeedClient {
  private readonly base: string;

  constructor(
    @Inject(ENV) env: Pick<Env, 'NODE_ENV' | 'FREELA_PUBLIC_API_URL'>,
    @Inject(FREELA_VACANCIES_FETCH) private readonly fetchFn: FreelaFetch,
  ) {
    this.base = overrideBase(env, env.FREELA_PUBLIC_API_URL, DEFAULT_BASE);
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
}
