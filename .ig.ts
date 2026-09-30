import { createClient } from "@supabase/supabase-js";
import { regenerateCaption } from "@/lib/instagram/instagram.server";
const s:any = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const WS="ab67e8e1-e147-48c9-bb68-a622d5f9c9fe";
const img = (await s.from("creatives").select("preview_url").eq("id","0414286d-df2d-4acd-93bb-dd597aaa07a3").single()).data.preview_url;
const vid = (await s.from("creatives").select("preview_url").eq("id","4566efd0-bf1b-4db2-9185-440ebc82e5ef").single()).data.preview_url;
const now = new Date().toISOString();
const base = { workspace_id: WS, status: "approved", approved_at: now, scheduled_at: now, theme: "Happy hour no Chopp e Espeto Valinhos – praça de alimentação do shopping", hook: "Chopp gelado + espetinho na brasa = happy hour perfeito", cta: "Vem pro Chopp e Espeto na praça de alimentação!", creative_brief: {} };
const rows = [
 { ...base, format: "feed_image", media: [{ url: img, type: "image", order: 0, width: 1024, height: 1024 }] },
 { ...base, format: "reel", media: [{ url: vid, type: "video", order: 0, width: 1080, height: 1920, duration: 10 }] },
 { ...base, format: "story_image", media: [{ url: img, type: "image", order: 0, width: 1024, height: 1024 }] },
];
const { data, error } = await s.from("ig_posts").insert(rows).select("id, format"); if (error) throw error;
console.log(JSON.stringify(data));
for (const p of data.filter((x:any)=>x.format!=="story_image")) {
  const r = await regenerateCaption(WS, p.id, "Post de hoje para o Chopp e Espeto Valinhos, restaurante na praça de alimentação do shopping. Tom animado, convidativo.", "auto");
  console.log(p.format, JSON.stringify(r).slice(0,200));
}
const { data: out } = await s.from("ig_posts").select("format, caption, hashtags, status").in("id", data.map((x:any)=>x.id));
console.log(JSON.stringify(out, null, 1).slice(0,3000));
