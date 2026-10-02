/** Padrões do CRM que a migração 20260917103746 do protótipo inseriu uma única vez (db.md §7). */
export const DEFAULT_PIPELINE_NAME = 'Funil Padrão';

export const DEFAULT_STAGES = [
  { name: 'Novo Lead', color: '#38bdf8', position: 1, sla_hours: 1, is_won: false, is_lost: false },
  { name: 'Contato Iniciado (SDR IA)', color: '#818cf8', position: 2, sla_hours: 4, is_won: false, is_lost: false },
  { name: 'Qualificado', color: '#a78bfa', position: 3, sla_hours: 24, is_won: false, is_lost: false },
  { name: 'Reunião Agendada', color: '#f59e0b', position: 4, sla_hours: 48, is_won: false, is_lost: false },
  { name: 'Reunião Realizada', color: '#f97316', position: 5, sla_hours: 48, is_won: false, is_lost: false },
  { name: 'Proposta', color: '#22d3ee', position: 6, sla_hours: 72, is_won: false, is_lost: false },
  { name: 'Ganho', color: '#22c55e', position: 7, sla_hours: 72, is_won: true, is_lost: false },
  { name: 'Perdido', color: '#ef4444', position: 8, sla_hours: 72, is_won: false, is_lost: true },
] as const;

export const DEFAULT_LOSS_REASONS = ['Sem orçamento', 'Sem perfil', 'Escolheu concorrente', 'Não respondeu', 'Fora da região'] as const;

export const DEFAULT_TAGS = [
  { name: 'VIP', color: '#f59e0b' },
  { name: 'Investidor', color: '#22d3ee' },
  { name: 'Baixo ticket', color: '#94a3b8' },
  { name: 'Reengajar', color: '#a78bfa' },
] as const;

export const DEFAULT_DISTRIBUTION = 'round_robin';
