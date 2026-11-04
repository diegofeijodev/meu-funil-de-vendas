import { describe, expect, it } from "vitest";
import { aiAlertText, aiStopsList, dayTimeSp, daySp, instagramAlertText, joinPt, META_PERMISSION_HELP, shortReason } from "./health-alerts";

const o = (since: string) => ({ vendor: "openai" as const, label: "ChatGPT (OpenAI)", since, last_at: since });
const g = (since: string) => ({ vendor: "gemini" as const, label: "Gemini (Google)", since, last_at: since });
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
    const app = aiAlertText({ level: "partial", fallback: "app", inherited_from: null, vendors: [o("2026-10-28T15:00:00Z"), g("2026-10-30T15:00:00Z")] });
    expect(app.body).toBe("As contas do ChatGPT (OpenAI) e do Gemini (Google) estão sem créditos desde 28/10. Por enquanto a IA está usando os créditos do app.");
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
