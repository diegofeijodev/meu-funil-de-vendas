import { buildCopyBrief } from '../copy-brief';

describe('buildCopyBrief', () => {
  it('monta marca e briefing como o web (números, datas só dia, sem brand_id nem intake_text)', () => {
    const decimal = (v: string) => ({ toString: () => v, toNumber: () => Number(v) });
    const campaign: any = {
      id: 'c', workspace_id: 'w', brand_id: 'b', name: 'Jundiaí', objective: 'leads', offer_product: 'Freela', offer_price: null,
      offer_promise: '1ª contratação grátis', landing_url: 'https://x.test/cadastro', start_date: new Date('2026-10-30T00:00:00Z'),
      end_date: new Date('2026-11-28T00:00:00Z'), audience: { persona: 'Donos de bar', localizacao: 'Jundiaí, SP' }, budget_total: decimal('900.00'),
      budget_daily: decimal('30.00'), goal_leads: 40, goal_sales: null, avg_ticket: null, intake_text: 'quero…', status: 'draft',
    };
    const brand: any = { id: 'b', name: 'Freela', description: 'd', segment: 's', differentials: null, target_audience: 'ta', competitors: null,
      tone_of_voice: 'direto', preferred_words: ['rápido'], banned_words: [], region: 'SP', logo_url: 'x', visual_style: {} };
    const r = buildCopyBrief(campaign, brand);
    expect(r.brand).toEqual({ name: 'Freela', description: 'd', segment: 's', differentials: null, target_audience: 'ta', competitors: null,
      tone_of_voice: 'direto', preferred_words: ['rápido'], banned_words: [], region: 'SP' });
    expect(r.brief).toEqual({ name: 'Jundiaí', objective: 'leads', offer_product: 'Freela', offer_price: null, offer_promise: '1ª contratação grátis',
      landing_url: 'https://x.test/cadastro', start_date: '2026-10-30', end_date: '2026-11-28', audience: { persona: 'Donos de bar', localizacao: 'Jundiaí, SP' },
      budget_total: 900, budget_daily: 30, goal_leads: 40, goal_sales: null, avg_ticket: null });
    expect(buildCopyBrief(campaign, null).brand).toEqual({});
  });
});
