import type { Metadata } from 'next';
import { CrmSettings } from './CrmSettings';

export const metadata: Metadata = {
  title: 'CRM · Configurações · Meu Funil',
  description: 'Funis, etapas, SLA, distribuição de leads, motivos de perda e tags.',
  openGraph: { title: 'CRM · Configurações', description: 'Configure o funil e as regras do time comercial.' },
};

export default function Page() {
  return <CrmSettings />;
}
