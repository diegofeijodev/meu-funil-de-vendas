import { AiError } from '../../ai/ai-error';
import { OWNER, seedCampaign, status, STRANGER, VIEWER, WS_A, world } from '../../campaigns/__tests__/world';
import { StrategistService } from '../../strategist/strategist.service';
import { buildCopyPrompt, COPY_SCHEMA } from '../copy-ai.prompt';
import { CopyAiService } from '../copy-ai.service';

function setup(ai: any = async () => ({ content: { headline: 'H' }, engine: 'IA do app' })) {
  const w = world();
  const calls: any[] = [];
  const fakeAi: any = { jsonWithEngine: async (ws: string, req: any) => { calls.push([ws, req]); return ai(ws, req); } };
  const strategist = new StrategistService(w.prisma, {} as any, w.guards, w.access, w.activity);
  return { w, calls, svc: new CopyAiService(fakeAi, w.access, strategist) };
}
const input = (extra: Record<string, unknown> = {}) => ({ workspaceId: WS_A, brand: { name: 'Bar' }, brief: { name: 'BF' }, ...extra }) as any;

describe('buildCopyPrompt (idêntico ao protótipo)', () => {
  it('sem estratégia', () => {
    const p = buildCopyPrompt({ name: 'Bar' }, { name: 'BF' }, 0);
    expect(p).toBe([
      'Você é um copywriter sênior de performance no Brasil. Escreva em português do Brasil.',
      'Respeite o tom de voz, use as palavras preferidas e NUNCA use as palavras proibidas da marca.',
      'Devolva SOMENTE um JSON com: headline, headline_variacoes (5), texto_curto, texto_longo, cta, meta_ad,',
      'instagram_feed, reels (roteiro com tempos), stories (4 stories), script_ugc, script_institucional,',
      'carrossel (7 slides), quiz (3 perguntas com 3-4 opções).',
      'Versão 1: traga ângulos diferentes das versões anteriores.',
      'MARCA: {"name":"Bar"}',
      'CAMPANHA: {"name":"BF"}',
    ].join('\n'));
  });
  it('com estratégia: instrução extra e bloco ESTRATÉGIA; versão = seed + 1', () => {
    const p = buildCopyPrompt({}, {}, 4, { big_idea: 'x' });
    expect(p).toContain('Siga a ESTRATÉGIA aprovada: a big idea e a mensagem principal guiam tudo;');
    expect(p).toContain('Versão 5:');
    expect(p.endsWith('ESTRATÉGIA: {"big_idea":"x"}')).toBe(true);
  });
  it('schema estrito com as 13 chaves obrigatórias', () => {
    expect(COPY_SCHEMA.additionalProperties).toBe(false);
    expect(COPY_SCHEMA.required).toHaveLength(13);
    expect(COPY_SCHEMA.required).toEqual(expect.arrayContaining(['headline_variacoes', 'carrossel', 'quiz', 'script_institucional']));
  });
});

describe('CopyAiService.generate', () => {
  it('chama o AiService com schema "copy" e o motor pedido; devolve {content, engine}', async () => {
    const { calls, svc } = setup(async () => ({ content: { headline: 'H' }, engine: 'Sua conta Gemini' }));
    const r = await svc.generate(OWNER, input({ engine: 'gemini', seed: 2 }));
    expect(r).toEqual({ content: { headline: 'H' }, engine: 'Sua conta Gemini' });
    expect(calls[0][0]).toBe(WS_A);
    expect(calls[0][1]).toMatchObject({ name: 'copy', engine: 'gemini', schema: COPY_SCHEMA });
    expect(calls[0][1].prompt).toContain('Versão 3:');
    expect(calls[0][1].prompt).not.toContain('ESTRATÉGIA:');
  });

  it('usa a estratégia (aprovada) da campanha, ou o ângulo escolhido', async () => {
    const { w, calls, svc } = setup();
    const { campaign } = await seedCampaign(w);
    await w.t.campaign_strategies.create({
      data: { workspace_id: WS_A, campaign_id: campaign.id, version: 1, status: 'approved', content: {
        big_idea: 'Chopp que une', mensagem_principal: 'MP', objecoes: [], angulos_detalhados: [{ nome: 'Promo', gancho: 'G', mensagem: 'Msg' }, { nome: 'Outro', gancho: 'G2', mensagem: 'Msg2' }],
      } },
    });
    await svc.generate(OWNER, input({ campaignId: campaign.id }));
    expect(calls[0][1].prompt).toContain('ESTRATÉGIA: {"big_idea":"Chopp que une","mensagem_principal":"MP","angulo":null,"angulos":[{"nome":"Promo"');
    await svc.generate(OWNER, input({ campaignId: campaign.id, angle: 'Outro' }));
    expect(calls[1][1].prompt).toContain('"angulo":{"nome":"Outro"');
    expect(calls[1][1].prompt).not.toContain('"angulos":[');
  });

  it('estratégia de campanha de OUTRO workspace não vaza para o prompt', async () => {
    const { w, calls, svc } = setup();
    const { campaign } = await seedCampaign(w);
    await w.t.campaign_strategies.create({ data: { workspace_id: WS_A, campaign_id: campaign.id, version: 1, status: 'approved', content: { big_idea: 'SEGREDO' } } });
    // STRANGER é dono de WS_B e aponta a campanha de WS_A
    await svc.generate(STRANGER, { workspaceId: (await import('../../campaigns/__tests__/world')).WS_B, brand: {}, brief: {}, campaignId: campaign.id } as any);
    expect(calls[0][1].prompt).not.toContain('SEGREDO');
  });

  it('viewer → 403; não-membro → 403 "Você não tem acesso a esta empresa."; a IA não é chamada', async () => {
    const { calls, svc } = setup();
    expect(await status(svc.generate(VIEWER, input()))).toBe('403:Seu perfil não tem permissão para esta ação.');
    expect(await status(svc.generate(STRANGER, input()))).toBe('403:Você não tem acesso a esta empresa.');
    expect(calls).toHaveLength(0);
  });

  it('briefing gigante → 400', async () => {
    const { svc } = setup();
    expect(await status(svc.generate(OWNER, input({ brief: { x: 'y'.repeat(31_000) } })))).toBe('400:Briefing grande demais.');
  });

  it('mensagens de erro da cópia: formato, créditos (conecte sua chave), limite, falha', async () => {
    const cases: [string, string][] = [
      ['A IA não devolveu o formato esperado.', 'A IA não devolveu a copy no formato esperado.'],
      ['Créditos de IA esgotados. Adicione créditos para continuar.', 'Créditos de IA esgotados. Conecte sua própria chave em Integrações.'],
      ['Muitas solicitações agora. Aguarde um instante e tente de novo.', 'Muitas solicitações agora. Tente em instantes.'],
      ['A IA não conseguiu responder.', 'A IA não conseguiu gerar a copy.'],
      ['IA do app não configurada.', 'IA do app não configurada.'],
    ];
    for (const [from, to] of cases) {
      const { svc } = setup(async () => { throw new AiError(from); });
      expect(await status(svc.generate(OWNER, input()))).toBe(`502:${to}`);
    }
  });
});
