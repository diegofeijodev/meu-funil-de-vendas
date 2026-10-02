import type { Metadata } from 'next';
import { LeadDetail } from './LeadDetail';

export const metadata: Metadata = {
  title: 'CRM · Ficha do lead · Meu Funil',
  description: 'Dados, timeline de interações, tarefas e controle da IA do lead.',
  openGraph: { title: 'CRM · Ficha do lead', description: 'Histórico completo e ações do lead.' },
};

export default function Page() {
  return <LeadDetail />;
}
