import { randomUUID } from 'node:crypto';
import { CrmPublicController } from '../crm-public.controller';
import { DEV_UNSUBSCRIBE_SECRET, UnsubscribeLinkService } from '../unsubscribe-link.service';
import { embedScript, formConfig, renderFormHtml, safeRedirect } from '../site-form.render';
import { FormError, INTEGRATION_CAP } from '../site-form.service';
import { crmWorld, WS_A, WS_B } from './harness';

const TOKEN = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8';

async function formWorld(config: Record<string, unknown> = {}, over: Record<string, unknown> = {}) {
  const w = crmWorld();
  const integration: any = await w.t.crm_integrations.create({ data: { workspace_id: WS_A, kind: 'site_form', provider: 'site', webhook_token: TOKEN, verify_token: 'v', config, ...over } });
  const ledger: any = {
    integrationByToken: async (token: string, kind: string) => {
      const row = w.t.crm_integrations.rows.find((r) => r.webhook_token === token && r.kind === kind);
      return row ?? null;
    },
    touchIntegration: async (id: string, patch: any) => { Object.assign(w.t.crm_integrations.rows.find((r) => r.id === id)!, patch, { last_event_at: new Date() }); },
  };
  const controller = new CrmPublicController(ledger, w.forms, w.unsubscribe, { APP_URL: 'http://web.test/' });
  return { w, integration, controller };
}

/** Resposta Fastify mínima: guarda status, cabeçalhos e corpo. */
function fakeReply() {
  const st = { code: 200, headers: {} as Record<string, string>, body: undefined as any };
  const reply: any = {
    status: (c: number) => { st.code = c; return reply; },
    header: (k: string, v: string) => { st.headers[k.toLowerCase()] = v; return reply; },
    headers: (h: Record<string, string>) => { for (const [k, v] of Object.entries(h)) st.headers[k.toLowerCase()] = v; return reply; },
    removeHeader: (k: string) => { delete st.headers[k.toLowerCase()]; return reply; },
    raw: { removeHeader: (k: string) => { st.headers[`raw-removed-${k.toLowerCase()}`] = '1'; } },
    send: (b?: unknown) => { st.body = b; return reply; },
  };
  return { reply, state: st };
}
const req = (body: unknown, opts: { type?: string; ip?: string } = {}): any => ({
  body, ip: opts.ip ?? '203.0.113.9', headers: { 'content-type': opts.type ?? 'application/json' }, isMultipart: () => false,
});
const OLD = Date.now() - 60_000; // preenchimento "demorado" (passa dos 2,5 s)

describe('formulário do site — POST', () => {
  it('lead novo: origem site, LGPD, etapa inicial + histórico + interação; integração vira "connected"', async () => {
    const { w, controller, integration } = await formWorld({ redirect_url: 'https://obrigado.example/ok' }, { status: 'connecting' });
    const { reply, state } = fakeReply();
    await controller.submit(TOKEN, req({ name: 'Ana', email: 'ANA@Ex.com', phone: '(11) 99999-0000', message: 'quero', page: 'https://s.test/', utm_source: 'g', _t: OLD }), reply);
    expect(state.code).toBe(200);
    expect(state.body).toEqual({ ok: true, redirect: 'https://obrigado.example/ok' });
    expect(state.headers['access-control-allow-origin']).toBe('*');
    expect(w.t.crm_leads.rows).toHaveLength(1);
    expect(w.t.crm_leads.rows[0]).toEqual(expect.objectContaining({
      workspace_id: WS_A, name: 'Ana', email: 'ana@ex.com', phone: '+5511999990000', source: 'site', utm_source: 'g', lgpd_consent: true, stage_id: w.A.stages[0]!.id,
    }));
    expect(w.t.crm_stage_history.rows).toEqual([expect.objectContaining({ from_stage_id: null, to_stage_id: w.A.stages[0]!.id })]);
    expect(w.t.crm_interactions.rows[0]!.content).toBe('Lead do formulário do site: "quero" Página: https://s.test/');
    expect(w.t.crm_integrations.rows.find((r) => r.id === integration.id)!.status).toBe('connected');
    expect(w.t.crm_webhook_events.rows).toEqual([expect.objectContaining({ source: 'site_form', payload: expect.objectContaining({ page: 'https://s.test/' }) })]);
  });

  it('isca (honeypot) preenchida: responde ok e NÃO grava nada', async () => {
    const { w, controller } = await formWorld();
    const { reply, state } = fakeReply();
    await controller.submit(TOKEN, req({ name: 'Robô', email: 'r@x.co', website: 'http://spam', _t: OLD }), reply);
    expect(state.code).toBe(200);
    expect(state.body).toEqual({ ok: true, redirect: null });
    expect(w.t.crm_leads.rows).toHaveLength(0);
    expect(w.t.crm_webhook_events.rows).toHaveLength(0);
  });

  it('preenchido em menos de 2,5 s: ok sem gravar; depois de 2,5 s grava', async () => {
    const { w, controller } = await formWorld();
    let r = fakeReply();
    await controller.submit(TOKEN, req({ name: 'Rápido', email: 'r@x.co', _t: Date.now() - 1000 }), r.reply);
    expect(r.state.code).toBe(200);
    expect(w.t.crm_leads.rows).toHaveLength(0);
    r = fakeReply();
    await controller.submit(TOKEN, req({ name: 'Lento', email: 'l@x.co', _t: Date.now() - 2600 }), r.reply);
    expect(w.t.crm_leads.rows).toHaveLength(1);
  });

  it('limite de 5 envios por 10 min por IP (com hash): o 6º é 429; outro IP passa; IP mais velho que 10 min não conta', async () => {
    const { w, controller, integration } = await formWorld();
    for (let i = 0; i < 5; i++) {
      const r = fakeReply();
      await controller.submit(TOKEN, req({ name: `L${i}`, email: `l${i}@x.co`, _t: OLD }), r.reply);
      expect(r.state.code).toBe(200);
    }
    const blocked = fakeReply();
    await controller.submit(TOKEN, req({ name: 'L6', email: 'l6@x.co', _t: OLD }), blocked.reply);
    expect(blocked.state.code).toBe(429);
    expect(blocked.state.body).toEqual({ error: 'Muitos envios seguidos. Tente de novo em alguns minutos.' });
    expect(w.t.crm_leads.rows).toHaveLength(5);
    // o IP nunca é gravado em texto puro: sha256(integrationId:ip)[0..32]
    const stored = w.t.crm_webhook_events.rows[0]!.payload.ip as string;
    expect(stored).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(w.t.crm_webhook_events.rows)).not.toContain('203.0.113.9');
    expect(integration.id).toBeTruthy();
    const other = fakeReply();
    await controller.submit(TOKEN, req({ name: 'Outro', email: 'o@x.co', _t: OLD }, { ip: '198.51.100.7' }), other.reply);
    expect(other.state.code).toBe(200);
    // eventos de mais de 10 min saem da janela
    w.t.crm_webhook_events.rows.forEach((e) => { if (e.payload.ip === stored) e.created_at = new Date(Date.now() - 11 * 60e3); });
    const again = fakeReply();
    await controller.submit(TOKEN, req({ name: 'Volta', email: 'v@x.co', _t: OLD }), again.reply);
    expect(again.state.code).toBe(200);
  });

  it('usa request.ip: um cabeçalho x-forwarded-for / cf-connecting-ip forjado NÃO muda o balde', async () => {
    const { controller } = await formWorld();
    for (let i = 0; i < 5; i++) {
      const r = fakeReply();
      const rq = req({ name: `L${i}`, email: `l${i}@x.co`, _t: OLD });
      rq.headers['x-forwarded-for'] = `10.0.0.${i}`;
      rq.headers['cf-connecting-ip'] = `10.1.0.${i}`;
      await controller.submit(TOKEN, rq, r.reply);
    }
    const blocked = fakeReply();
    const rq = req({ name: 'X', email: 'x@x.co', _t: OLD });
    rq.headers['x-forwarded-for'] = '10.9.9.9';
    await controller.submit(TOKEN, rq, blocked.reply);
    expect(blocked.state.code).toBe(429);
  });

  it('teto por integração: com IPs diferentes, o 61º envio em 10 min é 429 (pt-BR); outra integração não é afetada', async () => {
    const { w, integration, controller } = await formWorld();
    const now = Date.now();
    for (let i = 0; i < INTEGRATION_CAP; i++) {
      w.t.crm_webhook_events.rows.push({ id: randomUUID(), workspace_id: WS_A, source: 'site_form', payload: { ip: `ip${i}`, integration: integration.id }, status: 'processed', created_at: new Date(now - 60_000) });
    }
    const r = fakeReply();
    await controller.submit(TOKEN, req({ name: 'Mais um', email: 'm@x.co', _t: OLD }, { ip: '198.51.100.77' }), r.reply);
    expect(r.state.code).toBe(429);
    expect(r.state.body.error).toBe('Este formulário está recebendo envios demais agora. Tente de novo em alguns minutos.');
    expect(w.t.crm_leads.rows).toHaveLength(0);
    // envios velhos (> 10 min) saem da janela
    w.t.crm_webhook_events.rows.forEach((e) => { e.created_at = new Date(now - 11 * 60e3); });
    const ok = fakeReply();
    await controller.submit(TOKEN, req({ name: 'Agora', email: 'a@x.co', _t: OLD }, { ip: '198.51.100.78' }), ok.reply);
    expect(ok.state.code).toBe(200);
    expect(w.t.crm_leads.rows).toHaveLength(1);
  });

  it('_t obrigatório: ausente, 0, não numérico ou no futuro = spam (mesma resposta ok do isca, nada gravado); válido grava', async () => {
    const { w, controller } = await formWorld();
    const base = { name: 'Bot', email: 'bot@x.co' };
    const ok = fakeReply();
    await controller.submit(TOKEN, req({ name: 'Humano', email: 'h@x.co', _t: OLD }), ok.reply);
    for (const t of [undefined, 0, '0', '', 'abc', null, Date.now() + 60_000, String(Date.now() + 60_000), -5, NaN]) {
      const r = fakeReply();
      await controller.submit(TOKEN, req({ ...base, ...(t === undefined ? {} : { _t: t }) }), r.reply);
      expect([r.state.code, r.state.body]).toEqual([ok.state.code, ok.state.body]);
    }
    expect(w.t.crm_leads.rows).toHaveLength(1);
    expect(w.t.crm_leads.rows[0].name).toBe('Humano');
    // a resposta do isca é a mesma
    const hp = fakeReply();
    await controller.submit(TOKEN, req({ ...base, website: 'x', _t: OLD }), hp.reply);
    expect([hp.state.code, hp.state.body]).toEqual([ok.state.code, ok.state.body]);
  });

  it('campos longos são truncados (nome 300, e-mail 320, telefone 40, mensagem 2000, página 2000, utm 200)', async () => {
    const { w, controller } = await formWorld();
    await controller.submit(TOKEN, req({ name: 'N'.repeat(5000), email: 'a@b.co', phone: '1'.repeat(200), message: 'M'.repeat(9000), page: 'P'.repeat(9000), utm_source: 'S'.repeat(999), utm_medium: 'D'.repeat(999), utm_campaign: 'C'.repeat(999), _t: OLD }), fakeReply().reply);
    const lead = w.t.crm_leads.rows[0];
    expect(lead.name).toHaveLength(300);
    expect(lead.utm_source).toHaveLength(200);
    expect(lead.utm_medium).toHaveLength(200);
    expect(lead.utm_campaign).toHaveLength(200);
    const inter = w.t.crm_interactions.rows[0];
    expect(inter.content.length).toBeLessThanOrEqual(2000 + 2000 + 100);
    expect(inter.content).not.toContain('M'.repeat(2001));
    expect(inter.content).not.toContain('P'.repeat(2001));
    expect(String(lead.phone).length).toBeLessThanOrEqual(41); // 40 dígitos + o "+" da normalização
  });

  it('erros: sem e-mail/telefone válidos → 400; token inexistente, de outro tipo ou desconectado → 404; corpo ilegível → 400', async () => {
    const { w, controller, integration } = await formWorld();
    let r = fakeReply();
    await controller.submit(TOKEN, req({ name: 'Sem contato', email: 'invalido', _t: OLD }), r.reply);
    expect([r.state.code, r.state.body]).toEqual([400, { error: 'Informe um e-mail válido ou um telefone.' }]);
    r = fakeReply();
    await controller.submit('naoexiste', req({ name: 'x', email: 'a@b.co' }), r.reply);
    expect([r.state.code, r.state.body]).toEqual([404, { error: 'Formulário não encontrado.' }]);
    w.t.crm_integrations.rows.find((x) => x.id === integration.id)!.status = 'disconnected';
    r = fakeReply();
    await controller.submit(TOKEN, req({ name: 'x', email: 'a@b.co' }), r.reply);
    expect(r.state.code).toBe(404);
    w.t.crm_integrations.rows.find((x) => x.id === integration.id)!.status = 'connected';
    r = fakeReply();
    await controller.submit(TOKEN, req(undefined), r.reply);
    expect([r.state.code, r.state.body]).toEqual([400, { error: 'Dados inválidos.' }]);
    w.t.crm_integrations.rows.find((x) => x.id === integration.id)!.kind = 'whatsapp';
    r = fakeReply();
    await controller.submit(TOKEN, req({ name: 'x', email: 'a@b.co' }), r.reply);
    expect(r.state.code).toBe(404);
  });

  it('envio de formulário comum (não JSON) com redirect_url → 303 Location; JSON → 200 com { redirect }', async () => {
    const { controller } = await formWorld({ redirect_url: 'https://obrigado.example/ok' });
    let r = fakeReply();
    await controller.submit(TOKEN, req({ name: 'Ana', email: 'a@b.co', _t: String(OLD) }, { type: 'application/x-www-form-urlencoded' }), r.reply);
    expect(r.state.code).toBe(303);
    expect(r.state.headers['location']).toBe('https://obrigado.example/ok');
    r = fakeReply();
    await controller.submit(TOKEN, req({ name: 'Bia', email: 'b@b.co', _t: OLD }, { type: 'application/json' }), r.reply);
    expect([r.state.code, r.state.body]).toEqual([200, { ok: true, redirect: 'https://obrigado.example/ok' }]);
  });

  it('formulário comum sem redirect_url → 200 JSON (como o protótipo)', async () => {
    const { controller } = await formWorld();
    const r = fakeReply();
    await controller.submit(TOKEN, req({ name: 'Ana', email: 'a@b.co', _t: OLD }, { type: 'application/x-www-form-urlencoded' }), r.reply);
    expect([r.state.code, r.state.body]).toEqual([200, { ok: true, redirect: null }]);
  });

  it('repetido (mesmo telefone/e-mail): não duplica o lead, registra a interação', async () => {
    const { w, controller } = await formWorld();
    await controller.submit(TOKEN, req({ name: 'Ana', email: 'a@b.co', _t: OLD }), fakeReply().reply);
    await controller.submit(TOKEN, req({ name: 'Ana', email: 'a@b.co', message: 'de novo', _t: OLD }), fakeReply().reply);
    expect(w.t.crm_leads.rows).toHaveLength(1);
    expect(w.t.crm_interactions.rows.map((i) => i.content)).toEqual(['Lead do formulário do site.', 'Preencheu o formulário do site novamente: "de novo"']);
  });

  it('lead de outro workspace com o mesmo e-mail NÃO é tocado (dedupe só no workspace da integração)', async () => {
    const { w, controller } = await formWorld();
    await w.addLead(WS_B, { email: 'a@b.co' });
    await controller.submit(TOKEN, req({ name: 'Ana', email: 'a@b.co', _t: OLD }), fakeReply().reply);
    expect(w.t.crm_leads.rows.filter((l) => l.workspace_id === WS_A)).toHaveLength(1);
    expect(w.t.crm_interactions.rows.every((i) => i.workspace_id === WS_A)).toBe(true);
  });

  it('cadência ativa por origem "site" matricula o lead novo', async () => {
    const { w, controller } = await formWorld();
    const cad = await w.t.crm_cadences.create({ data: { workspace_id: WS_A, name: 'Site', trigger_type: 'source', trigger_value: 'site' } });
    await controller.submit(TOKEN, req({ name: 'Ana', email: 'a@b.co', _t: OLD }), fakeReply().reply);
    expect(w.t.crm_cadence_runs.rows).toEqual([expect.objectContaining({ cadence_id: cad.id, workspace_id: WS_A, status: 'running' })]);
  });
});

describe('formulário do site — GET, embed e OPTIONS', () => {
  it('GET devolve o HTML (no-store, embutível em iframe); 404 sem integração', async () => {
    const { controller } = await formWorld({ title: 'Fale <b>já</b>', color: '#112233', ask_message: true, privacy_url: 'https://p.test/priv' });
    const r = fakeReply();
    await controller.form(TOKEN, r.reply);
    expect(r.state.code).toBe(200);
    expect(r.state.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(r.state.headers['cache-control']).toBe('no-store');
    expect(r.state.headers['content-security-policy']).toContain('frame-ancestors *');
    expect(r.state.headers['raw-removed-x-frame-options']).toBe('1');
    expect(r.state.body).toContain('Fale &lt;b&gt;já&lt;/b&gt;');
    expect(r.state.body).toContain('background:#112233');
    expect(r.state.body).toContain('name="website"');
    expect(r.state.body).toContain('name="message"');
    expect(r.state.body).toContain(`mfForm:${JSON.stringify(TOKEN)}`);
    const nf = fakeReply();
    await controller.form('nao-existe', nf.reply);
    expect(nf.state.code).toBe(404);
  });

  it('embed: JavaScript com cache de 5 min e CORS *, apontando para APP_URL; token estranho → 404', async () => {
    const { controller } = await formWorld();
    const r = fakeReply();
    controller.embed(TOKEN, r.reply);
    expect(r.state.headers['content-type']).toBe('application/javascript; charset=utf-8');
    expect(r.state.headers['cache-control']).toBe('public, max-age=300');
    expect(r.state.headers['access-control-allow-origin']).toBe('*');
    expect(r.state.body).toContain(`"http://web.test/api/public/forms/${TOKEN}"`);
    const bad = fakeReply();
    controller.embed('x"</script>', bad.reply);
    expect(bad.state.code).toBe(404);
  });

  it('o HTML sempre leva o _t do servidor num campo oculto (envio sem JS) e o JS o reaproveita', async () => {
    const { controller } = await formWorld();
    const r = fakeReply();
    const before = Date.now();
    await controller.form(TOKEN, r.reply);
    const m = /<input type="hidden" name="_t" value="(\d+)">/.exec(r.state.body);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(before);
    expect(r.state.body).toContain('d._t=Number(d._t)||t');
  });

  it('XSS: título, subtítulo, botão e agradecimento vindos da config são escapados (HTML e script)', () => {
    const evil = `</script><img src=x onerror=alert(1)>"'&`;
    const cfg = formConfig({ config: { title: evil, subtitle: evil, button: evil, thanks: evil } });
    const html = renderFormHtml(TOKEN, cfg);
    expect(html).not.toContain('<img src=x');
    expect(html).not.toMatch(/<\/script><img/);
    const esc = '&lt;/script&gt;&lt;img src=x onerror=alert(1)&gt;&quot;\'&amp;';
    expect(html).toContain(`<h1>${esc}</h1>`);
    expect(html).toContain(`<p class="sub">${esc}</p>`);
    expect(html).toContain(`<button type="submit">${esc}</button>`);
    // "obrigado" vai dentro do <script>: escapado como HTML e como literal JS (JSON.stringify), sem fechar a tag
    const script = html.slice(html.indexOf('<script>'));
    expect(script).toContain(JSON.stringify(esc));
    expect(script.match(/<\/script>/g)).toHaveLength(1);
  });

  it('OPTIONS → 204 com CORS', () => {
    const w = fakeReply();
    new CrmPublicController(null as any, null as any, null as any, { APP_URL: 'x' }).preflight(w.reply);
    expect([w.state.code, w.state.headers['access-control-allow-methods']]).toEqual([204, 'GET, POST, OPTIONS']);
  });

  it('redirect/privacidade só aceitam http(s) (javascript: é descartado); cor inválida cai no padrão', () => {
    expect(safeRedirect('javascript:alert(1)')).toBeNull();
    expect(safeRedirect('https://ok.test/a')).toBe('https://ok.test/a');
    expect(safeRedirect('//x.test')).toBeNull();
    const cfg = formConfig({ config: { redirect_url: 'javascript:alert(1)', privacy_url: 'data:text/html,x', color: 'red', title: 42 } });
    expect([cfg.redirect_url, cfg.privacy_url, cfg.color, cfg.title]).toEqual([null, null, '#4F46E5', 'Fale com a gente']);
    expect(renderFormHtml('t', cfg)).not.toContain('javascript:');
    expect(embedScript('tok', 'http://o.test')).toContain('"http://o.test/api/public/forms/tok"');
  });

  it('FormError carrega o status', () => {
    expect(new FormError('x', 429).status).toBe(429);
    expect(new FormError('x').status).toBe(400);
  });
});

describe('descadastro — link assinado', () => {
  async function leadWorld() {
    const w = crmWorld();
    const lead: any = await w.addLead(WS_A, { email: 'a@b.co' });
    const other: any = await w.addLead(WS_A, { email: 'o@b.co' });
    const cad = await w.t.crm_cadences.create({ data: { workspace_id: WS_A, name: 'C' } });
    await w.t.crm_cadence_runs.create({ data: { workspace_id: WS_A, cadence_id: cad.id, lead_id: lead.id } });
    const ctl = new CrmPublicController(null as any, null as any, w.unsubscribe, { APP_URL: 'http://web.test/' });
    return { w, lead, other, ctl };
  }
  const tokenOf = (url: string) => new URL(url).searchParams.get('t')!;
  const page = async (ctl: CrmPublicController, id: string, t: string | undefined) => {
    const r = fakeReply();
    await ctl.unsubscribeLead(id, t, r.reply);
    return r.state;
  };

  it('link válido: HMAC-SHA256 completo (64 hex), sob APP_URL; descadastra, desliga a IA, para a cadência e registra', async () => {
    const { w, lead, ctl } = await leadWorld();
    const url = w.links.link(WS_A, lead.id);
    expect(url).toMatch(new RegExp(`^http://web\\.test/api/public/unsubscribe/${lead.id}\\?t=[0-9a-f]{64}$`));
    const s = await page(ctl, lead.id, tokenOf(url));
    expect(s.code).toBe(200);
    expect(s.body).toContain('Pronto. Você não receberá mais nossos e-mails.');
    expect(w.t.crm_leads.rows.find((l) => l.id === lead.id)).toEqual(expect.objectContaining({ unsubscribed: true, ai_active: false }));
    expect(w.t.crm_cadence_runs.rows[0]).toEqual(expect.objectContaining({ status: 'stopped', stop_reason: 'opt_out' }));
    expect(w.t.crm_cadence_events.rows).toEqual([expect.objectContaining({ event: 'opt_out', lead_id: lead.id })]);
    expect(w.t.crm_interactions.rows).toEqual([expect.objectContaining({ kind: 'ai_action', author_type: 'system', content: 'Lead se descadastrou pelo link do e-mail. Envios automáticos bloqueados.' })]);
    // clicar de novo é idempotente (não duplica a interação)
    await page(ctl, lead.id, tokenOf(url));
    expect(w.t.crm_interactions.rows).toHaveLength(1);
  });

  it('assinatura adulterada, truncada (formato antigo de 32 hex), vazia ou ausente → "Link inválido ou expirado." e nada muda', async () => {
    const { w, lead, ctl } = await leadWorld();
    const good = tokenOf(w.links.link(WS_A, lead.id));
    const flipped = (good[0] === 'a' ? 'b' : 'a') + good.slice(1);
    for (const t of [flipped, good.slice(0, 32), good + '0', '', undefined, 'zzzz']) {
      const s = await page(ctl, lead.id, t as any);
      expect(s.body).toContain('Link inválido ou expirado.');
    }
    expect(w.t.crm_leads.rows.find((l) => l.id === lead.id)!.unsubscribed).toBe(false);
    expect(w.t.crm_interactions.rows).toHaveLength(0);
  });

  it('assinatura de OUTRO lead (mesmo workspace) não vale; id malformado, inexistente ou de lead apagado → inválido', async () => {
    const { w, lead, other, ctl } = await leadWorld();
    const tOther = tokenOf(w.links.link(WS_A, other.id));
    expect((await page(ctl, lead.id, tOther)).body).toContain('Link inválido ou expirado.');
    expect((await page(ctl, 'nao-e-uuid', tOther)).body).toContain('Link inválido ou expirado.');
    const ghost = randomUUID();
    expect((await page(ctl, ghost, tokenOf(w.links.link(WS_A, ghost)))).body).toContain('Link inválido ou expirado.');
    expect(w.t.crm_leads.rows.every((l) => !l.unsubscribed)).toBe(true);
  });

  it('a assinatura é presa ao workspace: o mesmo lead com a assinatura calculada para OUTRO workspace não vale', async () => {
    const { w, lead, ctl } = await leadWorld();
    const wrongWs = tokenOf(w.links.link(WS_B, lead.id));
    expect((await page(ctl, lead.id, wrongWs)).body).toContain('Link inválido ou expirado.');
    expect(w.links.verify(WS_A, lead.id, w.links.sign(WS_A, lead.id))).toBe(true);
    expect(w.links.verify(WS_B, lead.id, w.links.sign(WS_A, lead.id))).toBe(false);
  });

  it('segredo: dev/test usam a chave fixa; produção exige UNSUBSCRIBE_SECRET; segredos diferentes geram assinaturas diferentes', () => {
    const id = randomUUID();
    const dev = new UnsubscribeLinkService({ NODE_ENV: 'development', APP_URL: 'http://x', UNSUBSCRIBE_SECRET: undefined } as any);
    expect(dev.sign(WS_A, id)).toMatch(/^[0-9a-f]{64}$/);
    expect(DEV_UNSUBSCRIBE_SECRET).toContain('dev');
    const prodNoSecret = new UnsubscribeLinkService({ NODE_ENV: 'production', APP_URL: 'http://x', UNSUBSCRIBE_SECRET: undefined } as any);
    expect(() => prodNoSecret.sign(WS_A, id)).toThrow(/UNSUBSCRIBE_SECRET/);
    const a = new UnsubscribeLinkService({ NODE_ENV: 'production', APP_URL: 'http://x', UNSUBSCRIBE_SECRET: 'um-segredo' } as any);
    const b = new UnsubscribeLinkService({ NODE_ENV: 'production', APP_URL: 'http://x', UNSUBSCRIBE_SECRET: 'outro-segredo' } as any);
    expect(a.sign(WS_A, id)).not.toBe(b.sign(WS_A, id));
    expect(b.verify(WS_A, id, a.sign(WS_A, id))).toBe(false);
    // o segredo do cron (CRM_CRON_SECRET) não é mais fallback
    expect(() => new UnsubscribeLinkService({ NODE_ENV: 'production', APP_URL: 'http://x', CRM_CRON_SECRET: 'cron' } as any).sign(WS_A, id)).toThrow();
  });

  it('nunca usa comparação comum: ids/tokens de tamanhos diferentes simplesmente não conferem (sem lançar)', () => {
    const l = new UnsubscribeLinkService({ NODE_ENV: 'test', APP_URL: 'http://x' } as any);
    expect(l.verify(WS_A, randomUUID(), 'curto')).toBe(false);
    expect(l.verify(WS_A, randomUUID(), null)).toBe(false);
  });
});
