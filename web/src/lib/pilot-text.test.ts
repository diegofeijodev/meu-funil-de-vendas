import { describe, expect, it } from "vitest";
import { blockerView, creditsLine, pilotListLine, raiseCapTo, stepStatusText } from "./pilot-text";

describe("stepStatusText (tabela C do doc de UI)", () => {
  it("cada status vira o texto do doc", () => {
    expect(stepStatusText({ status: "pending" })).toBe("○ Na fila");
    expect(stepStatusText({ status: "running" })).toBe("◐ Fazendo agora");
    expect(stepStatusText({ status: "waiting" })).toBe("◐ Gerando o vídeo, leva alguns minutos");
    expect(stepStatusText({ status: "done", note: "7 de 7 prontas" })).toBe("✓ Pronto · 7 de 7 prontas");
    expect(stepStatusText({ status: "skipped", note: "Instagram desligado no pacote." })).toBe("– Pulado: Instagram desligado no pacote.");
    expect(stepStatusText({ status: "blocked" })).toBe("! Esperando você");
    expect(stepStatusText({ status: "failed" })).toBe("✕ Não deu certo");
  });
});

describe("blockerView", () => {
  const ctx = { canEdit: true, maxCredits: 48, done: 5, total: 7 };
  it("COST_CAP: aumentar o teto ou seguir com as prontas; nada de tentar de novo", () => {
    const v = blockerView("COST_CAP", "Chegamos ao teto de 48 créditos com 5 de 7 artes prontas.", ctx);
    expect(v.actions.map((a) => a.label)).toEqual(["Aumentar o teto para 60", "Seguir com as 5 artes"]);
    expect(v.actions.map((a) => a.kind)).toEqual(["raise_cap", "proceed_partial"]);
    expect(v.message).toBe("Chegamos ao teto de 48 créditos com 5 de 7 artes prontas.");
  });
  it("IA sem configurar ou sem créditos: integrações + já resolvi", () => {
    for (const code of ["AI_NOT_CONFIGURED", "AI_NO_CREDITS"]) {
      expect(blockerView(code, "x", ctx).actions.map((a) => a.label)).toEqual(["Abrir integrações", "Já resolvi: continuar"]);
    }
  });
  it("falha comum e nenhuma arte pronta: tentar de novo; temas do Instagram: só aviso", () => {
    expect(blockerView("STEP_FAILED", "Meta fora do ar", ctx).actions.map((a) => a.kind)).toEqual(["retry"]);
    expect(blockerView("NO_CREATIVE_MADE", "Nenhuma arte ficou pronta.", ctx).actions[0]!.label).toBe("Fazer mais uma rodada");
    expect(blockerView("NO_IG_PLAN", "O plano veio sem os temas…", ctx).actions).toEqual([]);
  });
  it("quem só vê não recebe ações", () => {
    expect(blockerView("COST_CAP", "x", { ...ctx, canEdit: false }).actions).toEqual([]);
  });
  it("teto sobe o custo de um vídeo (12)", () => {
    expect(raiseCapTo(48)).toBe(60);
    expect(raiseCapTo(495)).toBe(500);
  });
});

describe("creditsLine", () => {
  it("diz a conta e de onde veio", () => {
    expect(creditsLine(39, 48, 7)).toBe("Créditos: 39 de até 48 usados (soma do custo das 7 peças já feitas)");
    expect(creditsLine(4.5, 48, 1)).toBe("Créditos: 4,5 de até 48 usados (soma do custo da 1 peça já feita)");
  });
});

describe("pilotListLine (cartão da lista)", () => {
  it("uma linha por estado; sem piloto = nada", () => {
    expect(pilotListLine(null)).toBeNull();
    expect(pilotListLine(undefined)).toBeNull();
    expect(pilotListLine({ status: "planning", current_step: "strategy", first_block_code: null, counts: { done: 0, total: 0 } })).toBe("◐ Montando o plano");
    expect(pilotListLine({ status: "running", current_step: "creatives", first_block_code: null, counts: { done: 4, total: 7 } })).toBe("◐ Fazendo artes (4 de 7)");
    expect(pilotListLine({ status: "running", current_step: "copies", first_block_code: null, counts: { done: 0, total: 0 } })).toBe("◐ Fazendo os textos do anúncio");
    expect(pilotListLine({ status: "blocked", current_step: "creatives", first_block_code: "COST_CAP", counts: { done: 5, total: 7 } })).toBe("! Precisa de você");
    expect(pilotListLine({ status: "done", current_step: "meta", first_block_code: null, counts: { done: 7, total: 7 } })).toBe("✓ Tudo pronto");
    expect(pilotListLine({ status: "cancelled", current_step: "copies", first_block_code: null, counts: { done: 0, total: 0 } })).toBe("– Estrategista parado");
  });
});
