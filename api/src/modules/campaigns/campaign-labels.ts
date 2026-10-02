/** Rótulos do protótipo (`lib/labels.ts`, `lib/format.ts`) que o servidor também usa em textos gerados. */
export const OBJECTIVES: Record<string, string> = {
  awareness: 'Reconhecimento',
  engagement: 'Engajamento',
  traffic: 'Tráfego',
  leads: 'Leads',
  whatsapp: 'WhatsApp',
  sales: 'Vendas / Conversão',
  remarketing: 'Remarketing',
};

/** `brl` de `lib/format.ts` (pt-BR, R$, até 2 casas). */
export const brl = (value: number | null | undefined): string =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 }).format(Number(value ?? 0));
