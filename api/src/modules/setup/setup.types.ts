export type SetupItem = {
  key: string;
  group: 'Começo' | 'Conexões' | 'CRM' | 'Agendadores';
  label: string;
  status: 'ok' | 'pending' | 'error' | 'optional';
  detail: string;
  link: string;
  required: boolean;
};
