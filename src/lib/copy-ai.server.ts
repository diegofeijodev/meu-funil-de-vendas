/**
 * Geração de copy com IA real. Ordem: chave própria OpenAI → chave própria Gemini → créditos do app.
 */
import { getWorkspaceAiKey, vendorError } from "./ai-keys.server";

export type CopyEngine = "auto" | "chatgpt" | "gemini";

const FIELDS = [
  "headline", "texto_curto", "texto_longo", "cta", "meta_ad", "instagram_feed",
  "reels", "stories", "script_ugc", "script_institucional",
] as const;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [...FIELDS, "headline_variacoes", "carrossel", "quiz"],
  properties: {
    ...Object.fromEntries(FIELDS.map((f) => [f, { type: "string" }])),
    headline_variacoes: { type: "array", items: { type: "string" } },
    carrossel: { type: "array", items: { type: "string" } },
    quiz: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["pergunta", "opcoes"],
        properties: { pergunta: { type: "string" }, opcoes: { type: "array", items: { type: "string" } } },
      },
    },
  },
};

function prompt(brand: unknown, brief: unknown, seed: number) {
  return [
    "Você é um copywriter sênior de performance no Brasil. Escreva em português do Brasil.",
    "Respeite o tom de voz, use as palavras preferidas e NUNCA use as palavras proibidas da marca.",
    "Devolva SOMENTE um JSON com: headline, headline_variacoes (5), texto_curto, texto_longo, cta, meta_ad,",
    "instagram_feed, reels (roteiro com tempos), stories (4 stories), script_ugc, script_institucional,",
    "carrossel (7 slides), quiz (3 perguntas com 3-4 opções).",
    `Versão ${seed + 1}: traga ângulos diferentes das versões anteriores.`,
    `MARCA: ${JSON.stringify(brand)}`,
    `CAMPANHA: ${JSON.stringify(brief)}`,
  ].join("\n");
}

function parse(text: string) {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("A IA não devolveu a copy no formato esperado.");
  return JSON.parse(m[0]);
}

export async function viaOpenAI(key: string, p: string) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: p }],
    }),
  });
  if (!res.ok) throw await vendorError("openai", res);
  const j = (await res.json()) as any;
  return parse(j.choices?.[0]?.message?.content ?? "");
}

export async function viaGemini(key: string, p: string) {
  const res = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent",
    {
      method: "POST",
      headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: p }] }],
        generationConfig: { responseMimeType: "application/json" },
      }),
    },
  );
  if (!res.ok) throw await vendorError("gemini", res);
  const j = (await res.json()) as any;
  return parse((j.candidates?.[0]?.content?.parts ?? []).map((x: any) => x.text ?? "").join(""));
}

/** Créditos do app (Lovable AI) via Responses em streaming. */
export async function viaGateway(p: string, schema: Record<string, unknown> = SCHEMA, name = "copy") {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) throw new Error("IA do app não configurada.");
  const res = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "X-Lovable-AIG-SDK": "fetch" },
    body: JSON.stringify({
      model: "openai/gpt-6-astra",
      input: p,
      stream: true,
      store: false,
      reasoning: { effort: "low" },
      text: { format: { type: "json_schema", name, strict: true, schema } },
    }),
  });
  if (res.status === 402) throw new Error("Créditos de IA esgotados. Conecte sua própria chave em Integrações.");
  if (res.status === 429) throw new Error("Muitas solicitações agora. Tente em instantes.");
  if (!res.ok || !res.body) throw new Error(`IA respondeu ${res.status}.`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let out = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const l of lines) {
      if (!l.startsWith("data:")) continue;
      const d = l.slice(5).trim();
      if (!d || d === "[DONE]") continue;
      try {
        const ev = JSON.parse(d);
        if (ev.type === "response.output_text.delta") out += ev.delta ?? "";
        if (ev.type === "response.failed" || ev.type === "error") throw new Error("A IA não conseguiu gerar a copy.");
      } catch (e) {
        if (e instanceof Error && e.message.startsWith("A IA")) throw e;
      }
    }
  }
  return parse(out);
}

export async function generateCopyAI(
  workspaceId: string,
  engine: CopyEngine,
  brand: unknown,
  brief: unknown,
  seed: number,
): Promise<{ content: any; engine: string }> {
  const p = prompt(brand, brief, seed);
  const [o, g] = await Promise.all([getWorkspaceAiKey(workspaceId, "openai"), getWorkspaceAiKey(workspaceId, "gemini")]);
  const fails: string[] = [];
  if ((engine === "chatgpt" || engine === "auto") && o) {
    try { return { content: await viaOpenAI(o, p), engine: "Sua conta OpenAI" }; }
    catch (e) { fails.push(`OpenAI: ${e instanceof Error ? e.message : "falhou"}`); }
  }
  if ((engine === "gemini" || engine === "auto") && g) {
    try { return { content: await viaGemini(g, p), engine: "Sua conta Gemini" }; }
    catch (e) { fails.push(`Gemini: ${e instanceof Error ? e.message : "falhou"}`); }
  }
  if (fails.length) console.warn("[copy] chaves próprias falharam:", fails.join(" | "));
  return { content: await viaGateway(p), engine: fails.length ? "IA do app (sua chave falhou)" : "IA do app" };
}
