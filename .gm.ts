import { getWorkspaceAiKey } from "@/lib/ai-keys.server";
const k = await getWorkspaceAiKey("ab67e8e1-e147-48c9-bb68-a622d5f9c9fe","gemini");
const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200",{headers:{"x-goog-api-key":k!}});
const j:any = await r.json(); console.log(r.status, (j.models??[]).map((m:any)=>m.name.replace("models/","")).filter((n:string)=>/flash|image|veo/.test(n)).join(" "));
