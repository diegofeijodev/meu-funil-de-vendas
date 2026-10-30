/**
 * Valor em reais digitado na tela: "30", "35,50", "1.500", "1.500,00", "R$ 2.000,5". Vírgula é decimal; ponto antes de 3 dígitos é
 * milhar ("1.500" = mil e quinhentos, não 1,5). Vazio ou texto → NaN (a tela pede de novo).
 */
export function parseMoneyInput(raw: string): number {
  const v = raw.replace(/R\$/i, "").replace(/\s/g, "");
  if (!v || !/^[\d.,]+$/.test(v)) return NaN;
  if (v.includes(",")) return Number(v.replace(/\./g, "").replace(",", "."));
  if (/^\d{1,3}(\.\d{3})+$/.test(v)) return Number(v.replace(/\./g, ""));
  return Number(v);
}
