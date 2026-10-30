import { buildCopyPrompt } from '../../copy-ai/copy-ai.prompt';
import { buildStrategyPrompt } from '../../strategist/strategist.prompt';
import { offerConstraint, parseOfferTerms } from '../offer-terms';
import { MARKETING, OWNER, seedCampaign, status, WS_A, world } from './world';
import { CampaignsService } from '../campaigns.service';

const TERMS = { what: 'A 1ª vaga inteira, com cupom liberado pela equipe depois do cadastro', valid_until: '2026-11-27', new_only: true };

describe('condições da oferta (§0.7 #1)', () => {
  it('vira a restrição obrigatória com o texto exato', () => {
    expect(offerConstraint('Primeira contratação grátis', TERMS)).toBe(
      'CONDIÇÕES DA OFERTA (obrigatório): prometa só "Primeira contratação grátis". O que é grátis/oferecido: A 1ª vaga inteira, com cupom liberado pela equipe depois do cadastro. Vale até 27/11/2026. Só para empresas/clientes novos. Não invente outras condições, prazos ou descontos.',
    );
    expect(offerConstraint('X', { ...TERMS, new_only: false })).toContain('Vale para todos.');
    expect(offerConstraint('X', null)).toBeNull();
    expect(offerConstraint('', TERMS)).toBeNull();
  });

  it('parseOfferTerms: vazio = null; sem data válida ou sem "o quê" → 400 com a frase da tela', async () => {
    expect(parseOfferTerms(null)).toBeNull();
    expect(parseOfferTerms({ ...TERMS, what: '  x  ' })).toEqual({ ...TERMS, what: 'x' });
    expect(await status(Promise.resolve().then(() => parseOfferTerms({ ...TERMS, valid_until: '27/11' })))).toBe('400:Informe até quando a oferta vale.');
    expect(await status(Promise.resolve().then(() => parseOfferTerms({ ...TERMS, what: ' ' })))).toBe('400:Diga o que é grátis ou oferecido.');
  });

  it('o estrategista recebe o pedido original e a restrição; a copy também', () => {
    const c = { name: 'C', objective: 'leads', offer_promise: 'Primeira contratação grátis', intake_text: 'quero cadastros de bares de Jundiaí', offer_terms: TERMS };
    const p = buildStrategyPrompt(c, {}, [], [], [], []);
    expect(p).toContain('PEDIDO ORIGINAL DO DONO: "quero cadastros de bares de Jundiaí"');
    expect(p).toContain('CONDIÇÕES DA OFERTA (obrigatório): prometa só "Primeira contratação grátis".');
    const q = buildCopyPrompt({}, { offer_promise: 'Primeira contratação grátis', offer_terms: TERMS }, 0);
    expect(q).toContain('CONDIÇÕES DA OFERTA (obrigatório)');
    expect(buildStrategyPrompt({ name: 'C', objective: 'leads' }, {}, [], [], [], [])).not.toContain('CONDIÇÕES DA OFERTA');
  });
});

describe('CampaignsService.create com o pedido e a oferta', () => {
  it('grava intake_text (trim) e offer_terms', async () => {
    const w = world();
    const svc = new CampaignsService(w.prisma as any, w.activity as any, w.guards as any);
    const { brand } = await seedCampaign(w);
    const c = await svc.create(OWNER, WS_A, {
      brand_id: brand.id, name: 'Jundiaí', objective: 'traffic', audience: {}, formats: ['static_image'],
      intake_text: '  quero cadastros  ', offer_terms: TERMS,
    } as any);
    expect(c.intake_text).toBe('quero cadastros');
    expect(c.offer_terms).toEqual(TERMS);
    expect(await status(svc.create(MARKETING, WS_A, { brand_id: brand.id, name: 'X', objective: 'leads', audience: {}, formats: [], offer_terms: { ...TERMS, valid_until: '' } } as any))).toBe('400:Informe até quando a oferta vale.');
  });
});
