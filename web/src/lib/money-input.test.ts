import { describe, expect, it } from "vitest";
import { parseMoneyInput } from "@/lib/money-input";

describe("parseMoneyInput (valor em reais digitado)", () => {
  it("lê vírgula como decimal e ponto como milhar", () => {
    expect(parseMoneyInput("30")).toBe(30);
    expect(parseMoneyInput("35,50")).toBe(35.5);
    expect(parseMoneyInput("1.500")).toBe(1500);
    expect(parseMoneyInput("1.500,00")).toBe(1500);
    expect(parseMoneyInput("R$ 2.000,5")).toBe(2000.5);
    expect(parseMoneyInput("29.90")).toBe(29.9);
  });
  it("vazio ou texto vira NaN", () => {
    expect(parseMoneyInput("")).toBeNaN();
    expect(parseMoneyInput("trinta")).toBeNaN();
  });
});
