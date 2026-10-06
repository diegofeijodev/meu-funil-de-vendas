import { describe, expect, it } from "vitest";
import { awaitsHuman, effectiveLayout, periodCounts, videoBriefPatch } from "./production";

describe("produção automática — regras da tela", () => {
  it("cartão do período: produzidos / produzindo / na fila / agendados / publicados / pulados", () => {
    expect(periodCounts({ total: 7, produced: 2, producing: 1, queued: 1, scheduled: 1, published: 1, skipped: 1, waiting: 0, failed: 0, review: 0, rewriting: 0 })).toBe(
      "7 conteúdos · 2 produzidos · 1 produzindo · 1 na fila · 1 agendados · 1 publicados · 1 pulados",
    );
  });

  it("aprovações: o post em revisão do modo totalmente automático não espera ninguém (a IA reescreve)", () => {
    expect(awaitsHuman({ status: "pending_approval" })).toBe(true);
    expect(awaitsHuman({ status: "needs_review", automation: "approval" })).toBe(true);
    expect(awaitsHuman({ status: "needs_review", automation: null })).toBe(true);
    expect(awaitsHuman({ status: "needs_review", automation: "publish" })).toBe(false);
    expect(awaitsHuman({ status: "ready" })).toBe(false);
  });

  it("layout padrão da arte igual ao da API: com headline, título no topo; sem, limpo; o escolhido vale", () => {
    expect(effectiveLayout({ headline: "Chope em dobro" })).toBe("titulo_topo");
    expect(effectiveLayout({})).toBe("limpo");
    expect(effectiveLayout({ headline: "x", layout: "cta_rodape" })).toBe("cta_rodape");
    expect(effectiveLayout(null)).toBe("limpo");
  });

  it("painel de vídeo: o roteiro só vira override se mudou; áudio do post (ou volta ao padrão); limites de tamanho", () => {
    const brief = { prompt: "x", audio: { modo: "narracao", instrucoes: "a" }, video_direction: { prompt: "ROTEIRO GERADO" } };
    expect(videoBriefPatch(brief, "ROTEIRO GERADO", null)).toEqual({ prompt: "x", video_direction: { prompt: "ROTEIRO GERADO" }, visual_prompt_override: null });
    const edited = videoBriefPatch(brief, "  MEU ROTEIRO  ", { modo: "sem_audio", instrucoes: ` ${"y".repeat(600)} ` });
    expect(edited.visual_prompt_override).toBe("MEU ROTEIRO");
    expect(edited.audio).toEqual({ modo: "sem_audio", instrucoes: "y".repeat(500) });
    expect((videoBriefPatch({}, "z".repeat(4000), null).visual_prompt_override as string).length).toBe(3000);
  });
});
