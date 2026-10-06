DROP FUNCTION IF EXISTS public.export_meufunil(text, text, text, text, integer, integer);

SELECT cron.unschedule(jobid) FROM cron.job WHERE command LIKE '%/api/public/cron/%';