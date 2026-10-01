-- lovable-cron-fallback-reviewed: user requested the daily Meta Ads insights sync and automatic optimization rules (items 2.1–2.3)
-- Fase 2: gestor de tráfego com dados reais, otimizador que age e publicação completa.

-- 2.1 Desempenho por anúncio e por dia vindo da Meta. Linhas antigas (demonstração aleatória)
-- ficam marcadas como 'demo' e somem dos painéis, sem apagar nada.
alter table public.performance_daily
  add column if not exists source text not null default 'demo',
  add column if not exists meta_ad_id text,
  add column if not exists meta_adset_id text,
  add column if not exists ad_name text,
  add column if not exists synced_at timestamptz;
create unique index if not exists performance_daily_meta_key on public.performance_daily(campaign_id, meta_ad_id, date);
create index if not exists performance_daily_source on public.performance_daily(workspace_id, source, date);

-- Campanhas: estrutura publicada, configuração dos anúncios e regras automáticas.
alter table public.campaigns
  add column if not exists meta_adset_ids text[] not null default '{}',
  add column if not exists meta_ad_map jsonb not null default '{}',
  add column if not exists meta_lead_form_id text,
  add column if not exists ads_config jsonb not null default '{}',
  add column if not exists automation_rules jsonb not null default '{}',
  add column if not exists last_insights_sync_at timestamptz;

-- 2.2 Recomendações executáveis: alvo, parâmetros e resultado da execução na Meta.
alter table public.ai_recommendations
  add column if not exists payload jsonb not null default '{}',
  add column if not exists source text not null default 'ai',
  add column if not exists applied_at timestamptz,
  add column if not exists applied_by uuid,
  add column if not exists result text;

-- Agendador de anúncios: sincroniza a cada 3 h e roda as regras automáticas 1x por dia.
insert into public.cron_tokens(name, token) values ('ads', encode(extensions.gen_random_bytes(32),'hex'))
on conflict (name) do nothing;
do $$ begin
  perform cron.unschedule(j) from unnest(array['ads-insights-3h','ads-rules-daily']) j where exists (select 1 from cron.job where jobname=j);
end $$;
select cron.schedule('ads-insights-3h','17 */3 * * *',$c$select net.http_post(url := 'https://www.meufunildevendas.com.br/api/public/cron/ads', headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select token from public.cron_tokens where name='ads')), body := '{"task":"sync"}'::jsonb, timeout_milliseconds := 120000);$c$);
select cron.schedule('ads-rules-daily','40 12 * * *',$c$select net.http_post(url := 'https://www.meufunildevendas.com.br/api/public/cron/ads', headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select token from public.cron_tokens where name='ads')), body := '{"task":"rules"}'::jsonb, timeout_milliseconds := 120000);$c$);
