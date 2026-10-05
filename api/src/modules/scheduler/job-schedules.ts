/**
 * Agenda dos 10 jobs do protótipo (db.md §6; pg_cron, horários em UTC) + 2 extras do port. `heartbeat` = chave que o job grava em `cron_heartbeats` (a checagem de frescor do `setup` lê `crm-cadences`, `instagram-queue`, `ads-sync`, `crm-daily`).
 * Tarefas posteriores registram o handler com `SchedulerService.register({ ...JOB_SCHEDULES['crm-cadences-5min'], handler })`.
 */
export const JOB_SCHEDULES = {
  'crm-cadences-5min': { name: 'crm-cadences-5min', cron: '*/5 * * * *', heartbeat: 'crm-cadences' },
  'instagram-queue-5min': { name: 'instagram-queue-5min', cron: '*/5 * * * *', heartbeat: 'instagram-queue' },
  'instagram-media-5min': { name: 'instagram-media-5min', cron: '*/5 * * * *', heartbeat: 'instagram-media' },
  'instagram-metrics-5min': { name: 'instagram-metrics-5min', cron: '*/5 * * * *', heartbeat: 'instagram-metrics' },
  'instagram-autopilot-weekly': { name: 'instagram-autopilot-weekly', cron: '0 21 * * 0', heartbeat: 'instagram-weekly' },
  'instagram-optimizer-monday': { name: 'instagram-optimizer-monday', cron: '0 12 * * 1', heartbeat: 'instagram-optimize' },
  'instagram-account-daily': { name: 'instagram-account-daily', cron: '25 10 * * *', heartbeat: 'instagram-account' },
  'ads-insights-3h': { name: 'ads-insights-3h', cron: '17 */3 * * *', heartbeat: 'ads-sync' },
  'ads-rules-daily': { name: 'ads-rules-daily', cron: '40 12 * * *', heartbeat: 'ads-rules' },
  'crm-daily': { name: 'crm-daily', cron: '10 9 * * *', heartbeat: 'crm-daily' },
  // Extras do port (não existem no pg_cron do protótipo): retomada dos vídeos de criativo e limpeza dos exports.
  'creative-poll-5min': { name: 'creative-poll-5min', cron: '*/5 * * * *', heartbeat: 'creative' },
  'exports-cleanup-hourly': { name: 'exports-cleanup-hourly', cron: '47 * * * *', heartbeat: 'exports_cleanup' },
} as const;
