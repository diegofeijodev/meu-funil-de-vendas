import { ConflictException, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../common/database/prisma.service';
import { addDays, todaySp } from '../../common/time/dates';
import { WorkspaceAccessService } from '../access/access.service';
import { AssetsService } from '../media/assets.service';
import { bad, errMessage } from '../media/user-error';
import { fallbackKindOf } from './vacancy-display';
import { VacancyFeedClient } from './vacancy-feed';
import { ArtAiError, VacancyGeneratorService } from './vacancy-generator.service';
import { VacancyGate } from './vacancy-gate.service';
import { PREVIEW_STALE_MS, type PreviewState } from './vacancy-preview-state';
import { vacancyLink } from './vacancy-qr';
import { VacancySettingsService } from './vacancy-settings.service';
import { isTestText, shortDay, spParts, vacancyFields } from './vacancy-text';
import { cltFields } from './vacancy-clt';
import type { FreelaFixedJob, FreelaVacancy, SettingsRow } from './vacancy-types';

export const PREVIEW_TITLE = 'Prévia · story de vaga';
export const CLT_PREVIEW_TITLE = 'Prévia · story de vaga fixa';
const AI_TRIES = 3;
const MSG = {
  running: 'Já existe uma prévia sendo criada.',
  noTemplate: 'Envie a arte modelo antes de gerar a prévia.',
  failed: 'Não conseguimos criar a prévia. Tente de novo em alguns minutos.',
};

const json = (v: unknown) => v as Prisma.InputJsonValue;

/** Vaga de exemplo quando a vitrine não tem nenhuma aberta (ou está fora): Garçom, R$ 150, Campinas, no próximo sábado 18h–23h. */
export function sampleVacancy(now: Date): FreelaVacancy {
  const weekday = spParts(now.toISOString()).weekday;
  const day = addDays(todaySp(now), (6 - weekday + 7) % 7 || 7);
  return {
    id: 'exemplo', title: 'Garçom', serviceType: 'garcom', city: 'Campinas', date: day,
    startTime: new Date(`${day}T18:00:00-03:00`).toISOString(), endTime: new Date(`${day}T23:00:00-03:00`).toISOString(),
    amountInCents: 15000, contractorName: null, publishedAt: now.toISOString(), isUpcoming: true,
  };
}

/** Vaga fixa de exemplo quando a vitrine CLT não tem nenhuma que sirva (ou está fora): Atendente, R$ 1.874,32, São Paulo – SP. */
export function sampleFixedJob(now: Date): FreelaFixedJob {
  return {
    id: 'exemplo', title: 'Atendente', role: 'atendente', category: null, companyName: null, city: 'São Paulo', uf: 'SP',
    salary: { minInCents: 187432, maxInCents: 187432 }, workSchedule: '6x1, 10h às 18h20', workScheduleSlots: [],
    benefits: ['Vale-transporte', 'Refeição no local'], description: null, publishedAt: now.toISOString(), expiresAt: null,
  };
}

/** A vaga fixa mais recente da vitrine com salário e sem cara de teste. */
export function previewFixedJob(list: FreelaFixedJob[]): FreelaFixedJob | null {
  const ok = list.filter((v) => !!v.salary && !isTestText(v.companyName) && !isTestText(v.title) && !isTestText(v.role));
  return ok.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))[0] ?? null;
}

/** A vaga mais recente da vitrine que ainda vai acontecer, com valor e cidade (e sem cara de teste). */
export function previewVacancy(list: FreelaVacancy[]): FreelaVacancy | null {
  const ok = list.filter((v) => v.isUpcoming === true && !!v.amountInCents && !!(v.city ?? '').trim() && !isTestText(v.contractorName) && !isTestText(v.title));
  return ok.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))[0] ?? null;
}

/**
 * "Gerar prévia com uma vaga real" (D15): roda em segundo plano (promessa no processo; a API é uma instância só) e grava o andamento
 * em `settings.preview`. Usa a mesma arte dos stories (`makeArt`, até 3 tentativas + reserva), salva o resultado na Biblioteca e
 * nunca cria post. Não precisa do Instagram conectado nem da função ligada — só da arte modelo.
 */
@Injectable()
export class VacancyPreviewService {
  private readonly logger = new Logger(VacancyPreviewService.name);
  /** Relógio (os testes trocam). */
  now: () => number = () => Date.now();
  /** Prévia em andamento neste processo, por empresa. */
  private readonly running = new Map<string, { token: string; startedAt: number }>();
  private readonly jobs = new Map<string, Promise<void>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
    private readonly gate: VacancyGate,
    private readonly feed: VacancyFeedClient,
    private readonly settings: VacancySettingsService,
    private readonly generator: VacancyGeneratorService,
    private readonly assets: AssetsService,
  ) {}

  /**
   * Começa a prévia e responde logo. Outra em andamento há menos de 10 min (neste processo ou gravada como `running`) → 409;
   * `running` mais velha que isso travou (a API reiniciou no meio) e é sobrescrita — a rodada velha não grava mais nada (`run_id`).
   */
  async start(userId: string, ws: string, o: { qr?: boolean; kind?: 'diaria' | 'clt' } = {}): Promise<{ ok: true }> {
    this.gate.assert(ws);
    await this.access.require(userId, ws, 'write');
    const s = await this.settings.get(ws);
    const clt = o.kind === 'clt';
    // A vaga fixa não usa a arte modelo (a logo vem da marca).
    if (!clt && !s.template_asset_id) throw bad(MSG.noTemplate);
    // Daqui até reservar a vez não há `await`: dois pedidos ao mesmo tempo não passam juntos.
    const now = this.now();
    const mine = this.running.get(ws);
    const prev = (s.preview ?? {}) as unknown as Partial<PreviewState>;
    const prevStarted = typeof prev.started_at === 'string' ? Date.parse(prev.started_at) : NaN;
    if ((mine && now - mine.startedAt <= PREVIEW_STALE_MS) || (prev.status === 'running' && now - prevStarted <= PREVIEW_STALE_MS)) {
      throw new ConflictException({ code: 'CONFLICT', message: MSG.running });
    }
    const token = randomUUID();
    this.running.set(ws, { token, startedAt: now });
    const state: PreviewState = {
      run_id: token, status: 'running', step: 'art', attempt: 1, started_at: new Date(now).toISOString(), finished_at: null, media_url: null,
      asset_id: null, checks: [], attempts: [], used_fallback: false, fallback_kind: null, sample: false, vacancy: null, error: null,
      // P2: a prévia leva o QR quando pedido (mesmo com o interruptor desligado) ou quando ele já está ligado.
      qr: o.qr === true || s.qr_enabled ? { url: null, read_ok: false } : null,
      ...(clt ? { kind: 'clt' as const } : {}),
    };
    try {
      await this.prisma.vacancy_story_settings.update({ where: { workspace_id: ws }, data: { preview: json(state) } });
    } catch (e) {
      this.release(ws, token);
      throw e;
    }
    const job: Promise<void> = this.run(userId, ws, s, state)
      .catch((e) => this.logger.error(`[vagas] ${ws}: prévia ${token} falhou ao gravar: ${e instanceof Error ? e.message : String(e)}`))
      .finally(() => {
        this.release(ws, token);
        if (this.jobs.get(ws) === job) this.jobs.delete(ws);
      });
    this.jobs.set(ws, job);
    return { ok: true };
  }

  /** Espera a prévia em andamento da empresa terminar (testes e desligamento). */
  wait(ws: string): Promise<void> {
    return this.jobs.get(ws) ?? Promise.resolve();
  }

  private release(ws: string, token: string) {
    if (this.running.get(ws)?.token === token) this.running.delete(ws);
  }

  /** A prévia: escolhe a vaga, faz a arte (o `onStep` grava a etapa), salva na Biblioteca e grava o resultado — ou a falha. */
  private async run(userId: string, ws: string, s: SettingsRow, state: PreviewState): Promise<void> {
    // Só grava enquanto a prévia gravada for esta (`run_id`): uma travada sobrescrita não volta a escrever.
    const save = async () => {
      await this.prisma.vacancy_story_settings.updateMany({
        where: { workspace_id: ws, preview: { path: ['run_id'], equals: state.run_id } },
        data: { preview: json(state) },
      });
    };
    const finished = () => new Date(this.now()).toISOString();
    try {
      if (state.kind === 'clt') {
        await this.runClt(userId, ws, s, state, save);
        state.finished_at = finished();
        await save();
        return;
      }
      const { v, sample } = await this.pickVacancy(ws);
      const f = vacancyFields(v);
      state.sample = sample;
      state.vacancy = { funcao: f.funcao, estabelecimento: f.estabelecimento, valor: f.valor, dia: shortDay(v.startTime), horario: f.horario, cidade: f.cidade };
      await save();
      // Etapa a etapa; as da reserva (4 e 5) viram `fallback` na tentativa 3 (nunca "Tentativa 4 de 3"). Falha ao gravar a etapa não derruba a prévia.
      const art = await this.generator.makeArt(
        ws, s, f,
        async (step, n) => {
          state.step = n > AI_TRIES ? 'fallback' : step;
          state.attempt = Math.min(n, AI_TRIES);
          await save().catch((e) => this.logger.warn(`[vagas] ${ws}: etapa da prévia não gravada: ${e instanceof Error ? e.message : String(e)}`));
        },
        { qrUrl: state.qr ? vacancyLink(v.id) : null },
      );
      if (state.qr) state.qr = { url: art.qr?.url ?? null, read_ok: art.qr ? await this.generator.verifyQr(art.bytes, art.qr) : false };
      const asset = await this.assets.ingest({
        workspaceId: ws, kind: 'image', targetFormat: 'ig_story', normalize: false, source: art.origin.source, provider: art.origin.provider,
        bytes: art.bytes, mime: 'image/jpeg', title: PREVIEW_TITLE, brandId: s.brand_id, createdBy: userId,
      });
      Object.assign(state, {
        status: 'done', finished_at: finished(), media_url: asset.url, asset_id: asset.id, checks: art.check.fields, attempts: art.attempts,
        used_fallback: art.usedFallback, fallback_kind: art.usedFallback ? fallbackKindOf(art.attempts) : null, error: null,
      } satisfies Partial<PreviewState>);
    } catch (e) {
      // Erro da IA: a mensagem pronta (chave, crédito…) e as tentativas; o resto vira texto genérico e o detalhe vai para o log.
      if (e instanceof ArtAiError) Object.assign(state, { status: 'failed', error: e.message, attempts: e.attempts } satisfies Partial<PreviewState>);
      else {
        this.logger.error(`[vagas] ${ws}: prévia falhou: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
        Object.assign(state, { status: 'failed', error: errMessage(e, MSG.failed) } satisfies Partial<PreviewState>);
      }
      state.finished_at = finished();
    }
    await save();
  }

  /** Prévia "Vaga fixa CLT": a vaga fixa mais recente que serve (ou a de exemplo), a arte CLT e o QR só com a página no ar. */
  private async runClt(userId: string, ws: string, s: SettingsRow, state: PreviewState, save: () => Promise<void>): Promise<void> {
    let list: FreelaFixedJob[] = [];
    try {
      list = await this.feed.recentClt();
    } catch (e) {
      this.logger.warn(`[vagas] ${ws}: vitrine CLT fora na prévia, usando a vaga fixa de exemplo: ${e instanceof Error ? e.message : String(e)}`);
    }
    const found = previewFixedJob(list);
    const v = found ?? sampleFixedJob(new Date(this.now()));
    const f = cltFields(v);
    state.sample = !found;
    state.vacancy = { funcao: f.cargo, estabelecimento: f.empresa, valor: f.salario, dia: 'Vaga fixa', horario: f.escala ?? '', cidade: f.cidade ?? '' };
    await save();
    const art = await this.generator.makeCltArt(
      ws, s, f,
      async (step, n) => {
        state.step = n > AI_TRIES ? 'fallback' : step;
        state.attempt = Math.min(n, AI_TRIES);
        await save().catch((e) => this.logger.warn(`[vagas] ${ws}: etapa da prévia não gravada: ${e instanceof Error ? e.message : String(e)}`));
      },
      { qrUrl: state.qr ? this.feed.fixedJobQrLink(v.id) : null },
    );
    if (state.qr) state.qr = { url: art.qr?.url ?? null, read_ok: art.qr ? await this.generator.verifyQr(art.bytes, art.qr) : false };
    const asset = await this.assets.ingest({
      workspaceId: ws, kind: 'image', targetFormat: 'ig_story', normalize: false, source: art.origin.source, provider: art.origin.provider,
      bytes: art.bytes, mime: 'image/jpeg', title: CLT_PREVIEW_TITLE, brandId: s.brand_id, createdBy: userId,
    });
    Object.assign(state, {
      status: 'done', media_url: asset.url, asset_id: asset.id, checks: art.check.fields, attempts: art.attempts,
      used_fallback: art.usedFallback, fallback_kind: art.usedFallback ? fallbackKindOf(art.attempts) : null, error: null,
    } satisfies Partial<PreviewState>);
  }

  /** A vaga mais recente da vitrine que serve; nenhuma (ou vitrine fora) → a vaga de exemplo. */
  private async pickVacancy(ws: string): Promise<{ v: FreelaVacancy; sample: boolean }> {
    let list: FreelaVacancy[] = [];
    try {
      list = await this.feed.recent();
      // B6: a mesma consulta preenche as cidades sugeridas nos Ajustes (antes de ligar, o job ainda não consultou).
      await this.settings.refreshRecentCities(ws, list);
    } catch (e) {
      this.logger.warn(`[vagas] ${ws}: vitrine fora na prévia, usando a vaga de exemplo: ${e instanceof Error ? e.message : String(e)}`);
    }
    const v = previewVacancy(list);
    return v ? { v, sample: false } : { v: sampleVacancy(new Date(this.now())), sample: true };
  }
}
