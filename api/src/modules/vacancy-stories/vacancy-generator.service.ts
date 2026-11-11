import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/database/prisma.service';
import { AiService } from '../ai/ai.service';
import type { AiImageInput, AiVendor } from '../ai/ai.types';
import { RefsService } from '../creative/refs.service';
import { FilesService } from '../files/files.service';
import { IgStore, leaseFree } from '../instagram/ig-store.service';
import { AssetsService, MEDIA_BUCKET, type MediaAsset } from '../media/assets.service';
import { ImageService } from '../media/image.service';
import { bad, errMessage } from '../media/user-error';
import { loadBadges } from './vacancy-art';
import { composeBaseArt, loadBaseFonts } from './vacancy-base-art';
import { VacancyFeedClient } from './vacancy-feed';
import { VacancyGate } from './vacancy-gate.service';
import { VACANCY_CLOSED_REASON, WAIT_CAP } from './vacancy-reasons';
import { photoPrompt, photoReadPrompt } from './vacancy-prompts';
import { fingerprint, shortDay, vacancyFields } from './vacancy-text';
import { forcedTriage, triage } from './vacancy-triage';
import type { ArtCheck, ArtRead, AttemptLog, FieldCheck, FieldKey, FreelaVacancy, SettingsRow, StoryRow, VacancyFields } from './vacancy-types';
import { FIELD_LABELS, READ_SCHEMA } from './vacancy-verify';

/** Sem conta conectada o gerador não cria arte (A6): a linha espera com este apoio. */
export const NO_ACCOUNT_WAIT = 'Esperando o Instagram ser reconectado para criar a arte.';
/** `handOff` perdeu a linha (desligaram no meio): nada foi entregue. */
export const HANDOFF_LOST = 'lost';

const MIN = 60_000;
const LEASE_MS = 15 * MIN;
const RETRY_MS = 10 * MIN;
/** Linhas que começam a gerar por rodada do job (no total, como o `production.service`). */
const PER_TICK = 2;
/** Tentativas da foto da IA antes de a arte sair sem foto. */
const AI_TRIES = 2;
/** Espera depois de erro da IA (D9): 5 → 15 → 45 min, e fica em 45. */
const AI_BACKOFF_MIN = [5, 15, 45];
const QUEUE = ['new', 'waiting'];
const TEMPLATE_BUCKET = 'creative-assets';
const TEMPLATE_MISSING = 'A arte modelo não foi encontrada. Envie a arte modelo de novo em Ajustes.';
/** Erro de IA sem mensagem pronta (resposta fora do formato, imagem ilegível): o detalhe fica no log. */
export const AI_UNUSABLE = 'A IA não devolveu uma arte que dê para usar. Tentamos de novo sozinhos em alguns minutos.';
/** Falha que não é da IA e não tem mensagem pronta (banco, disco): o detalhe fica no log. */
const RETRY_REASON = 'Não conseguimos criar a arte agora. Vamos tentar de novo em alguns minutos.';

export type ArtOrigin = { source: 'chatgpt' | 'gemini' | 'other'; provider: string };
/** Arte pronta (quadro 1080×1920 JPEG), a conferência da tentativa aceita, todas as tentativas e de onde a imagem veio. */
export type ArtResult = { bytes: Uint8Array; check: ArtCheck; attempts: AttemptLog[]; usedFallback: boolean; vendorLabel: string; origin: ArtOrigin };

const VENDORS: Record<AiVendor, { label: string; origin: ArtOrigin }> = {
  openai: { label: 'ChatGPT (OpenAI)', origin: { source: 'chatgpt', provider: 'chatgpt' } },
  gemini: { label: 'Gemini (Google)', origin: { source: 'gemini', provider: 'gemini' } },
};
/** Reserva sem foto: tudo desenhado pelo sistema (D8). */
const SYSTEM = { label: 'Sistema (sem IA)', origin: { source: 'other', provider: 'sistema' } as ArtOrigin };

/** Campos da arte escrita pelo sistema: todos conferem (o texto vem direto da vaga). */
function systemFields(f: VacancyFields): FieldCheck[] {
  const hour = f.horario;
  const one = (key: FieldKey, v: string | null): FieldCheck => ({ key, label: FIELD_LABELS[key], ok: true, read: v, expected: v });
  return [one('funcao', f.funcao), one('estabelecimento', f.estabelecimento), one('cidade', f.cidade), one('valor', f.valor), one('data', f.data), one('inicio', hour), one('fim', hour)];
}

/** Textos que a leitura achou na foto e que a reprovam: qualquer bloco com 3+ letras ou dígitos (placa, fachada, logo, uniforme). */
export function photoTexts(read: ArtRead): string[] {
  return (read.textos ?? [])
    .map((t) => String(t ?? '').trim())
    .filter((t) => t.replace(/[^\p{L}\p{N}]/gu, '').length >= 3)
    // a leitura às vezes responde com uma frase em vez de lista vazia ("nenhum texto visível")
    .filter((t) => !/^(n[aã]o h[aá]|nenhum|sem) .*(texto|escrit)/i.test(t) && !/^(n\/a|nada|null|none)$/i.test(t));
}

/** A IA falhou (chave, crédito, fora do ar, resposta ilegível) antes de existir uma arte aprovada ou de reserva (D9). */
export class ArtAiError extends Error {
  constructor(message: string, readonly attempts: AttemptLog[] = []) {
    super(message);
    this.name = 'ArtAiError';
  }
}

/** Pontos que a Task 10 liga (limite do dia e agenda depois da entrega). Ausente = a etapa não roda. */
export type VacancyGeneratorHooks = {
  /** Limite do dia: devolve até quando a linha espera (início da janela do dia seguinte) se a empresa já atingiu o limite; `null` = pode gerar. */
  capacityWait?: (row: StoryRow, s: SettingsRow, now: Date) => Promise<Date | null>;
  /**
   * A4 — antes de gastar IA, com a data VIVA da vaga na linha: o story ainda tem como ir ao ar? Devolve o motivo (a linha vira
   * `expired`) ou `null` (pode gerar).
   */
  beforeGenerate?: (row: StoryRow, s: SettingsRow, now: Date) => Promise<string | null>;
  /**
   * Depois da entrega (modo "postar sozinho" → agenda o post). Decida pelo PRÓPRIO post (`status`/`creative_brief.vacancy.
   * requires_approval`), não pelo modo da empresa: reserva reprovada pela leitura sai `pending_approval` mesmo no modo sozinho (R22).
   * Falha aqui não desfaz a entrega.
   */
  afterHandOff?: (ws: string, postId: string) => Promise<unknown>;
};

type Outcome = 'handed' | 'waiting' | 'cancelled' | 'lost';
/** A linha não é mais nossa (desligaram, ou outro processo a pegou depois de o lease vencer): para tudo sem gravar nada. */
class LeaseLost extends Error {}

/**
 * Lease da linha durante a geração (molde do `PostLease`): renovado antes de cada chamada da IA e antes da entrega — uma linha pode
 * passar de 15 min (até 4 imagens e 5 leituras). Renovação perdida → `LeaseLost`. Toda escrita na linha é condicionada a ele.
 */
class RowLease {
  constructor(
    private readonly prisma: PrismaService,
    readonly id: string,
    public until: Date,
    private readonly clock: () => number,
  ) {}

  /** `extra`: o que gravar junto (a tentativa em andamento, R28), na mesma escrita condicionada ao lease. */
  async renew(extra: Prisma.vacancy_storiesUpdateManyMutationInput = {}): Promise<void> {
    const next = new Date(this.clock() + LEASE_MS);
    const got = await this.prisma.vacancy_stories.updateMany({ where: { id: this.id, status: 'generating', lease_until: this.until }, data: { ...extra, lease_until: next } });
    if (!got.count) throw new LeaseLost();
    this.until = next;
  }

  /** Grava só se a linha ainda é nossa (`generating` com o nosso `lease_until`). */
  async write(data: Prisma.vacancy_storiesUpdateManyMutationInput): Promise<boolean> {
    const r = await this.prisma.vacancy_stories.updateMany({ where: { id: this.id, status: 'generating', lease_until: this.until }, data });
    return r.count > 0;
  }
}

const json = (v: unknown) => v as Prisma.InputJsonValue;
const noPeriod = (s: string) => s.trim().replace(/[.\s]+$/, '');

/** Resposta da leitura às cegas no formato `ArtRead`; fora do formato = erro de IA (lança). */
function asRead(raw: unknown): ArtRead {
  const r = raw as Record<string, unknown> | null;
  if (!r || typeof r !== 'object' || !Array.isArray(r['textos'])) throw new Error('leitura da arte fora do formato');
  const str = (k: string) => (typeof r[k] === 'string' ? (r[k] as string) : null);
  return {
    textos: (r['textos'] as unknown[]).filter((t): t is string => typeof t === 'string'),
    funcao: str('funcao'),
    estabelecimento: str('estabelecimento'),
    data: str('data'),
    inicio: str('inicio'),
    fim: str('fim'),
    valor: str('valor'),
    cidade: str('cidade'),
  };
}

/**
 * Geração dos stories das vagas: pega a linha (lease), confere a vaga na vitrine, faz a arte com a IA (modelo como referência),
 * confere o texto lendo a imagem às cegas, cai na reserva quando a IA erra 3 vezes e entrega o post à fila do Instagram.
 */
@Injectable()
export class VacancyGeneratorService {
  private readonly logger = new Logger(VacancyGeneratorService.name);
  /** Ganchos da Task 10 (trocados pelo `VacancySchedulerService` no `onModuleInit`). */
  readonly hooks: VacancyGeneratorHooks = {};
  /** Relógio dos leases (o `now` da rodada só escolhe as candidatas); os testes trocam. */
  now: () => number = () => Date.now();

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly images: ImageService,
    private readonly files: FilesService,
    private readonly assets: AssetsService,
    private readonly refs: RefsService,
    private readonly store: IgStore,
    private readonly feed: VacancyFeedClient,
    private readonly gate: VacancyGate,
  ) {}

  /**
   * Rodada do job: até 2 linhas (no total) começam a gerar, as de início mais próximo. Empresa sem Instagram conectado não gera (a
   * linha diz por quê); empresa no limite do dia espera a vez (gancho da Task 10).
   */
  async generateDue(now = new Date()): Promise<{ started: number; handed: number; waiting: number; cancelled: number }> {
    const out = { started: 0, handed: 0, waiting: 0, cancelled: 0 };
    const active = new Map(
      (await this.prisma.vacancy_story_settings.findMany({ where: { enabled: true } }))
        .filter((s) => this.gate.allowed(s.workspace_id))
        .map((s) => [s.workspace_id, s]),
    );
    if (!active.size) return out;
    const due = await this.prisma.vacancy_stories.findMany({
      where: {
        workspace_id: { in: [...active.keys()] },
        status: { in: QUEUE },
        AND: [
          { OR: [{ next_attempt_at: null }, { next_attempt_at: { lte: now } }] },
          { OR: [{ not_before: null }, { not_before: { lte: now } }] },
          leaseFree(now),
        ],
      },
      orderBy: { starts_at: 'asc' },
      take: 100,
    });
    const live = new Map<string, boolean>();
    const free = (id: string) => ({ id, status: { in: QUEUE }, ...leaseFree(now) });
    for (const row of due) {
      if (out.started >= PER_TICK) break;
      const ws = row.workspace_id;
      const s = active.get(ws)!;
      if (!live.has(ws)) live.set(ws, !!(await this.store.liveAccount(ws)));
      if (!live.get(ws)) {
        if (row.wait_reason !== NO_ACCOUNT_WAIT) await this.prisma.vacancy_stories.updateMany({ where: free(row.id), data: { wait_reason: NO_ACCOUNT_WAIT } });
        continue;
      }
      const capUntil = this.hooks.capacityWait ? await this.hooks.capacityWait(row, s, now) : null;
      if (capUntil) {
        const r = await this.prisma.vacancy_stories.updateMany({ where: free(row.id), data: { status: 'waiting', wait_reason: WAIT_CAP, not_before: capUntil } });
        out.waiting += r.count;
        continue;
      }
      // O lease conta do relógio de agora (a 2ª linha da rodada começa depois da 1ª), não do `now` da rodada.
      const lease = new RowLease(this.prisma, row.id, new Date(this.now() + LEASE_MS), () => this.now());
      // `mismatch_attempts` zera ao pegar a linha: durante a geração é o contador ao vivo da tentativa (R28 — a tela mostra +1).
      const got = await this.prisma.vacancy_stories.updateMany({ where: free(row.id), data: { status: 'generating', lease_until: lease.until, wait_reason: null, mismatch_attempts: 0 } });
      if (!got.count) continue;
      out.started++;
      const leased: StoryRow = { ...row, status: 'generating', lease_until: lease.until, wait_reason: null, mismatch_attempts: 0 };
      let r: Outcome;
      try {
        r = await this.generateOne(leased, lease, s, now);
      } catch (e) {
        if (e instanceof LeaseLost) r = 'lost';
        else {
          // Falha que não é da IA (arte modelo sumiu, banco, disco): solta a linha com o motivo e tenta de novo daqui a 10 min.
          this.logger.error(`[vagas] ${ws}: geração da linha ${row.id} falhou: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
          const reason = errMessage(e, RETRY_REASON);
          r = (await lease.write({ status: 'waiting', lease_until: null, next_attempt_at: new Date(now.getTime() + RETRY_MS), wait_reason: reason })) ? 'waiting' : 'lost';
        }
      }
      if (r !== 'lost') out[r]++;
    }
    return out;
  }

  /** Uma linha com o lease na mão. `LeaseLost` (renovação perdida) sobe para o `generateDue`, que conta como perdida. */
  private async generateOne(row: StoryRow, lease: RowLease, s: SettingsRow, now: Date): Promise<Outcome> {
    let v: FreelaVacancy | null;
    try {
      v = await this.feed.byId(row.external_id);
    } catch (e) {
      // Vitrine fora do ar: não é culpa da vaga nem da IA — volta a esperar, sem gastar nada.
      this.logger.warn(`[vagas] ${row.workspace_id}: vitrine fora ao conferir ${row.external_id}: ${e instanceof Error ? e.message : String(e)}`);
      return (await lease.write({ status: 'waiting', lease_until: null, next_attempt_at: new Date(now.getTime() + RETRY_MS) })) ? 'waiting' : 'lost';
    }
    if (!v) return (await lease.write({ status: 'cancelled', skip_reason: VACANCY_CLOSED_REASON, lease_until: null })) ? 'cancelled' : 'lost';
    const fp = fingerprint(v);
    if (fp !== row.fingerprint) {
      // A vaga mudou desde a triagem: a arte sai com os dados novos.
      const starts = new Date(v.startTime);
      if (!(await lease.write({ snapshot: json(v), fingerprint: fp, starts_at: starts }))) return 'lost';
      row = { ...row, snapshot: v as unknown as StoryRow['snapshot'], fingerprint: fp, starts_at: starts };
    }
    // C1: a triagem roda de novo na vaga VIVA (valor apagado, cidade fora da lista, "teste" no nome, em cima da hora). A linha `forced`
    // ("Criar story mesmo assim", R30) só confere valor, cidade e antecedência.
    const t = row.forced ? forcedTriage(v, s, now) : triage(v, s, now);
    if (t.status === 'skipped') return (await lease.write({ status: 'skipped', skip_reason: t.reason, lease_until: null })) ? 'cancelled' : 'lost';
    // A4: sem como ir ao ar (prazo de aprovação passado, ou nenhum horário livre a tempo) → não gera a arte.
    const late = await this.hooks.beforeGenerate?.(row, s, now);
    if (late) return (await lease.write({ status: 'expired', skip_reason: late, lease_until: null })) ? 'cancelled' : 'lost';
    let art: ArtResult;
    try {
      // `onStep` vem antes de cada chamada da IA: renova o lease (perdeu → `LeaseLost`, nada é gravado) e, na arte da tentativa n ≤ 3,
      // grava n − 1 em `mismatch_attempts` (R28: as anteriores foram reprovadas; os passos da reserva não mexem — fica em 2).
      art = await this.makeArt(row.workspace_id, s, vacancyFields(v), (step, n) =>
        lease.renew(step === 'art' && n <= AI_TRIES ? { mismatch_attempts: n - 1 } : {}),
      );
    } catch (e) {
      if (!(e instanceof ArtAiError)) throw e;
      return (await this.recordAiError(row, lease, e, now)) ? 'waiting' : 'lost';
    }
    await lease.renew();
    if ((await this.handOff({ ...row, lease_until: lease.until }, s, art, v)) === HANDOFF_LOST) return 'lost';
    // A arte saiu sem foto porque a IA falhou (chave, crédito, queda): o story vai assim mesmo, mas o aviso vermelho fica para o dono.
    const aiError = art.attempts.find((a) => a.error)?.error;
    if (aiError) await this.prisma.vacancy_story_settings.updateMany({ where: { workspace_id: row.workspace_id }, data: { ai_error: aiError, ai_error_at: now } });
    return 'handed';
  }

  /**
   * D9: linha volta a esperar 5/15/45 min com o motivo; a configuração guarda a última falha para o aviso vermelho (só se a linha
   * ainda era nossa — desligaram no meio = nada muda).
   */
  private async recordAiError(row: StoryRow, lease: RowLease, e: ArtAiError, now: Date): Promise<boolean> {
    const n = row.ai_error_count + 1;
    const wait = AI_BACKOFF_MIN[Math.min(n - 1, AI_BACKOFF_MIN.length - 1)]!;
    const ok = await lease.write({
      status: 'waiting',
      lease_until: null,
      ai_error_count: n,
      next_attempt_at: new Date(now.getTime() + wait * MIN),
      // A mensagem genérica já é uma frase completa para a fila; a do provedor (chave, crédito) ganha o prefixo.
      wait_reason: e.message === AI_UNUSABLE ? AI_UNUSABLE : `A IA não conseguiu criar a arte: ${noPeriod(e.message)}.`,
      attempts_log: json(e.attempts),
    });
    if (ok) await this.prisma.vacancy_story_settings.updateMany({ where: { workspace_id: row.workspace_id }, data: { ai_error: e.message, ai_error_at: now } });
    return ok;
  }

  // ------------------------------------------------------------------ arte

  /**
   * Arte do story no layout da arte modelo, desenhada pelo SISTEMA (`composeBaseArt`): todo texto é nosso, então nunca sai errado.
   * A IA só faz a foto do canto (até 2 tentativas); a leitura às cegas confere se a foto não trouxe texto, placa ou logo. Foto com
   * erro de IA ou reprovada nas 2 → a mesma arte sem foto (`usedFallback`), que não depende de IA. `onStep` vem antes de cada
   * chamada da IA (a prévia mostra a etapa; a geração renova o lease) e um erro dele sobe como está.
   */
  async makeArt(
    ws: string,
    s: SettingsRow,
    f: VacancyFields,
    onStep?: (step: 'art' | 'check', attempt: number) => Promise<void>,
  ): Promise<ArtResult> {
    const vendor: AiVendor = s.vendor === 'gemini' ? 'gemini' : 'openai';
    const badges = loadBadges();
    const fonts = loadBaseFonts();
    const logo = (await this.refs.loadLogo(ws, s.brand_id)) ?? (await this.templateLogo(ws, s));
    const attempts: AttemptLog[] = [];
    const log = (n: number, kind: AttemptLog['kind'], ok: boolean, forbidden: string[], error?: string) =>
      attempts.push({ n, at: new Date().toISOString(), kind, ok, wrong: [], forbidden: forbidden.map((x) => x.slice(0, 120)), ...(error ? { error } : {}) });
    // Os textos são escritos pelo sistema a partir da vaga: todos os campos estão certos por construção.
    const fields = systemFields(f);

    for (let n = 1; n <= AI_TRIES; n++) {
      await onStep?.('art', n);
      let photo: Uint8Array;
      try {
        photo = (await this.ai.image(ws, { prompt: photoPrompt(f.funcao), aspectRatio: '1:1', vendor, strict: true })).bytes;
      } catch (e) {
        log(n, 'ai', false, [], this.aiMessage(ws, e));
        break; // IA fora (chave, crédito, queda): não insiste; a arte sai sem foto
      }
      await onStep?.('check', n);
      let found: string[];
      try {
        found = photoTexts(await this.readPhoto(ws, photo));
      } catch (e) {
        log(n, 'ai', false, [], this.aiMessage(ws, e));
        break;
      }
      log(n, 'ai', found.length === 0, found);
      if (found.length === 0) {
        const bytes = await composeBaseArt(this.images, { fields: f, photo, logo, badges, fonts });
        const check: ArtCheck = { ok: true, fields, forbidden: [], hint: null };
        return { bytes, check, attempts, usedFallback: false, vendorLabel: VENDORS[vendor].label, origin: VENDORS[vendor].origin };
      }
    }

    const bytes = await composeBaseArt(this.images, { fields: f, photo: null, logo, badges, fonts });
    log(AI_TRIES + 1, 'fallback_plain', true, []);
    return { bytes, check: { ok: true, fields, forbidden: [], hint: null }, attempts, usedFallback: true, vendorLabel: SYSTEM.label, origin: SYSTEM.origin };
  }

  /** Leitura às cegas da foto da IA (reduzida a 1024 px): só interessa a lista de textos visíveis. */
  private async readPhoto(ws: string, photo: Uint8Array): Promise<ArtRead> {
    const small = await this.images.shrink(photo, 1024);
    return asRead(await this.ai.json(ws, { name: 'vacancy_art_read', prompt: photoReadPrompt(), schema: READ_SCHEMA, images: [small] }));
  }

  /** Sem logo na marca: recorta a logo do canto de cima da arte modelo (2%–38% da largura, 2%–17% da altura). Sem modelo, sem logo. */
  private async templateLogo(ws: string, s: SettingsRow): Promise<Uint8Array | null> {
    try {
      const t = await this.images.read((await this.loadTemplate(ws, s)).bytes);
      const w = t.bitmap.width as number;
      const h = t.bitmap.height as number;
      t.crop({ x: Math.round(w * 0.02), y: Math.round(h * 0.02), w: Math.round(w * 0.36), h: Math.round(h * 0.15) });
      return await this.images.encode(t, true);
    } catch {
      return null;
    }
  }

  /** Mensagem pt-BR do erro da IA (a do provedor quando houver); o resto vira texto genérico e o detalhe vai para o log. */
  private aiMessage(ws: string, e: unknown): string {
    this.logger.warn(`[vagas] ${ws}: IA falhou na arte: ${e instanceof Error ? e.message : String(e)}`);
    return errMessage(e, AI_UNUSABLE);
  }

  /** Arte modelo da empresa (arquivo do próprio workspace), reduzida a 1024 px para a referência da IA. */
  private async loadTemplate(ws: string, s: SettingsRow): Promise<AiImageInput> {
    const a = s.template_asset_id
      ? await this.prisma.brand_assets.findFirst({ where: { id: s.template_asset_id, workspace_id: ws }, select: { storage_path: true } })
      : null;
    if (!a?.storage_path || !this.files.keyBelongsToWorkspace(a.storage_path, ws)) throw bad(TEMPLATE_MISSING);
    let bytes: Buffer;
    try {
      bytes = await this.files.read(TEMPLATE_BUCKET, a.storage_path);
    } catch {
      throw bad(TEMPLATE_MISSING);
    }
    return this.images.shrink(new Uint8Array(bytes), 1024);
  }

  private async brandColor(ws: string, brandId: string | null): Promise<string> {
    if (!brandId) return '';
    const b = await this.prisma.brands.findFirst({ where: { id: brandId, workspace_id: ws }, select: { primary_color: true } });
    return b?.primary_color ?? '';
  }

  // ------------------------------------------------------------------ entrega

  /**
   * Entrega: salva a mídia (fora da transação) e, numa transação condicionada ao lease, cria o `ig_post` de vaga, liga a mídia e
   * marca a linha `handed_off`. Se a linha deixou de ser nossa (desligaram no meio), desfaz tudo, apaga a mídia e devolve `'lost'`.
   * Devolve o id do post; depois chama o gancho `afterHandOff` (Task 10).
   */
  async handOff(row: StoryRow, s: SettingsRow, art: ArtResult, v: FreelaVacancy): Promise<string> {
    const ws = row.workspace_id;
    const ours = { id: row.id, workspace_id: ws, status: 'generating', lease_until: row.lease_until };
    // Atalho: desligaram durante a geração → nem salva a mídia.
    if (!row.lease_until || !(await this.prisma.vacancy_stories.count({ where: ours }))) return HANDOFF_LOST;
    const f = vacancyFields(v);
    const theme = `Vaga · ${f.funcao} · ${f.estabelecimento ?? f.cidade} · ${shortDay(v.startTime)}`;
    // O modo pode ter mudado durante a geração: vale o de agora. Reserva que a leitura reprovou (texto proibido, R22) ou que a leitura
    // nem conseguiu conferir (erro na última leitura, T9) nunca vai ao ar sozinha: espera aprovação mesmo no modo "postar sozinho".
    const autoMode = (await this.prisma.vacancy_story_settings.findUnique({ where: { workspace_id: ws }, select: { auto_publish: true } }))?.auto_publish ?? s.auto_publish;
    const unread = art.usedFallback && !!art.attempts[art.attempts.length - 1]?.error;
    const unchecked = unread || (art.usedFallback && !art.check.ok);
    const auto = autoMode && !unchecked;
    const asset = await this.assets.ingest({
      workspaceId: ws, kind: 'image', targetFormat: 'ig_story', normalize: false, source: art.origin.source, provider: art.origin.provider,
      bytes: art.bytes, mime: 'image/jpeg', title: theme, brandId: s.brand_id,
    });
    const media = [{
      url: asset.url, type: 'image', order: 0, width: asset.width, height: asset.height, duration: null, asset_id: asset.id, ig_ready: asset.ig_ready,
    }];
    const aiTries = art.attempts.filter((a) => a.kind === 'ai').length;
    // A3: na reserva que a leitura reprovou, o que ela achou (Aprovações e a aba Vagas avisam em vez de "✓ Conferido"). R40/M3: na que
    // a leitura nem conseguiu ler, `check_unread` (a tela diz que a conferência não leu a arte, também no lugar do "✓ Conferido").
    const alert = art.usedFallback && !art.check.ok && art.check.forbidden.length ? art.check.forbidden : null;
    const vacancy = {
      story_id: row.id, external_id: row.external_id, fingerprint: fingerprint(v), requires_approval: !auto,
      checked_fields: art.check.fields.filter((x) => x.ok).map((x) => x.key), attempts: aiTries, used_fallback: art.usedFallback,
      check_alert: alert, check_unread: unread, starts_at: v.startTime,
    };
    // D12: no post só o resumo de cada tentativa; o detalhe fica em `vacancy_stories.attempts_log`.
    const shortLog = art.attempts.map((a) => ({ at: a.at, step: 'vacancy_art', attempt: a.n, ok: a.ok, wrong: a.wrong, fallback: a.kind !== 'ai' }));
    const mismatches = art.attempts.filter((a) => a.kind === 'ai' && !a.ok && !a.error).length;
    let postId: string;
    try {
      postId = await this.prisma.$transaction(async (tx) => {
        const post = await tx.ig_posts.create({
          data: {
            workspace_id: ws, format: 'story_image', source: 'vacancy', status: auto ? 'ready' : 'pending_approval', theme, caption: null,
            hashtags: [], creative_brief: json({ compose: false, vacancy }), media: json(media), ai_provider: art.origin.provider,
            ai_generation_log: json(shortLog), automation: null, plan_id: null, run_id: null,
          },
          select: { id: true },
        });
        await tx.media_assets.updateMany({ where: { id: asset.id, workspace_id: ws }, data: { ig_post_id: post.id } });
        const done = await tx.vacancy_stories.updateMany({
          where: ours,
          data: {
            status: 'handed_off', ig_post_id: post.id, attempts_log: json(art.attempts), used_fallback: art.usedFallback, mismatch_attempts: mismatches,
            template_asset_id: s.template_asset_id, lease_until: null, wait_reason: null, next_attempt_at: null, ai_error_count: 0,
          },
        });
        if (!done.count) throw new LeaseLost();
        // Um story entregue apaga o aviso vermelho da IA (D9).
        await tx.vacancy_story_settings.updateMany({ where: { workspace_id: ws, ai_error: { not: null } }, data: { ai_error: null, ai_error_at: null } });
        return post.id;
      });
    } catch (e) {
      await this.dropAsset(ws, asset);
      if (e instanceof LeaseLost) return HANDOFF_LOST;
      throw e;
    }
    try {
      await this.hooks.afterHandOff?.(ws, postId);
    } catch (e) {
      // O post já existe; a agenda reconcilia na próxima rodada (Task 10).
      this.logger.warn(`[vagas] ${ws}: depois da entrega do post ${postId}: ${e instanceof Error ? e.message : String(e)}`);
    }
    return postId;
  }

  /** Mídia salva para um post que não foi criado: sai da Biblioteca e do disco. */
  private async dropAsset(ws: string, asset: MediaAsset): Promise<void> {
    await this.prisma.media_assets.deleteMany({ where: { id: asset.id, workspace_id: ws } }).catch((e) => this.logger.warn(`[vagas] mídia ${asset.id} não apagada: ${e}`));
    if (asset.storage_path) await this.files.delete(MEDIA_BUCKET, asset.storage_path).catch((e) => this.logger.warn(`[vagas] arquivo ${asset.storage_path} não apagado: ${e}`));
  }
}
