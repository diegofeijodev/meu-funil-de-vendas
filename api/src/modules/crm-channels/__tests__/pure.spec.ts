import { inWindow, isOptOut, nextWindowSlot, renderVariables, withinBusinessHours } from '../channel-common';
import { applyMapping } from '../leadgen.service';
import { buildPrompt, pickStage, sanitizeDecision } from '../sdr.service';
import { parseCloudPayload, parseUnofficialPayload } from '../wa-payload';
import { templateText } from '../wa-providers';

// 2026-10-05 é segunda; 12:00 BRT = 15:00Z
const MON_NOON = new Date('2026-10-05T15:00:00Z');
const SAT_NOON = new Date('2026-10-10T15:00:00Z');
const MON_NIGHT = new Date('2026-10-06T02:00:00Z'); // 23:00 BRT de segunda

describe('palavras de saída (opt-out)', () => {
  it.each(['sair', 'PARAR', ' Stop. ', 'descadastrar!'])('%s é opt-out', (t) => expect(isOptOut(t)).toBe(true));
  it.each(['quero sair daqui', 'oi', '', null, undefined])('%s não é', (t) => expect(isOptOut(t as never)).toBe(false));
});

describe('janela de envio da cadência (America/Sao_Paulo)', () => {
  it('padrão: seg–sex 08–20h', () => {
    expect(inWindow({}, MON_NOON)).toBe(true);
    expect(inWindow({}, SAT_NOON)).toBe(false);
    expect(inWindow({}, MON_NIGHT)).toBe(false);
  });
  it('janela própria e próximo horário em saltos de 15 min', () => {
    expect(inWindow({ window: { days: [6], start: '08:00', end: '20:00' } }, SAT_NOON)).toBe(true);
    const next = nextWindowSlot({}, SAT_NOON);
    expect(inWindow({}, next)).toBe(true);
    expect(next.getTime()).toBeGreaterThan(SAT_NOON.getTime());
  });
});

describe('horário de atendimento do SDR', () => {
  const hours = { timezone: 'America/Sao_Paulo', days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00' };
  it('dentro e fora', () => {
    expect(withinBusinessHours(hours, MON_NOON)).toBe(true);
    expect(withinBusinessHours(hours, MON_NIGHT)).toBe(false);
    expect(withinBusinessHours(hours, SAT_NOON)).toBe(false);
  });
});

describe('variáveis e prompts', () => {
  it('renderiza {{nome}} {{cidade}} {{empresa}} {{responsavel}} (vazio se faltar)', () => {
    expect(renderVariables('Oi {{ nome }} de {{cidade}} {{empresa}}|{{responsavel}}', { nome: 'Ana', cidade: 'SP' })).toBe('Oi Ana de SP |');
  });
  it('template sem API oficial vira texto com {{1}} preenchido', () => {
    expect(templateText({ to: '1', kind: 'template', body: 'Olá {{1}}, {{2}}', templateParams: ['Ana', 'bem-vinda'] })).toBe('Olá Ana, bem-vinda');
  });
  it('transcrição da conversa no prompt', () => {
    const p = buildPrompt('SISTEMA', [{ role: 'user', content: 'oi' }, { role: 'assistant', content: 'olá' }]);
    expect(p).toContain('LEAD: oi');
    expect(p).toContain('AGENTE: olá');
  });
});

describe('decisão do SDR', () => {
  const stages = [{ name: 'Novo Lead' }, { name: 'Contato Iniciado' }, { name: 'Qualificado ✓' }, { name: 'Reunião Agendada' }, { name: 'Descartado', is_lost: true }];
  it('etapa por nome, sem acento', () => {
    expect(pickStage(stages, 'qualificado')?.name).toBe('Qualificado ✓');
    expect(pickStage(stages, 'reuniao_agendada')?.name).toBe('Reunião Agendada');
    expect(pickStage(stages, 'contato_iniciado')?.name).toBe('Contato Iniciado');
    expect(pickStage(stages, 'perdido')?.name).toBe('Descartado');
    expect(pickStage(stages, 'manter')).toBeNull();
  });
  it('sanitiza lixo da IA e recusa resposta vazia', () => {
    const d = sanitizeDecision({ resposta: ' oi ', score: 999, temperatura: 'ardente', proxima_etapa: 'voar', transferir_humano: 'sim' });
    expect(d).toMatchObject({ resposta: 'oi', score: 100, temperatura: 'frio', proxima_etapa: 'manter', transferir_humano: false });
    expect(() => sanitizeDecision({ resposta: '  ' })).toThrow('A IA retornou uma resposta vazia.');
  });
});

describe('payloads de WhatsApp', () => {
  it('Cloud API: mensagens, contatos, anúncio e recibos', () => {
    const r = parseCloudPayload({ entry: [{ changes: [{ value: { contacts: [{ wa_id: '5511', profile: { name: 'Ana' } }], messages: [{ id: 'm1', from: '5511999', type: 'image', image: { id: 'media1', caption: 'foto' }, referral: { source_id: 'ad1', headline: 'Camp' } }, { id: 'm2', from: '5511999', type: 'text', text: { body: 'oi' } }], statuses: [{ id: 'm0', status: 'read' }] } }] }] });
    expect(r.inbound).toHaveLength(2);
    expect(r.inbound[0]).toMatchObject({ externalId: 'm1', type: 'image', body: 'foto', mediaId: 'media1', profileName: 'Ana', referral: { adId: 'ad1', campaignName: 'Camp' } });
    expect(r.inbound[1]).toMatchObject({ body: 'oi', type: 'text' });
    expect(r.statuses).toEqual([{ id: 'm0', status: 'read' }]);
  });
  it('Z-API / Evolution: texto, mídia, ignora fromMe', () => {
    expect(parseUnofficialPayload({ phone: '5511988887777', messageId: 'z1', text: { message: 'oi' }, senderName: 'Bia' })[0]).toMatchObject({ externalId: 'z1', from: '5511988887777', body: 'oi', type: 'text', profileName: 'Bia' });
    expect(parseUnofficialPayload({ data: { key: { remoteJid: '5511@s.whatsapp.net', id: 'e1' }, message: { conversation: 'olá' } } })[0]).toMatchObject({ from: '5511', body: 'olá', externalId: 'e1' });
    expect(parseUnofficialPayload({ phone: '5511', fromMe: true, text: { message: 'x' } })).toEqual([]);
    expect(parseUnofficialPayload({ phone: '5511', audio: { audioUrl: 'https://a/x.ogg' } })[0]).toMatchObject({ type: 'audio', mediaUrl: 'https://a/x.ogg' });
  });
});

describe('mapeamento dos campos do formulário Meta', () => {
  it('automático e explícito', () => {
    const out = applyMapping([{ name: 'full_name', values: ['Ana'] }, { name: 'whatsapp_number', values: ['1199'] }, { name: 'Pergunta', values: ['x', 'y'] }, { name: 'e_mail', values: ['a@b.co'] }], { Pergunta: 'city' });
    expect(out).toEqual({ name: 'Ana', phone: '1199', city: 'x, y', email: 'a@b.co' });
  });
});
