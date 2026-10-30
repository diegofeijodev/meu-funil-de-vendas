import { describe, expect, it } from "vitest";
import { regionSentence, splitCityUf } from "@/components/region-picker";

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
