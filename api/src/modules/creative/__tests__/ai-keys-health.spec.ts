import { WorkspaceAccessService } from '../../access/access.service';
import { OWNER, STRANGER, VIEWER, WS_A, memMembers, status } from '../../media/__tests__/mem';
import { AiKeysHealthController } from '../creative.controller';

describe('AiKeysHealthController (aviso de crédito do Studio)', () => {
  const setup = (st: any) => {
    const asked: string[] = [];
    const alerts = { status: async (ws: string) => (asked.push(ws), st) } as any;
    return { ctrl: new AiKeysHealthController(new WorkspaceAccessService({ workspace_members: memMembers } as any), alerts), asked };
  };

  it('lê o aviso gravado (sem chamar o provedor) e devolve o formato antigo { outOfCredit:[{ vendor, error }] }', async () => {
    const { ctrl } = setup({ level: 'partial', fallback: 'gemini', inherited_from: null, vendors: [
      { vendor: 'openai', label: 'ChatGPT (OpenAI)', reason: 'no_credit', message: 'Sua conta OpenAI está sem créditos…', since: new Date(), last_at: new Date(), owner_id: WS_A },
      // Limite de hoje é do modelo de texto: não entra no aviso do Studio (as artes podem sair).
      { vendor: 'gemini', label: 'Gemini (Google)', reason: 'daily_limit', message: 'limite de hoje', since: new Date(), last_at: new Date(), owner_id: WS_A },
    ] });
    expect(await ctrl.health({ id: VIEWER } as any, { workspaceId: WS_A })).toEqual({ outOfCredit: [{ vendor: 'openai', error: 'Sua conta OpenAI está sem créditos…' }] });
    expect(await setup(null).ctrl.health({ id: OWNER } as any, { workspaceId: WS_A })).toEqual({ outOfCredit: [] });
  });

  it('não-membro → 403 e nada é lido', async () => {
    const { ctrl, asked } = setup(null);
    expect(await status(ctrl.health({ id: STRANGER } as any, { workspaceId: WS_A }))).toMatch(/^403:/);
    expect(asked).toEqual([]);
  });
});
