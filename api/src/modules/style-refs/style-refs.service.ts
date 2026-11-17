/**
 * Estilo das artes (Fatias 5 e 6, spec §2.3 + §0.8 #5): referências enviadas, Pins colados e pastas/perfis públicos do Pinterest
 * acompanhados pelo RSS. Cada referência vira NOTAS DE ESTILO em texto (IA de visão); a imagem fica guardada só para a tela
 * (bucket `style-refs`, ≤ 1024 px) e nunca vai ao gerador, à Biblioteca, à Meta ou ao Instagram.
 */
import { BadRequestException, Inject, Injectable, Logger, NotFoundException, OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { ENV } from '../../common/config/env.module';
import type { Env } from '../../common/config/env.validation';
import { todaySp } from '../../common/time/dates';
import { PrismaService } from '../../common/database/prisma.service';
import { isUniqueViolation } from '../../common/database/next-version';
import { WorkspaceAccessService } from '../access/access.service';
import { AiKeysFailedError } from '../ai/ai-error';
import { AiCreditAlertsService } from '../ai/ai-credit-alerts.service';
import { AiKeysService } from '../ai/ai-keys.service';
import { AiService } from '../ai/ai.service';
import { FilesService } from '../files/files.service';
import { EXTERNAL_FETCH, ExternalFetch } from '../media/external-fetch';
import { ImageService } from '../media/image.service';
import { isPinImageHost, isPinterestHost, ogImage, parsePinterestLink, parseRss, pinImageFromOembed, rssTitle } from './pinterest';
import { normalizeText, STYLE_CATEGORY_LABEL } from './categories';
import { KeyedQueue } from './keyed-queue';
import { SELECTION_CATALOG, SELECTION_OPTIONS, selectionLabel } from './selection-catalog';
import { chooseNotes, PickedNote, PickRow, resolveSelectionBranch } from './style-pick';
import { MAX_NOTES, normalizeStyleNotes, notesSummary, PhotoStyle, STYLE_NOTES_PROMPT, STYLE_NOTES_SCHEMA, StyleNotes, StylePick, StyleRefsUsed, styleNotesText } from './style-notes';

const BUCKET = 'style-refs';
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_PAGE_BYTES = 2 * 1024 * 1024;
const MAX_SIDE = 1024;
export const BRAND_CAP = 30;
export const CAMPAIGN_CAP = 8;
const LIST_ALL_CAP = 200;
/** Cota diária de leitura da Seleção por marca (P21′): `daily_left` da vista = 12 menos as de hoje. */
const SELECTION_DAILY_NEW = 12;
/** Teto da Seleção por marca e quanto cada `sync` de pasta traz (P21′). */
const SELECTION_MAX = 12;
const SELECTION_PER_SYNC = 4;
/** Pastas PRÓPRIAS acompanhadas por marca (as da Seleção não contam). */
const SOURCE_CAP = 5;
/** A Seleção de uma marca é conferida de novo depois de 6 h (ou antes, quando um gatilho zera o `style_library_checked_at`). */
const RECONCILE_EVERY_MS = 6 * 3600_000;
const PINS_PER_SYNC = 8;
const RESYNC_MS = 24 * 3600_000;
/** Leituras que falharam de forma transitória: 3 no total; a espera até a próxima depende de quantas já falharam (P1). */
export const READ_MAX_ATTEMPTS = 3;
export const RETRY_AFTER_MS = [10 * 60_000, 30 * 60_000, 3 * 3600_000];
const SEEN_CAP = 300;
const VIEW_URL_TTL_S = 3600;
const UA = 'Mozilla/5.0 (compatible; MeuFunil/1.0; +https://www.meufunildevendas.com.br)';

const bad = (message: string) => new BadRequestException({ code: 'BAD_REQUEST', message });
const MSG_NOT_PINTEREST = 'Esse link não é de um Pin nem de uma pasta do Pinterest. No Pinterest, toque em Compartilhar → Copiar link.';
const MSG_PIN_IMAGE = 'Não conseguimos pegar a imagem desse Pin. Salve a imagem no celular e envie aqui.';
const MSG_READ_FAILED = 'Não conseguimos ler o estilo desta referência. Remova e tente outra.';
const MSG_RSS_DOWN = 'O Pinterest não respondeu agora. Tentamos de novo amanhã.';
const MSG_SELECTION_SOURCE = 'Esta pasta é da Seleção do Meu Funil e não dá para parar por aqui. Para tirar, desligue a seleção ou troque o ramo na marca, aba Guia visual.';
const MSG_SOURCE_CAP = 'Você já acompanha 5 pastas nesta marca. Pare uma para pôr outra.';

const QUOTA_SELECT = { style_library_enabled: true, style_selection_day: true, style_selection_reads: true };
/** Leituras da Seleção feitas hoje (dia de Brasília) na marca; outro dia = 0. A data "só dia" é comparada pelo texto `YYYY-MM-DD`. */
function selectionReadsToday(b: { style_selection_day?: Date | string | null; style_selection_reads?: number | null }): number {
  const d = b.style_selection_day;
  const day = d instanceof Date ? d.toISOString().slice(0, 10) : d ? String(d).slice(0, 10) : null;
  return day === todaySp() ? b.style_selection_reads ?? 0 : 0;
}

class FetchFailed extends Error {}
/** Falha da leitura que repetir não resolve (nota vazia, imagem sumida): vira `failed` na hora. */
class ReadDefinitive extends Error {}

/** Falha transitória (vale tentar de novo depois)? Só é definitiva a que as chaves recusam todas por formato/recusa/outro. */
export function isTransientReadError(e: unknown): boolean {
  if (e instanceof AiKeysFailedError) return e.failures.some((f) => f.kind !== 'format' && f.kind !== 'rejected' && f.kind !== 'other');
  return true;
}

/** Corpo lido em streaming e cortado ao passar do teto (resposta sem content-length não entra inteira na memória). */
async function readCapped(res: Response, maxBytes: number): Promise<Uint8Array> {
  if (Number(res.headers.get('content-length') ?? 0) > maxBytes) {
    await res.body?.cancel().catch(() => undefined);
    throw new FetchFailed('grande demais');
  }
  if (!res.body) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new FetchFailed('grande demais');
    }
    chunks.push(value);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

function toPickRow(r: RefRow): PickRow | null {
  const notes = normalizeStyleNotes(r.style_notes);
  return notes ? { id: r.id, campaign_id: r.campaign_id, created_at: r.created_at, notes } : null;
}

type RefRow = {
  id: string; workspace_id: string; brand_id: string; campaign_id: string | null; source_id: string | null; source: string;
  source_url: string | null; pin_id: string | null; title: string | null; storage_path: string | null; style_notes: unknown;
  status: string; error: string | null; claimed_at: Date | null; attempts: number; created_at: Date; origin?: string;
};

export type StyleRefView = {
  id: string; source: string; source_url: string | null; title: string | null; status: string; summary: string | null; error: string | null;
  image_url: string | null; campaign_id: string | null; campaign_name: string | null; from_source: boolean; source_title: string | null;
  attempts: number; created_at: Date; origin: 'own' | 'selection';
};

/** Seleção do Meu Funil vista pela empresa (contrato §28, P34): só números e rótulos — nada que leve a uma referência. */
export type StyleSelectionView = {
  segment: string | null; segment_label: string | null; segment_source: 'auto' | 'chosen' | 'none'; brand_segment: string | null;
  options: { id: string; label: string }[]; enabled: boolean; needs_ai_key: boolean; ai_credit: 'no_credit' | 'daily_limit' | null;
  daily_left: number; sources_count: number; count: number; reading: number; own_ready: number; in_use: boolean;
};

type SourceRow = { id: string; workspace_id: string; brand_id: string; url: string; rss_url: string; created_by?: string | null; seen_pin_ids?: string[]; origin?: string };

type ViewNames = { campaigns: Map<string, string>; sources: Map<string, string | null> };

/** JPEG ≤ 1024 px. Lança se não for JPG/PNG (o tipo é conferido pelo conteúdo, não pelo nome; o decodificador do servidor não lê WEBP). */
async function shrink(images: ImageService, bytes: Uint8Array): Promise<Uint8Array> {
  const head = bytes.subarray(0, 12);
  const isJpeg = head[0] === 0xff && head[1] === 0xd8;
  const isPng = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
  if (!isJpeg && !isPng) throw bad('Envie uma imagem JPG ou PNG.');
  // `ImageService.read` barra a imagem-bomba (poucos bytes declarando bilhões de pixels) antes de decodificar.
  let img;
  try {
    img = await images.read(bytes);
  } catch (e) {
    if (e instanceof BadRequestException) throw e;
    throw bad('Envie uma imagem JPG ou PNG.');
  }
  const w = img.bitmap.width as number;
  const h = img.bitmap.height as number;
  const s = Math.min(1, MAX_SIDE / Math.max(w, h));
  if (s < 1) img.resize({ w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) });
  return images.encode(img, false, 85);
}

@Injectable()
export class StyleRefsService implements OnModuleDestroy {
  private readonly logger = new Logger(StyleRefsService.name);
  /** Lê o estilo logo depois de adicionar (em segundo plano). Os testes desligam e chamam `processPending`. */
  autoProcess = true;
  private readonly pinterestOn: boolean;
  private readonly libraryOn: boolean;
  /** Fila por marca (chave `ws:brand`): reconciliação, `sync` das pastas e `removeSource` da mesma marca rodam um de cada vez. */
  private readonly queue = new KeyedQueue();
  /** Trabalhos em segundo plano em andamento (`reconcileSoon` e o chute depois de criar pastas): só para `whenIdle` (testes e desligamento). */
  private readonly inflight = new Set<Promise<unknown>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
    private readonly ai: AiService,
    private readonly files: FilesService,
    private readonly images: ImageService,
    @Inject(EXTERNAL_FETCH) private readonly fetchExternal: ExternalFetch,
    @Inject(ENV) env: Pick<Env, 'STYLE_REFS_PINTEREST_ENABLED' | 'STYLE_LIBRARY_ENABLED'>,
    private readonly aiKeys: AiKeysService,
    private readonly aiAlerts: AiCreditAlertsService,
  ) {
    this.pinterestOn = env.STYLE_REFS_PINTEREST_ENABLED === true;
    this.libraryOn = env.STYLE_LIBRARY_ENABLED === true;
  }

  /** Seleção do Meu Funil ligada (P18): as duas chaves, porque ela só existe pelo RSS. Desligada = inerte (nada é lido nem usado na escolha). */
  selectionOn(): boolean {
    return this.libraryOn && this.pinterestOn;
  }

  pinterestEnabled(): boolean {
    return this.pinterestOn;
  }

  // ── leitura ────────────────────────────────────────────────────────────

  async list(userId: string, ws: string, brandId: string, campaignId?: string | null) {
    await this.access.require(userId, ws, 'read');
    await this.brand(ws, brandId);
    // Seleção desligada = inerte (P18/P22′): a lista esconde as pastas e as referências dela.
    const selOn = this.selectionOn();
    const only = selOn ? {} : { origin: 'own' };
    const rows = (await this.prisma.style_references.findMany({
      where: campaignId ? { workspace_id: ws, brand_id: brandId, ...only, OR: [{ campaign_id: campaignId }, { campaign_id: null }] } : { workspace_id: ws, brand_id: brandId, ...only },
      orderBy: { created_at: 'desc' },
      // Com campanha: as dela + as da marca (38). Sem campanha: a marca e todas as campanhas (teto de segurança 200).
      take: campaignId ? BRAND_CAP + CAMPAIGN_CAP : LIST_ALL_CAP,
    })) as RefRow[];
    const sources = await this.prisma.style_ref_sources.findMany({ where: { workspace_id: ws, brand_id: brandId, ...only }, orderBy: { created_at: 'asc' } });
    const names: ViewNames = { campaigns: await this.campaignNames(ws, rows), sources: new Map(sources.map((s) => [s.id, s.title])) };
    // Contagem real no banco (no máx. 5 pastas), não pelas linhas lidas.
    const perSource = new Map<string, number>();
    for (const s of sources) perSource.set(s.id, await this.prisma.style_references.count({ where: { workspace_id: ws, brand_id: brandId, source_id: s.id } }));
    // `in_brand` = só as próprias (o teto de 30 da tela é delas); `in_selection` = as da Seleção na marca (0 com a Seleção desligada).
    const inBrand = await this.prisma.style_references.count({ where: { workspace_id: ws, brand_id: brandId, origin: 'own' } });
    const inSelection = selOn ? await this.prisma.style_references.count({ where: { workspace_id: ws, brand_id: brandId, origin: 'selection' } }) : 0;
    return {
      refs: rows.map((r) => this.view(r, names)),
      sources: sources.map((s) => ({ id: s.id, url: s.url, title: s.title, last_synced_at: s.last_synced_at, last_error: s.last_error, refs_count: perSource.get(s.id) ?? 0, origin: (s.origin === 'selection' ? 'selection' : 'own') as 'own' | 'selection' })),
      limits: {
        campaign: CAMPAIGN_CAP,
        brand: BRAND_CAP,
        in_campaign: campaignId ? rows.filter((r) => r.campaign_id === campaignId).length : 0,
        in_brand: inBrand,
        in_selection: inSelection,
        pinterest: this.pinterestOn,
      },
    };
  }

  /** Painel da Seleção do Meu Funil na marca. Seleção desligada = 404 como se a rota não existisse. Toda consulta leva o `workspace_id` da empresa. */
  async library(userId: string, ws: string, brandId: string): Promise<StyleSelectionView> {
    await this.access.require(userId, ws, 'read');
    if (!this.selectionOn()) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Não encontrado.' });
    const brand = await this.prisma.brands.findFirst({
      where: { id: brandId, workspace_id: ws },
      select: { segment: true, style_library_segment: true, ...QUOTA_SELECT },
    });
    if (!brand) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Marca não encontrada.' });
    const resolved = resolveSelectionBranch(brand);
    const segment = resolved.segment;
    const fromSelection = { workspace_id: ws, brand_id: brandId, origin: 'selection' };
    const sourcesCount = await this.prisma.style_ref_sources.count({ where: fromSelection });
    const count = await this.prisma.style_references.count({ where: { ...fromSelection, status: 'ready' } });
    const reading = await this.prisma.style_references.count({ where: { ...fromSelection, status: 'processing' } });
    // Régua do "útil" (P21′): próprias prontas ou ainda sendo lidas, sem campanha.
    const ownReady = await this.prisma.style_references.count({ where: { workspace_id: ws, brand_id: brandId, origin: 'own', campaign_id: null, status: { in: ['ready', 'processing'] } } });
    const hasKey = !!(await this.aiKeys.get(ws, 'openai')) || !!(await this.aiKeys.get(ws, 'gemini'));
    const credit = await this.aiAlerts.status(ws);
    const reads = selectionReadsToday(brand);
    const enabled = brand.style_library_enabled === true;
    return {
      segment,
      segment_label: segment ? selectionLabel(segment) : null,
      segment_source: resolved.source,
      brand_segment: brand.segment ?? null,
      options: SELECTION_OPTIONS.map((o) => ({ id: o.id, label: o.label })),
      enabled,
      needs_ai_key: !hasKey,
      ai_credit: credit?.vendors[0]?.reason ?? null,
      daily_left: Math.max(0, SELECTION_DAILY_NEW - reads),
      sources_count: sourcesCount,
      count,
      reading,
      own_ready: ownReady,
      in_use: enabled && !!segment && count > 0 && ownReady < MAX_NOTES,
    };
  }

  /**
   * Carregador único da escolha (Fatia 3): lê as prontas da marca no workspace e escolhe até 4 pelo assunto do pedido (`chooseNotes`).
   * `loadStyleNotes` e, adiante, a foto das vagas só chamam isto.
   */
  async pickNotes(ws: string, brandId: string, campaignId: string | null, subject: string | null): Promise<PickedNote[]> {
    // Só as da marca (sem campanha) e as da campanha pedida: nota de outra campanha seria descartada depois e ainda gastaria vaga no `take`.
    const rows = (await this.prisma.style_references.findMany({
      where: { workspace_id: ws, brand_id: brandId, status: 'ready', ...(campaignId ? { OR: [{ campaign_id: null }, { campaign_id: campaignId }] } : { campaign_id: null }) },
      orderBy: { created_at: 'desc' },
      take: BRAND_CAP + CAMPAIGN_CAP,
    })) as RefRow[];
    // Separa por origem (P23): as próprias escolhem como sempre; as da Seleção (sem campanha) só completam, e só com a Seleção ligada.
    const own = rows.filter((r) => r.origin !== 'selection').map(toPickRow).filter((x): x is PickRow => !!x);
    let library: PickRow[] = [];
    const selection = rows.filter((r) => r.origin === 'selection' && r.campaign_id === null);
    if (own.length < MAX_NOTES && selection.length > 0 && this.selectionOn()) {
      try {
        const brand = await this.prisma.brands.findFirst({ where: { id: brandId, workspace_id: ws }, select: { style_library_enabled: true } });
        if (brand?.style_library_enabled) library = selection.map(toPickRow).filter((x): x is PickRow => !!x);
      } catch (e) {
        this.logger.warn(`Seleção do Meu Funil indisponível; seguindo só com as referências da marca: ${(e as Error).message}`);
      }
    }
    return chooseNotes(own, campaignId ?? null, subject, library);
  }

  /**
   * Estilo para a foto das vagas (Fatia 5, P14): mesma escolha de notas (`pickNotes`, próprias + Seleção) com o assunto do chamador. Nota
   * completa dá paleta, luz e clima; reduzida dá paleta e luz. Itens sem repetição, até 8 por lista (o filtro e o corte 4/2/2 são do
   * `photoStyleLines`). `used` = as notas que deram algum item; nenhuma → null.
   */
  async loadPhotoStyle(ws: string, brandId: string | null | undefined, subject: string): Promise<{ style: PhotoStyle; used: StyleRefsUsed } | null> {
    if (!brandId) return null;
    const picked = await this.pickNotes(ws, brandId, null, subject);
    const style: PhotoStyle = { paleta: [], luz: [], clima: [] };
    const seen = { paleta: new Set<string>(), luz: new Set<string>(), clima: new Set<string>() };
    const add = (key: keyof PhotoStyle, v: string | null | undefined): boolean => {
      const item = (v ?? '').replace(/\s+/g, ' ').trim();
      const k = normalizeText(item);
      if (!k || seen[key].has(k) || style[key].length >= 8) return false;
      seen[key].add(k);
      style[key].push(item);
      return true;
    };
    const own: string[] = [];
    const library: string[] = [];
    for (const p of picked) {
      const n = p.row.notes;
      let gave = false;
      for (const c of n.paleta) gave = add('paleta', c) || gave;
      gave = add('luz', n.luz) || gave;
      if (p.full) gave = add('clima', n.clima) || gave;
      if (gave) (p.library ? library : own).push(p.row.id);
    }
    return own.length || library.length ? { style, used: { own, library } } : null;
  }

  /** Quantas referências a escolha usaria agora, sem assunto (próprias + Seleção, até 4): o "em uso" dos Ajustes das vagas. */
  async notesInUse(ws: string, brandId: string): Promise<number> {
    return (await this.pickNotes(ws, brandId, null, null)).length;
  }

  /** Bloco para o diretor de arte/vídeo: até 4 prontas escolhidas pelo assunto, com rótulos + quais entraram, ou null. */
  async loadStyleNotes(ws: string, brandId: string | null | undefined, campaignId?: string | null, subject?: string | null): Promise<StylePick | null> {
    if (!brandId) return null;
    const picked = await this.pickNotes(ws, brandId, campaignId ?? null, subject ?? null);
    const r = styleNotesText(
      picked.map((p) => ({ id: p.row.id, notes: p.row.notes, full: p.full, labels: p.row.notes.categorias.slice(0, 2).map((c) => STYLE_CATEGORY_LABEL[c]) })),
    );
    if (!r) return null;
    const lib = new Set(picked.filter((p) => p.library).map((p) => p.row.id));
    return { text: r.text, used: { own: r.ids.filter((id) => !lib.has(id)), library: r.ids.filter((id) => lib.has(id)) } };
  }

  // ── adicionar ──────────────────────────────────────────────────────────

  async upload(userId: string, ws: string, brandId: string, file: { bytes: Uint8Array; mime: string }, campaignId?: string | null) {
    await this.access.require(userId, ws, 'write');
    await this.brand(ws, brandId);
    if (campaignId) await this.campaign(ws, brandId, campaignId);
    if (file.bytes.length > MAX_IMAGE_BYTES) throw bad('A imagem passa de 15 MB.');
    const jpeg = await shrink(this.images, file.bytes);
    await this.makeRoom(ws, brandId, campaignId ?? null, 1, true);
    const row = await this.store(ws, brandId, { campaignId: campaignId ?? null, source: 'upload', createdBy: userId }, jpeg);
    this.kick();
    return this.view(row, await this.namesFor(ws, [row]));
  }

  /** Pin (1 referência) ou pasta/perfil (vira fonte acompanhada + até 8 Pins agora; o job renova a cada 24 h). */
  async addPinterest(userId: string, ws: string, brandId: string, url: string, campaignId?: string | null) {
    if (!this.pinterestOn) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Não encontrado.' });
    await this.access.require(userId, ws, 'write');
    await this.brand(ws, brandId);
    if (campaignId) await this.campaign(ws, brandId, campaignId);
    let link = parsePinterestLink(url);
    if (link?.kind === 'shortlink') link = await this.resolveShortlink(link.url);
    if (!link) throw bad(MSG_NOT_PINTEREST);

    const key = this.queueKey(ws, brandId);

    if (link.kind === 'pin') {
      const pinId = link.pinId;
      // Pin que a Seleção já trouxe (P26′): promove a própria e devolve (sem "já está"). Escrita atômica (sem esperar a fila da marca):
      // só vale se ainda é da Seleção; `source_id` nulo na mesma escrita, senão o cascade da FK o apagaria junto com a pasta.
      const dup = (await this.prisma.style_references.findFirst({ where: { workspace_id: ws, brand_id: brandId, pin_id: pinId } })) as RefRow | null;
      if (dup) {
        if (dup.origin !== 'selection') throw bad('Esse Pin já está nas referências.');
        const done = await this.prisma.style_references.updateMany({ where: { id: dup.id, workspace_id: ws, origin: 'selection' }, data: { origin: 'own', source_id: null } });
        if (done.count === 1) {
          const taken = { ...dup, origin: 'own' as const, source_id: null };
          return { kind: 'pin' as const, added: 0, refs: [this.view(taken, await this.namesFor(ws, [taken]))], promoted: true as const };
        }
        // Perdeu a corrida (já promovida ou apagada): segue o fluxo normal; o índice único barra a duplicata.
      }
      const imageUrl = await this.pinImage(link.url);
      const jpeg = await this.download(imageUrl).then((b) => shrink(this.images, b)).catch(() => {
        throw bad(MSG_PIN_IMAGE);
      });
      await this.makeRoom(ws, brandId, campaignId ?? null, 1, true);
      const row = await this.store(ws, brandId, { campaignId: campaignId ?? null, source: 'pinterest', sourceUrl: link.url, pinId, createdBy: userId }, jpeg);
      this.kick();
      return { kind: 'pin' as const, added: 1, refs: [this.view(row, await this.namesFor(ws, [row]))] };
    }

    const kind = link.kind;
    const rssUrl = link.rssUrl;
    const boardUrl = link.url;
    // Pasta: tudo (achar/criar/promover e o primeiro `sync`) pela fila da marca, uma de cada vez com a reconciliação.
    return this.queue.run(key, async () => {
      let source = (await this.prisma.style_ref_sources.findFirst({ where: { workspace_id: ws, brand_id: brandId, rss_url: rssUrl } })) as SourceRow | null;
      let promoted = false;
      if (source?.origin === 'selection') {
        // P26′: colar a pasta da Seleção a promove (e as referências dela) a própria; confere o teto de 5 próprias como numa pasta nova.
        if ((await this.ownSourceCount(ws, brandId)) >= SOURCE_CAP) throw bad(MSG_SOURCE_CAP);
        await this.prisma.style_ref_sources.updateMany({ where: { id: source.id, workspace_id: ws }, data: { origin: 'own', created_by: userId } });
        await this.prisma.style_references.updateMany({ where: { workspace_id: ws, brand_id: brandId, source_id: source.id }, data: { origin: 'own' } });
        source = { ...source, origin: 'own', created_by: userId };
        promoted = true;
      } else if (!source) {
        if ((await this.ownSourceCount(ws, brandId)) >= SOURCE_CAP) throw bad(MSG_SOURCE_CAP);
        try {
          source = (await this.prisma.style_ref_sources.create({ data: { workspace_id: ws, brand_id: brandId, url: boardUrl, rss_url: rssUrl, created_by: userId } })) as SourceRow;
        } catch (e) {
          if (!isUniqueViolation(e)) throw e;
          source = (await this.prisma.style_ref_sources.findFirst({ where: { workspace_id: ws, brand_id: brandId, rss_url: rssUrl } })) as SourceRow | null;
          if (!source) throw e;
        }
      }
      const added = await this.sync(source);
      if (added === null) throw bad('Não conseguimos ler essa pasta do Pinterest agora. Confira se ela é pública e tente de novo.');
      this.kick();
      return promoted ? { kind, added, promoted: true as const } : { kind, added };
    });
  }

  // ── remover ────────────────────────────────────────────────────────────

  async remove(userId: string, ws: string, brandId: string, id: string) {
    await this.access.require(userId, ws, 'write');
    const row = (await this.prisma.style_references.findFirst({ where: { id, workspace_id: ws, brand_id: brandId } })) as RefRow | null;
    if (!row) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Referência não encontrada.' });
    await this.drop(row);
    return { ok: true };
  }

  /** Parar de acompanhar a pasta: ela e as referências que vieram dela saem. Pasta da Seleção não para por aqui (a reconciliação a recriaria). */
  async removeSource(userId: string, ws: string, brandId: string, sourceId: string) {
    await this.access.require(userId, ws, 'write');
    return this.queue.run(this.queueKey(ws, brandId), async () => {
      const src = await this.prisma.style_ref_sources.findFirst({ where: { id: sourceId, workspace_id: ws, brand_id: brandId } });
      if (!src) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Pasta não encontrada.' });
      if (src.origin === 'selection') throw new BadRequestException({ code: 'SELECTION_SOURCE', message: MSG_SELECTION_SOURCE });
      const refs = (await this.prisma.style_references.findMany({ where: { workspace_id: ws, source_id: sourceId } })) as RefRow[];
      for (const r of refs) await this.drop(r, { sourceId });
      await this.prisma.style_ref_sources.deleteMany({ where: { id: sourceId, workspace_id: ws } });
      return { ok: true, removed: refs.length };
    });
  }

  // ── Seleção do Meu Funil: reconciliação ────────────────────────────────

  /**
   * Ajusta as pastas da Seleção da marca ao ramo (P20/P20′), idempotente, SEMPRE pela fila da marca. Sem a Seleção ligada não faz nada
   * (nem apaga). Alvo = pastas do ramo resolvido quando o interruptor da marca está ligado, senão nenhuma: as pastas `origin='selection'`
   * fora do alvo saem com as referências (com ou sem chave); as do alvo que não existem em NENHUMA origem são criadas, só se a empresa tem
   * chave de IA. Uma pasta própria igual à do catálogo fica como está. Grava `style_library_checked_at`.
   */
  reconcileSelection(ws: string, brandId: string): Promise<{ created: number; removed: number }> {
    return this.queue.run(this.queueKey(ws, brandId), () => this.reconcileNow(ws, brandId));
  }

  /** Ajuste em segundo plano: devolve na hora; erro vai para o log (nunca rejeição solta). */
  reconcileSoon(ws: string, brandId: string): void {
    this.track(this.reconcileSelection(ws, brandId).catch((e) => this.logger.warn(`Seleção da marca ${brandId}: ${(e as Error).message}`)));
  }

  /** Job: reconcilia até `limit` marcas com `style_library_checked_at` nulo (primeiro) ou com mais de 6 h. Devolve quantas. */
  async reconcileDueBrands(limit = 10): Promise<number> {
    if (!this.selectionOn()) return 0;
    // Única consulta sem empresa: é a busca das marcas vencidas; daí em diante cada marca usa o `workspace_id` da própria linha.
    const due = (await this.prisma.brands.findMany({
      where: { OR: [{ style_library_checked_at: null }, { style_library_checked_at: { lt: new Date(Date.now() - RECONCILE_EVERY_MS) } }] },
      orderBy: { style_library_checked_at: { sort: 'asc', nulls: 'first' } },
      take: limit,
      select: { id: true, workspace_id: true },
    })) as { id: string; workspace_id: string }[];
    for (const b of due) await this.reconcileSelection(b.workspace_id, b.id).catch((e) => this.logger.warn(`Seleção da marca ${b.id}: ${(e as Error).message}`));
    return due.length;
  }

  /** Chave de IA nova (P37): põe as marcas da empresa e das que herdam dela na frente da fila do job. Só banco. */
  async markSelectionDue(ws: string): Promise<void> {
    const heirs = (await this.prisma.workspaces.findMany({ where: { ai_inherit_from: ws }, select: { id: true } })) as { id: string }[];
    await this.prisma.brands.updateMany({ where: { workspace_id: { in: [ws, ...heirs.map((h) => h.id)] } }, data: { style_library_checked_at: null } });
  }

  /** Espera os trabalhos em segundo plano em andamento (usado pelos testes e pelo desligamento da API). */
  async whenIdle(): Promise<void> {
    while (this.inflight.size) await Promise.allSettled([...this.inflight]);
  }

  async onModuleDestroy(): Promise<void> {
    await this.whenIdle();
  }

  private async reconcileNow(ws: string, brandId: string): Promise<{ created: number; removed: number }> {
    const none = { created: 0, removed: 0 };
    if (!this.selectionOn()) return none;
    const brand = await this.prisma.brands.findFirst({ where: { id: brandId, workspace_id: ws }, select: { segment: true, style_library_enabled: true, style_library_segment: true } });
    if (!brand) return none;
    // Carimbo no INÍCIO (antes do cofre): marca que dá erro não volta ao topo da fila e chave gravada no meio (`markSelectionDue`) não perde o efeito.
    await this.prisma.brands.updateMany({ where: { id: brandId, workspace_id: ws }, data: { style_library_checked_at: new Date() } });
    const branch = resolveSelectionBranch(brand).segment;
    const target = new Map<string, string>(); // rss_url → url
    if (brand.style_library_enabled && branch) {
      for (const url of SELECTION_CATALOG[branch] ?? []) {
        const link = parsePinterestLink(url);
        if (link?.kind === 'board') target.set(link.rssUrl, link.url);
      }
    }
    // Todas as pastas da marca, de qualquer origem, de uma vez.
    const all = (await this.prisma.style_ref_sources.findMany({ where: { workspace_id: ws, brand_id: brandId } })) as SourceRow[];
    let removed = 0;
    for (const s of all.filter((x) => x.origin === 'selection' && !target.has(x.rss_url))) {
      const refs = (await this.prisma.style_references.findMany({ where: { workspace_id: ws, source_id: s.id } })) as RefRow[];
      for (const r of refs) await this.drop(r, { sourceId: s.id, origin: 'selection' });
      await this.prisma.style_ref_sources.deleteMany({ where: { id: s.id, workspace_id: ws } });
      removed++;
    }
    const have = new Set(all.map((x) => x.rss_url));
    const missing = [...target].filter(([rss]) => !have.has(rss));
    const made: SourceRow[] = [];
    // O cofre só é consultado quando há o que criar.
    if (missing.length && (await this.hasAiKey(ws))) {
      for (const [rssUrl, url] of missing) {
        try {
          made.push((await this.prisma.style_ref_sources.create({ data: { workspace_id: ws, brand_id: brandId, url, rss_url: rssUrl, origin: 'selection', created_by: null } })) as SourceRow);
        } catch (e) {
          if (!isUniqueViolation(e)) throw e; // a pasta já existe (corrida): segue
        }
      }
    }
    if (made.length) this.kickSelection(ws, brandId, made);
    return { created: made.length, removed };
  }

  /** Chave de IA da empresa (a herdada da agência conta: é a mesma que a leitura usa). */
  private async hasAiKey(ws: string): Promise<boolean> {
    return !!(await this.aiKeys.get(ws, 'openai')) || !!(await this.aiKeys.get(ws, 'gemini'));
  }

  // ── job ────────────────────────────────────────────────────────────────

  /**
   * Lê o estilo das pendentes (com trava otimista). Falha transitória volta para a fila com `attempts` + 1 e só é relida depois de
   * 30 min / 3 h (a trava vencida com `attempts` 0 volta em 10 min); na 3ª vira `failed`. Definitiva vira `failed` na hora.
   * O filtro de espera vai no `where` (12 linhas esperando a vez não escondem as novas atrás do `take`). Devolve quantas processou.
   */
  async processPending(limit = 5): Promise<number> {
    const now = Date.now();
    // Duas filas (P22′): as PRÓPRIAS primeiro; com o que sobrar do limite, as da Seleção (só com a Seleção ligada).
    const waiting = { status: 'processing', OR: [{ claimed_at: null }, ...RETRY_AFTER_MS.map((ms, i) => ({ attempts: i, claimed_at: { lt: new Date(now - ms) } }))] };
    const rows = (await this.prisma.style_references.findMany({ where: { ...waiting, origin: 'own' }, orderBy: { created_at: 'asc' }, take: limit })) as RefRow[];
    if (this.selectionOn() && limit - rows.length > 0) {
      rows.push(...((await this.prisma.style_references.findMany({ where: { ...waiting, origin: 'selection' }, orderBy: { created_at: 'asc' }, take: limit - rows.length })) as RefRow[]));
    }
    let done = 0;
    for (const r of rows) {
      const lock = new Date();
      const claim = await this.prisma.style_references.updateMany({ where: { id: r.id, status: 'processing', claimed_at: r.claimed_at }, data: { claimed_at: lock } });
      if (claim.count !== 1) continue;
      // Toda escrita desta leitura confere a trava: se outro worker a tomou (leitura lenta), o resultado deste não sobrescreve o dele.
      const mine = { id: r.id, status: 'processing', claimed_at: lock };
      try {
        const bytes = await this.files.read(BUCKET, r.storage_path!).catch(() => { throw new ReadDefinitive('imagem sumida'); });
        const raw = await this.ai.json(r.workspace_id, {
          prompt: STYLE_NOTES_PROMPT,
          schema: STYLE_NOTES_SCHEMA as unknown as Record<string, unknown>,
          name: 'style_notes',
          images: [{ bytes: new Uint8Array(bytes), mime: 'image/jpeg' }],
          // A Seleção é da casa: lê só com a chave da empresa, nunca gasta a IA do app (P31).
          ...(r.origin === 'selection' ? { ownKeysOnly: true } : {}),
        });
        const notes = normalizeStyleNotes(raw);
        if (!notes) throw new ReadDefinitive('notas vazias');
        // updateMany: referência apagada no meio da leitura (ou a empresa inteira) não derruba a rodada.
        await this.prisma.style_references.updateMany({ where: mine, data: { status: 'ready', style_notes: { ...notes, v: 2 } as unknown as Prisma.InputJsonObject, error: null } });
      } catch (e) {
        this.logger.warn(`estilo da referência ${r.id}: ${(e as Error).message}`);
        const transient = !(e instanceof ReadDefinitive) && isTransientReadError(e);
        if (transient && r.attempts + 1 < READ_MAX_ATTEMPTS) {
          // Volta para a fila: a nova trava (claimed_at) é o relógio da espera. Sem `increment`: o FakeTable dos testes não o entende.
          await this.prisma.style_references.updateMany({ where: mine, data: { attempts: r.attempts + 1, claimed_at: new Date(), error: null } });
        } else {
          await this.prisma.style_references.updateMany({ where: mine, data: { status: 'failed', error: MSG_READ_FAILED, ...(transient ? { attempts: READ_MAX_ATTEMPTS } : {}) } });
        }
      }
      done++;
    }
    return done;
  }

  /**
   * Renova as pastas acompanhadas há mais de 24 h (P22): o vencimento vai no `where` (nulas primeiro); pastas da Seleção só entram com a
   * Seleção ligada. Cada `sync` roda pela fila da marca. Devolve quantas tentou.
   */
  async refreshDueSources(limit = 5): Promise<number> {
    if (!this.pinterestOn) return 0;
    const cutoff = new Date(Date.now() - RESYNC_MS);
    const due = (await this.prisma.style_ref_sources.findMany({
      where: { OR: [{ last_synced_at: null }, { last_synced_at: { lt: cutoff } }], ...(this.selectionOn() ? {} : { origin: 'own' }) },
      orderBy: { last_synced_at: { sort: 'asc', nulls: 'first' } },
      take: limit,
    })) as SourceRow[];
    // Uma fonte com erro (ex.: empresa apagada no meio) não impede as outras.
    for (const s of due) await this.queue.run(this.queueKey(s.workspace_id, s.brand_id), () => this.syncIfDue(s)).catch((e) => this.logger.warn(`pasta ${s.id}: ${(e as Error).message}`));
    return due.length;
  }

  // ── internos ───────────────────────────────────────────────────────────

  /**
   * `sync` com a pasta relida DENTRO da fila (o retrato lido antes pode estar velho): pula se ela sumiu, se já foi renovada há menos de 24 h
   * (ex.: o chute da reconciliação passou na frente do job) ou se é da Seleção com a Seleção desligada.
   */
  private async syncIfDue(s: { id: string; workspace_id: string }): Promise<number | null> {
    const row = (await this.prisma.style_ref_sources.findFirst({ where: { id: s.id, workspace_id: s.workspace_id } })) as (SourceRow & { last_synced_at?: Date | null }) | null;
    if (!row) return null;
    if (row.origin === 'selection' && !this.selectionOn()) return null;
    if (row.last_synced_at && new Date(row.last_synced_at).getTime() >= Date.now() - RESYNC_MS) return null;
    return this.sync(row);
  }

  private queueKey(ws: string, brandId: string): string {
    // minúsculas: o uuid que chega pela URL pode vir em maiúsculas e a linha do banco (job) vem em minúsculas.
    return `${ws}:${brandId}`.toLowerCase();
  }

  private track(p: Promise<unknown>): void {
    const done = p.catch(() => undefined).finally(() => this.inflight.delete(done));
    this.inflight.add(done);
  }

  private ownSourceCount(ws: string, brandId: string): Promise<number> {
    return this.prisma.style_ref_sources.count({ where: { workspace_id: ws, brand_id: brandId, origin: 'own' } });
  }

  /**
   * Depois de criar pastas da Seleção: em segundo plano (pela fila da marca, depois da reconciliação que o chamou) sincroniza as novas e lê
   * as pendentes. Os testes desligam com `autoProcess = false`.
   */
  private kickSelection(ws: string, brandId: string, sources: SourceRow[]) {
    if (!this.autoProcess) return;
    this.track(
      this.queue
        .run(this.queueKey(ws, brandId), async () => {
          for (const s of sources) await this.syncIfDue(s).catch((e) => this.logger.warn(`pasta ${s.id}: ${(e as Error).message}`));
        })
        .then(() => this.processPending(PINS_PER_SYNC))
        .catch((e) => this.logger.warn(`Seleção da marca ${brandId}: ${(e as Error).message}`)),
    );
  }

  private kick() {
    if (!this.autoProcess) return;
    setTimeout(() => void this.processPending(PINS_PER_SYNC).catch((e) => this.logger.warn(`ler estilo: ${(e as Error).message}`)), 0);
  }

  /** Nome das campanhas das linhas (sempre no workspace). */
  private async campaignNames(ws: string, rows: RefRow[]): Promise<Map<string, string>> {
    const ids = [...new Set(rows.map((r) => r.campaign_id).filter((x): x is string => !!x))];
    if (!ids.length) return new Map();
    const cs = await this.prisma.campaigns.findMany({ where: { workspace_id: ws, id: { in: ids } }, select: { id: true, name: true } });
    return new Map(cs.map((c) => [c.id, c.name]));
  }

  private async namesFor(ws: string, rows: RefRow[]): Promise<ViewNames> {
    const ids = [...new Set(rows.map((r) => r.source_id).filter((x): x is string => !!x))];
    const srcs = ids.length ? await this.prisma.style_ref_sources.findMany({ where: { workspace_id: ws, id: { in: ids } } }) : [];
    return { campaigns: await this.campaignNames(ws, rows), sources: new Map(srcs.map((s) => [s.id, s.title])) };
  }

  private view(r: RefRow, names: ViewNames): StyleRefView {
    return {
      id: r.id,
      source: r.source,
      source_url: r.source_url,
      title: r.title,
      status: r.status,
      summary: r.status === 'ready' ? notesSummary(normalizeStyleNotes(r.style_notes)) : null,
      error: r.error,
      // Só para a tela e por pouco tempo: a imagem de terceiro não fica circulando (a lista é buscada de novo ao abrir).
      image_url: r.storage_path ? this.files.signedUrl(BUCKET, r.storage_path, VIEW_URL_TTL_S) : null,
      campaign_id: r.campaign_id,
      campaign_name: r.campaign_id ? names.campaigns.get(r.campaign_id) ?? null : null,
      from_source: !!r.source_id,
      source_title: r.source_id ? names.sources.get(r.source_id) ?? null : null,
      attempts: r.attempts ?? 0,
      created_at: r.created_at,
      origin: r.origin === 'selection' ? 'selection' : 'own',
    };
  }

  private async brand(ws: string, brandId: string) {
    const b = await this.prisma.brands.findFirst({ where: { id: brandId, workspace_id: ws }, select: { id: true } });
    if (!b) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Marca não encontrada.' });
  }

  private async campaign(ws: string, brandId: string, campaignId: string) {
    const c = await this.prisma.campaigns.findFirst({ where: { id: campaignId, workspace_id: ws, brand_id: brandId }, select: { id: true } });
    if (!c) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Campanha não encontrada.' });
  }

  private async store(
    ws: string,
    brandId: string,
    o: { campaignId: string | null; source: 'upload' | 'pinterest'; sourceUrl?: string; pinId?: string; title?: string | null; sourceId?: string; createdBy?: string | null; origin?: 'own' | 'selection' },
    jpeg: Uint8Array,
  ): Promise<RefRow> {
    const key = `${ws}/${brandId}/${randomUUID()}.jpg`;
    await this.files.put(BUCKET, key, jpeg);
    try {
      return (await this.prisma.style_references.create({
        data: {
          workspace_id: ws, brand_id: brandId, campaign_id: o.campaignId, source_id: o.sourceId ?? null, source: o.source,
          source_url: o.sourceUrl ?? null, pin_id: o.pinId ?? null, title: o.title ?? null, kind: 'image', storage_path: key,
          status: 'processing', created_by: o.createdBy ?? null, origin: o.origin ?? 'own',
        },
      })) as RefRow;
    } catch (e) {
      await this.files.delete(BUCKET, key).catch(() => undefined);
      // O mesmo Pin colado duas vezes ao mesmo tempo: o índice único decide; o segundo recebe a frase, não um 500.
      if (isUniqueViolation(e)) throw bad('Esse Pin já está nas referências.');
      throw e;
    }
  }

  /**
   * Apaga a referência (linha + arquivo). `fromSource`: o apagar vem da pasta — só apaga se a linha AINDA é daquela pasta (e, na reconciliação,
   * ainda da Seleção); se um Pin foi promovido no meio (própria, `source_id` nulo), nada some, nem o arquivo.
   */
  private async drop(r: RefRow, fromSource?: { sourceId: string; origin?: 'selection' }): Promise<boolean> {
    // `deleteMany` com a empresa: nada é apagado só pelo id.
    const where = { id: r.id, workspace_id: r.workspace_id, ...(fromSource ? { source_id: fromSource.sourceId, ...(fromSource.origin ? { origin: fromSource.origin } : {}) } : {}) };
    const { count } = await this.prisma.style_references.deleteMany({ where });
    if (fromSource && count !== 1) return false;
    if (r.storage_path) await this.files.delete(BUCKET, r.storage_path).catch(() => undefined);
    return true;
  }

  /**
   * Abre espaço para `n` novas: 8 por campanha (pedido da pessoa → recusa) e 30 por marca (saem primeiro as da Seleção, depois as mais
   * antigas vindas de pastas próprias; enviadas e Pins colados não saem sozinhos). Devolve quantas cabem (RSS adiciona só o que couber).
   */
  private async makeRoom(ws: string, brandId: string, campaignId: string | null, n: number, strict: boolean): Promise<number> {
    if (campaignId) {
      const inCampaign = await this.prisma.style_references.count({ where: { workspace_id: ws, brand_id: brandId, campaign_id: campaignId } });
      if (inCampaign + n > CAMPAIGN_CAP) throw bad('Chegou a 8 referências nesta campanha. Remova uma para pôr outra.');
    }
    const all = (await this.prisma.style_references.findMany({ where: { workspace_id: ws, brand_id: brandId }, orderBy: { created_at: 'asc' } })) as RefRow[];
    let over = all.length + n - BRAND_CAP;
    // P21′: primeiro saem as da Seleção (mais antigas; só se ainda são dela), depois as próprias vindas de pasta.
    for (const r of all) {
      if (over <= 0) break;
      if (r.origin !== 'selection' || !r.source_id) continue;
      if (await this.drop(r, { sourceId: r.source_id, origin: 'selection' })) over--;
    }
    for (const r of all) {
      if (over <= 0) break;
      if (r.origin === 'selection' || !r.source_id) continue;
      await this.drop(r);
      over--;
    }
    if (over > 0 && strict) throw bad('Chegou a 30 referências nesta marca. Remova uma para pôr outra.');
    return Math.max(0, n - Math.max(0, over));
  }

  /** Busca com redirecionamento seguido à mão; cada salto precisa estar na lista (`allow`). */
  private async get(url: string, allow: (host: string) => boolean, maxBytes: number): Promise<{ bytes: Uint8Array; type: string; finalUrl: string }> {
    let current = url;
    for (let hop = 0; hop < 5; hop++) {
      const u = new URL(current);
      if (u.protocol !== 'https:' || !allow(u.hostname)) throw new FetchFailed(`host fora da lista: ${u.hostname}`);
      const res = await this.fetchExternal(current, { redirect: 'manual', headers: { 'user-agent': UA }, signal: AbortSignal.timeout(15_000) });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        if (!loc) throw new FetchFailed('redirecionamento sem destino');
        current = new URL(loc, current).toString();
        continue;
      }
      if (!res.ok) throw new FetchFailed(`HTTP ${res.status}`);
      return { bytes: await readCapped(res, maxBytes), type: res.headers.get('content-type') ?? '', finalUrl: current };
    }
    throw new FetchFailed('redirecionamentos demais');
  }

  private async download(imageUrl: string): Promise<Uint8Array> {
    return (await this.get(imageUrl, isPinImageHost, MAX_IMAGE_BYTES)).bytes;
  }

  /** `pin.it/…` → segue os saltos (só Pinterest) até o Pin ou a pasta. */
  private async resolveShortlink(url: string) {
    let current = url;
    for (let hop = 0; hop < 5; hop++) {
      const u = new URL(current);
      if (u.protocol !== 'https:' || !isPinterestHost(u.hostname)) return null;
      const res = await this.fetchExternal(current, { redirect: 'manual', headers: { 'user-agent': UA }, signal: AbortSignal.timeout(15_000) }).catch(() => null);
      if (!res) return null;
      const loc = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
      if (!loc) {
        const parsed = parsePinterestLink(current);
        return parsed && parsed.kind !== 'shortlink' ? parsed : null;
      }
      const next = new URL(loc, current).toString();
      const parsed = parsePinterestLink(next);
      if (parsed && parsed.kind !== 'shortlink' && !/\/url_shortener\//.test(next)) {
        return isPinterestHost(new URL(next).hostname) ? parsed : null;
      }
      current = next;
    }
    return null;
  }

  /** Imagem do Pin: oEmbed (`thumbnail_url`) e, sem ele, `og:image` da página. */
  private async pinImage(pinUrl: string): Promise<string> {
    const oembed = `https://www.pinterest.com/oembed.json?url=${encodeURIComponent(pinUrl)}`;
    try {
      const r = await this.get(oembed, isPinterestHost, MAX_PAGE_BYTES);
      const img = pinImageFromOembed(JSON.parse(Buffer.from(r.bytes).toString('utf8')));
      if (img) return img;
    } catch {
      // sem oEmbed: tenta a página
    }
    try {
      const page = await this.get(pinUrl, isPinterestHost, MAX_PAGE_BYTES);
      const img = ogImage(Buffer.from(page.bytes).toString('utf8'));
      if (img) return img;
    } catch {
      // cai no erro abaixo
    }
    throw bad(MSG_PIN_IMAGE);
  }

  /** RSS da pasta como texto; Pinterest fora do ar = grava o erro na pasta (e o carimbo) e devolve null. */
  private async fetchRss(source: { id: string; workspace_id: string; rss_url: string }): Promise<string | null> {
    try {
      return Buffer.from((await this.get(source.rss_url, isPinterestHost, MAX_PAGE_BYTES)).bytes).toString('utf8');
    } catch (e) {
      this.logger.warn(`RSS ${source.rss_url}: ${(e as Error).message}`);
      await this.prisma.style_ref_sources.updateMany({ where: { id: source.id, workspace_id: source.workspace_id }, data: { last_error: MSG_RSS_DOWN, last_synced_at: new Date() } });
      return null;
    }
  }

  /** Pins do RSS que a marca ainda não conhece (nem já vistos nesta pasta: senão cada renovação reimportava e relia com IA). */
  private async freshPins(source: { workspace_id: string; brand_id: string; seen_pin_ids?: string[] }, pins: ReturnType<typeof parseRss>) {
    const known = new Set(
      ((await this.prisma.style_references.findMany({ where: { workspace_id: source.workspace_id, brand_id: source.brand_id }, select: { pin_id: true } })) as { pin_id: string | null }[])
        .map((r) => r.pin_id)
        .filter(Boolean) as string[],
    );
    for (const id of source.seen_pin_ids ?? []) known.add(id);
    return pins.filter((p) => !known.has(p.pinId));
  }

  /** Baixa e grava os Pins (um que falha não derruba os outros). Devolve as linhas criadas. */
  private async storePins(source: { id: string; workspace_id: string; brand_id: string; created_by?: string | null }, pins: ReturnType<typeof parseRss>, origin: 'own' | 'selection'): Promise<RefRow[]> {
    const created: RefRow[] = [];
    for (const p of pins) {
      try {
        const jpeg = await shrink(this.images, await this.download(p.imageUrl));
        created.push(await this.store(source.workspace_id, source.brand_id, { campaignId: null, source: 'pinterest', sourceUrl: p.link, pinId: p.pinId, title: p.title || null, sourceId: source.id, createdBy: source.created_by ?? null, origin }, jpeg));
      } catch (e) {
        this.logger.warn(`Pin ${p.pinId}: ${(e as Error).message}`);
      }
    }
    return created;
  }

  /** Grava o resultado na pasta (updateMany: pasta ou empresa apagada no meio não derruba a rodada). Devolve quantas linhas casaram. */
  private async finishSync(source: { id: string; workspace_id: string; seen_pin_ids?: string[] }, xml: string, found: number, taken: ReturnType<typeof parseRss>): Promise<number> {
    const { count } = await this.prisma.style_ref_sources.updateMany({
      where: { id: source.id, workspace_id: source.workspace_id },
      data: {
        last_synced_at: new Date(),
        last_error: found ? null : 'A pasta está vazia ou não é pública.',
        title: rssTitle(xml),
        seen_pin_ids: [...new Set([...taken.map((p) => p.pinId), ...(source.seen_pin_ids ?? [])])].slice(0, SEEN_CAP),
      },
    });
    return count;
  }

  /** Lê o RSS da fonte e adiciona até 8 Pins novos. Devolve quantos entraram, ou null se o Pinterest não respondeu. */
  private async sync(source: { id: string; workspace_id: string; brand_id: string; rss_url: string; created_by?: string | null; seen_pin_ids?: string[]; origin?: string }): Promise<number | null> {
    if (source.origin === 'selection') return this.syncSelection(source);
    const xml = await this.fetchRss(source);
    if (xml === null) return null;
    const pins = parseRss(xml);
    const fresh = (await this.freshPins(source, pins)).slice(0, PINS_PER_SYNC);
    const room = fresh.length ? await this.makeRoom(source.workspace_id, source.brand_id, null, fresh.length, false) : 0;
    const taken = fresh.slice(0, room);
    const created = await this.storePins(source, taken, 'own');
    await this.finishSync(source, xml, pins.length, taken);
    return created.length;
  }

  /**
   * `sync` de pasta da Seleção (P21′; sempre dentro da fila da marca). Nunca chama o `makeRoom`: a vaga é decidida ANTES de buscar o RSS
   * (vaga 0 = só `last_synced_at`, sem rede) e nada de próprio é tocado. Devolve quantas entraram, ou null se o Pinterest não respondeu.
   */
  private async syncSelection(source: { id: string; workspace_id: string; brand_id: string; rss_url: string; seen_pin_ids?: string[] }): Promise<number | null> {
    const ws = source.workspace_id;
    const brandId = source.brand_id;
    const folder = { id: source.id, workspace_id: ws };
    const stamp = () => this.prisma.style_ref_sources.updateMany({ where: folder, data: { last_synced_at: new Date() } });
    // 1. marca de hoje (a reconciliação tira a pasta se ela sumiu ou foi desligada).
    const brand = await this.prisma.brands.findFirst({ where: { id: brandId, workspace_id: ws }, select: QUOTA_SELECT });
    if (!brand || brand.style_library_enabled !== true) {
      await stamp();
      return 0;
    }
    const fromSelection = { workspace_id: ws, brand_id: brandId, origin: 'selection' };
    const credit = await this.aiAlerts.status(ws);
    const hasKey = await this.hasAiKey(ws);
    // 2. falhas desta pasta: a definitiva sai (o Pin já está em `seen_pin_ids`); a transitória esgotada volta para a fila quando a chave está bem.
    const failed = (await this.prisma.style_references.findMany({ where: { workspace_id: ws, source_id: source.id, origin: 'selection', status: 'failed' } })) as RefRow[];
    const exhausted: RefRow[] = [];
    for (const r of failed) {
      if (r.attempts < READ_MAX_ATTEMPTS) await this.drop(r, { sourceId: source.id, origin: 'selection' });
      else exhausted.push(r);
    }
    // R11: só freia a que espera NOVA tentativa (`attempts > 0`, sinal de chave em apuros); leitura nova (attempts 0) não freia.
    const waitingRetry = await this.prisma.style_references.count({ where: { ...fromSelection, status: 'processing', attempts: { gt: 0 } } });
    let requeued = false;
    if (exhausted.length && !credit && hasKey && waitingRetry === 0) {
      for (const r of exhausted) {
        const back = await this.prisma.style_references.updateMany({
          where: { id: r.id, workspace_id: ws, origin: 'selection', status: 'failed' },
          data: { status: 'processing', attempts: 0, claimed_at: null, error: null },
        });
        if (back.count) requeued = true;
      }
    }
    // 3. vaga: min(4, 12 − da Seleção, 30 − total, cota de hoje); 0 se a Seleção não é útil agora ou a chave não está bem.
    // A pasta que acabou de devolver falha para a fila não traz Pin novo neste mesmo sync.
    const ownUseful = await this.prisma.style_references.count({ where: { workspace_id: ws, brand_id: brandId, origin: 'own', campaign_id: null, status: { in: ['ready', 'processing'] } } });
    let room = 0;
    if (ownUseful < MAX_NOTES && !credit && waitingRetry === 0 && !requeued && hasKey) {
      const inSelection = await this.prisma.style_references.count({ where: fromSelection });
      const total = await this.prisma.style_references.count({ where: { workspace_id: ws, brand_id: brandId } });
      room = Math.max(0, Math.min(SELECTION_PER_SYNC, SELECTION_MAX - inSelection, BRAND_CAP - total, SELECTION_DAILY_NEW - selectionReadsToday(brand)));
    }
    // 4. sem vaga: não vai ao Pinterest.
    if (room === 0) {
      await stamp();
      return 0;
    }
    // 5. RSS como no sync próprio; até `room` Pins novos.
    const xml = await this.fetchRss(source);
    if (xml === null) return null;
    const pins = parseRss(xml);
    const taken = (await this.freshPins(source, pins)).slice(0, room);
    const created = await this.storePins(source, taken, 'selection');
    const matched = await this.finishSync(source, xml, pins.length, taken);
    // 6. pasta apagada no meio (ex.: cascade): o que esta rodada criou não fica solto. Pin promovido no meio (a linha existe, agora própria) fica com o arquivo.
    if (matched === 0) {
      for (const r of created) {
        if (await this.drop(r, { sourceId: source.id, origin: 'selection' })) continue;
        const still = await this.prisma.style_references.count({ where: { id: r.id, workspace_id: ws } });
        if (still === 0 && r.storage_path) await this.files.delete(BUCKET, r.storage_path).catch(() => undefined);
      }
      return 0;
    }
    // Cota do dia: a fila da marca já serializa, então é releitura + `updateMany` simples (sem `increment`).
    if (created.length) {
      const fresh = await this.prisma.brands.findFirst({ where: { id: brandId, workspace_id: ws }, select: QUOTA_SELECT });
      if (fresh) await this.prisma.brands.updateMany({ where: { id: brandId, workspace_id: ws }, data: { style_selection_day: new Date(`${todaySp()}T00:00:00Z`), style_selection_reads: selectionReadsToday(fresh) + created.length } });
    }
    return created.length;
  }
}
