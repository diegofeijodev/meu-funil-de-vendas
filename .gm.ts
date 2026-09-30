import { viaGemini } from "@/lib/copy-ai.server";
import { getWorkspaceAiKey } from "@/lib/ai-keys.server";
const k = await getWorkspaceAiKey("ab67e8e1-e147-48c9-bb68-a622d5f9c9fe","gemini");
console.log(JSON.stringify(await viaGemini(k!, 'Responda JSON {"ok":true,"frase":"..."} com uma frase curta sobre chopp.')).slice(0,200));
