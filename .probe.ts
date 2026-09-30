import { graph, metaConfig } from "@/lib/meta/graph.server";
const c = await metaConfig();
console.log(await graph(`/${c.adAccountId}`, {params:{fields:"name,account_status,currency,timezone_name"}}));
console.log(JSON.stringify(await graph(`/${c.adAccountId}/adspixels`, {params:{fields:"id,name,last_fired_time"}})));
console.log(JSON.stringify(await graph(`/search`, {params:{type:"adgeolocation", q:"Valinhos", location_types:JSON.stringify(["city"]), country_code:"BR"}})).slice(0,600));
