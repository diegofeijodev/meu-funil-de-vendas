export const brl = (value: number | null | undefined) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 2,
  }).format(Number(value ?? 0));

export const num = (value: number | null | undefined, digits = 0) =>
  new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number(value ?? 0));

export const pct = (value: number | null | undefined, digits = 1) =>
  `${num(value, digits)}%`;

export const shortDate = (value: string | Date | null | undefined) => {
  if (!value) return "—";
  // "YYYY-MM-DD" (colunas `date`) é UTC meia-noite para o JS: em Brasília cairia no dia anterior. Data pura = data local.
  const dateOnly = typeof value === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
  const d = dateOnly ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3])) : typeof value === "string" ? new Date(value) : value;
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
};

export const fullDate = (value: string | Date | null | undefined) => {
  if (!value) return "—";
  // "YYYY-MM-DD" (colunas `date`) é meia-noite UTC para o JS: em Brasília cairia no dia anterior. Data pura = data local.
  const dateOnly = typeof value === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
  const d = dateOnly ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3])) : typeof value === "string" ? new Date(value) : value;
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
};

export const safeDiv = (a: number, b: number) => (b === 0 ? 0 : a / b);
