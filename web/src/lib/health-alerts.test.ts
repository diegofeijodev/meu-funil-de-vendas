import { describe, expect, it } from "vitest";
import { aiAlertText, aiStopsList, dayTimeSp, daySp, instagramAlertText, joinPt, META_PERMISSION_HELP, shortReason } from "./health-alerts";

type R = "no_credit" | "daily_limit";
const o = (since: string, reason: R = "no_credit") => ({ vendor: "openai" as const, label: "ChatGPT (OpenAI)", reason, since, last_at: since });
const g = (since: string, reason: R = "no_credit") => ({ vendor: "gemini" as const, label: "Gemini (Google)", reason, since, last_at: since });
const LIST = "posts e calendário do Instagram, artes e vídeos, textos de anúncio, estratégias de campanha, o piloto de campanhas, as sugestões do gestor de tráfego e as respostas automáticas do SDR no CRM";

describe("datas em Brasília", () => {
  it("01/11 21:00 de Brasília = 02/11 00:00 UTC", () => {
    expect(dayTimeSp("2026-11-02T00:00:00Z")).toBe("01/11 às 21:00");
    expect(daySp("2026-11-02T00:00:00Z")).toBe("01/11");
  });
});

describe("aiAlertText", () => {
  it("IA parada (vermelho): desde a falha do ÚLTIMO provedor, o que para e o que continua; links e teste dos dois", () => {
    const t = aiAlertText({ level: "stopped", fallback: null, inherited_from: null, vendors: [o("2026-10-28T15:00:00Z"), g("2026-11-02T00:00:00Z")] });
    expect(t.tone).toBe("danger");
    expect(t.title).toBe("Sua IA está sem créditos");
    expect(t.body).toBe(
      `Desde 01/11 às 21:00, o ChatGPT (OpenAI) e o Gemini (Google) recusaram os pedidos por falta de saldo. Enquanto isso, nada novo é criado: ${LIST}. O que já estava pronto e agendado continua sendo publicado.`,
    );
    expect(t.links.map((l) => [l.label, l.href])).toEqual([
      ["Colocar créditos na OpenAI", "https://platform.openai.com/settings/organization/billing/overview"],
      ["Colocar créditos no Google", "https://aistudio.google.com/"],
    ]);
    expect(t.testVendors).toEqual(["openai", "gemini"]);
    expect(t.inherited).toBeNull();
  });

  it("parada com um provedor só, herdada da agência e com stories das vagas", () => {
    const t = aiAlertText({ level: "stopped", fallback: null, inherited_from: { id: "x", name: "Freela App" }, vendors: [g("2026-11-02T00:00:00Z")] }, { vacancyStories: true });
    expect(t.body).toMatch(/^Desde 01\/11 às 21:00, o Gemini \(Google\) recusou os pedidos por falta de saldo\. /);
    expect(t.body).toContain("as respostas automáticas do SDR no CRM e os stories das vagas.");
    expect(t.inherited).toBe("A IA desta empresa vem da Freela App.");
    expect(t.links.map((l) => l.vendor)).toEqual(["gemini"]);
  });

  it("parcial (amarelo): quem está sem saldo e quem segura a IA", () => {
    const t = aiAlertText({ level: "partial", fallback: "gemini", inherited_from: null, vendors: [o("2026-10-28T15:00:00Z")] });
    expect(t).toMatchObject({ tone: "warning", title: "Uma das IAs está sem créditos", testVendors: ["openai"] });
    expect(t.body).toBe("A conta do ChatGPT (OpenAI) está sem créditos desde 28/10. Por enquanto a IA está usando o Gemini (Google).");
    // Gateway do app: não conferimos se ele tem crédito, então o texto não afirma que a IA está usando.
    const app = aiAlertText({ level: "partial", fallback: "app", inherited_from: null, vendors: [o("2026-10-28T15:00:00Z"), g("2026-10-30T15:00:00Z")] });
    expect(app.body).toBe("As contas do ChatGPT (OpenAI) e do Gemini (Google) estão sem créditos desde 28/10. A IA pode seguir pelos créditos do app.");
  });

  it("limite de hoje: amarelo, volta sozinho amanhã (colocar créditos não é a única saída)", () => {
    const stopped = aiAlertText({ level: "stopped", fallback: null, inherited_from: null, vendors: [g("2026-11-02T00:00:00Z", "daily_limit")] });
    expect(stopped).toMatchObject({ tone: "warning", title: "Sua IA chegou ao limite de uso de hoje", testVendors: ["gemini"] });
    expect(stopped.body).toBe(
      `Desde 01/11 às 21:00, o Gemini (Google) chegou ao limite de uso de hoje. Volta sozinho amanhã, ou antes se você colocar créditos. Enquanto isso, nada novo é criado: ${LIST}. O que já estava pronto e agendado continua sendo publicado.`,
    );
    // Um sem saldo e outro no limite de hoje: vermelho, cada um com o seu motivo.
    const mixed = aiAlertText({ level: "stopped", fallback: null, inherited_from: null, vendors: [o("2026-10-28T15:00:00Z"), g("2026-11-02T00:00:00Z", "daily_limit")] });
    expect(mixed).toMatchObject({ tone: "danger", title: "Sua IA está sem créditos" });
    expect(mixed.body).toMatch(/^Desde 01\/11 às 21:00, o ChatGPT \(OpenAI\) recusou os pedidos por falta de saldo e o Gemini \(Google\) chegou ao limite de uso de hoje\. Enquanto isso/);
    const partial = aiAlertText({ level: "partial", fallback: "openai", inherited_from: null, vendors: [g("2026-11-02T00:00:00Z", "daily_limit")] });
    expect(partial).toMatchObject({ tone: "warning", title: "Uma das IAs chegou ao limite de uso de hoje" });
    expect(partial.body).toBe("O Gemini (Google) chegou ao limite de uso de hoje (volta sozinho amanhã). Por enquanto a IA está usando o ChatGPT (OpenAI).");
  });
});

describe("instagramAlertText", () => {
  it("singular e plural; último motivo curto", () => {
    expect(instagramAlertText({ failed_count: 1, last_error: "A Meta respondeu com erro: mídia inválida. Detalhe técnico longo.", last_at: "2026-11-03T12:00:00Z", permission: false })).toEqual({
      title: "1 post do Instagram não foi publicado nos últimos 7 dias.",
      reason: "Último motivo: A Meta respondeu com erro: mídia inválida.",
      permission: null,
    });
    expect(instagramAlertText({ failed_count: 3, last_error: null, last_at: "2026-11-03T12:00:00Z", permission: false }).title).toBe("3 posts do Instagram não foram publicados nos últimos 7 dias.");
  });

  it("permissão da Meta: explica o que fazer e não repete a frase técnica", () => {
    const perm = "Permissão insuficiente na Meta. Confira se o usuário do sistema tem acesso à conta de anúncios/página e as permissões necessárias. ((#10) Application does not have permission for this action)";
    const t = instagramAlertText({ failed_count: 2, last_error: perm, last_at: "2026-11-03T12:00:00Z", permission: true });
    expect(t.reason).toBeNull();
    expect(t.permission).toBe(META_PERMISSION_HELP);
    // Último erro diferente, permissão num post anterior: mostra os dois.
    expect(instagramAlertText({ failed_count: 2, last_error: "Limite de chamadas da Meta atingido. Aguarde.", last_at: "x", permission: true })).toMatchObject({
      reason: "Último motivo: Limite de chamadas da Meta atingido.",
      permission: META_PERMISSION_HELP,
    });
  });
});

describe("auxiliares", () => {
  it("joinPt, shortReason e a lista do que para", () => {
    expect(joinPt(["a"])).toBe("a");
    expect(joinPt(["a", "b", "c"])).toBe("a, b e c");
    expect(shortReason("x".repeat(300))).toHaveLength(158);
    expect(shortReason("  ")).toBeNull();
    expect(aiStopsList()).toBe(LIST);
  });
});

import { hourSp, PUBLISH_BACK, publishingAlertText, showInstagramFailAlert, sinceSp, stillBlockedText, waitingText, whenSp, type PublishingAlert } from "./health-alerts";

describe("publicação parada (UI 24/11 §1.4)", () => {
  const NOW = new Date("2026-11-20T15:00:00Z"); // 20/11 12h em Brasília
  const base: PublishingAlert = {
    reason: "permission", since: "2026-11-20T11:30:00Z", last_at: "2026-11-20T11:30:00Z", message: "(#10)", next_check_at: "2026-11-20T12:30:00Z",
    waiting: { posts: 3, vacancies: 7 }, username: "freelaapp",
  };

  it("horas e dias em Brasília", () => {
    expect(hourSp("2026-11-20T11:30:00Z")).toBe("8h30");
    expect(hourSp("2026-11-20T11:00:00Z")).toBe("8h");
    expect(sinceSp("2026-11-20T11:30:00Z", NOW)).toBe("Desde as 8h30");
    expect(sinceSp("2026-11-19T11:30:00Z", NOW)).toBe("Desde 19/11 às 8h30");
    expect(whenSp("2026-11-20T18:30:00Z", NOW)).toBe("hoje às 15h30");
    expect(whenSp("2026-11-21T11:30:00Z", NOW)).toBe("amanhã às 8h30");
    expect(whenSp("2026-11-26T11:30:00Z", NOW)).toBe("26/11 às 8h30");
    // 21/11 01h30 UTC = 20/11 22h30 em Brasília (ainda hoje)
    expect(whenSp("2026-11-21T01:30:00Z", NOW)).toBe("hoje às 22h30");
  });

  it("o que espera: singular, plural e zero", () => {
    expect(waitingText({ posts: 0, vacancies: 0 })).toBe("Nada está esperando agora.");
    expect(waitingText({ posts: 1, vacancies: 0 })).toBe("1 post espera aqui; o que perder o prazo é cancelado com o motivo.");
    expect(waitingText({ posts: 3, vacancies: 0 })).toBe("3 posts esperam aqui; o que perder o prazo é cancelado com o motivo.");
    expect(waitingText({ posts: 0, vacancies: 1 })).toBe("1 vaga espera aqui; o que perder o prazo é cancelado com o motivo.");
    expect(waitingText({ posts: 1, vacancies: 7 })).toBe("1 post e 7 vagas esperam aqui; o que perder o prazo é cancelado com o motivo.");
  });

  it("permissão: corpo, conferência automática e passo 5 (o botão testa de verdade)", () => {
    const t = publishingAlertText(base, NOW);
    expect(t.mode).toBe("permission");
    expect(t.title).toBe("O Instagram parou de aceitar as publicações");
    expect(t.body).toBe(
      "Desde as 8h30, a Meta recusa tudo o que o Meu Funil tenta publicar no @freelaapp, por falta de permissão. 3 posts e 7 vagas esperam aqui; o que perder o prazo é cancelado com o motivo. Nenhuma arte nova de vaga é criada até voltar.",
    );
    expect(t.nextCheck).toBe("Também conferimos sozinhos. Próxima conferência: nos próximos minutos.");
    expect(publishingAlertText({ ...base, next_check_at: "2026-11-20T15:30:00Z" }, NOW).nextCheck).toBe("Também conferimos sozinhos. Próxima conferência: hoje às 12h30.");
    expect(publishingAlertText({ ...base, next_check_at: null }, NOW).nextCheck).toBeNull();
    expect(t.steps).toHaveLength(5);
    expect(t.steps[1]).toBe("Escolha o usuário do sistema do Meu Funil → Atribuir ativos → Contas do Instagram → @freelaapp. Ligue Controle total e salve.");
    expect(t.steps[4]).toBe("Volte aqui e toque em Já corrigi — testar agora.");
  });

  it("token: corpo próprio, sem conferência; sem username = 'Instagram desta empresa'", () => {
    const t = publishingAlertText({ ...base, reason: "token", since: "2026-11-19T11:30:00Z", username: null, waiting: { posts: 1, vacancies: 0 } }, NOW);
    expect(t.mode).toBe("token");
    expect(t.body).toBe(
      "Desde 19/11 às 8h30, o acesso do Meu Funil ao Instagram desta empresa venceu ou foi trocado. Reconecte o Instagram para voltar a publicar. 1 post espera aqui; o que perder o prazo é cancelado com o motivo.",
    );
    expect(t.nextCheck).toBeNull();
  });

  it("ainda bloqueado: hora do teste, o motivo da API, quando testar de novo e a próxima conferência automática", () => {
    const denied = "A Meta ainda recusa as publicações desta empresa. Confira os passos 2 e 3.";
    expect(stillBlockedText(new Date("2026-11-20T12:12:30Z"), denied, "2026-11-20T15:12:30Z")).toBe(
      "Testado às 9h12. A Meta ainda recusa as publicações desta empresa. Confira os passos 2 e 3. Teste de novo a partir das 9h13. Próxima conferência automática: hoje às 12h12.",
    );
    expect(stillBlockedText(new Date("2026-11-20T12:12:30Z"), "Não conseguimos falar com a Meta agora.", null)).toBe(
      "Testado às 9h12. Não conseguimos falar com a Meta agora. Teste de novo a partir das 9h13.",
    );
  });

  it("voltou: a permissão voltou e as publicações voltaram", () => {
    expect(PUBLISH_BACK.title).toBe("A permissão de publicar voltou");
    expect(PUBLISH_BACK.body.startsWith("As publicações voltaram.")).toBe(true);
  });

  it("R10: a faixa amarela some quando é o mesmo fato (permissão); com outro motivo, aparece", () => {
    const ig = { failed_count: 2, last_error: "x", last_at: "2026-11-20T11:30:00Z", permission: true };
    expect(showInstagramFailAlert({ ai: null, instagram: ig, publishing: base })).toBe(false);
    expect(showInstagramFailAlert({ ai: null, instagram: { ...ig, permission: false }, publishing: base })).toBe(true);
    expect(showInstagramFailAlert({ ai: null, instagram: ig, publishing: null })).toBe(true);
    expect(showInstagramFailAlert({ ai: null, instagram: null, publishing: base })).toBe(false);
  });

  it("faixa da IA com a publicação parada não promete publicar", () => {
    const t = aiAlertText({ level: "stopped", fallback: null, inherited_from: null, vendors: [o("2026-11-02T00:00:00Z")] }, { publishingBlocked: true });
    expect(t.body.endsWith("A publicação também está parada: veja o aviso acima.")).toBe(true);
    expect(t.body).not.toMatch(/continua sendo publicado/);
  });
});
