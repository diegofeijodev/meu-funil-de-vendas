import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/database/prisma.service';
import { todaySp } from '../../common/time/dates';
import { WorkspaceAccessService } from '../access/access.service';
import { ActivityService } from '../activity/activity.service';
import { AiService } from '../ai/ai.service';
import { FilesService } from '../files/files.service';
import { IgStore } from '../instagram/ig-store.service';
import { imageHeaderSize, ImageService } from '../media/image.service';
import { bad } from '../media/user-error';
import { edgeColor } from './vacancy-art';
import { VacancyGate } from './vacancy-gate.service';
import { templateReadPrompt } from './vacancy-prompts';
import { LEAD_OPTIONS, UpdateVacancySettingsDto, VENDORS } from './vacancy-stories.dto';
import { norm } from './vacancy-text';
import type { SettingsRow } from './vacancy-types';
import { countVacancyStoriesOnDay } from './vacancy-usage';
import { TEMPLATE_TEXTS_SCHEMA } from './vacancy-verify';

export const DISABLED_REASON = 'Os stories das vagas foram desligados.';
export const DONT_POST_REASON = 'Você escolheu não postar.';

const BUCKET = 'creative-assets';
const MAX_TEMPLATE_MB = 10;
const MIN_TEMPLATE_SIDE = 600;
/** Linhas da fila que o "desligar" cancela (antes da entrega do post). */
const QUEUED = ['new', 'waiting', 'generating'];
/** Posts de vaga ainda não publicados que o "desligar" cancela. */
const UNPUBLISHED = ['pending_approval', 'approved', 'ready', 'scheduled'];
const READY = ['ready', 'approved', 'scheduled'];
// Só PNG/JPG (R19): o jimp do projeto não decodifica WEBP (nem a leitura da cor da borda nem a redução para a IA funcionariam).
const TEMPLATE_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg' } as const;
type TemplateMime = keyof typeof TEMPLATE_EXT;

const MSG = {
  noTemplate: 'Envie a arte modelo para poder ligar.',
  window: 'O início precisa ser antes do fim.',
  time: 'Use um horário entre 00:00 e 23:59.',
  cap: 'O máximo de stories de vagas por dia vai de 1 a 20.',
  lead: 'Escolha 1 h, 2 h, 4 h ou 6 h de antecedência.',
  vendor: 'Escolha OpenAI ou Gemini.',
  wrongType: 'Esse arquivo não serve. Envie uma imagem PNG ou JPG.',
  tooSmall: 'A arte modelo precisa ter pelo menos 600 px de largura.',
  noBrand: 'Cadastre uma marca em Marcas antes de enviar a arte modelo.',
};
/** "A imagem tem 10,6 MB…" — arredonda para cima (10 MB + 1 byte não vira "10,0 MB"). */
export const tooBigMessage = (bytes: number) =>
  `A imagem tem ${(Math.ceil((bytes / 1048576) * 10) / 10).toFixed(1).replace('.', ',')} MB e o máximo é ${MAX_TEMPLATE_MB} MB. Envie uma menor.`;

/** Tipo da arte modelo pelo CONTEÚDO (assinatura do arquivo), nunca pelo nome ou pelo tipo declarado. WEBP, GIF, SVG, PDF… = null. */
export function sniffTemplateMime(b: Uint8Array): TemplateMime | null {
  const ascii = (o: number, t: string) => b.length >= o + t.length && [...t].every((c, i) => b[o + i] === c.charCodeAt(0));
  if (b.length >= 8 && b[0] === 0x89 && ascii(1, 'PNG') && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  return null;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Textos que a IA leu na arte modelo; resposta fora do formato = nenhum texto (a arte salva mesmo assim). */
function cleanTexts(read: unknown): string[] {
  const list = (read as { textos?: unknown } | null)?.textos;
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const t of list) {
    if (typeof t !== 'string') continue;
    const s = t.replace(/\s+/g, ' ').trim().slice(0, 200);
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= 100) break;
  }
  return out;
}

/** Cidades da tela: sem espaços sobrando, sem vazias e sem repetidas (sem acento/maiúsculas), na ordem em que vieram. */
function cleanCities(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const c = raw.replace(/\s+/g, ' ').trim();
    const k = norm(c);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out.slice(0, 50);
}

const asCities = (v: unknown): { city: string; count: number }[] =>
  Array.isArray(v) ? v.filter((x): x is { city: string; count: number } => typeof x?.city === 'string' && typeof x?.count === 'number') : [];

export type VacancySettingsView = {
  enabled: boolean;
  enabled_at: Date | null;
  auto_publish: boolean;
  template: { asset_id: string; url: string | null; landscape: boolean; texts_count: number } | null;
  template_bg: string | null;
  cities: string[];
  daily_cap: number;
  window_start: string;
  window_end: string;
  min_lead_minutes: number;
  vendor: string;
  last_poll_at: Date | null;
  last_poll_ok_at: Date | null;
  last_poll_error: string | null;
  recent_cities: { city: string; count: number }[];
  instagram: { connected: boolean; username: string | null };
  today: { posted: number; scheduled: number; cap: number };
  pending_approval: number;
  counts: { ready: number; to_approve: number };
  ai_error: string | null;
  ai_error_at: Date | null;
  preview: unknown;
  recent_outcomes: { n: number; first_try: number; redone: number; fallback: number; not_posted: number };
  week: { total: number; fallback: number };
};

/**
 * Ajustes dos stories das vagas (1 linha por empresa, criada com os padrões na 1ª leitura), arte modelo, ligar/desligar e
 * "postar sozinho". Toda entrada pública confere o portão (`VacancyGate`) ANTES do acesso (R20): fora da lista = 404, até para membro sem papel.
 */
@Injectable()
export class VacancySettingsService {
  private readonly logger = new Logger(VacancySettingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
    private readonly activity: ActivityService,
    private readonly files: FilesService,
    private readonly images: ImageService,
    private readonly ai: AiService,
    private readonly store: IgStore,
    private readonly gate: VacancyGate,
  ) {}

  /** Configuração da empresa; cria com os padrões do banco na 1ª leitura (upsert: duas leituras ao mesmo tempo não colidem). */
  async get(workspaceId: string): Promise<SettingsRow> {
    const found = await this.prisma.vacancy_story_settings.findUnique({ where: { workspace_id: workspaceId } });
    if (found) return found;
    return this.prisma.vacancy_story_settings.upsert({ where: { workspace_id: workspaceId }, create: { workspace_id: workspaceId }, update: {} });
  }

  async view(workspaceId: string, now = new Date()): Promise<VacancySettingsView> {
    this.gate.assert(workspaceId);
    const s = await this.get(workspaceId);
    const vacancyPosts = { workspace_id: workspaceId, source: 'vacancy' };
    const [today, account, template, ready, toApprove, recent, week] = await Promise.all([
      countVacancyStoriesOnDay(this.prisma, workspaceId, todaySp(now)),
      this.store.liveAccount(workspaceId),
      this.templateView(s),
      this.prisma.ig_posts.count({ where: { ...vacancyPosts, status: { in: READY } } }),
      this.prisma.ig_posts.count({ where: { ...vacancyPosts, status: 'pending_approval' } }),
      this.recentOutcomes(workspaceId),
      this.week(workspaceId, now),
    ]);
    return {
      enabled: s.enabled,
      enabled_at: s.enabled_at,
      auto_publish: s.auto_publish,
      template,
      template_bg: s.template_bg,
      cities: s.cities,
      daily_cap: s.daily_cap,
      window_start: s.window_start,
      window_end: s.window_end,
      min_lead_minutes: s.min_lead_minutes,
      vendor: s.vendor,
      last_poll_at: s.last_poll_at,
      last_poll_ok_at: s.last_poll_ok_at,
      last_poll_error: s.last_poll_error,
      recent_cities: asCities(s.recent_cities),
      instagram: { connected: !!account, username: account?.username ?? null },
      today: { ...today, cap: s.daily_cap },
      pending_approval: toApprove,
      counts: { ready, to_approve: toApprove },
      ai_error: s.ai_error,
      ai_error_at: s.ai_error_at,
      preview: s.preview,
      recent_outcomes: recent,
      week,
    };
  }

  async update(userId: string, workspaceId: string, dto: UpdateVacancySettingsDto): Promise<VacancySettingsView> {
    this.gate.assert(workspaceId);
    await this.access.require(userId, workspaceId, 'write');
    const s = await this.get(workspaceId);
    const start = dto.window_start ?? s.window_start;
    const end = dto.window_end ?? s.window_end;
    // O DTO já barra o formato; aqui a regra entre os dois campos (com o que já está salvo) e a defesa do CHECK do banco.
    if (!HHMM.test(start) || !HHMM.test(end)) throw bad(MSG.time);
    if (start >= end) throw bad(MSG.window);
    if (dto.daily_cap !== undefined && (!Number.isInteger(dto.daily_cap) || dto.daily_cap < 1 || dto.daily_cap > 20)) throw bad(MSG.cap);
    if (dto.min_lead_minutes !== undefined && !(LEAD_OPTIONS as readonly number[]).includes(dto.min_lead_minutes)) throw bad(MSG.lead);
    if (dto.vendor !== undefined && !(VENDORS as readonly string[]).includes(dto.vendor)) throw bad(MSG.vendor);
    await this.prisma.vacancy_story_settings.update({
      where: { workspace_id: workspaceId },
      data: {
        window_start: start,
        window_end: end,
        ...(dto.cities !== undefined ? { cities: cleanCities(dto.cities) } : {}),
        ...(dto.daily_cap !== undefined ? { daily_cap: dto.daily_cap } : {}),
        ...(dto.min_lead_minutes !== undefined ? { min_lead_minutes: dto.min_lead_minutes } : {}),
        ...(dto.vendor !== undefined ? { vendor: dto.vendor } : {}),
      },
    });
    return this.view(workspaceId);
  }

  /** Liga (exige a arte modelo). `enabled_at` = agora é a marca d'água: só vagas publicadas depois entram. Já ligado = nada muda. */
  async enable(userId: string, workspaceId: string): Promise<VacancySettingsView> {
    this.gate.assert(workspaceId);
    await this.access.require(userId, workspaceId, 'manage');
    const s = await this.get(workspaceId);
    if (!s.template_asset_id) throw bad(MSG.noTemplate);
    if (!s.enabled) {
      const r = await this.prisma.vacancy_story_settings.updateMany({
        where: { workspace_id: workspaceId, enabled: false },
        data: { enabled: true, enabled_at: new Date(), enabled_by: userId },
      });
      if (r.count) await this.activity.log(workspaceId, userId, 'vacancy_stories.enable', 'vacancy_stories', { auto_publish: s.auto_publish });
    }
    return this.view(workspaceId);
  }

  /**
   * Desliga: cancela as linhas na fila/esperando/gerando e os posts de vaga ainda não publicados (com os jobs pendentes), com o
   * motivo na linha (a tela lê o `skip_reason` também para o post cancelado). Devolve quantos (linhas + posts) foram cancelados.
   */
  async disable(userId: string, workspaceId: string): Promise<{ ok: true; cancelled: number }> {
    this.gate.assert(workspaceId);
    await this.access.require(userId, workspaceId, 'manage');
    await this.get(workspaceId);
    const cancelled = await this.turnOff(workspaceId, userId, {});
    return { ok: true, cancelled };
  }

  /** Desliga e cancela (sem checar acesso): usado pelo botão (`disable`) e pelo job quando a arte modelo some. Devolve linhas + posts cancelados. */
  async turnOff(workspaceId: string, actorId: string | null, meta: Record<string, unknown> = {}): Promise<number> {
    const cancelled = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.vacancy_stories.updateMany({
        where: { workspace_id: workspaceId, status: { in: QUEUED } },
        data: { status: 'cancelled', skip_reason: DISABLED_REASON, lease_until: null },
      });
      const open = await tx.ig_posts.findMany({ where: { workspace_id: workspaceId, source: 'vacancy', status: { in: UNPUBLISHED } }, select: { id: true } });
      let posts = 0;
      if (open.length) {
        const ids = open.map((p) => p.id);
        // Condicional ao status: um post que virou `publishing` entre a leitura e aqui segue.
        posts = (await tx.ig_posts.updateMany({ where: { id: { in: ids }, workspace_id: workspaceId, status: { in: UNPUBLISHED } }, data: { status: 'cancelled' } })).count;
        const done = (await tx.ig_posts.findMany({ where: { id: { in: ids }, workspace_id: workspaceId, status: 'cancelled' }, select: { id: true } })).map((p) => p.id);
        if (done.length) {
          await tx.publishing_jobs.updateMany({ where: { ig_post_id: { in: done }, workspace_id: workspaceId, status: 'pending' }, data: { status: 'cancelled', locked_at: null } });
          await tx.vacancy_stories.updateMany({ where: { workspace_id: workspaceId, ig_post_id: { in: done } }, data: { skip_reason: DISABLED_REASON } });
        }
      }
      await tx.vacancy_story_settings.update({ where: { workspace_id: workspaceId }, data: { enabled: false } });
      return rows.count + posts;
    });
    await this.activity.log(workspaceId, actorId, 'vacancy_stories.disable', 'vacancy_stories', { cancelled, ...meta });
    return cancelled;
  }

  async setAutoPublish(userId: string, workspaceId: string, value: boolean): Promise<VacancySettingsView> {
    this.gate.assert(workspaceId);
    await this.access.require(userId, workspaceId, 'manage');
    await this.get(workspaceId);
    await this.prisma.vacancy_story_settings.update({ where: { workspace_id: workspaceId }, data: { auto_publish: value } });
    await this.activity.log(workspaceId, userId, 'vacancy_stories.auto_publish', 'vacancy_stories', { auto_publish: value });
    return this.view(workspaceId);
  }

  /**
   * Arte modelo: tipo pelo conteúdo (PNG/JPG), até 10 MB, lado menor ≥ 600 px, marca da empresa (D1). Grava o arquivo e a linha de
   * `brand_assets` (`vacancy_template`), lê os textos com a IA (imagem reduzida a 1024 px) e guarda a cor da borda. Falha da leitura
   * apaga a linha e o arquivo e repassa o erro da IA. Arte deitada salva, com o aviso `landscape`.
   */
  async uploadTemplate(
    userId: string,
    workspaceId: string,
    file: { bytes: Buffer; mime: string; filename: string },
  ): Promise<VacancySettingsView & { warning: 'landscape' | null }> {
    this.gate.assert(workspaceId);
    await this.access.require(userId, workspaceId, 'write');
    const bytes = file.bytes;
    const mime = sniffTemplateMime(bytes);
    if (!mime) throw bad(MSG.wrongType);
    if (bytes.length > MAX_TEMPLATE_MB * 1024 * 1024) throw bad(tooBigMessage(bytes.length));
    const dim = imageHeaderSize(bytes);
    if (!dim || dim.width < 1 || dim.height < 1) throw bad(MSG.wrongType);
    if (Math.min(dim.width, dim.height) < MIN_TEMPLATE_SIDE) throw bad(MSG.tooSmall);
    const s = await this.get(workspaceId);
    const brandId = await this.templateBrand(workspaceId, s.brand_id);
    // Decodifica antes de gravar qualquer coisa: arquivo corrompido para aqui (400 do ImageService), sem sobrar arquivo.
    const shrunk = await this.images.shrink(bytes, 1024);
    const bg = await edgeColor(this.images, bytes);
    const landscape = dim.width > dim.height;

    const key = this.files.newUploadKey('brands', workspaceId, TEMPLATE_EXT[mime]);
    await this.files.put(BUCKET, key, bytes);
    let assetId: string | null = null;
    try {
      const asset = await this.prisma.brand_assets.create({
        data: { workspace_id: workspaceId, brand_id: brandId, kind: 'vacancy_template', name: safeName(file.filename), url: this.files.signedUrl(BUCKET, key), storage_path: key },
        select: { id: true },
      });
      assetId = asset.id;
      const read = await this.ai.json<{ textos?: unknown }>(workspaceId, {
        name: 'vacancy_template_texts',
        prompt: templateReadPrompt(),
        schema: TEMPLATE_TEXTS_SCHEMA,
        images: [shrunk],
      });
      await this.prisma.vacancy_story_settings.update({
        where: { workspace_id: workspaceId },
        data: { template_asset_id: asset.id, template_texts: cleanTexts(read), template_bg: bg, template_landscape: landscape, brand_id: brandId },
      });
    } catch (e) {
      if (assetId) {
        await this.prisma.brand_assets.deleteMany({ where: { id: assetId, workspace_id: workspaceId } }).catch((err) => this.logger.warn(`arte modelo: linha ${assetId} não apagada: ${err}`));
      }
      await this.files.delete(BUCKET, key).catch((err) => this.logger.warn(`arte modelo: arquivo ${key} não apagado: ${err}`));
      throw e;
    }
    return { ...(await this.view(workspaceId)), warning: landscape ? 'landscape' : null };
  }

  // ------------------------------------------------------------------ helpers

  /** D1: a marca dos ajustes (se ainda for da empresa) ou a mais antiga da empresa. */
  private async templateBrand(workspaceId: string, current: string | null): Promise<string> {
    if (current) {
      const b = await this.prisma.brands.findFirst({ where: { id: current, workspace_id: workspaceId }, select: { id: true } });
      if (b) return b.id;
    }
    const oldest = await this.prisma.brands.findFirst({ where: { workspace_id: workspaceId }, orderBy: { created_at: 'asc' }, select: { id: true } });
    if (!oldest) throw bad(MSG.noBrand);
    return oldest.id;
  }

  private async templateView(s: SettingsRow): Promise<VacancySettingsView['template']> {
    if (!s.template_asset_id) return null;
    const a = await this.prisma.brand_assets.findFirst({ where: { id: s.template_asset_id, workspace_id: s.workspace_id }, select: { id: true, url: true } });
    if (!a) return null;
    return { asset_id: a.id, url: a.url, landscape: s.template_landscape, texts_count: s.template_texts.length };
  }

  /**
   * Como foram os últimos 20 stories entregues ou que você não postou (diálogo "Postar sozinho"): de primeira, refeitos pela
   * conferência, na reserva, ou não postados (linha cancelada por você antes da entrega, ou post recusado).
   */
  private async recentOutcomes(workspaceId: string): Promise<VacancySettingsView['recent_outcomes']> {
    const rows = await this.prisma.vacancy_stories.findMany({
      where: { workspace_id: workspaceId, OR: [{ status: 'handed_off' }, { status: 'cancelled', skip_reason: DONT_POST_REASON }] },
      orderBy: { created_at: 'desc' },
      take: 20,
      select: { status: true, ig_post_id: true, used_fallback: true, mismatch_attempts: true },
    });
    const ids = rows.map((r) => r.ig_post_id).filter((x): x is string => !!x);
    const rejected = new Set(
      ids.length
        ? (await this.prisma.ig_posts.findMany({ where: { id: { in: ids }, workspace_id: workspaceId, rejection_reason: { not: null } }, select: { id: true } })).map((p) => p.id)
        : [],
    );
    const out = { n: rows.length, first_try: 0, redone: 0, fallback: 0, not_posted: 0 };
    for (const r of rows) {
      if (r.status === 'cancelled' || (r.ig_post_id && rejected.has(r.ig_post_id))) out.not_posted++;
      else if (r.used_fallback) out.fallback++;
      else if (r.mismatch_attempts > 0) out.redone++;
      else out.first_try++;
    }
    return out;
  }

  /** Stories de vaga entregues nos últimos 7 dias e quantos foram para a reserva (aviso semanal). */
  private async week(workspaceId: string, now: Date): Promise<VacancySettingsView['week']> {
    const base = { workspace_id: workspaceId, source: 'vacancy', created_at: { gte: new Date(now.getTime() - 7 * 86_400_000) } };
    const [total, fallback] = await Promise.all([
      this.prisma.ig_posts.count({ where: base }),
      this.prisma.ig_posts.count({ where: { ...base, creative_brief: { path: ['vacancy', 'used_fallback'], equals: true } } }),
    ]);
    return { total, fallback };
  }
}

/** Nome do arquivo para a tela de Marcas (sem caracteres de controle). */
const safeName = (name: string) => name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 150) || 'arte-modelo';
