import { addDays, todaySp } from '../../../common/time/dates';
import { CampaignIntakeService } from '../campaign-intake.service';
import { moneyIn, urlsIn } from '../campaign-intake';
import { OWNER, seedCampaign, status, VIEWER, WS_A, WS_B, world } from './world';

const DIEGO = 'quero criar uma pra cadastros de bares e restaurantes aqui da cidade de Jundiaí pelo período de 30 dias e eu quero oferecer a primeira contratação gratuita';

/** Resposta da IA no formato do schema (tudo obrigatório). */
const aiOut = (over: Record<string, unknown> = {}) => ({
  nome: 'Cadastros Jundiaí',
  objetivo: 'leads',
  produto: 'Freela para bares e restaurantes',
  promessa: 'Primeira contratação gratuita',
  resumo_objetivo: 'trazer cadastros de bares e restaurantes de Jundiaí',
  periodo: { inicio: 'hoje', inicio_data: '', duracao_dias: 30, fim_data: '' },
  publico: { persona: 'Donos e gerentes de bares e restaurantes', idade: '25-55', localizacao: 'Jundiaí, SP', interesses: 'bares, restaurantes', tipo: 'B2B' },
  verba_dia: 0,
  verba_total: 0,
  meta_leads: 0,
  formatos: ['static_image', 'video', 'inventado'],
  suposicoes: [{ campo: 'publico', texto: 'Para quem: donos e gerentes de bares e restaurantes.' }],
  ...over,
});

function setup(opts: { enabled?: boolean } = {}) {
  const w = world();
  const ai = { json: jest.fn(async () => aiOut()) };
  const features = { intakeEnabled: jest.fn(() => opts.enabled ?? true) };
  const svc = new CampaignIntakeService(w.prisma, w.access, ai as any, features as any);
  return { w, ai, features, svc };
}
const br = (ymd: string) => ymd.split('-').reverse().slice(0, 2).join('/');

describe('números e links só do texto (guarda anti-invenção)', () => {
  it('moneyIn lê R$ e "reais"; ignora "30 dias"; urlsIn tira a pontuação do fim', () => {
    expect(moneyIn('R$ 30 por dia, 30 dias, teto de R$ 1.500,50 ou 40 reais')).toEqual([30, 1500.5, 40]);
    expect(moneyIn(DIEGO)).toEqual([]);
    expect(urlsIn('manda pra https://www.freelaservicos.com.br/cadastro?perfil=empresa. Valeu')).toEqual(['https://www.freelaservicos.com.br/cadastro?perfil=empresa']);
  });
});

describe('CampaignIntakeService.intake (POST …/campaigns/intake)', () => {
  it('frase do Diego: leads, Jundiaí, hoje..hoje+29, 30 dias e as 3 perguntas na ordem verba → destino → oferta', async () => {
    const { w, svc, ai } = setup();
    const { brand } = await seedCampaign(w, { landing_url: 'https://www.freelaservicos.com.br/cadastro?perfil=empresa' });
    const r = await svc.intake(OWNER, WS_A, { brand_id: brand.id, text: `  ${DIEGO}  ` });
    const today = todaySp();
    const end = addDays(today, 29);
    expect(r.draft).toMatchObject({
      objective: 'leads', start_date: today, end_date: end, budget_daily: null, budget_total: null, landing_url: null,
      offer_promise: 'Primeira contratação gratuita', intake_text: DIEGO, formats: ['static_image', 'video'],
      audience: { localizacao: 'Jundiaí, SP', tipo: 'B2B', persona: 'Donos e gerentes de bares e restaurantes' },
    });
    expect(r.days).toBe(30);
    expect(r.missing.map((m) => m.field)).toEqual(['budget_daily', 'landing_url', 'offer_terms']);
    expect(r.missing[0]!.question).toBe('Quanto gastar por dia no anúncio?');
    expect(r.missing[1]).toEqual({ field: 'landing_url', question: 'Para onde vai quem se interessar?', suggestion: 'https://www.freelaservicos.com.br/cadastro?perfil=empresa' });
    expect(r.missing[2]!.question).toBe('O que exatamente é grátis ou oferecido, e até quando?');
    expect(r.summary).toBe(`Uma campanha para trazer cadastros de bares e restaurantes de Jundiaí, de ${br(today)} a ${br(end)} (30 dias), oferecendo primeira contratação gratuita.`);
    expect(r.assumptions).toContainEqual({ field: 'publico', text: 'Para quem: donos e gerentes de bares e restaurantes.' });
    const req = (ai.json.mock.calls[0] as any)[1];
    expect(req.name).toBe('campaign_intake');
    expect(req.prompt).toContain(`HOJE: ${today}`);
    expect(req.prompt).toContain('Bar do Zé');
  });

  it('a IA inventa verba e link que não estão no texto → descartados e perguntados', async () => {
    const { w, svc, ai } = setup();
    ai.json.mockResolvedValue(aiOut({ verba_dia: 30, verba_total: 900 }));
    const { brand } = await seedCampaign(w);
    const r = await svc.intake(OWNER, WS_A, { brand_id: brand.id, text: DIEGO });
    expect(r.draft.budget_daily).toBeNull();
    expect(r.missing[0]!.field).toBe('budget_daily');
  });

  it('"R$ 30 por dia" → verba aceita e total = dia × dias; "R$ 900 no mês" → dia = total ÷ dias com a conta', async () => {
    const { w, svc, ai } = setup();
    const { brand } = await seedCampaign(w);
    ai.json.mockResolvedValue(aiOut({ verba_dia: 30 }));
    const a = await svc.intake(OWNER, WS_A, { brand_id: brand.id, text: `${DIEGO}, R$ 30 por dia` });
    expect(a.draft).toMatchObject({ budget_daily: 30, budget_total: 900 });
    expect(a.missing.map((m) => m.field)).toEqual(['landing_url', 'offer_terms']);
    ai.json.mockResolvedValue(aiOut({ verba_total: 900 }));
    const b = await svc.intake(OWNER, WS_A, { brand_id: brand.id, text: `${DIEGO}, até R$ 900 no mês` });
    expect(b.draft).toMatchObject({ budget_daily: 30, budget_total: 900 });
    expect(b.assumptions).toContainEqual({ field: 'budget_daily', text: 'R$ 900,00 ÷ 30 dias = R$ 30,00 por dia.' });
  });

  it('link no texto vira o destino; sem promessa, sem pergunta da oferta', async () => {
    const { w, svc, ai } = setup();
    ai.json.mockResolvedValue(aiOut({ promessa: '' }));
    const { brand } = await seedCampaign(w);
    const r = await svc.intake(OWNER, WS_A, { brand_id: brand.id, text: 'cadastros em Jundiaí, link https://site.test/cadastro' });
    expect(r.draft.landing_url).toBe('https://site.test/cadastro');
    expect(r.missing.map((m) => m.field)).toEqual(['budget_daily']);
  });

  it('sem período → 30 dias com a suposição; mais de 180 dias → corta com a suposição', async () => {
    const { w, svc, ai } = setup();
    const { brand } = await seedCampaign(w);
    const today = todaySp();
    ai.json.mockResolvedValue(aiOut({ periodo: { inicio: 'hoje', inicio_data: '', duracao_dias: 0, fim_data: '' } }));
    const a = await svc.intake(OWNER, WS_A, { brand_id: brand.id, text: 'cadastros de bares' });
    expect(a.draft.end_date).toBe(addDays(today, 29));
    expect(a.assumptions).toContainEqual({ field: 'end_date', text: `Considerei 30 dias, de ${br(today)} a ${br(addDays(today, 29))}.` });
    ai.json.mockResolvedValue(aiOut({ periodo: { inicio: 'hoje', inicio_data: '', duracao_dias: 400, fim_data: '' } }));
    const b = await svc.intake(OWNER, WS_A, { brand_id: brand.id, text: 'cadastros de bares por 400 dias' });
    expect(b.days).toBe(180);
    expect(b.draft.end_date).toBe(addDays(today, 179));
    expect(b.assumptions).toContainEqual({ field: 'end_date', text: `O plano vai até 180 dias: considerei até ${br(addDays(today, 179))}.` });
  });

  it('fora da lista → 404; texto vazio → 400; viewer → 403; marca de outra empresa → 404', async () => {
    const off = setup({ enabled: false });
    const { brand } = await seedCampaign(off.w);
    expect(await status(off.svc.intake(OWNER, WS_A, { brand_id: brand.id, text: DIEGO }))).toBe('404:Não encontrado.');
    const { w, svc, ai } = setup();
    const { brand: b2 } = await seedCampaign(w);
    expect(await status(svc.intake(OWNER, WS_A, { brand_id: b2.id, text: '   ' }))).toBe('400:Conte em uma ou duas frases o que você quer.');
    expect(await status(svc.intake(VIEWER, WS_A, { brand_id: b2.id, text: DIEGO }))).toMatch(/^403:/);
    expect(await status(svc.intake(OWNER, WS_B, { brand_id: b2.id, text: DIEGO }))).toMatch(/^40[34]:/);
    expect(ai.json).not.toHaveBeenCalled();
  });
});

describe('intake — depois da revisão da Fatia 1', () => {
  it('verba lida do texto sempre aparece no Entendi com a conta', async () => {
    const { w, svc, ai } = setup();
    const { brand } = await seedCampaign(w);
    ai.json.mockResolvedValue(aiOut({ verba_dia: 30 }));
    const r = await svc.intake(OWNER, WS_A, { brand_id: brand.id, text: `${DIEGO}, R$ 30 por dia` });
    expect(r.assumptions).toContainEqual({ field: 'budget_daily', text: 'R$ 30,00 por dia × 30 dias = R$ 900,00 no período.' });
  });

  it('resposta malformada da IA (chave própria, sem schema estrito) não derruba: usa os padrões', async () => {
    const { w, svc, ai } = setup();
    const { brand } = await seedCampaign(w);
    ai.json.mockResolvedValue({ nome: 'X', objetivo: 'leads', formatos: 'video', suposicoes: { campo: 'a' }, periodo: null, publico: 'bares', promessa: 3 } as any);
    const r = await svc.intake(OWNER, WS_A, { brand_id: brand.id, text: 'cadastros de bares' });
    expect(r.draft.formats).toEqual(['static_image', 'video']);
    expect(r.days).toBe(30);
    expect(r.draft.audience.localizacao).toBe('');
    expect(r.draft.offer_promise).toBe('');
  });
});
