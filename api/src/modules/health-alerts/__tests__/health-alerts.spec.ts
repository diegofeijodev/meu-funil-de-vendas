import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import { WorkspaceAccessService } from '../../access/access.service';
import { WorkspaceAccessGuard } from '../../access/workspace-access.guard';
import { MemTable, OWNER, STRANGER, VIEWER, WS_A, WS_B, memMembers } from '../../media/__tests__/mem';
import { HealthAlertsController } from '../health-alerts.controller';
import { HealthAlertsService } from '../health-alerts.service';

const NOW = new Date('2026-11-04T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86400e3);
const PERMISSION = 'Permissão insuficiente na Meta. Confira se o usuário do sistema tem acesso à conta de anúncios/página e as permissões necessárias. ((#10) Application does not have permission for this action)';

function setup(aiStatus: Record<string, any> = {}) {
  const posts = new MemTable();
  const prisma: any = { ig_posts: posts, workspace_members: memMembers, instagram_accounts: new MemTable(), vacancy_stories: new MemTable() };
  const aiAlerts = { status: async (ws: string) => aiStatus[ws] ?? null } as any;
  const svc = new HealthAlertsService(prisma, aiAlerts);
  const post = (ws: string, status: string, updated_at: Date, last_error: string | null = 'x') => posts.rows.push({ id: randomUUID(), workspace_id: ws, status, updated_at, last_error });
  return { svc, post, prisma };
}

describe('HealthAlertsService — IA', () => {
  it('sem aviso de créditos → ai null', async () => {
    expect((await setup().svc.get(WS_A, NOW)).ai).toBeNull();
  });

  it('repassa nível, provedores (sem a mensagem interna nem a dona), fallback e herança', async () => {
    const since = daysAgo(3);
    const { svc } = setup({
      [WS_A]: { level: 'stopped', fallback: null, inherited_from: { id: WS_B, name: 'Freela App' }, vendors: [{ vendor: 'openai', label: 'ChatGPT (OpenAI)', reason: 'daily_limit', since, last_at: NOW, message: 'interna', owner_id: WS_B }] },
    });
    expect((await svc.get(WS_A, NOW)).ai).toEqual({
      level: 'stopped', fallback: null, inherited_from: { id: WS_B, name: 'Freela App' },
      vendors: [{ vendor: 'openai', label: 'ChatGPT (OpenAI)', reason: 'daily_limit', since, last_at: NOW }],
    });
  });
});

describe('HealthAlertsService — Instagram', () => {
  it('conta só os posts com status failed AGORA e falha nos últimos 7 dias; o mais recente dá o motivo', async () => {
    const { svc, post } = setup();
    post(WS_A, 'failed', daysAgo(1), 'A Meta respondeu com erro: velho');
    post(WS_A, 'failed', daysAgo(0.1), 'A Meta respondeu com erro: novo');
    post(WS_A, 'failed', daysAgo(8), 'fora da janela');
    post(WS_A, 'published', daysAgo(0.5), 'republicado depois');
    post(WS_A, 'cancelled', daysAgo(0.5), 'cancelado');
    post(WS_A, 'scheduled', daysAgo(0.5), 'vai tentar de novo');
    expect((await svc.get(WS_A, NOW)).instagram).toEqual({ failed_count: 2, last_error: 'A Meta respondeu com erro: novo', last_at: daysAgo(0.1), permission: false });
  });

  it('erro de permissão da Meta (#10) liga `permission`', async () => {
    const { svc, post } = setup();
    post(WS_A, 'failed', daysAgo(2), PERMISSION);
    post(WS_A, 'failed', daysAgo(1), 'A Meta respondeu com erro: outro');
    expect((await svc.get(WS_A, NOW)).instagram).toMatchObject({ failed_count: 2, permission: true, last_error: 'A Meta respondeu com erro: outro' });
  });

  it('nada falhou → instagram null; motivo longo é cortado em 300 caracteres', async () => {
    const { svc, post } = setup();
    expect((await svc.get(WS_A, NOW)).instagram).toBeNull();
    post(WS_A, 'failed', daysAgo(1), 'y'.repeat(900));
    expect((await svc.get(WS_A, NOW)).instagram!.last_error).toHaveLength(300);
  });

  it('isolamento: a falha de uma empresa não aparece na outra', async () => {
    const { svc, post } = setup({ [WS_A]: { level: 'partial', fallback: 'gemini', inherited_from: null, vendors: [] } });
    post(WS_A, 'failed', daysAgo(1), PERMISSION);
    expect(await svc.get(WS_B, NOW)).toEqual({ ai: null, instagram: null, publishing: null });
  });
});

describe('HealthAlertsController — acesso (qualquer membro lê; estranho 403; id malformado 404)', () => {
  const guard = (user: string, wsId: string = WS_A) => {
    const g = new WorkspaceAccessGuard(new WorkspaceAccessService({ workspace_members: memMembers } as any), new Reflector());
    const req = { method: 'GET', user: { id: user }, params: { workspaceId: wsId } };
    const ctx = { switchToHttp: () => ({ getRequest: () => req }), getHandler: () => () => undefined, getClass: () => HealthAlertsController } as unknown as ExecutionContext;
    return g.canActivate(ctx);
  };

  it('viewer e owner leem; quem não é membro não', async () => {
    expect(await guard(VIEWER)).toBe(true);
    expect(await guard(OWNER)).toBe(true);
    await expect(guard(STRANGER)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(guard(OWNER, 'não-é-uuid')).rejects.toMatchObject({ status: 404 });
  });

  it('o controller devolve a leitura do serviço para o workspace da URL', async () => {
    const { svc, post } = setup();
    post(WS_A, 'failed', new Date(), 'falhou');
    const out = await new HealthAlertsController(svc).get(WS_A);
    expect(out).toMatchObject({ ai: null, instagram: { failed_count: 1, last_error: 'falhou' } });
  });
});

describe('HealthAlertsService — publicação parada (R10)', () => {
  const PUBLISH_BLOCKED_MSG = 'Esperando o Instagram voltar a aceitar as publicações desta empresa.';
  const WAIT = 'Esperando o Instagram voltar a aceitar publicações para criar a arte.';
  function world() {
    const t = setup();
    const svc = new HealthAlertsService(t.prisma, { status: async () => null } as any);
    const account = (ws: string, over: Record<string, unknown>) => t.prisma.instagram_accounts.rows.push({ id: randomUUID(), workspace_id: ws, username: 'freelaapp', publish_block_reason: null, publish_unblocked_at: null, ...over });
    const story = (ws: string, status: string, wait_reason: string | null) => t.prisma.vacancy_stories.rows.push({ id: randomUUID(), workspace_id: ws, status, wait_reason });
    return { ...t, svc, account, story };
  }

  it('bloqueio aberto: motivo, desde, próxima conferência, o que espera e a conta (sem o antigo campo `probe`)', async () => {
    const w = world();
    w.account(WS_A, { publish_block_reason: 'permission', publish_block_message: '(#10) sem permissão', publish_blocked_at: daysAgo(2), publish_block_last_at: daysAgo(1), publish_next_check_at: NOW });
    w.post(WS_A, 'scheduled', daysAgo(1), PUBLISH_BLOCKED_MSG);
    w.post(WS_A, 'ready', daysAgo(1), PUBLISH_BLOCKED_MSG);
    w.post(WS_A, 'published', daysAgo(1), PUBLISH_BLOCKED_MSG);
    w.post(WS_A, 'scheduled', daysAgo(1), null);
    w.story(WS_A, 'waiting', WAIT);
    w.story(WS_A, 'new', WAIT);
    w.story(WS_A, 'expired', WAIT);
    w.story(WS_A, 'waiting', 'cap');
    expect((await w.svc.get(WS_A, NOW)).publishing).toEqual({
      reason: 'permission', since: daysAgo(2), last_at: daysAgo(1), message: '(#10) sem permissão', next_check_at: NOW,
      waiting: { posts: 2, vacancies: 2 }, username: 'freelaapp',
    });
    expect((await world().svc.get(WS_A, NOW)).publishing).toBeNull();
  });

  it('token: sem próxima conferência', async () => {
    const w = world();
    w.account(WS_A, { publish_block_reason: 'token', publish_blocked_at: daysAgo(1), publish_block_last_at: daysAgo(1), publish_next_check_at: NOW, username: null });
    const p = (await w.svc.get(WS_A, NOW)).publishing;
    expect(p).toMatchObject({ reason: 'token', next_check_at: null, username: null });
    expect(p).not.toHaveProperty('probe');
  });

  it('sem bloqueio → null; a faixa amarela só conta falhas DEPOIS do último fechamento', async () => {
    const w = world();
    w.account(WS_A, { publish_unblocked_at: daysAgo(1) });
    w.post(WS_A, 'failed', daysAgo(2), PERMISSION);
    expect(await w.svc.get(WS_A, NOW)).toEqual({ ai: null, instagram: null, publishing: null });
    w.post(WS_A, 'failed', daysAgo(0.5), 'A Meta respondeu com erro: outro');
    expect((await w.svc.get(WS_A, NOW)).instagram).toMatchObject({ failed_count: 1, permission: false });
  });

  it('isolamento: o bloqueio de A não aparece em B', async () => {
    const w = world();
    w.account(WS_A, { publish_block_reason: 'permission', publish_blocked_at: daysAgo(1), publish_block_last_at: daysAgo(1) });
    w.post(WS_A, 'scheduled', daysAgo(1), PUBLISH_BLOCKED_MSG);
    expect((await w.svc.get(WS_B, NOW)).publishing).toBeNull();
  });
});
