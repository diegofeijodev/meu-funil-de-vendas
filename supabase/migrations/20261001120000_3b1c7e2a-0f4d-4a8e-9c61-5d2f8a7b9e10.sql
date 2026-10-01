-- lovable-cron-fallback-reviewed: user requested fixing the existing jobs (missing cadence token, 5s pg_net timeout) and scheduling the daily Meta cost import
-- Fase 0 (0.4, 0.5) + 2.7: tokens dos agendadores, tempo de espera maior e custos diários da Meta.

-- 0.4: o agendador das cadências procurava um token que nunca foi criado (rota respondia 401).
insert into public.cron_tokens(name, token) values ('crm_cadences', encode(extensions.gen_random_bytes(32),'hex'))
on conflict (name) do nothing;
insert into public.cron_tokens(name, token) values ('crm_daily', encode(extensions.gen_random_bytes(32),'hex'))
on conflict (name) do nothing;

-- 0.5: pg_net espera só 5 s por padrão; publicações e gerações levam mais. Reagenda com 120 s.
do $$ begin
  perform cron.unschedule(j) from unnest(array['crm-cadences-5min','crm-daily','instagram-autopilot-weekly','instagram-optimizer-monday','instagram-queue-5min','instagram-media-5min','instagram-metrics-5min']) j where exists (select 1 from cron.job where jobname=j);
end $$;

select cron.schedule('crm-cadences-5min','*/5 * * * *',$c$select net.http_post(url := 'https://www.meufunildevendas.com.br/api/public/cron/crm-cadences', headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select token from public.cron_tokens where name='crm_cadences')), body := '{}'::jsonb, timeout_milliseconds := 120000);$c$);
select cron.schedule('instagram-queue-5min','*/5 * * * *',$c$select net.http_post(url := 'https://www.meufunildevendas.com.br/api/public/cron/instagram', headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select token from public.cron_tokens where name='instagram')), body := '{"task":"queue"}'::jsonb, timeout_milliseconds := 120000);$c$);
select cron.schedule('instagram-media-5min','*/5 * * * *',$c$select net.http_post(url := 'https://www.meufunildevendas.com.br/api/public/cron/instagram', headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select token from public.cron_tokens where name='instagram')), body := '{"task":"media"}'::jsonb, timeout_milliseconds := 120000);$c$);
select cron.schedule('instagram-metrics-5min','*/5 * * * *',$c$select net.http_post(url := 'https://www.meufunildevendas.com.br/api/public/cron/instagram', headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select token from public.cron_tokens where name='instagram')), body := '{"task":"metrics"}'::jsonb, timeout_milliseconds := 120000);$c$);
select cron.schedule('instagram-autopilot-weekly','0 21 * * 0',$c$select net.http_post(url := 'https://www.meufunildevendas.com.br/api/public/cron/instagram', headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select token from public.cron_tokens where name='instagram')), body := '{"task":"weekly"}'::jsonb, timeout_milliseconds := 120000);$c$);
select cron.schedule('instagram-optimizer-monday','0 12 * * 1',$c$select net.http_post(url := 'https://www.meufunildevendas.com.br/api/public/cron/instagram', headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select token from public.cron_tokens where name='instagram')), body := '{"task":"optimize"}'::jsonb, timeout_milliseconds := 120000);$c$);

-- 2.7: custos diários das campanhas da Meta no CRM (06:10 BRT = 09:10 UTC).
select cron.schedule('crm-daily','10 9 * * *',$c$select net.http_post(url := 'https://www.meufunildevendas.com.br/api/public/cron/crm-daily', headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select token from public.cron_tokens where name='crm_daily')), body := '{}'::jsonb, timeout_milliseconds := 120000);$c$);
