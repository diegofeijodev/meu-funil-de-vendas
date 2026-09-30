import { createClient } from "@supabase/supabase-js";
import { callTool } from "@/lib/mcp.server";
const s = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const { data } = await s.from("mcp_connections").select("server_url,access_token").eq("provider","higgsfield").single();
const r = await callTool(data!.server_url, data!.access_token, "job_status", {jobId:"d5e851bd-17f7-4b63-8324-309eda6a8c48", sync:true});
console.log(r.text.slice(0,200)); console.log(r.mediaUrl, String(r.structured).match(/https:[^"]+/g));
