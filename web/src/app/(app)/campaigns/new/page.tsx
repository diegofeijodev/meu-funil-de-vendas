import type { Metadata } from 'next';
import { NewCampaign } from './NewCampaign';

export const metadata: Metadata = {
  title: 'Nova campanha · Meu Funil',
  description: 'Wizard de briefing em 5 etapas com geração automática de estratégia e copies.',
  openGraph: { title: 'Nova campanha · Meu Funil', description: 'Do briefing ao plano completo em minutos.' },
};

export default function Page() {
  return <NewCampaign />;
}
