import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { ActivityService } from '../../activity/activity.service';
import { FilesService } from '../../files/files.service';
import { IgTable, igWorld, uuid } from '../../instagram/__tests__/harness';
import { ImageService } from '../../media/image.service';
import { ENV_FOR_TESTS, WS_A, memMembers } from '../../media/__tests__/mem';
import { VacancyFeedClient, type FreelaFetch } from '../vacancy-feed';
import { VacancyGate } from '../vacancy-gate.service';
import { VacancyGuardService } from '../vacancy-guard.service';
import { VacancySettingsService } from '../vacancy-settings.service';
import type { ArtRead, FreelaVacancy } from '../vacancy-types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Req = any;

/**
 * IA falsa: `json` responde pelo nome do schema (`jsonBy[name]`, que pode lançar); `image` lança até ser programada.
 * Nenhuma rede.
 */
export function fakeAi() {
  const jsonBy: Record<string, (req: Req) => unknown> = {};
  const ai = {
    json: jest.fn(async (_ws: string, req: Req) => {
      const fn = jsonBy[req?.name];
      if (!fn) throw new Error(`IA falsa sem resposta para "${req?.name}".`);
      return fn(req);
    }),
    image: jest.fn(async (_ws: string, _req: Req): Promise<unknown> => {
      throw new Error('IA falsa: image não programada.');
    }),
  };
  return { ai, jsonBy };
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/**
 * Vitrine falsa do Freela por trás da porta `FREELA_VACANCIES_FETCH`: `vacancies` = resposta de `recent`; `byId` procura em `byId`
 * e depois em `vacancies`; `closed` = 404 (vaga fechada); `down` = 503 (vitrine fora do ar). `urls` guarda cada chamada.
 */
export function fakeFeed() {
  const state = {
    vacancies: [] as FreelaVacancy[],
    byId: new Map<string, FreelaVacancy>(),
    closed: new Set<string>(),
    down: false,
    urls: [] as string[],
  };
  const fetch: FreelaFetch = async (url) => {
    state.urls.push(url);
    if (state.down) return new Response('fora do ar', { status: 503 });
    if (url.includes('/public/vacancies/recent')) return json(200, { data: state.vacancies });
    const m = url.match(/\/public\/vacancies\/([^/?]+)$/);
    if (!m) return json(404, { error: 'not found' });
    const id = decodeURIComponent(m[1]!);
    const v = state.closed.has(id) ? null : (state.byId.get(id) ?? state.vacancies.find((x) => x.id === id) ?? null);
    return v ? json(200, { data: v }) : json(404, { error: 'not found' });
  };
  return { state, fetch };
}

/** Arquivos gravados no disco temporário (caminhos relativos ao `UPLOADS_DIR`). */
function listFiles(dir: string, base = dir): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? listFiles(path.join(dir, e.name), base) : [path.relative(base, path.join(dir, e.name))],
  );
}

/**
 * Mundo dos stories das vagas: tabelas do Instagram em memória (`igWorld`) + `activity_logs`, arquivos num diretório temporário
 * (`FilesService` real, como `media/__tests__/mem.ts`), `ImageService` real, IA falsa e vitrine falsa. Lista de empresas = `list`
 * (padrão: só a empresa A).
 */
export function vacancyWorld(o: { list?: string } = {}) {
  const w = igWorld();
  w.t['activity_logs'] = new IgTable();
  w.prisma.activity_logs = w.t['activity_logs'];
  // Membros além dos fixos de `mem.ts` (ex.: viewer/editor da empresa B), lidos antes deles.
  const extraMembers: [string, string, string][] = [];
  w.prisma.workspace_members = {
    findUnique: async (a: Req) => {
      const k = a.where.workspace_id_user_id;
      const m = extraMembers.find(([ws, u]) => ws === k.workspace_id && u === k.user_id);
      return m ? { role: m[2] } : memMembers.findUnique(a);
    },
    findMany: memMembers.findMany,
  };
  const member = (workspaceId: string, userId: string, role: 'owner' | 'admin' | 'marketing' | 'viewer') => extraMembers.push([workspaceId, userId, role]);
  const dir = mkdtempSync(path.join(tmpdir(), 'mf-vagas-'));
  const env = { ...ENV_FOR_TESTS, UPLOADS_DIR: dir, VACANCY_STORIES_WORKSPACE_IDS: o.list ?? WS_A, FREELA_PUBLIC_API_URL: 'http://freela.test' };
  const files = new FilesService(env);
  const images = new ImageService();
  const { ai, jsonBy } = fakeAi();
  const feed = fakeFeed();
  const feedClient = new VacancyFeedClient(env, feed.fetch);
  const gate = new VacancyGate(env);
  const activity = new ActivityService(w.prisma);
  const guard = new VacancyGuardService();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const settings = new VacancySettingsService(w.prisma, w.access, activity, files, images, ai as any, w.store, gate);
  /** Marca da empresa (a arte modelo precisa de uma — D1). */
  const brand = (over: Record<string, unknown> = {}) => {
    const b = { id: uuid(), workspace_id: WS_A, name: 'Freela Serviços', primary_color: '#ff6600', created_at: new Date(), ...over };
    w.t['brands']!.rows.push(b);
    return b;
  };
  /**
   * IA da arte das vagas, programável: cada chamada de `image` tira o próximo item de `images` — `Error` lança, qualquer outro valor
   * (ou fila vazia) devolve um PNG de verdade feito com jimp (2:3 como o gpt-image-1; pequeno para o jest andar). Cada leitura
   * `json('vacancy_art_read')` devolve o próximo item de `reads` (`Error` lança; o último se repete).
   */
  const programArt = async (o: { reads: (ArtRead | Error)[]; images?: (Error | null)[] }) => {
    const png = Buffer.from(await images.encode(images.blank(256, 384, 0x2b6cb0ff), true));
    const queue = [...(o.images ?? [])];
    ai.image.mockImplementation(async () => {
      const next = queue.shift();
      if (next instanceof Error) throw next;
      return { bytes: Buffer.from(png), mime: 'image/png', ext: 'png', cost: 0, note: null };
    });
    const reads = [...o.reads];
    jsonBy['vacancy_art_read'] = () => {
      const r = reads.length > 1 ? reads.shift()! : reads[0]!;
      if (r instanceof Error) throw r;
      return structuredClone(r);
    };
  };
  return {
    ...w,
    dir,
    env,
    files,
    images,
    ai,
    jsonBy,
    feed,
    feedClient,
    gate,
    activity,
    guard,
    settings,
    brand,
    programArt,
    member,
    storedFiles: () => listFiles(dir),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

export type VacancyWorld = ReturnType<typeof vacancyWorld>;
