import { randomUUID } from 'node:crypto';
import { WorkspaceAccessService } from '../../access/access.service';
import { SetupService } from '../setup.service';

const WS = randomUUID();
const USER = randomUUID();
const NOW = Date.parse('2026-10-02T12:00:00Z');

type Over = {
  role?: string | null; brands?: any[]; strategies?: any[]; published?: any; ig?: any; crm?: any[]; sdr?: any; stages?: any[]; beats?: any[];
  vault?: Record<string, string>; env?: Record<string, string>; aiKeys?: Record<string, string>; mcp?: boolean;
};

function setup(o: Over = {}) {
  const prisma: any = {
    workspace_members: { findUnique: async () => (o.role === null ? null : { role: o.role ?? 'viewer' }) },
    brands: { findMany: async () => o.brands ?? [] },
    campaign_strategies: { findMany: async () => o.strategies ?? [] },
    campaigns: { findFirst: async () => o.published ?? null },
    instagram_accounts: { findUnique: async () => o.ig ?? null },
    crm_integrations: { findMany: async () => o.crm ?? [] },
    crm_sdr_agents: { findUnique: async () => o.sdr ?? null },
    crm_stages: { findMany: async () => o.stages ?? [] },
    cron_heartbeats: { findMany: async () => o.beats ?? [] },
    mcp_connections: { findFirst: async () => (o.mcp ? { id: 'x' } : null) },
  };
  const vault: any = { get: async (ws: string | null, k: string) => (ws === WS ? o.vault?.[k] : undefined) ?? null, has: async (_ws: string, k: string) => !!o.vault?.[k] };
  const aiKeys: any = { get: async (_ws: string, v: string) => o.aiKeys?.[v] ?? null, inheritSource: async () => null };
  const ensured: string[] = [];
  const crmDefaults: any = { ensure: async (ws: string) => ensured.push(ws) };
  const svc = new SetupService(prisma, new WorkspaceAccessService(prisma), vault, aiKeys, crmDefaults, { AI_GATEWAY_URL: 'http://gw', AI_GATEWAY_API_KEY: 'k', ...o.env } as any);
  return { svc, ensured };
}

const byKey = (items: any[], k: string) => items.find((i) => i.key === k);

describe('SetupService.status', () => {
  it('não-membro → 403; qualquer membro (viewer) lê', async () => {
    await expect(setup({ role: null }).svc.status(USER, WS, NOW)).rejects.toMatchObject({ status: 403 });
    const { items } = await setup({ role: 'viewer' }).svc.status(USER, WS, NOW);
    expect(items.length).toBeGreaterThan(15);
  });

  it('garante os padrões do CRM antes de ler as etapas', async () => {
    const { svc, ensured } = setup();
    await svc.status(USER, WS, NOW);
    expect(ensured).toEqual([WS]);
  });

  it('workspace vazio: itens essenciais pendentes, textos do protótipo', async () => {
    const { items } = await setup().svc.status(USER, WS, NOW);
    expect(byKey(items, 'brand')).toMatchObject({ group: 'Começo', status: 'pending', required: true, link: '/brands', label: 'DNA da marca preenchido' });
    expect(byKey(items, 'strategy').status).toBe('pending');
    expect(byKey(items, 'published')).toMatchObject({ status: 'pending', required: false });
    expect(byKey(items, 'app-ai')).toMatchObject({ status: 'ok', detail: 'Disponível para estratégia, copy, imagens e SDR.' });
    expect(byKey(items, 'meta').detail).toBe('Faltam: META_APP_ID, META_APP_SECRET, META_SYSTEM_USER_TOKEN, META_AD_ACCOUNT_ID, META_PAGE_ID.');
    expect(byKey(items, 'google-ads').detail).toContain('Falta: ID do cliente OAuth');
    expect(byKey(items, 'instagram').status).toBe('pending');
    expect(byKey(items, 'crm-whatsapp').status).toBe('pending');
    expect(byKey(items, 'crm-email').status).toBe('optional');
    expect(byKey(items, 'sdr').status).toBe('pending');
    expect(byKey(items, 'cron-crm-cadences').detail).toMatch(/^Ainda não rodou\./);
    expect(items.map((i) => i.group)).toEqual([...items.map((i) => i.group)].sort((a, b) => ['Começo', 'Conexões', 'CRM', 'Agendadores'].indexOf(a) - ['Começo', 'Conexões', 'CRM', 'Agendadores'].indexOf(b)));
  });

  it('IA do app ausente → erro', async () => {
    const { items } = await setup({ env: { AI_GATEWAY_URL: '', AI_GATEWAY_API_KEY: '' } }).svc.status(USER, WS, NOW);
    expect(byKey(items, 'app-ai').status).toBe('error');
  });

  it('marca completa, estratégia aprovada e campanha publicada', async () => {
    const { items } = await setup({
      brands: [{ description: 'd', tone_of_voice: 't', target_audience: 'a' }],
      strategies: [{ status: 'approved' }], published: { id: 'c' },
    }).svc.status(USER, WS, NOW);
    expect(['brand', 'strategy', 'published'].map((k) => byKey(items, k).status)).toEqual(['ok', 'ok', 'ok']);
  });

  it('contas de IA próprias: lista OpenAI/Gemini/Higgsfield', async () => {
    const { items } = await setup({ aiKeys: { openai: 'k', gemini: 'g' }, mcp: true }).svc.status(USER, WS, NOW);
    expect(byKey(items, 'own-ai')).toMatchObject({ status: 'ok', detail: 'Conectadas: OpenAI, Gemini, Higgsfield.' });
  });

  it('Meta: completa pelo cofre; vencimento do login em ≤ 7 dias vira erro', async () => {
    const vault = { META_APP_ID: 'a', META_APP_SECRET: 's', META_SYSTEM_USER_TOKEN: 't', META_AD_ACCOUNT_ID: '1', META_PAGE_ID: '2' };
    expect(byKey((await setup({ vault }).svc.status(USER, WS, NOW)).items, 'meta')).toMatchObject({ status: 'ok', detail: 'Conectado com usuário do sistema.' });
    const soon = new Date(NOW + 3 * 86400e3).toISOString();
    expect(byKey((await setup({ vault: { ...vault, META_TOKEN_EXPIRES_AT: soon } }).svc.status(USER, WS, NOW)).items, 'meta'))
      .toMatchObject({ status: 'error', detail: 'Conectado. Login com Facebook vence em 3 dia(s).' });
    const past = new Date(NOW - 86400e3).toISOString();
    expect(byKey((await setup({ vault: { ...vault, META_TOKEN_EXPIRES_AT: past } }).svc.status(USER, WS, NOW)).items, 'meta').detail).toBe('O login com Facebook venceu: entre de novo.');
  });

  it('Meta pode vir das variáveis de ambiente (META_GRAPH_TOKEN vale como token)', async () => {
    const env = { META_APP_ID: 'a', META_APP_SECRET: 's', META_GRAPH_TOKEN: 't', META_AD_ACCOUNT_ID: '1', META_PAGE_ID: '2' };
    expect(byKey((await setup({ env }).svc.status(USER, WS, NOW)).items, 'meta').status).toBe('ok');
  });

  it('CRM: canais conectados/erro, SDR ativo e etapas faltando', async () => {
    const { items } = await setup({
      crm: [{ kind: 'whatsapp', status: 'connected' }, { kind: 'email', status: 'error', last_error: 'chave inválida' }],
      sdr: { is_active: true }, stages: [{ name: 'Novo Lead', is_lost: false }],
      ig: { status: 'connected', username: 'bar' },
    }).svc.status(USER, WS, NOW);
    expect(byKey(items, 'crm-whatsapp').status).toBe('ok');
    expect(byKey(items, 'crm-email')).toMatchObject({ status: 'error', detail: 'Erro: chave inválida' });
    expect(byKey(items, 'sdr').status).toBe('ok');
    expect(byKey(items, 'stages').detail).toBe('Crie as etapas: Qualificado, Reunião agendada, Perdido (o SDR move o lead pelo nome).');
    expect(byKey(items, 'instagram').detail).toBe('Conectado: @bar.');
    const ok = await setup({ stages: [{ name: 'Qualificado' }, { name: 'Reunião Agendada' }, { name: 'X', is_lost: true }] }).svc.status(USER, WS, NOW);
    expect(byKey(ok.items, 'stages')).toMatchObject({ status: 'ok', detail: 'Funil pronto para o SDR.' });
  });

  it('agendadores: ok, atrasado, com erro e ausente', async () => {
    const mk = (name: string, minAgo: number, status = 'ok') => ({ name, last_run_at: new Date(NOW - minAgo * 60000), last_status: status, last_detail: status === 'error' ? 'falhou' : null });
    const { items } = await setup({ beats: [mk('crm-cadences', 3), mk('instagram-queue', 60), mk('ads-sync', 10, 'error')] }).svc.status(USER, WS, NOW);
    expect(byKey(items, 'cron-crm-cadences')).toMatchObject({ status: 'ok', detail: 'Última execução há 3 min.' });
    expect(byKey(items, 'cron-instagram-queue')).toMatchObject({ status: 'error', detail: 'Última execução há 1 h (atrasado).' });
    expect(byKey(items, 'cron-ads-sync')).toMatchObject({ status: 'error', detail: 'Última execução há 10 min com erro: falhou.' });
    expect(byKey(items, 'cron-crm-daily').status).toBe('pending');
  });
});
