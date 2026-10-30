/**
 * Estilo das artes (Fatias 5 e 6, spec §2.3 + §0.8 #5): referências enviadas, Pins colados e pastas/perfis públicos do Pinterest
 * acompanhados pelo RSS. Cada referência vira NOTAS DE ESTILO em texto (IA de visão); a imagem fica guardada só para a tela
 * (bucket `style-refs`, ≤ 1024 px) e nunca vai ao gerador, à Biblioteca, à Meta ou ao Instagram.
 */
import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { ENV } from '../../common/config/env.module';
import type { Env } from '../../common/config/env.validation';
import { PrismaService } from '../../common/database/prisma.service';
import { isUniqueViolation } from '../../common/database/next-version';
import { WorkspaceAccessService } from '../access/access.service';
import { AiService } from '../ai/ai.service';
import { FilesService } from '../files/files.service';
import { EXTERNAL_FETCH, ExternalFetch } from '../media/external-fetch';
import { ImageService } from '../media/image.service';
import { isPinImageHost, isPinterestHost, ogImage, parsePinterestLink, parseRss, pinImageFromOembed, rssTitle } from './pinterest';
import { normalizeStyleNotes, notesSummary, STYLE_NOTES_PROMPT, STYLE_NOTES_SCHEMA, StyleNotes, styleNotesText } from './style-notes';

const BUCKET = 'style-refs';
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_PAGE_BYTES = 2 * 1024 * 1024;
const MAX_SIDE = 1024;
export const BRAND_CAP = 30;
export const CAMPAIGN_CAP = 8;
const SOURCE_CAP = 5;
const PINS_PER_SYNC = 8;
const RESYNC_MS = 24 * 3600_000;
const STALE_CLAIM_MS = 10 * 60_000;
const SEEN_CAP = 300;
const VIEW_URL_TTL_S = 3600;
const UA = 'Mozilla/5.0 (compatible; MeuFunil/1.0; +https://www.meufunildevendas.com.br)';

const bad = (message: string) => new BadRequestException({ code: 'BAD_REQUEST', message });
const MSG_NOT_PINTEREST = 'Esse link não é de um Pin nem de uma pasta do Pinterest. No Pinterest, toque em Compartilhar → Copiar link.';
const MSG_PIN_IMAGE = 'Não conseguimos pegar a imagem desse Pin. Salve a imagem no celular e envie aqui.';
const MSG_READ_FAILED = 'Não conseguimos ler o estilo desta referência. Remova e tente outra.';
const MSG_RSS_DOWN = 'O Pinterest não respondeu agora. Tentamos de novo amanhã.';

class FetchFailed extends Error {}

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

type RefRow = {
  id: string; workspace_id: string; brand_id: string; campaign_id: string | null; source_id: string | null; source: string;
  source_url: string | null; pin_id: string | null; title: string | null; storage_path: string | null; style_notes: unknown;
  status: string; error: string | null; claimed_at: Date | null; created_at: Date;
};

export type StyleRefView = {
  id: string; source: string; source_url: string | null; title: string | null; status: string; summary: string | null; error: string | null;
  image_url: string | null; campaign_id: string | null; from_source: boolean; created_at: Date;
};

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
export class StyleRefsService {
  private readonly logger = new Logger(StyleRefsService.name);
  /** Lê o estilo logo depois de adicionar (em segundo plano). Os testes desligam e chamam `processPending`. */
  autoProcess = true;
  private readonly pinterestOn: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
    private readonly ai: AiService,
    private readonly files: FilesService,
    private readonly images: ImageService,
    @Inject(EXTERNAL_FETCH) private readonly fetchExternal: ExternalFetch,
    @Inject(ENV) env: Pick<Env, 'STYLE_REFS_PINTEREST_ENABLED'>,
  ) {
    this.pinterestOn = env.STYLE_REFS_PINTEREST_ENABLED === true;
  }

  pinterestEnabled(): boolean {
    return this.pinterestOn;
  }

  // ── leitura ────────────────────────────────────────────────────────────

  async list(userId: string, ws: string, brandId: string, campaignId?: string | null) {
    await this.access.require(userId, ws, 'read');
    await this.brand(ws, brandId);
    const rows = (await this.prisma.style_references.findMany({
      where: campaignId ? { workspace_id: ws, brand_id: brandId, OR: [{ campaign_id: campaignId }, { campaign_id: null }] } : { workspace_id: ws, brand_id: brandId },
      orderBy: { created_at: 'desc' },
      take: BRAND_CAP + CAMPAIGN_CAP,
    })) as RefRow[];
    const sources = await this.prisma.style_ref_sources.findMany({ where: { workspace_id: ws, brand_id: brandId }, orderBy: { created_at: 'asc' } });
    return {
      refs: rows.map((r) => this.view(r)),
      sources: sources.map((s) => ({ id: s.id, url: s.url, title: s.title, last_synced_at: s.last_synced_at, last_error: s.last_error })),
      limits: {
        campaign: CAMPAIGN_CAP,
        brand: BRAND_CAP,
        in_campaign: campaignId ? rows.filter((r) => r.campaign_id === campaignId).length : 0,
        pinterest: this.pinterestOn,
      },
    };
  }

  /** Texto para o diretor de arte/vídeo: até 8 prontas (as da campanha primeiro, depois as da marca), ou null. */
  async loadStyleNotes(ws: string, brandId: string | null | undefined, campaignId?: string | null): Promise<string | null> {
    if (!brandId) return null;
    const rows = (await this.prisma.style_references.findMany({
      where: { workspace_id: ws, brand_id: brandId, status: 'ready' },
      orderBy: { created_at: 'desc' },
      take: BRAND_CAP + CAMPAIGN_CAP,
    })) as RefRow[];
    const usable = rows.filter((r) => !r.campaign_id || r.campaign_id === campaignId);
    usable.sort((a, b) => Number(b.campaign_id === campaignId && !!campaignId) - Number(a.campaign_id === campaignId && !!campaignId));
    const notes = usable.map((r) => normalizeStyleNotes(r.style_notes)).filter((n): n is StyleNotes => !!n);
    return styleNotesText(notes);
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
    return this.view(row);
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

    if (link.kind === 'pin') {
      const dup = await this.prisma.style_references.findFirst({ where: { workspace_id: ws, brand_id: brandId, pin_id: link.pinId } });
      if (dup) throw bad('Esse Pin já está nas referências.');
      const imageUrl = await this.pinImage(link.url);
      const jpeg = await this.download(imageUrl).then((b) => shrink(this.images, b)).catch(() => {
        throw bad(MSG_PIN_IMAGE);
      });
      await this.makeRoom(ws, brandId, campaignId ?? null, 1, true);
      const row = await this.store(ws, brandId, { campaignId: campaignId ?? null, source: 'pinterest', sourceUrl: link.url, pinId: link.pinId, createdBy: userId }, jpeg);
      this.kick();
      return { kind: 'pin' as const, added: 1, refs: [this.view(row)] };
    }

    let source = await this.prisma.style_ref_sources.findFirst({ where: { workspace_id: ws, brand_id: brandId, rss_url: link.rssUrl } });
    if (!source) {
      const count = await this.prisma.style_ref_sources.count({ where: { workspace_id: ws, brand_id: brandId } });
      if (count >= SOURCE_CAP) throw bad('Você já acompanha 5 pastas nesta marca. Pare uma para pôr outra.');
      try {
        source = await this.prisma.style_ref_sources.create({ data: { workspace_id: ws, brand_id: brandId, url: link.url, rss_url: link.rssUrl, created_by: userId } });
      } catch (e) {
        if (!isUniqueViolation(e)) throw e;
        source = await this.prisma.style_ref_sources.findFirst({ where: { workspace_id: ws, brand_id: brandId, rss_url: link.rssUrl } });
        if (!source) throw e;
      }
    }
    const added = await this.sync(source);
    if (added === null) throw bad('Não conseguimos ler essa pasta do Pinterest agora. Confira se ela é pública e tente de novo.');
    this.kick();
    return { kind: link.kind, added };
  }

  // ── remover ────────────────────────────────────────────────────────────

  async remove(userId: string, ws: string, brandId: string, id: string) {
    await this.access.require(userId, ws, 'write');
    const row = (await this.prisma.style_references.findFirst({ where: { id, workspace_id: ws, brand_id: brandId } })) as RefRow | null;
    if (!row) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Referência não encontrada.' });
    await this.drop(row);
    return { ok: true };
  }

  /** Parar de acompanhar a pasta: ela e as referências que vieram dela saem. */
  async removeSource(userId: string, ws: string, brandId: string, sourceId: string) {
    await this.access.require(userId, ws, 'write');
    const src = await this.prisma.style_ref_sources.findFirst({ where: { id: sourceId, workspace_id: ws, brand_id: brandId } });
    if (!src) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Pasta não encontrada.' });
    const refs = (await this.prisma.style_references.findMany({ where: { workspace_id: ws, source_id: sourceId } })) as RefRow[];
    for (const r of refs) await this.drop(r);
    await this.prisma.style_ref_sources.delete({ where: { id: sourceId } });
    return { ok: true, removed: refs.length };
  }

  // ── job ────────────────────────────────────────────────────────────────

  /** Lê o estilo das pendentes (com trava otimista; trava vencida em 10 min volta para a fila). Devolve quantas processou. */
  async processPending(limit = 5): Promise<number> {
    const now = Date.now();
    const rows = ((await this.prisma.style_references.findMany({ where: { status: 'processing' }, orderBy: { created_at: 'asc' }, take: limit * 4 })) as RefRow[])
      .filter((r) => !r.claimed_at || now - new Date(r.claimed_at).getTime() > STALE_CLAIM_MS)
      .slice(0, limit);
    let done = 0;
    for (const r of rows) {
      const claim = await this.prisma.style_references.updateMany({ where: { id: r.id, status: 'processing', claimed_at: r.claimed_at }, data: { claimed_at: new Date() } });
      if (claim.count !== 1) continue;
      try {
        const bytes = await this.files.read(BUCKET, r.storage_path!);
        const raw = await this.ai.json(r.workspace_id, {
          prompt: STYLE_NOTES_PROMPT,
          schema: STYLE_NOTES_SCHEMA as unknown as Record<string, unknown>,
          name: 'style_notes',
          images: [{ bytes: new Uint8Array(bytes), mime: 'image/jpeg' }],
        });
        const notes = normalizeStyleNotes(raw);
        if (!notes) throw new Error('notas vazias');
        await this.prisma.style_references.update({ where: { id: r.id }, data: { status: 'ready', style_notes: notes as unknown as Prisma.InputJsonObject, error: null } });
      } catch (e) {
        this.logger.warn(`estilo da referência ${r.id}: ${(e as Error).message}`);
        await this.prisma.style_references.update({ where: { id: r.id }, data: { status: 'failed', error: MSG_READ_FAILED } });
      }
      done++;
    }
    return done;
  }

  /** Renova as pastas acompanhadas há mais de 24 h. Devolve quantas tentou. */
  async refreshDueSources(limit = 3): Promise<number> {
    if (!this.pinterestOn) return 0;
    const cutoff = Date.now() - RESYNC_MS;
    const due = (await this.prisma.style_ref_sources.findMany({ orderBy: { created_at: 'asc' }, take: 200 }))
      .filter((s) => !s.last_synced_at || new Date(s.last_synced_at).getTime() < cutoff)
      .slice(0, limit);
    for (const s of due) await this.sync(s);
    return due.length;
  }

  // ── internos ───────────────────────────────────────────────────────────

  private kick() {
    if (!this.autoProcess) return;
    setTimeout(() => void this.processPending(PINS_PER_SYNC).catch((e) => this.logger.warn(`ler estilo: ${(e as Error).message}`)), 0);
  }

  private view(r: RefRow): StyleRefView {
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
      from_source: !!r.source_id,
      created_at: r.created_at,
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
    o: { campaignId: string | null; source: 'upload' | 'pinterest'; sourceUrl?: string; pinId?: string; title?: string | null; sourceId?: string; createdBy?: string | null },
    jpeg: Uint8Array,
  ): Promise<RefRow> {
    const key = `${ws}/${brandId}/${randomUUID()}.jpg`;
    await this.files.put(BUCKET, key, jpeg);
    try {
      return (await this.prisma.style_references.create({
        data: {
          workspace_id: ws, brand_id: brandId, campaign_id: o.campaignId, source_id: o.sourceId ?? null, source: o.source,
          source_url: o.sourceUrl ?? null, pin_id: o.pinId ?? null, title: o.title ?? null, kind: 'image', storage_path: key,
          status: 'processing', created_by: o.createdBy ?? null,
        },
      })) as RefRow;
    } catch (e) {
      await this.files.delete(BUCKET, key).catch(() => undefined);
      // O mesmo Pin colado duas vezes ao mesmo tempo: o índice único decide; o segundo recebe a frase, não um 500.
      if (isUniqueViolation(e)) throw bad('Esse Pin já está nas referências.');
      throw e;
    }
  }

  private async drop(r: RefRow) {
    await this.prisma.style_references.delete({ where: { id: r.id } });
    if (r.storage_path) await this.files.delete(BUCKET, r.storage_path).catch(() => undefined);
  }

  /**
   * Abre espaço para `n` novas: 8 por campanha (pedido da pessoa → recusa) e 30 por marca (saem as mais antigas vindas de pastas;
   * enviadas e Pins colados não saem sozinhos). Devolve quantas cabem (RSS adiciona só o que couber).
   */
  private async makeRoom(ws: string, brandId: string, campaignId: string | null, n: number, strict: boolean): Promise<number> {
    if (campaignId) {
      const inCampaign = await this.prisma.style_references.count({ where: { workspace_id: ws, brand_id: brandId, campaign_id: campaignId } });
      if (inCampaign + n > CAMPAIGN_CAP) throw bad('Chegou a 8 referências nesta campanha. Remova uma para pôr outra.');
    }
    const all = (await this.prisma.style_references.findMany({ where: { workspace_id: ws, brand_id: brandId }, orderBy: { created_at: 'asc' } })) as RefRow[];
    let over = all.length + n - BRAND_CAP;
    for (const r of all) {
      if (over <= 0) break;
      if (!r.source_id) continue;
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

  /** Lê o RSS da fonte e adiciona até 8 Pins novos. Devolve quantos entraram, ou null se o Pinterest não respondeu. */
  private async sync(source: { id: string; workspace_id: string; brand_id: string; rss_url: string; created_by?: string | null; seen_pin_ids?: string[] }): Promise<number | null> {
    let xml: string;
    try {
      xml = Buffer.from((await this.get(source.rss_url, isPinterestHost, MAX_PAGE_BYTES)).bytes).toString('utf8');
    } catch (e) {
      this.logger.warn(`RSS ${source.rss_url}: ${(e as Error).message}`);
      await this.prisma.style_ref_sources.update({ where: { id: source.id }, data: { last_error: MSG_RSS_DOWN, last_synced_at: new Date() } });
      return null;
    }
    const pins = parseRss(xml);
    const known = new Set(
      ((await this.prisma.style_references.findMany({ where: { workspace_id: source.workspace_id, brand_id: source.brand_id }, select: { pin_id: true } })) as { pin_id: string | null }[])
        .map((r) => r.pin_id)
        .filter(Boolean) as string[],
    );
    // Pins já vistos nesta pasta (removidos ou que saíram pelo teto) não voltam: senão cada renovação reimportava e relia com IA.
    for (const id of source.seen_pin_ids ?? []) known.add(id);
    const fresh = pins.filter((p) => !known.has(p.pinId)).slice(0, PINS_PER_SYNC);
    const room = fresh.length ? await this.makeRoom(source.workspace_id, source.brand_id, null, fresh.length, false) : 0;
    let added = 0;
    for (const p of fresh.slice(0, room)) {
      try {
        const jpeg = await shrink(this.images, await this.download(p.imageUrl));
        await this.store(source.workspace_id, source.brand_id, { campaignId: null, source: 'pinterest', sourceUrl: p.link, pinId: p.pinId, title: p.title || null, sourceId: source.id, createdBy: source.created_by ?? null }, jpeg);
        added++;
      } catch (e) {
        this.logger.warn(`Pin ${p.pinId}: ${(e as Error).message}`);
      }
    }
    await this.prisma.style_ref_sources.update({
      where: { id: source.id },
      data: {
        last_synced_at: new Date(),
        last_error: pins.length ? null : 'A pasta está vazia ou não é pública.',
        title: rssTitle(xml),
        seen_pin_ids: [...new Set([...fresh.slice(0, room).map((p) => p.pinId), ...(source.seen_pin_ids ?? [])])].slice(0, SEEN_CAP),
      },
    });
    return added;
  }
}
