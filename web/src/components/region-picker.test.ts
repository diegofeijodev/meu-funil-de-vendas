import { describe, expect, it } from "vitest";
import { isFreeRegion, regionSentence, splitCityUf } from "@/components/region-picker";

describe("região (seletor)", () => {
  it("separa cidade e UF nos jeitos comuns de escrever", () => {
    expect(splitCityUf("Jundiaí, SP")).toEqual({ name: "Jundiaí", uf: "SP" });
    expect(splitCityUf("Jundiaí - sp")).toEqual({ name: "Jundiaí", uf: "SP" });
    expect(splitCityUf("Jundiaí SP")).toEqual({ name: "Jundiaí", uf: "SP" });
    expect(splitCityUf("São José dos Campos")).toEqual({ name: "São José dos Campos", uf: null });
  });
  it("frase da região", () => {
    expect(regionSentence({ type: "city", name: "Jundiaí", uf: "SP", meta_key: null, radius_km: 20 })).toBe("Jundiaí e cidades em volta, até 20 km do centro.");
    expect(regionSentence({ type: "city", name: "Jundiaí", uf: "SP", meta_key: null, radius_km: null })).toBe("Só Jundiaí.");
  });
});

describe("região que não cabe numa cidade só (revisão da Fatia 2)", () => {
  it("país inteiro ou várias cidades ficam como texto (conferidas na Meta ao publicar)", () => {
    expect(isFreeRegion("Brasil todo")).toBe(true);
    expect(isFreeRegion("Brasil inteiro")).toBe(true);
    expect(isFreeRegion("Jundiaí e Campinas, SP")).toBe(true);
    expect(isFreeRegion("Jundiaí; Itupeva")).toBe(true);
    expect(isFreeRegion("Jundiaí, SP")).toBe(false);
    expect(isFreeRegion("São José dos Campos - SP")).toBe(false);
    expect(isFreeRegion("")).toBe(false);
  });
});
