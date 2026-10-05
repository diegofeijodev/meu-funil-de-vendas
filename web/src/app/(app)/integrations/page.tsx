import type { Metadata } from 'next';
import { IntegrationsPage } from './IntegrationsPage';

export const metadata: Metadata = {
  title: 'Integrações · Meu Funil',
  description: 'Conexões reais com Meta Ads, Instagram, OpenAI, Gemini e Higgsfield.',
  openGraph: { title: 'Integrações · Meu Funil', description: 'Conecte as contas e IAs que a agência usa.' },
};

export default function Page() {
  return <IntegrationsPage />;
}
