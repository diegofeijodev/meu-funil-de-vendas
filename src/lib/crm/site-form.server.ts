/**
 * Formulário do site (somente servidor): página embutível, script para colar no site
 * e recebimento de leads (também de ferramentas externas: Elementor, RD, Typeform…).
 * Anti-spam: campo isca, tempo mínimo de preenchimento e limite por IP.
 */
import { createHash } from "crypto";
import { addInteraction, admin, findLead, firstStage, normalizePhone, pickOwner, startCadence, type Integration } from "./integrations.server";

export type SiteFormConfig = {
  title: string;
  subtitle: string;
  button: string;
  thanks: string;
  redirect_url: string | null;
  ask_phone: boolean;
  ask_message: boolean;
  privacy_url: string | null;
  color: string;
};

export function formConfig(integration: Integration): SiteFormConfig {
  const c = (integration.config ?? {}) as Partial<SiteFormConfig>;
  return {
    title: c.title || "Fale com a gente",
    subtitle: c.subtitle || "Deixe seus dados que entramos em contato.",
    button: c.button || "Quero ser atendido",
    thanks: c.thanks || "Recebemos seus dados! Em breve entraremos em contato.",
    redirect_url: c.redirect_url || null,
    ask_phone: c.ask_phone !== false,
    ask_message: !!c.ask_message,
    privacy_url: c.privacy_url || null,
    color: /^#[0-9a-f]{6}$/i.test(c.color ?? "") ? c.color! : "#4F46E5",
  };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function renderFormHtml(token: string, cfg: SiteFormConfig) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(cfg.title)}</title>
<style>
*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:transparent;color:#111}
form{max-width:480px;margin:0 auto;padding:20px;background:#fff;border-radius:12px}
h1{font-size:20px;margin:0 0 4px}p.sub{margin:0 0 16px;color:#555;font-size:14px}
label{display:block;font-size:13px;margin:10px 0 4px;color:#333}
input,textarea{width:100%;padding:10px 12px;border:1px solid #ccc;border-radius:8px;font-size:15px}
button{margin-top:16px;width:100%;padding:12px;border:0;border-radius:8px;background:${cfg.color};color:#fff;font-size:15px;font-weight:600;cursor:pointer}
.hp{position:absolute;left:-9999px}.ok{padding:24px;text-align:center;font-size:16px}.err{color:#b00020;font-size:13px;margin-top:8px}
small{display:block;margin-top:10px;color:#777;font-size:12px}
</style></head><body>
<form id="f" novalidate>
<h1>${esc(cfg.title)}</h1><p class="sub">${esc(cfg.subtitle)}</p>
<label for="n">Nome</label><input id="n" name="name" required autocomplete="name">
<label for="e">E-mail</label><input id="e" name="email" type="email" required autocomplete="email">
${cfg.ask_phone ? '<label for="p">WhatsApp</label><input id="p" name="phone" type="tel" required autocomplete="tel" placeholder="(11) 99999-9999">' : ""}
${cfg.ask_message ? '<label for="m">Mensagem</label><textarea id="m" name="message" rows="3"></textarea>' : ""}
<input class="hp" name="website" tabindex="-1" autocomplete="off">
<button type="submit">${esc(cfg.button)}</button>
<small>Ao enviar, você concorda em ser contatado${cfg.privacy_url ? ` (<a href="${esc(cfg.privacy_url)}" target="_blank" rel="noopener">política de privacidade</a>)` : ""}.</small>
<div class="err" id="err"></div>
</form>
<script>
(function(){
  var t=Date.now(),f=document.getElementById('f'),q=new URLSearchParams(location.search);
  function size(){try{parent.postMessage({mfForm:${JSON.stringify(token)},h:document.body.scrollHeight},'*')}catch(e){}}
  size();
  f.addEventListener('submit',function(ev){
    ev.preventDefault();
    var d={};new FormData(f).forEach(function(v,k){d[k]=v});
    d._t=t;d.page=q.get('page')||document.referrer||'';
    ['utm_source','utm_medium','utm_campaign','utm_content','utm_term'].forEach(function(k){if(q.get(k))d[k]=q.get(k)});
    var b=f.querySelector('button');b.disabled=true;
    fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)})
      .then(function(r){return r.json().then(function(j){return {ok:r.ok,j:j}})})
      .then(function(x){
        if(!x.ok){document.getElementById('err').textContent=x.j.error||'Não foi possível enviar.';b.disabled=false;return}
        if(x.j.redirect){try{top.location.href=x.j.redirect}catch(e){location.href=x.j.redirect}return}
        f.innerHTML='<div class="ok">'+${JSON.stringify(esc(cfg.thanks))}+'</div>';size();
      }).catch(function(){document.getElementById('err').textContent='Sem conexão. Tente de novo.';b.disabled=false});
  });
})();
</script></body></html>`;
}

/** Script para colar no site: cria o iframe do formulário e passa UTMs e a página de origem. */
export function embedScript(token: string, origin: string) {
  const src = `${origin}/api/public/forms/${token}`;
  return `(function(){
  var s=document.currentScript,box=document.createElement('div');
  var q=new URLSearchParams(location.search),p=new URLSearchParams();
  ['utm_source','utm_medium','utm_campaign','utm_content','utm_term'].forEach(function(k){if(q.get(k))p.set(k,q.get(k))});
  p.set('page',location.href);
  var f=document.createElement('iframe');
  f.src=${JSON.stringify(src)}+'?'+p.toString();
  f.style.cssText='width:100%;max-width:520px;border:0;min-height:420px;display:block;margin:0 auto';
  f.title='Formulário';
  box.appendChild(f);s.parentNode.insertBefore(box,s);
  window.addEventListener('message',function(e){if(e.data&&e.data.mfForm===${JSON.stringify(token)}&&e.data.h)f.style.height=(e.data.h+20)+'px'});
})();`;
}

const pick = (b: Record<string, unknown>, keys: string[]) => {
  for (const k of keys) {
    const v = b[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
};

export class FormError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/** Recebe o envio, aplica o anti-spam e cria/atualiza o lead com origem "site". */
export async function ingestSiteLead(integration: Integration, body: Record<string, unknown>, ip: string | null) {
  const db = await admin();
  // Campo isca preenchido = robô. Responde "ok" sem gravar nada.
  if (pick(body, ["website", "url_hp"])) return { spam: true };
  const started = Number(body["_t"] ?? 0);
  if (started && Date.now() - started < 2500) return { spam: true };

  const ipHash = ip ? createHash("sha256").update(`${integration.id}:${ip}`).digest("hex").slice(0, 32) : null;
  if (ipHash) {
    const { count } = await db
      .from("crm_webhook_events")
      .select("id", { count: "exact", head: true })
      .eq("source", "site_form")
      .eq("payload->>ip" as never, ipHash)
      .gte("created_at", new Date(Date.now() - 10 * 60e3).toISOString());
    if ((count ?? 0) >= 5) throw new FormError("Muitos envios seguidos. Tente de novo em alguns minutos.", 429);
  }

  const name = pick(body, ["name", "nome", "full_name", "fullname", "first_name"]) ?? "Lead do site";
  const emailRaw = pick(body, ["email", "e-mail", "mail"]);
  const email = emailRaw && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw) ? emailRaw.toLowerCase() : null;
  const phone = normalizePhone(pick(body, ["phone", "telefone", "whatsapp", "celular", "tel"]));
  if (!email && !phone) throw new FormError("Informe um e-mail válido ou um telefone.");
  const message = pick(body, ["message", "mensagem", "msg", "comentario"]);
  const utm = {
    utm_source: pick(body, ["utm_source"]),
    utm_medium: pick(body, ["utm_medium"]),
    utm_campaign: pick(body, ["utm_campaign"]),
  };
  const page = pick(body, ["page", "pagina", "url"]);

  await db.from("crm_webhook_events").insert({
    workspace_id: integration.workspace_id,
    source: "site_form",
    payload: { ip: ipHash, page } as never,
    status: "processed",
  });

  const existing = await findLead(integration.workspace_id, phone, email);
  if (existing) {
    await addInteraction({
      workspaceId: integration.workspace_id,
      leadId: existing.id as string,
      kind: "message_in",
      authorType: "contact",
      content: `Preencheu o formulário do site novamente${message ? `: "${message}"` : "."}`,
      metadata: { page, ...utm },
    });
    return { leadId: existing.id as string, duplicated: true };
  }

  const { pipelineId, stageId } = await firstStage(integration.workspace_id);
  const ownerId = await pickOwner(integration.workspace_id);
  const { data: created, error } = await db
    .from("crm_leads")
    .insert({
      workspace_id: integration.workspace_id,
      pipeline_id: pipelineId,
      stage_id: stageId,
      name,
      email,
      phone,
      source: "site",
      owner_id: ownerId,
      ...utm,
      lgpd_consent: true,
      lgpd_consent_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  const leadId = created.id as string;
  if (stageId) {
    await db.from("crm_stage_history").insert({
      workspace_id: integration.workspace_id,
      lead_id: leadId,
      from_stage_id: null,
      to_stage_id: stageId,
    });
  }
  await addInteraction({
    workspaceId: integration.workspace_id,
    leadId,
    kind: "message_in",
    authorType: "contact",
    content: `Lead do formulário do site${message ? `: "${message}"` : "."}${page ? ` Página: ${page}` : ""}`,
    metadata: { page, ...utm },
  });
  await startCadence(integration.workspace_id, leadId, "site");
  return { leadId, duplicated: false };
}
