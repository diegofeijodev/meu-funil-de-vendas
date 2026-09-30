import { createClient } from "@supabase/supabase-js";
import { regenerateCaption } from "@/lib/instagram/instagram.server";
const s:any = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const WS="ab67e8e1-e147-48c9-bb68-a622d5f9c9fe";
for (const id of ["e8210ec7-44d7-4c2d-b33c-65d543169f75","eedaa2f6-88c7-4e06-a41c-3fd24647b0b5"]) {
  const r = await regenerateCaption(WS, id, "Post de hoje para o Chopp e Espeto Valinhos, restaurante na praça de alimentação do shopping. Tom animado, convidativo.", "auto");
  console.log(JSON.stringify(r).slice(0,150));
}
const { data: out } = await s.from("ig_posts").select("format, caption, hashtags, cta, status").in("id", ["e8210ec7-44d7-4c2d-b33c-65d543169f75","eedaa2f6-88c7-4e06-a41c-3fd24647b0b5"]);
console.log(JSON.stringify(out, null, 1).slice(0,3000));
