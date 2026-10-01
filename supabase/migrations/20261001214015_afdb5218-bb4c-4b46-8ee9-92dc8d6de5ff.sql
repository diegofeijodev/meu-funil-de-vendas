-- lovable-cron-fallback-reviewed: user explicitly requested daily Meta costs job on custom domain
insert into public.cron_tokens (name, token)
values ('crm_daily', encode(extensions.gen_random_bytes(32), 'hex'))
on conflict (name) do nothing;

do $$ begin
  perform cron.unschedule('crm-daily') where exists (select 1 from cron.job where jobname='crm-daily');
end $$;

select cron.schedule('crm-daily','10 9 * * *',$c$select net.http_post(url := 'https://www.meufunildevendas.com.br/api/public/cron/crm-daily', headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select token from public.cron_tokens where name='crm_daily')), body := '{}'::jsonb, timeout_milliseconds := 120000);$c$);
