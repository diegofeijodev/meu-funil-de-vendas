import { publishInstagramPost } from "@/lib/instagram/instagram.server";
for (const id of process.argv.slice(2)) {
  const t=Date.now();
  try { console.log(id, JSON.stringify(await publishInstagramPost(id)), Math.round((Date.now()-t)/1000)+"s"); }
  catch (e:any) { console.log(id, "ERRO", e?.constructor?.name, e?.code, e?.message); }
}
