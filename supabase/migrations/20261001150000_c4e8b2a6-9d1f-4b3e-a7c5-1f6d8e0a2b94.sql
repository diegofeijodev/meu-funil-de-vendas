-- Fase 3: CRM com Instagram (Direct e comentários), formulário do site, e-mail e agenda.

-- Novos canais em crm_integrations.
alter table public.crm_integrations drop constraint if exists crm_integrations_kind_check;
alter table public.crm_integrations add constraint crm_integrations_kind_check
  check (kind in ('meta_lead_ads','whatsapp','instagram','site_form','email','calendar'));
alter table public.crm_integrations drop constraint if exists crm_integrations_provider_check;
alter table public.crm_integrations add constraint crm_integrations_provider_check
  check (provider in ('meta','whatsapp_cloud','zapi','evolution','site','resend','calcom'));

-- 3.1 Leads que chegam pelo Instagram (identificados pelo IGSID).
alter table public.crm_leads
  add column if not exists instagram_id text,
  add column if not exists instagram_username text;
create unique index if not exists crm_leads_instagram_key on public.crm_leads(workspace_id, instagram_id) where instagram_id is not null;

-- 3.3 Segredo do link de descadastro dos e-mails.
insert into public.cron_tokens(name, token) values ('unsubscribe', encode(extensions.gen_random_bytes(32),'hex'))
on conflict (name) do nothing;
