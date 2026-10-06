A migração do sistema terminou. Remova a exportação temporária e os agendamentos, sem mexer em mais nada:

1. Crie e aplique uma migration com exatamente:
   DROP FUNCTION IF EXISTS public.export_meufunil(text, text, text, text, integer, integer);
   SELECT cron.unschedule(jobid) FROM cron.job WHERE command LIKE '%/api/public/cron/%';
2. Apague o endereço de servidor /api/export-file (o arquivo da rota) e publique o app.
