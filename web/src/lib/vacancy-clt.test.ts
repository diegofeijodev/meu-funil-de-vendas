import { describe, expect, it } from 'vitest';
import {
  cltArrivedEmpty, cltDisableText, cltEnableText, cltPollLine, cltPollNotice, cltSinceLine, cltStatusLine, cltTodayLine, cltWhatEnters,
  cltCheckedLine, isCltPost, storyDataLine, summaryWithClt, type CltView,
} from './vacancy-clt';

const base: CltView = {
  enabled: true, enabled_at: '2026-11-25T13:00:00Z', daily_cap: 2, backlog_days: 14, since: '2026-11-11T13:00:00Z', promo_days: 30,
  last_poll_at: '2026-11-25T17:40:00Z', last_poll_ok_at: '2026-11-25T17:40:00Z', last_poll_error: null,
  today: { posted: 1, scheduled: 0, cap: 2 }, counts: { ready: 0, to_approve: 0 }, has_brand: true, qr_available: false,
};

describe('vagas fixas — textos do cartão (UI §4.2)', () => {
  it('situação, hoje, consulta e desde', () => {
    expect(cltStatusLine(base, false)).toBe('Ligado · você aprova cada story antes');
    expect(cltStatusLine(base, true)).toBe('Ligado · posta sozinho depois da conferência');
    expect(cltStatusLine({ enabled: false }, true)).toBe('Desligado. Nenhuma vaga fixa vira story agora.');
    expect(cltTodayLine(base)).toBe('Hoje: 1 postado de 2 (o máximo por dia das vagas fixas)');
    expect(cltTodayLine({ today: { posted: 0, scheduled: 1, cap: 3 } })).toBe('Hoje: 0 postados de 3 (o máximo por dia das vagas fixas)');
    expect(cltPollLine(base)).toBe('Última consulta: 14h40 (a cada 10 minutos)');
    expect(cltPollLine({ enabled_at: base.enabled_at, last_poll_at: null })).toBe('Primeira consulta ao Freela em até 10 minutos.');
    expect(cltSinceLine(base)).toBe('Ligado desde 25/11 às 10h. Entram as vagas fixas publicadas desde 11/11.');
    expect(cltSinceLine({ ...base, backlog_days: 0 })).toBe('Ligado desde 25/11 às 10h. Vagas fixas publicadas antes disso não entram.');
    expect(cltSinceLine({ ...base, enabled_at: null })).toBeNull();
  });

  it('o que vai entrar (sem números), sem a cidade (decisão de 24/11)', () => {
    expect(cltWhatEnters(base)).toBe('Entram as vagas fixas novas e as dos últimos 14 dias, até 2 por dia. Vaga fixa publicada há mais de 30 dias não vira story. Sem salário também não.');
    expect(cltWhatEnters({ ...base, backlog_days: 0, daily_cap: 3 })).toBe('Entram as vagas fixas novas, até 3 por dia. Vaga fixa publicada há mais de 30 dias não vira story. Sem salário também não.');
  });

  it('consulta fora há mais de 30 min → aviso; dentro dos 30 min ou sem erro → nada', () => {
    const now = new Date('2026-11-25T18:30:00Z');
    expect(cltPollNotice({ ...base, last_poll_error: 'x', last_poll_ok_at: '2026-11-25T17:10:00Z' }, now)).toBe(
      'Não conseguimos consultar as vagas fixas do Freela desde as 14h10. Tentamos de novo sozinhos a cada 10 minutos. As diárias seguem normais.',
    );
    expect(cltPollNotice({ ...base, last_poll_error: 'x', last_poll_ok_at: '2026-11-25T18:10:00Z' }, now)).toBeNull();
    expect(cltPollNotice({ ...base, last_poll_error: null }, now)).toBeNull();
    expect(cltPollNotice({ ...base, last_poll_error: 'x', last_poll_ok_at: null }, now)).toMatch(/do Freela ainda\./);
  });

  it('diálogos de ligar e desligar', () => {
    expect(cltEnableText(base, 'freelaapp', false)).toBe(
      'A partir de agora, cada vaga fixa (CLT) nova do Freela vira um story no @freelaapp, até 2 por dia. Também entram, aos poucos, as abertas publicadas nos últimos 14 dias. Vagas sem salário não entram. Cada story espera sua aprovação antes de ir ao ar. As diárias não mudam.',
    );
    expect(cltEnableText({ daily_cap: 1, backlog_days: 0 }, null, true)).toBe(
      'A partir de agora, cada vaga fixa (CLT) nova do Freela vira um story no Instagram da empresa, até 1 por dia. Vagas sem salário não entram. Os stories vão ao ar sozinhos, depois que o sistema confere cargo e salário. As diárias não mudam.',
    );
    expect(cltDisableText({ ready: 1, to_approve: 0 })).toBe('1 story pronto de vagas fixas não vai ao ar. Os que já foram postados continuam no Instagram até sumirem sozinhos (24 h). As diárias continuam como estão.');
    expect(cltDisableText({ ready: 2, to_approve: 3 })).toMatch(/^2 stories prontos e 3 esperando aprovação de vagas fixas não vão ao ar\./);
    expect(cltDisableText({ ready: 0, to_approve: 0 })).toBe('Os que já foram postados continuam no Instagram até sumirem sozinhos (24 h). As diárias continuam como estão.');
  });
});

describe('vagas fixas — lista e Ajustes (UI §4.3–§4.4)', () => {
  it('linha de dados: CLT com /mês e "divulgar até"; diária como antes', () => {
    expect(storyDataLine({ kind: 'clt', valor: 'R$ 1.874,32', quando: 'divulgar até 24/12', cidade: 'São Paulo – SP' })).toBe('R$ 1.874,32/mês · São Paulo – SP · divulgar até 24/12');
    expect(storyDataLine({ kind: 'clt', valor: 'R$ 2.550', quando: 'divulgar até 24/12', cidade: null })).toBe('R$ 2.550/mês · divulgar até 24/12');
    expect(storyDataLine({ kind: 'diaria', valor: 'R$ 150', quando: 'Sáb 29/11 · 18h às 23h', cidade: 'Campinas' })).toBe('R$ 150 · Sáb 29/11 · 18h às 23h · Campinas');
    expect(storyDataLine({ valor: 'R$ 150', quando: 'Sáb 29/11 · 18h às 23h', cidade: 'Campinas' })).toBe('R$ 150 · Sáb 29/11 · 18h às 23h · Campinas');
  });

  it('vazio do filtro Fixas', () => {
    expect(cltArrivedEmpty(base)).toBe('Nenhuma vaga fixa nova desde que você ligou (25/11 às 10h). Consultamos o Freela a cada 10 minutos; a última foi às 14h40. Vagas fixas são poucas: conte em dias, não em horas.');
    expect(cltArrivedEmpty({ ...base, enabled: false })).toBe('Ligue as vagas fixas no cartão acima para elas aparecerem aqui.');
  });

  it('resumo dos Ajustes: as fixas só com elas ligadas', () => {
    const s = 'Todas as cidades · 8h às 21h · até 15/dia · OpenAI';
    expect(summaryWithClt(s, 15, base)).toBe('Todas as cidades · 8h às 21h · diárias até 15/dia · fixas até 2/dia · OpenAI');
    expect(summaryWithClt(s, 15, { ...base, enabled: false })).toBe(s);
    expect(summaryWithClt(s, 15, null)).toBe(s);
  });
});

describe('vagas fixas — Aprovações', () => {
  it('"Conferido: cargo, salário, cidade"; só o post com kind clt é de vaga fixa', () => {
    expect(cltCheckedLine(['funcao', 'valor', 'cidade'])).toBe('Conferido: cargo, salário, cidade');
    expect(cltCheckedLine(['funcao', 'valor', 'estabelecimento'])).toBe('Conferido: cargo, salário, empresa');
    expect(cltCheckedLine([])).toBeNull();
    expect(isCltPost({ creative_brief: { vacancy: { kind: 'clt' } } })).toBe(true);
    expect(isCltPost({ creative_brief: { vacancy: {} } })).toBe(false);
    expect(isCltPost({ creative_brief: null })).toBe(false);
  });
});
