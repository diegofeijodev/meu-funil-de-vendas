/**
 * IA de texto e visão da direção de arte (somente servidor).
 * Texto: chave própria OpenAI → chave própria Gemini → IA do app.
 * Visão: chave própria Gemini → IA do app (modelo padrão com imagens).
 */
import { getWorkspaceAiKey, vendorError } from "@/lib/ai-keys.server";
import { viaGemini, viaOpenAI } from "@/lib/copy-ai.server";

export type Img = { bytes: Uint8Array; mime: string };

const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64");

function parse(text: string) {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("A IA não devolveu o formato esperado.");
  return JSON.parse(m[0]);
}

/** Responses em streaming na IA do app; aceita texto e imagens. */
async function gateway(content: unknown[], schema: Record<string, unknown>, name: string) {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) throw new Error("IA do app não configurada.");
  const res = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "X-Lovable-AIG-SDK": "fetch",
    },
    body: JSON.stringify({
      model: "openai/gpt-6-astra",
      input: [{ role: "user", content }],
      stream: true,
      store: false,
      reasoning: { effort: "low" },
      text: { format: { type: "json_schema", name, strict: true, schema } },
    }),
  });
  if (res.status === 402) throw new Error("Créditos de IA esgotados.");
  if (res.status === 429) throw new Error("Muitas solicitações agora. Tente em instantes.");
  if (!res.ok || !res.body) {
    const t = await res.text().catch(() => "");
    throw new Error(`IA respondeu ${res.status}: ${t.slice(0, 200)}`);
  }
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
      let ev: any;
      try {
        ev = JSON.parse(d);
      } catch {
        continue;
      }
      if (ev.type === "response.output_text.delta") out += ev.delta ?? "";
      if (ev.type === "response.failed" || ev.type === "error")
        throw new Error("A IA não conseguiu responder.");
    }
  }
  return parse(out);
}

export async function jsonLLM(
  workspaceId: string,
  prompt: string,
  schema: Record<string, unknown>,
  name: string,
) {
  const [o, g] = await Promise.all([
    getWorkspaceAiKey(workspaceId, "openai"),
    getWorkspaceAiKey(workspaceId, "gemini"),
  ]);
  const full = `${prompt}\nDevolva SOMENTE JSON com estas chaves: ${JSON.stringify(schema["properties"] ? Object.keys(schema["properties"] as object) : [])}.`;
  if (o) {
    try {
      return await viaOpenAI(o, full);
    } catch (e) {
      console.warn("[art] chave OpenAI falhou:", e instanceof Error ? e.message : e);
    }
  }
  if (g) {
    try {
      return await viaGemini(g, full);
    } catch (e) {
      console.warn("[art] chave Gemini falhou:", e instanceof Error ? e.message : e);
    }
  }
  return gateway([{ type: "input_text", text: prompt }], schema, name);
}

export async function visionJSON(
  workspaceId: string,
  prompt: string,
  images: Img[],
  schema: Record<string, unknown>,
  name: string,
) {
  const g = await getWorkspaceAiKey(workspaceId, "gemini");
  if (g) {
    try {
      const res = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent",
        {
          method: "POST",
          headers: { "x-goog-api-key": g, "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  ...images.map((i) => ({ inlineData: { mimeType: i.mime, data: b64(i.bytes) } })),
                  { text: `${prompt}\nDevolva SOMENTE JSON.` },
                ],
              },
            ],
            generationConfig: { responseMimeType: "application/json", responseSchema: undefined },
          }),
        },
      );
      if (!res.ok) throw await vendorError("gemini", res);
      const j = (await res.json()) as any;
      return parse((j.candidates?.[0]?.content?.parts ?? []).map((x: any) => x.text ?? "").join(""));
    } catch (e) {
      console.warn("[vision] chave Gemini falhou:", e instanceof Error ? e.message : e);
    }
  }
  return gateway(
    [
      ...images.map((i) => ({
        type: "input_image",
        image_url: `data:${i.mime};base64,${b64(i.bytes)}`,
      })),
      { type: "input_text", text: prompt },
    ],
    schema,
    name,
  );
}
