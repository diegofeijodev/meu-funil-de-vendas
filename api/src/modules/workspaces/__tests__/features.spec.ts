import { ForbiddenException } from '@nestjs/common';
import { parseWorkspaceList } from '../../../common/config/vacancy-workspaces';
import { FeaturesService } from '../features.service';

const A = '7309ae62-15c2-48d3-8990-4dbe75a29c4e';
const B = '11111111-2222-4333-8444-555555555555';
const access = { require: jest.fn(async (user: string) => { if (user === 'estranho') throw new ForbiddenException({ code: 'FORBIDDEN', message: 'x' }); return 'viewer'; }) };
const make = (env: Record<string, string>) =>
  new FeaturesService(access as any, { NODE_ENV: 'production', CAMPAIGN_INTAKE_WORKSPACE_IDS: '', VACANCY_STORIES_WORKSPACE_IDS: '', ...env } as any);

describe('FeaturesService (fonte única do "liberado para a empresa")', () => {
  it('style_refs_pinterest segue STYLE_REFS_PINTEREST_ENABLED (chave geral, OK jurídico)', async () => {
    expect((await make({ STYLE_REFS_PINTEREST_ENABLED: true } as any).forWorkspace('u1', A)).style_refs_pinterest).toBe(true);
  });

  it('campaign_intake só para as empresas da lista; vacancy_stories pela lista dela; piloto e Pinterest ainda desligados', async () => {
    const f = make({ CAMPAIGN_INTAKE_WORKSPACE_IDS: A, VACANCY_STORIES_WORKSPACE_IDS: B });
    expect(await f.forWorkspace('u1', A)).toEqual({ campaign_intake: true, campaign_pilot: false, style_refs_pinterest: false, vacancy_stories: false });
    expect(await f.forWorkspace('u1', B)).toEqual({ campaign_intake: false, campaign_pilot: false, style_refs_pinterest: false, vacancy_stories: true });
    expect(f.intakeEnabled(A)).toBe(true);
    expect(f.intakeEnabled(B)).toBe(false);
  });

  it('qualquer membro lê; quem não é da empresa recebe o erro do acesso', async () => {
    const f = make({ CAMPAIGN_INTAKE_WORKSPACE_IDS: A });
    await expect(f.forWorkspace('estranho', A)).rejects.toBeInstanceOf(ForbiddenException);
    expect(access.require).toHaveBeenCalledWith('u1', A, 'read');
  });

  it('"*" só em development/test; id inválido derruba a subida citando a variável', () => {
    expect(parseWorkspaceList('CAMPAIGN_INTAKE_WORKSPACE_IDS', '*', 'test')).toBe('*');
    expect(() => parseWorkspaceList('CAMPAIGN_INTAKE_WORKSPACE_IDS', '*', 'production')).toThrow(/CAMPAIGN_INTAKE_WORKSPACE_IDS/);
    expect(() => parseWorkspaceList('CAMPAIGN_INTAKE_WORKSPACE_IDS', 'abc', 'production')).toThrow(/CAMPAIGN_INTAKE_WORKSPACE_IDS inválido: "abc"/);
    expect(make({ NODE_ENV: 'test', CAMPAIGN_INTAKE_WORKSPACE_IDS: '*' }).intakeEnabled(B)).toBe(true);
  });
});
