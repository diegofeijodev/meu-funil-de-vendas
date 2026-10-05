/** Normalização defensiva dos campos que a IA devolve (às vezes string em vez de lista e vice-versa). */

export function normalizeHashtags(value: unknown, max = 15): string[] {
  const raw: unknown[] = Array.isArray(value)
    ? value.flatMap((v) => (typeof v === "string" ? v.split(/[\s,#]+/) : [v]))
    : typeof value === "string"
      ? value.split(/[\s,#]+/)
      : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of raw) {
    if (v == null || typeof v === "object") continue;
    const tag = String(v).replace(/[^\p{Script=Latin}\p{N}_]/gu, "").trim();
    if (!tag || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    out.push(tag);
    if (out.length >= max) break;
  }
  return out;
}

/** Texto: junta listas, converte números; null para vazio. */
export function asText(value: unknown): string | null {
  if (value == null) return null;
  if (Array.isArray(value)) return value.map((v) => asText(v)).filter(Boolean).join("\n") || null;
  if (typeof value === "object") return null;
  const s = String(value).trim();
  return s || null;
}

/** Lista: aceita array ou string separada por quebra de linha / ";". */
export function asList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") return value.split(/\n|;/).map((s) => s.trim()).filter(Boolean);
  return [];
}
