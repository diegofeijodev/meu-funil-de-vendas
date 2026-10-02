/**
 * Agenda dos 10 jobs do protótipo (db.md §6; pg_cron, horários em UTC).
 * Tarefas posteriores registram o handler com `SchedulerService.register({ ...JOB_SCHEDULES['crm-cadences-5min'], handler })`.
 */
export const JOB_SCHEDULES = {
  'crm-cadences-5min': { name: 'crm-cadences-5min', cron: '*/5 * * * *', heartbeat: 'crm_cadences' },
  'instagram-queue-5min': { name: 'instagram-queue-5min', cron: '*/5 * * * *', heartbeat: 'instagram' },
  'instagram-media-5min': { name: 'instagram-media-5min', cron: '*/5 * * * *', heartbeat: 'instagram' },
  'instagram-metrics-5min': { name: 'instagram-metrics-5min', cron: '*/5 * * * *', heartbeat: 'instagram' },
  'instagram-autopilot-weekly': { name: 'instagram-autopilot-weekly', cron: '0 21 * * 0', heartbeat: 'instagram' },
  'instagram-optimizer-monday': { name: 'instagram-optimizer-monday', cron: '0 12 * * 1', heartbeat: 'instagram' },
  'instagram-account-daily': { name: 'instagram-account-daily', cron: '25 10 * * *', heartbeat: 'instagram' },
  'ads-insights-3h': { name: 'ads-insights-3h', cron: '17 */3 * * *', heartbeat: 'ads' },
  'ads-rules-daily': { name: 'ads-rules-daily', cron: '40 12 * * *', heartbeat: 'ads' },
  'crm-daily': { name: 'crm-daily', cron: '10 9 * * *', heartbeat: 'crm_daily' },
} as const;
