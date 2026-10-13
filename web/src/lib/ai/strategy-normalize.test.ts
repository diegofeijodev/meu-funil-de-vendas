import { describe, expect, it } from "vitest";
import { asList, joinList, normalizeCopy, normalizeStrategy, toList } from "./strategy-normalize";

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
    expect(s.publicos_meta![0]).toMatchObject({ nome: "Frio", interesses: [], descricao: "" });
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
    const s = normalizeStrategy({ distribuicao_verba: [{ destino: "Meta", percentual: 70 }], kpis: [{ nome: "CPL", meta: "R$ 10" }] })!;
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
});
