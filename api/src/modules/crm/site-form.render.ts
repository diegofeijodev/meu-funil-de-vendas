/**
 * Página e script do formulário do site (porte 1:1 de `crm/site-form.server.ts`, parte de apresentação).
 * Desvios: `redirect_url` só aceita http(s); a origem do script de embed vem de `APP_URL` (a API fica atrás do rewrite do web).
 */
/** Só http(s) absoluto: o script do formulário faz `location.href = redirect`, então `javascript:` seria XSS. */
export function safeRedirect(v: unknown): string | null {
  if (typeof v !== 'string' || !v.trim()) return null;
  try {
    const u = new URL(v.trim());
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

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

export function formConfig(integration: { config?: unknown }): SiteFormConfig {
  const c = (integration.config ?? {}) as Partial<SiteFormConfig>;
  return {
    title: str(c.title) || "Fale com a gente",
    subtitle: str(c.subtitle) || "Deixe seus dados que entramos em contato.",
    button: str(c.button) || "Quero ser atendido",
    thanks: str(c.thanks) || "Recebemos seus dados! Em breve entraremos em contato.",
    redirect_url: safeRedirect(c.redirect_url),
    ask_phone: c.ask_phone !== false,
    ask_message: !!c.ask_message,
    privacy_url: safeRedirect(c.privacy_url),
    color: typeof c.color === "string" && /^#[0-9a-f]{6}$/i.test(c.color) ? c.color : "#4F46E5",
  };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** `now` = relógio do SERVIDOR: vai num campo oculto `_t` (o envio sem JS também o leva; o servidor exige `_t` válido e com ≥ 2,5 s). */
export function renderFormHtml(token: string, cfg: SiteFormConfig, now = Date.now()) {
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
<input type="hidden" name="_t" value="${Math.floor(now)}">
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
    d._t=Number(d._t)||t;d.page=q.get('page')||document.referrer||'';
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
