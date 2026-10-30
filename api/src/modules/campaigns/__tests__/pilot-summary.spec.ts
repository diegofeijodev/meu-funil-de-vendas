import { pilotSummary } from '../pilot-summary';

describe('pilotSummary (linha do estrategista na lista de campanhas)', () => {
  it('sem execução = null', () => {
    expect(pilotSummary(null)).toBeNull();
  });
  it('acha o 1º bloqueio na ordem das etapas e conta as peças prontas', () => {
    const run = {
      status: 'blocked', current_step: 'creatives',
      steps: {
        copies: { status: 'done', attempts: 0 },
        instagram: { status: 'blocked', attempts: 0, error_code: 'NO_IG_PLAN' },
        creatives: { status: 'blocked', attempts: 0, error_code: 'COST_CAP', slots: [{ status: 'done' }, { status: 'done' }, { status: 'pending' }, { status: 'failed' }] },
      },
    };
    expect(pilotSummary(run)).toEqual({ status: 'blocked', current_step: 'creatives', first_block_code: 'NO_IG_PLAN', counts: { done: 2, total: 4 } });
  });
  it('em planejamento, sem peças', () => {
    expect(pilotSummary({ status: 'planning', current_step: 'strategy', steps: { strategy: { status: 'running', attempts: 0 } } }))
      .toEqual({ status: 'planning', current_step: 'strategy', first_block_code: null, counts: { done: 0, total: 0 } });
  });
});
