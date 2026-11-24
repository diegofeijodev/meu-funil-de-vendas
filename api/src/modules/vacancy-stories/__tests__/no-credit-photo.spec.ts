jest.setTimeout(120_000);

import { RefsService } from '../../creative/refs.service';
import { AssetsService } from '../../media/assets.service';
import { WS_A } from '../../media/__tests__/mem';
import { VacancyGeneratorService } from '../vacancy-generator.service';
import { vacancyFields } from '../vacancy-text';
import type { FreelaVacancy, SettingsRow } from '../vacancy-types';
import { vacancyWorld, type VacancyWorld } from './world';

const NOW = new Date('2026-11-24T13:00:00Z');
const MIN = 60_000;
const v: FreelaVacancy = {
  id: 'v1', title: 'Garçom', serviceType: 'garcom', city: 'Campinas', date: '2026-11-28',
  startTime: '2026-11-28T21:00:00Z', endTime: '2026-11-29T02:00:00Z', amountInCents: 15000, contractorName: 'COCO BAMBU', publishedAt: '2026-11-24T10:00:00Z',
};
const MSG = 'A conta do Gemini está sem créditos.';

let w: VacancyWorld;
afterEach(() => w?.cleanup());

async function setup(lastAtMinAgo: number | null, vendor: 'gemini' | 'openai' = 'gemini') {
  w = vacancyWorld();
  const assets = new AssetsService(w.prisma, w.files, w.images, jest.fn() as never, w.env);
  const refs = new RefsService(w.prisma, w.files, assets, w.images);
  const alerts = {
    status: jest.fn(async () =>
      lastAtMinAgo === null
        ? null
        : { level: 'stopped', fallback: null, inherited_from: null, vendors: [{ vendor, label: 'Gemini (Google)', reason: 'no_credit', since: new Date(NOW.getTime() - 3 * 86400e3), last_at: new Date(NOW.getTime() - lastAtMinAgo * MIN), message: MSG, owner_id: WS_A }] },
    ),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const gen = new VacancyGeneratorService(w.prisma, w.ai as any, w.images, w.files, assets, refs, w.store, w.feedClient, w.gate, alerts as any);
  gen.now = () => NOW.getTime();
  await w.programArt({ reads: [{ textos: [], funcao: null, estabelecimento: null, data: null, inicio: null, fim: null, valor: null, cidade: null }] });
  const s = { workspace_id: WS_A, vendor: 'gemini', brand_id: null, template_asset_id: null, style_refs_enabled: false } as unknown as SettingsRow;
  return { gen, s, alerts };
}

describe('P4: foto da IA com o fornecedor sem crédito', () => {
  it('aviso de sem crédito regravado há menos de 60 min: zero chamadas à IA, arte sem foto, motivo registrado', async () => {
    const { gen, s } = await setup(10);
    const art = await gen.makeArt(WS_A, s, vacancyFields(v));
    expect(w.ai.image).not.toHaveBeenCalled();
    expect(w.ai.json).not.toHaveBeenCalled();
    expect(art.usedFallback).toBe(true);
    expect(art.attempts[0]).toMatchObject({ kind: 'ai', ok: false, error: MSG });
    expect(art.bytes.length).toBeGreaterThan(1000);
  });

  it('há mais de 60 min: tenta de novo (1 chamada), senão o aviso nunca se apagaria', async () => {
    const { gen, s } = await setup(61);
    const art = await gen.makeArt(WS_A, s, vacancyFields(v));
    expect(w.ai.image).toHaveBeenCalledTimes(1);
    expect(art.usedFallback).toBe(false);
  });

  it('o aviso é de outro fornecedor, ou não há aviso: pede a foto normalmente', async () => {
    const other = await setup(5, 'openai');
    await other.gen.makeArt(WS_A, other.s, vacancyFields(v));
    expect(w.ai.image).toHaveBeenCalledTimes(1);
    w.cleanup();
    const none = await setup(null);
    await none.gen.makeArt(WS_A, none.s, vacancyFields(v));
    expect(w.ai.image).toHaveBeenCalledTimes(1);
  });
});
