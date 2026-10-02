import { Inject, Injectable } from '@nestjs/common';
import { ENV } from '../../common/config/env.module';
import { Env } from '../../common/config/env.validation';
import { PrismaService } from '../../common/database/prisma.service';
import { WorkspaceAccessService } from '../access/access.service';
import { AiKeysService } from '../ai/ai-keys.service';
import { CrmDefaultsService } from '../crm-defaults/crm-defaults.service';
import { VaultService } from '../vault/vault.service';
import { SetupItem } from './setup.types';

const ago = (iso: Date, now: number) => {
  const min = Math.round((now - iso.getTime()) / 60000);
  return min < 60 ? `${min} min` : min < 48 * 60 ? `${Math.round(min / 60)} h` : `${Math.round(min / 1440)} dias`;
};

const META_KEYS = ['META_APP_ID', 'META_APP_SECRET', 'META_SYSTEM_USER_TOKEN', 'META_AD_ACCOUNT_ID', 'META_PAGE_ID', 'META_INSTAGRAM_ACCOUNT_ID'] as const;

/**
 * `setupStatus` (setup.functions.ts): o checklist "o que falta configurar" desta empresa.
 *
 * As sondas de conexão (Meta, Google/TikTok Ads, Canva, Higgsfield) leem o cofre/tabelas diretamente com
 * as MESMAS chaves e regras dos módulos do protótipo (`graph.server`, `google-ads.server`, `tiktok-ads.server`,
 * `canva.server`, `mcp-auth.server`): o checklist só precisa saber "está conectado?", não chamar os provedores.
 */
@Injectable()
export class SetupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
    private readonly vault: VaultService,
    private readonly aiKeys: AiKeysService,
    private readonly crmDefaults: CrmDefaultsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async status(userId: string, ws: string, now = Date.now()): Promise<{ items: SetupItem[] }> {
    await this.access.require(userId, ws, 'read');
    await this.crmDefaults.ensure(ws); // as etapas do funil nascem na 1ª leitura de CRM
    const [brands, strategies, published, ig, crm, sdr, stages, beats] = await Promise.all([
      this.prisma.brands.findMany({ where: { workspace_id: ws }, select: { id: true, description: true, tone_of_voice: true, target_audience: true } }),
      this.prisma.campaign_strategies.findMany({ where: { workspace_id: ws }, select: { id: true, status: true }, take: 50 }),
      this.prisma.campaigns.findFirst({ where: { workspace_id: ws, meta_campaign_id: { not: null } }, select: { id: true } }),
      this.prisma.instagram_accounts.findUnique({ where: { workspace_id: ws }, select: { status: true, username: true } }),
      this.prisma.crm_integrations.findMany({ where: { workspace_id: ws }, select: { kind: true, status: true, last_error: true } }),
      this.prisma.crm_sdr_agents.findUnique({ where: { workspace_id: ws }, select: { is_active: true } }),
      this.prisma.crm_stages.findMany({ where: { workspace_id: ws }, select: { name: true, is_lost: true } }),
      this.prisma.cron_heartbeats.findMany(),
    ]);
    const items: SetupItem[] = [];
    const add = (i: SetupItem) => items.push(i);

    // Começo
    const fullBrand = brands.find((b) => b.description && b.tone_of_voice && b.target_audience);
    add({
      key: 'brand', group: 'Começo', label: 'DNA da marca preenchido', status: fullBrand ? 'ok' : 'pending',
      detail: fullBrand ? 'Descrição, público e tom de voz cadastrados.' : 'Preencha descrição, público-alvo e tom de voz: tudo que a IA cria parte daqui.',
      link: '/brands', required: true,
    });
    const approved = strategies.some((s) => s.status === 'approved');
    add({
      key: 'strategy', group: 'Começo', label: 'Primeira estratégia aprovada', status: approved ? 'ok' : 'pending',
      detail: approved ? 'Copy, criativos e públicos seguem a estratégia aprovada.' : 'Crie uma campanha e aprove a estratégia gerada pela IA.',
      link: '/campaigns/new', required: true,
    });
    add({
      key: 'published', group: 'Começo', label: 'Primeira campanha publicada na Meta', status: published ? 'ok' : 'pending',
      detail: published ? 'Já existe campanha na Meta.' : 'Aprove a campanha e clique em Publicar na Meta (sai pausada).',
      link: '/campaigns', required: false,
    });

    // Conexões
    const appAi = !!(this.env.AI_GATEWAY_URL && this.env.AI_GATEWAY_API_KEY);
    add({
      key: 'app-ai', group: 'Conexões', label: 'IA do app', status: appAi ? 'ok' : 'error',
      detail: appAi ? 'Disponível para estratégia, copy, imagens e SDR.' : 'AI_GATEWAY_URL / AI_GATEWAY_API_KEY não configuradas no servidor.',
      link: '/integrations', required: true,
    });
    const [oKey, gKey, higgs, canva] = await Promise.all([
      this.aiKeys.get(ws, 'openai'), this.aiKeys.get(ws, 'gemini'), this.higgsfieldConnected(ws), this.canvaConnected(ws),
    ]);
    const own = [oKey && 'OpenAI', gKey && 'Gemini', higgs && 'Higgsfield'].filter(Boolean);
    add({
      key: 'own-ai', group: 'Conexões', label: 'Contas de IA próprias ou da agência', status: own.length ? 'ok' : 'optional',
      detail: own.length ? `Conectadas: ${own.join(', ')}.` : 'Opcional: conecte Higgsfield, OpenAI ou Gemini para gerar com a sua conta (sem gastar créditos do app).',
      link: '/integrations', required: false,
    });
    add({
      key: 'canva', group: 'Conexões', label: 'Canva', status: canva ? 'ok' : 'optional',
      detail: canva ? 'Conectado.' : 'Opcional: envie criativos ao Canva e traga a edição de volta.',
      link: '/integrations', required: false,
    });
    const [missing, expiresAt] = await Promise.all([this.metaMissing(ws), this.vault.get(ws, 'META_TOKEN_EXPIRES_AT')]);
    const days = expiresAt ? Math.ceil((new Date(expiresAt).getTime() - now) / 86400e3) : null;
    add({
      key: 'meta', group: 'Conexões', label: 'Meta Ads',
      status: missing.length ? 'pending' : days != null && days <= 7 ? 'error' : 'ok',
      detail: missing.length
        ? `Faltam: ${missing.join(', ')}.`
        : days != null
          ? days <= 0 ? 'O login com Facebook venceu: entre de novo.' : `Conectado. Login com Facebook vence em ${days} dia(s).`
          : 'Conectado com usuário do sistema.',
      link: '/integrations', required: true,
    });
    const [gMiss, tMiss] = await Promise.all([this.googleMissing(ws), this.tiktokMissing(ws)]);
    for (const [k, label, miss] of [['google-ads', 'Google Ads', gMiss], ['tiktok-ads', 'TikTok Ads', tMiss]] as const) {
      add({
        key: k, group: 'Conexões', label, status: miss.length ? 'optional' : 'ok',
        detail: miss.length ? `Opcional: anuncie também neste canal. Falta: ${miss.join(', ')}.` : 'Conectado.',
        link: '/integrations', required: false,
      });
    }
    add({
      key: 'instagram', group: 'Conexões', label: 'Instagram', status: ig?.status === 'connected' ? 'ok' : 'pending',
      detail: ig?.status === 'connected' ? `Conectado${ig.username ? `: @${ig.username}` : ''}.` : 'Conecte a conta profissional para publicar e medir.',
      link: '/instagram', required: true,
    });

    // CRM
    const kind = (k: string) => crm.find((i) => i.kind === k);
    const channel = (k: string, label: string, required: boolean, hint: string) => {
      const i = kind(k);
      add({
        key: `crm-${k}`, group: 'CRM', label,
        status: i?.status === 'connected' ? 'ok' : i?.status === 'error' ? 'error' : required ? 'pending' : 'optional',
        detail: i?.status === 'connected' ? 'Conectado.' : i?.status === 'error' ? `Erro: ${i.last_error ?? 'veja a integração'}` : hint,
        link: '/crm/integrations', required,
      });
    };
    channel('whatsapp', 'WhatsApp', true, 'Conecte o número para o SDR e as cadências conversarem com os leads.');
    channel('meta_lead_ads', 'Formulários da Meta (Lead Ads)', false, 'Opcional: leads dos formulários instantâneos entram sozinhos.');
    channel('instagram', 'Direct e comentários do Instagram', false, 'Opcional: conversas do Instagram viram lead.');
    channel('site_form', 'Formulário do site', false, 'Opcional: link e código para colar no site.');
    channel('email', 'E-mail (Resend)', false, 'Opcional: cadências com e-mail de verdade.');
    channel('calendar', 'Agenda (Cal.com)', false, 'Opcional: o SDR marca reuniões em horários livres reais.');
    add({
      key: 'sdr', group: 'CRM', label: 'Agente SDR ativo', status: sdr?.is_active ? 'ok' : 'pending',
      detail: sdr?.is_active ? 'Respondendo e qualificando.' : 'Configure a persona, as perguntas e ative o agente.',
      link: '/crm/settings', required: true,
    });
    const norm = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const names = stages.map((s) => norm(s.name));
    const needed = [['qualificado', 'Qualificado'], ['agendada', 'Reunião agendada']].filter(([k]) => !names.some((n) => n.includes(k!)));
    const hasLost = stages.some((s) => s.is_lost || norm(s.name).includes('perdido'));
    const missingStages = [...needed.map(([, l]) => l), ...(hasLost ? [] : ['Perdido'])];
    add({
      key: 'stages', group: 'CRM', label: 'Etapas do funil para o SDR', status: missingStages.length ? 'pending' : 'ok',
      detail: missingStages.length ? `Crie as etapas: ${missingStages.join(', ')} (o SDR move o lead pelo nome).` : 'Funil pronto para o SDR.',
      link: '/crm/settings', required: true,
    });

    // Agendadores
    const beat = new Map(beats.map((b) => [b.name, b]));
    const cron = (name: string, label: string, maxMin: number) => {
      const b = beat.get(name);
      const late = b ? (now - b.last_run_at.getTime()) / 60000 > maxMin : true;
      add({
        key: `cron-${name}`, group: 'Agendadores', label,
        status: !b ? 'pending' : b.last_status === 'error' ? 'error' : late ? 'error' : 'ok',
        detail: !b
          ? 'Ainda não rodou. Confira se o agendador da API está ligado (SCHEDULER_ENABLED=true) e se as migrações foram aplicadas.'
          : `Última execução há ${ago(b.last_run_at, now)}${b.last_status === 'error' ? ` com erro: ${b.last_detail ?? ''}` : late ? ' (atrasado)' : ''}.`,
        link: '/settings', required: false,
      });
    };
    cron('crm-cadences', 'Cadências do CRM (a cada 5 min)', 20);
    cron('instagram-queue', 'Fila de publicação do Instagram (a cada 5 min)', 20);
    cron('ads-sync', 'Resultados da Meta (a cada 3 h)', 4 * 60);
    cron('crm-daily', 'Custos diários da Meta (1x por dia)', 26 * 60);
    return { items };
  }

  // ------------------------------------------------------------------ sondas de conexão

  private envValue(name: string): string | null {
    const v = (this.env as unknown as Record<string, unknown>)[name];
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  }

  /** Cofre da empresa primeiro, global depois, variável de ambiente por fim (`metaConfig` do protótipo). */
  private async metaMissing(ws: string): Promise<string[]> {
    const pick = async (k: (typeof META_KEYS)[number]) => (await this.vault.get(ws, k)) ?? (await this.vault.get(null, k)) ?? this.envValue(k);
    const [appId, appSecret, systemToken, adAccount, page] = await Promise.all([
      pick('META_APP_ID'), pick('META_APP_SECRET'), pick('META_SYSTEM_USER_TOKEN'), pick('META_AD_ACCOUNT_ID'), pick('META_PAGE_ID'),
    ]);
    const token = systemToken ?? this.envValue('META_GRAPH_TOKEN');
    const miss: string[] = [];
    if (!appId) miss.push('META_APP_ID');
    if (!appSecret) miss.push('META_APP_SECRET');
    if (!token) miss.push('META_SYSTEM_USER_TOKEN');
    if (!adAccount) miss.push('META_AD_ACCOUNT_ID');
    if (!page) miss.push('META_PAGE_ID');
    return miss;
  }

  private async googleMissing(ws: string): Promise<string[]> {
    const r = async (k: string) => (await this.vault.get(ws, k)) ?? this.envValue(k);
    const [clientId, clientSecret, developerToken, refreshToken, customerId] = await Promise.all([
      r('GOOGLE_ADS_CLIENT_ID'), r('GOOGLE_ADS_CLIENT_SECRET'), r('GOOGLE_ADS_DEVELOPER_TOKEN'),
      this.vault.get(ws, 'GOOGLE_ADS_REFRESH_TOKEN'), this.vault.get(ws, 'GOOGLE_ADS_CUSTOMER_ID'),
    ]);
    const miss: string[] = [];
    if (!clientId) miss.push('ID do cliente OAuth');
    if (!clientSecret) miss.push('Chave secreta do cliente OAuth');
    if (!developerToken) miss.push('Token de desenvolvedor');
    if (!refreshToken) miss.push('Login com Google');
    if (!customerId) miss.push('Conta do Google Ads');
    return miss;
  }

  private async tiktokMissing(ws: string): Promise<string[]> {
    const r = async (k: string) => (await this.vault.get(ws, k)) ?? this.envValue(k);
    const [appId, secret, token, advertiserId] = await Promise.all([
      r('TIKTOK_APP_ID'), r('TIKTOK_APP_SECRET'), this.vault.get(ws, 'TIKTOK_ACCESS_TOKEN'), this.vault.get(ws, 'TIKTOK_ADVERTISER_ID'),
    ]);
    const miss: string[] = [];
    if (!appId) miss.push('App ID');
    if (!secret) miss.push('Secret do app');
    if (!token) miss.push('Login com TikTok');
    if (!advertiserId) miss.push('Conta de anúncios');
    return miss;
  }

  /** `canvaStatus().connected`: tokens da própria empresa ou da empresa de origem (agência). */
  private async canvaConnected(ws: string): Promise<boolean> {
    if (await this.vault.has(ws, 'CANVA_TOKENS')) return true;
    const src = await this.aiKeys.inheritSource(ws);
    return !!src && (await this.vault.has(src, 'CANVA_TOKENS'));
  }

  /** `getLiveConnection(..., 'higgsfield').status === 'connected'`, com herança da agência. */
  private async higgsfieldConnected(ws: string): Promise<boolean> {
    const connected = async (id: string) =>
      !!(await this.prisma.mcp_connections.findFirst({ where: { workspace_id: id, provider: 'higgsfield', status: 'connected' }, select: { id: true } }));
    if (await connected(ws)) return true;
    const src = await this.aiKeys.inheritSource(ws);
    return !!src && (await connected(src));
  }
}
