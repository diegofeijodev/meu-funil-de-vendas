import type { Metadata } from 'next';
import { TasksPage } from './TasksPage';

export const metadata: Metadata = {
  title: 'CRM · Minhas tarefas · Meu Funil',
  description: 'Tarefas do dia por lead, com vencimento e conclusão rápida.',
  openGraph: { title: 'CRM · Minhas tarefas', description: 'Organize o follow-up diário do time comercial.' },
};

export default function Page() {
  return <TasksPage />;
}
