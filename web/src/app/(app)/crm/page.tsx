import type { Metadata } from 'next';
import { KanbanPage } from './KanbanPage';

export const metadata: Metadata = {
  title: 'CRM · Funil de vendas · Meu Funil',
  description: 'Kanban de leads com SLA, origem, score e responsável por etapa.',
  openGraph: { title: 'CRM · Funil de vendas', description: 'Acompanhe leads por etapa, SLA e responsável.' },
};

export default function Page() {
  return <KanbanPage />;
}
