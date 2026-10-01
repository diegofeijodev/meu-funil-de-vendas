-- Fase 4/6: mídias vindas do Canva e do histórico do Instagram entram na biblioteca.
alter table public.media_assets drop constraint if exists media_assets_source_check;
alter table public.media_assets add constraint media_assets_source_check
  check (source in ('higgsfield','chatgpt','gemini','upload','mock','other','canva','instagram'));

-- 4.2 Extras do criativo: capa com logo/CTA e legendas do vídeo.
alter table public.creatives add column if not exists extras jsonb not null default '{}';

-- 4.1 Opções do vídeo guardadas no job para o cron concluir em segundo plano (capa, legendas).
alter table public.creative_generation_jobs add column if not exists options jsonb not null default '{}';
