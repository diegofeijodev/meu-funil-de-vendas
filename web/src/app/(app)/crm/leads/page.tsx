import type { Metadata } from 'next';
import { LeadsPage } from './LeadsPage';

export const metadata: Metadata = {
  title: 'CRM · Lista de leads · Meu Funil',
  description: 'Filtre, edite em massa, importe e exporte leads do CRM.',
  openGraph: { title: 'CRM · Lista de leads', description: 'Gestão de leads com ações em massa e CSV.' },
};

export default function Page() {
  return <LeadsPage />;
}
