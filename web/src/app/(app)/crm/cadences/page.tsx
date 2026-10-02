import type { Metadata } from 'next';
import { CadencesPage } from './CadencesPage';

export const metadata: Metadata = {
  title: 'CRM · Cadências · Meu Funil',
  description: 'Construtor de cadências de follow-up por WhatsApp, e-mail e ligação.',
  openGraph: { title: 'CRM · Cadências', description: 'Sequências automáticas de contato com indicadores por passo.' },
};

export default function Page() {
  return <CadencesPage />;
}
