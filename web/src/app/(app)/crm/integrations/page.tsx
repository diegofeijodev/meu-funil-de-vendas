import type { Metadata } from 'next';
import { IntegrationsPage } from './IntegrationsPage';

export const metadata: Metadata = {
  title: 'CRM · Integrações · Meu Funil',
  description: 'Conecte Meta Lead Ads, WhatsApp, Instagram, formulário do site, e-mail e agenda por empresa.',
  openGraph: { title: 'CRM · Integrações', description: 'Webhooks, mapeamento de formulários e provedores de WhatsApp.' },
};

export default function Page() {
  return <IntegrationsPage />;
}
