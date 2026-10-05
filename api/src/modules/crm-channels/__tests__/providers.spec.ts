import { ChannelHttp } from '../channel-http';
import { createGuardedLookup } from '../../media/external-fetch';
import { WaProviders } from '../wa-providers';

const env = (over: Record<string, unknown> = {}) => ({ NODE_ENV: 'production', META_GRAPH_BASE_URL: undefined, RESEND_API_URL: undefined, CALCOM_API_URL: undefined, ...over }) as never;
const make = (nodeEnv: string, calls: { url: string; init: any }[] = [], reply = { ok: true, body: '{"messageId":"Z1"}' }) => {
  const http = new ChannelHttp(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(reply.body, { status: reply.ok ? 200 : 500 });
  }, env({ NODE_ENV: nodeEnv }));
  const secrets: Record<string, string> = { ZAPI_TOKEN: 'ztok-12345', EVOLUTION_API_KEY: 'evo-12345', WHATSAPP_CLOUD_TOKEN: 'cloud-12345' };
  return { http, wa: new WaProviders(http, async (_ws, n) => secrets[n] ?? null), calls };
};
const integ = (provider: string, config: Record<string, unknown>) => ({ workspace_id: 'w', provider, config });

describe('hosts digitados pelo usuário (Z-API/Evolution) — SSRF', () => {
  it.each(['http://example.com', 'https://127.0.0.1', 'https://10.0.0.5/x', 'https://169.254.169.254/latest', 'https://localhost', 'https://svc.internal', 'ftp://x.com'])('produção recusa %s antes de qualquer rede', async (base) => {
    const { wa, calls } = make('production');
    await expect(wa.send(integ('zapi', { base_url: base }), { to: '5511', kind: 'text', body: 'oi' })).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
  it('fora de produção só o loopback http é aceito', async () => {
    const { wa, calls } = make('development');
    await wa.send(integ('zapi', { base_url: 'http://127.0.0.1:3097/inst/1/token/x/' }), { to: '+55 11 9', kind: 'text', body: 'oi' });
    expect(calls[0]!.url).toBe('http://127.0.0.1:3097/inst/1/token/x/send-text');
    const { wa: w2 } = make('development');
    await expect(w2.send(integ('zapi', { base_url: 'http://10.1.1.1' }), { to: '5511', kind: 'text', body: 'oi' })).rejects.toThrow();
  });
  it('redirecionamento não é seguido (3xx vira erro)', async () => {
    const http = new ChannelHttp(async () => new Response('', { status: 302, headers: { location: 'http://169.254.169.254/' } }), env({ NODE_ENV: 'production' }));
    expect(await http.request('https://api.exemplo.com/x')).toMatchObject({ ok: false, status: 302 });
  });
  it('o fetch guardado recusa nome que resolve para IP interno (DNS verificado)', async () => {
    const lookup = createGuardedLookup(false, async () => [{ address: '10.0.0.9', family: 4 }]);
    const err: any = await new Promise((res) => lookup('mal.example.com', {}, (e) => res(e)));
    expect(err?.code).toBe('EBLOCKED');
  });
});

describe('envio pelos provedores', () => {
  it('Z-API: Client-Token no cabeçalho; template vira texto preenchido', async () => {
    const { wa, calls } = make('development');
    const r = await wa.send(integ('zapi', { base_url: 'http://127.0.0.1:1/i' }), { to: '+5511', kind: 'template', body: 'Oi {{1}}', templateParams: ['Ana'], templateName: 't' });
    expect(r.externalId).toBe('Z1');
    expect(calls[0]!.init.headers['Client-Token']).toBe('ztok-12345');
    expect(JSON.parse(calls[0]!.init.body)).toEqual({ phone: '5511', message: 'Oi Ana' });
  });
  it('Evolution: apikey e instância validada', async () => {
    const { wa, calls } = make('development', [], { ok: true, body: '{"key":{"id":"E9"}}' });
    expect((await wa.send(integ('evolution', { base_url: 'http://localhost:9/', instance: 'minha' }), { to: '5511', kind: 'image', mediaUrl: 'https://x/y.png', body: 'cap' })).externalId).toBe('E9');
    expect(calls[0]!.url).toBe('http://localhost:9/message/sendMedia/minha');
    expect(calls[0]!.init.headers.apikey).toBe('evo-12345');
    await expect(wa.send(integ('evolution', { base_url: 'http://localhost:9', instance: '../x' }), { to: '1', kind: 'text', body: 'a' })).rejects.toThrow('instance não configurada');
  });
  it('Cloud API: payload de template com parâmetros e Bearer', async () => {
    const { wa, calls } = make('production', [], { ok: true, body: '{"messages":[{"id":"wamid.1"}]}' });
    const r = await wa.send(integ('whatsapp_cloud', { phone_number_id: '12345' }), { to: '+55 (11) 9', kind: 'template', templateName: 'boas_vindas', templateParams: ['Ana'] });
    expect(r.externalId).toBe('wamid.1');
    expect(calls[0]!.url).toBe('https://graph.facebook.com/v21.0/12345/messages');
    expect(calls[0]!.init.headers.Authorization).toBe('Bearer cloud-12345');
    expect(JSON.parse(calls[0]!.init.body).template).toEqual({ name: 'boas_vindas', language: { code: 'pt_BR' }, components: [{ type: 'body', parameters: [{ type: 'text', text: 'Ana' }] }] });
  });
  it('phone_number_id não numérico é recusado (nada de ../ no caminho)', async () => {
    const { wa } = make('production');
    await expect(wa.send(integ('whatsapp_cloud', { phone_number_id: '../me' }), { to: '1', kind: 'text', body: 'a' })).rejects.toThrow('phone_number_id não configurado');
  });
  it('hosts de teste só valem fora de produção', () => {
    const prod = new ChannelHttp(async () => new Response(''), env({ NODE_ENV: 'production', RESEND_API_URL: 'http://127.0.0.1:1', META_GRAPH_BASE_URL: 'http://127.0.0.1:2' }));
    expect(prod.resendBase).toBe('https://api.resend.com');
    expect(prod.waCloudBase).toBe('https://graph.facebook.com/v21.0');
    const dev = new ChannelHttp(async () => new Response(''), env({ NODE_ENV: 'development', RESEND_API_URL: 'http://127.0.0.1:1/' }));
    expect(dev.resendBase).toBe('http://127.0.0.1:1');
    // lista de permissão: NODE_ENV ausente ou desconhecido também ignora o override
    for (const NODE_ENV of [undefined, 'staging']) {
      expect(new ChannelHttp(async () => new Response(''), env({ NODE_ENV, RESEND_API_URL: 'http://127.0.0.1:1', CALCOM_API_URL: 'http://127.0.0.1:3' })).resendBase).toBe('https://api.resend.com');
    }
    expect(new ChannelHttp(async () => new Response(''), env({ NODE_ENV: 'test', CALCOM_API_URL: 'http://127.0.0.1:3/' })).calBase).toBe('http://127.0.0.1:3');
  });
});
