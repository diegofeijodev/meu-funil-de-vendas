import { describe, expect, it } from "vitest";
import { aiText, asList, joinList, normalizeCopy, normalizeStrategy, toList } from "./strategy-normalize";

describe("strategy-normalize", () => {
  it("toList/joinList/asList: ausente/null → [], string → [string], não-array nunca quebra", () => {
    expect(toList(undefined)).toEqual([]);
    expect(toList(null)).toEqual([]);
    expect(toList("a")).toEqual(["a"]);
    expect(toList("  ")).toEqual([]);
    expect(joinList(undefined)).toBe("");
    expect(joinList("x")).toBe("");
    expect(joinList(["a", "b"], " · ")).toBe("a · b");
    expect(asList("x" as never)).toEqual([]);
    expect(asList(null)).toEqual([]);
  });

  it("normalizeStrategy: sem estratégia → null; listas ausentes viram arrays e nunca lança", () => {
    expect(normalizeStrategy(null)).toBeNull();
    expect(normalizeStrategy(undefined)).toBeNull();
    const s = normalizeStrategy({
      big_idea: "x",
      hipoteses: "só uma",
      recomendacoes: null,
      publicos_meta: [{ nome: "Frio" }],
      briefing_criativo: { cta: "Venha" },
      briefing_video: { roteiro: "r" },
      plano_instagram: { temas: "um tema" },
    })!;
    expect(s.hipoteses).toEqual(["só uma"]);
    expect(s.recomendacoes).toEqual([]);
    expect(s.objecoes).toEqual([]);
    expect(s.angulos).toEqual([]);
    expect(s.publicos_meta![0]).toMatchObject({ nome: "Frio", tipo: "", interesses: [], descricao: "" });
    expect(s.briefing_criativo!.formatos).toEqual([]);
    expect(s.briefing_video!.cenas).toEqual([]);
    expect(s.plano_instagram).toMatchObject({ pilares: [], temas: ["um tema"] });
    expect(s.kpis).toEqual({});
  });

  it("blocos opcionais ausentes continuam ausentes (a tela esconde)", () => {
    const s = normalizeStrategy({ big_idea: "x" })!;
    expect(s.briefing_criativo).toBeUndefined();
    expect(s.briefing_video).toBeUndefined();
    expect(s.plano_instagram).toBeUndefined();
  });

  it("normalizeStrategy aceita distribuicao_verba/kpis na forma de lista da IA", () => {
    const s = normalizeStrategy({ big_idea: "x", distribuicao_verba: [{ destino: "Meta", percentual: 70 }], kpis: [{ nome: "CPL", meta: "R$ 10" }] })!;
    expect(s.distribuicao_verba).toEqual({ Meta: 70 });
    expect(s.kpis).toEqual({ CPL: "R$ 10" });
  });

  it("normalizeCopy: sem copy → null; carrossel/variações/quiz ausentes viram listas", () => {
    expect(normalizeCopy(null)).toBeNull();
    const c = normalizeCopy({ headline: "H", quiz: [{ pergunta: "P" }, "só texto"], carrossel: "um slide" })!;
    expect(c.headline).toBe("H");
    expect(c.headline_variacoes).toEqual([]);
    expect(c.carrossel).toEqual(["um slide"]);
    expect(c.quiz).toEqual([
      { pergunta: "P", opcoes: [] },
      { pergunta: "só texto", opcoes: [] },
    ]);
  });

  it("lixo (texto não-JSON, array, sem big_idea nem ângulos) → null", () => {
    expect(normalizeStrategy("isto não é json")).toBeNull();
    expect(normalizeStrategy([1, 2])).toBeNull();
    expect(normalizeStrategy({ big_idea: " ", angulos_detalhados: [] })).toBeNull();
    expect(normalizeStrategy({ angulos_detalhados: [{ nome: "A" }] })).not.toBeNull();
  });

  it("não inventa defaults: duração/quantidade ausentes ficam undefined; válido é mantido; tipo desconhecido como veio", () => {
    const s = normalizeStrategy({
      big_idea: "x",
      briefing_video: { roteiro: "r" },
      briefing_criativo: { quantidade_por_angulo: "3" },
      publicos_meta: [{ nome: "A", tipo: "custom" }],
    })!;
    expect(s.briefing_video!.duracao_segundos).toBeUndefined();
    expect(s.briefing_criativo!.quantidade_por_angulo).toBe(3);
    expect(s.publicos_meta![0]!.tipo).toBe("custom");
  });

  it("aiText: objeto/lista viram texto legível, sem \"[object Object]\" em nenhum nível", () => {
    expect(aiText(" a ")).toBe("a");
    expect(aiText(3)).toBe("3");
    expect(aiText(["a", "b"])).toBe("a\nb");
    expect(aiText({ especifico: "200 leads", prazo_final: "30 dias" })).toBe("Específico: 200 leads\nPrazo final: 30 dias");
    expect(aiText(false)).toBe("Não");
    expect(aiText({ perfil: "P", dores: ["d1", "d2"], sub: { x: "y" } })).toBe("Perfil: P\nDores: d1, d2\nSub: X: y");
    expect(aiText("[object Object]")).toBe("");
    expect(aiText([{ a: {} }])).toBe("");
  });

  it("estratégia antiga com \"[object Object]\" vira vazio; objeto vira linhas; ângulos aceitam sinônimos", () => {
    const s = normalizeStrategy({
      big_idea: "x",
      objetivo_smart: "[object Object]",
      icp: { perfil: "Donos de bar", dores: ["pouco movimento"] },
      angulos_detalhados: [{ titulo: "Promo", hook: "Dobrou", message: "Chopp em dobro" }, { hook: "Só o gancho" }],
    })!;
    expect(s.objetivo_smart).toBe("");
    expect(s.icp).toBe("Perfil: Donos de bar\nDores: pouco movimento");
    expect(s.angulos_detalhados!.map((a) => [a.nome, a.gancho, a.mensagem])).toEqual([
      ["Promo", "Dobrou", "Chopp em dobro"],
      ["", "Só o gancho", ""],
    ]);
    expect(JSON.stringify(s)).not.toContain("[object Object]");
  });
});
