import { describe, expect, it } from "vitest";
import { blockerView, creditsLine, pilotListLine, raiseCapTo, stepStatus } from "./pilot-text";

describe("stepStatus (ícone separado do texto: o leitor de tela não lê o ícone)", () => {
  it("cada status vira o texto do doc", () => {
    expect(stepStatus({ status: "pending", attempts: 0 })).toEqual({ icon: "○", text: "Na fila" });
    expect(stepStatus({ status: "running", attempts: 0 })).toEqual({ icon: "◐", text: "Fazendo agora" });
    expect(stepStatus({ status: "waiting", attempts: 0 })).toEqual({ icon: "◐", text: "Gerando o vídeo, leva alguns minutos" });
    expect(stepStatus({ status: "done", attempts: 0, note: "7 de 7 prontas" })).toEqual({ icon: "✓", text: "Pronto · 7 de 7 prontas" });
    expect(stepStatus({ status: "skipped", attempts: 0, note: "Instagram desligado no pacote." })).toEqual({ icon: "–", text: "Pulado: Instagram desligado no pacote." });
    expect(stepStatus({ status: "blocked", attempts: 0 })).toEqual({ icon: "!", text: "Esperando você" });
    expect(stepStatus({ status: "failed", attempts: 0 })).toEqual({ icon: "✕", text: "Não deu certo" });
  });
  it("nova tentativa aparece (tentativa n de 4)", () => {
    expect(stepStatus({ status: "pending", attempts: 1 })).toEqual({ icon: "○", text: "Não deu certo; tentando de novo em alguns minutos (tentativa 2 de 4)" });
  });
  it("Instagram não programado não é 'esperando você'", () => {
    expect(stepStatus({ status: "blocked", attempts: 0, error_code: "NO_IG_PLAN", error: "O plano veio sem os temas do Instagram." })).toEqual({ icon: "–", text: "Não programado: O plano veio sem os temas do Instagram." });
  });
  it("estrategista parado: o que não terminou não parece andando", () => {
    expect(stepStatus({ status: "running", attempts: 0 }, { cancelled: true })).toEqual({ icon: "–", text: "Não feito (estrategista parado)" });
    expect(stepStatus({ status: "done", attempts: 0 }, { cancelled: true }).icon).toBe("✓");
  });
});

describe("blockerView", () => {
  const ctx = { canEdit: true, step: "creatives" as const, spent: 39, remaining: 18, done: 5 };
  it("COST_CAP: aumentar o teto com a conta do que falta, ou seguir com as prontas; nada de tentar de novo", () => {
    const v = blockerView("COST_CAP", "Chegamos ao teto de 48 créditos com 5 de 7 artes prontas.", ctx);
    expect(v.actions).toEqual([
      { kind: "raise_cap", label: "Aumentar o teto para 57 créditos (o que falta custa até 18)" },
      { kind: "proceed_partial", label: "Seguir com as 5 peças prontas" },
    ]);
  });
  it("IA sem configurar ou sem créditos: integrações + já resolvi", () => {
    for (const code of ["AI_NOT_CONFIGURED", "AI_NO_CREDITS"]) {
      expect(blockerView(code, "x", ctx).actions.map((a) => a.label)).toEqual(["Abrir integrações", "Já resolvi: continuar"]);
    }
  });
  it("falha comum: frase com a etapa, 4 tentativas e o motivo", () => {
    const v = blockerView("STEP_FAILED", "fetch failed", { ...ctx, step: "copies" });
    expect(v.message).toBe("Não conseguimos fazer os textos depois de 4 tentativas. Nada do que ficou pronto se perdeu. Motivo: fetch failed");
    expect(v.actions).toEqual([{ kind: "retry", label: "Tentar de novo" }]);
  });
  it("nenhuma arte pronta: diz o que fazer e quanto custa a nova rodada", () => {
    const v = blockerView("NO_CREATIVE_MADE", "Nenhuma arte ficou pronta.", { ...ctx, remaining: 0, roundCost: 9 });
    expect(v.message).toBe("Nenhuma arte ficou pronta. Faça mais uma rodada ou veja as tentativas na aba Criativos.");
    expect(v.actions).toEqual([{ kind: "retry", label: "Fazer mais uma rodada (até 9 créditos)" }]);
  });
  it("quem só vê não recebe ações", () => {
    expect(blockerView("COST_CAP", "x", { ...ctx, canEdit: false }).actions).toEqual([]);
  });
  it("teto novo = gasto + o que falta, arredondado para cima, até 500", () => {
    expect(raiseCapTo(39, 18)).toBe(57);
    expect(raiseCapTo(4.5, 6)).toBe(11);
    expect(raiseCapTo(495, 18)).toBe(500);
  });
});

describe("creditsLine", () => {
  it("diz o que é, a conta e de onde veio", () => {
    expect(creditsLine(39, 48)).toBe("Créditos usados: 39 de até 48 (teto). Soma do custo registrado de cada geração feita até agora.");
    expect(creditsLine(4.5, 48)).toBe("Créditos usados: 4,5 de até 48 (teto). Soma do custo registrado de cada geração feita até agora.");
  });
});

describe("pilotListLine (cartão da lista)", () => {
  const base = { current_step: "strategy", first_block_code: null, counts: { done: 0, total: 0 }, plan_ready: false };
  it("uma linha por estado; sem piloto = nada", () => {
    expect(pilotListLine(null)).toBeNull();
    expect(pilotListLine({ ...base, status: "planning" })).toEqual({ icon: "◐", text: "Montando o plano", tone: "work" });
    expect(pilotListLine({ ...base, status: "planning", plan_ready: true })).toEqual({ icon: "!", text: "Precisa de você: conferir e aprovar o plano", tone: "needs" });
    expect(pilotListLine({ ...base, status: "running", current_step: "creatives", counts: { done: 4, total: 7 } })).toEqual({ icon: "◐", text: "Fazendo artes (4 de 7)", tone: "work" });
    expect(pilotListLine({ ...base, status: "running", current_step: "copies" })).toEqual({ icon: "◐", text: "Fazendo os textos do anúncio", tone: "work" });
    expect(pilotListLine({ ...base, status: "blocked", current_step: "creatives", first_block_code: "COST_CAP" })).toEqual({ icon: "!", text: "Precisa de você: aumentar o teto de créditos", tone: "needs" });
    expect(pilotListLine({ ...base, status: "failed", current_step: "copies", first_block_code: "STEP_FAILED" })).toEqual({ icon: "!", text: "Precisa de você: tentar de novo", tone: "needs" });
    expect(pilotListLine({ ...base, status: "done", current_step: "meta" })).toEqual({ icon: "✓", text: "Tudo pronto", tone: "done" });
    expect(pilotListLine({ ...base, status: "cancelled", current_step: "copies" })).toEqual({ icon: "–", text: "Estrategista parado", tone: "idle" });
  });
});
