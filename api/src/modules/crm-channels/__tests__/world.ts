import { randomUUID } from 'node:crypto';
import { IgTable } from '../../instagram/__tests__/harness';
import { crmWorld, OWNER, WS_A } from '../../crm/__tests__/harness';
import { CadenceService } from '../cadence.service';
import { ChannelHttp, ChannelSecrets } from '../channel-http';
import { MediaUnderstandingService } from '../media-understanding.service';
import { SdrService } from '../sdr.service';
import { WhatsAppService } from '../whatsapp.service';

export type SentCall = { url: string; init: any };

/** Mundo do CRM + tabelas de canais + provedores falsos (nenhuma rede). */
export function channelsWorld(opts: { provider?: string; secrets?: Record<string, string>; ai?: (prompt: string, model?: string) => unknown } = {}) {
  const w = crmWorld();
  const extra = {
    crm_conversations: new IgTable(() => ({ unread_count: 0, window_expires_at: null, last_message_at: null })),
    crm_sdr_agents: new IgTable(() => ({ is_active: true, name: 'Agente', persona: '', tone: 't', goal: 'g', knowledge_text: '', questions: [], min_score: 60, scheduling_link: null, available_slots: [], business_hours: { timezone: 'America/Sao_Paulo', days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '23:59' }, offhours_message: 'Fora do horário', max_messages: 20, handoff_triggers: [], model: 'openai/gpt-6-astra' })),
    crm_sdr_runs: new IgTable(),
    // a restrição única parcial (source, external_id) do banco: sem ela o ledger não teria como deduplicar
    crm_webhook_events: new IgTable(() => ({ status: 'processed', error_message: null }), ['source', 'external_id']),
    crm_sdr_documents: new IgTable(),
    // índice único parcial (workspace, external_id) das mensagens recebidas
    crm_messages: new IgTable(() => ({}), ['workspace_id', 'external_id']),
  };
  Object.assign(w.prisma, extra);
  Object.assign(w.t, extra);
  w.prisma.crm_leads.upsert = undefined;
  const prisma = w.prisma;
  prisma.$executeRaw = async () => 1;

  const sent: SentCall[] = [];
  const http = new ChannelHttp(
    async (url: string, init?: RequestInit) => {
      sent.push({ url, init });
      return new Response('{"messageId":"Z-' + sent.length + '","messages":[{"id":"wamid.' + sent.length + '"}]}', { status: 200 });
    },
    { NODE_ENV: 'development', META_GRAPH_BASE_URL: undefined, RESEND_API_URL: undefined, CALCOM_API_URL: undefined } as never,
  );
  const secrets = new ChannelSecrets({ get: async () => null, has: async () => false } as never, opts.secrets ?? { ZAPI_TOKEN: 'ztok-12345', WHATSAPP_CLOUD_TOKEN: 'cloud-12345' });
  const calendar: any = { availableSlots: async () => [], formatSlot: (iso: string) => iso, bookSlot: jest.fn(async (_ws: string, i: any) => ({ uid: 'u', start: i.start, url: 'https://meet/x' })) };
  const aiCalls: { prompt: string; model?: string }[] = [];
  const ai: any = {
    json: async (_ws: string, req: any) => {
      aiCalls.push({ prompt: req.prompt, model: req.model });
      return (opts.ai ?? (() => ({ resposta: 'Olá!', campos_extraidos: {}, score: 10, temperatura: 'frio', proxima_etapa: 'manter', transferir_humano: false, motivo: '' })))(req.prompt, req.model);
    },
  };
  const sdr = new SdrService(prisma, ai, calendar, w.core);
  const media: any = new MediaUnderstandingService(http, {} as never, ai, {} as never, (async () => new Response('')) as never);
  media.describe = jest.fn(async () => '[Áudio do lead, transcrito] quero saber o preço');
  const whatsapp = new WhatsAppService(prisma, http, secrets, w.core, media, sdr);
  const email: any = { integration: async () => null, sendLeadEmail: jest.fn(async () => ({ id: 'r1' })) };
  const instagram: any = { sendInstagramAndStore: jest.fn(async () => ({ id: 'ig1', externalId: 'x' })) };
  const cadences = new CadenceService(prisma, w.core, whatsapp, email, instagram);

  const integration = async (over: Record<string, unknown> = {}) =>
    w.t.crm_integrations.create({ data: { workspace_id: WS_A, kind: 'whatsapp', provider: opts.provider ?? 'zapi', status: 'connected', config: { base_url: 'http://127.0.0.1:3097/i/1', phone_number_id: '123', instance: 'x' }, webhook_token: randomUUID().replace(/-/g, ''), verify_token: 'vt', field_mapping: {}, ...over } });
  const t = w.t as typeof w.t & typeof extra;
  return { ...w, t, extra, sent, http, secrets, calendar, aiCalls, sdr, whatsapp, email, instagram, cadences, integration, OWNER, WS_A };
}
