import type { Metadata } from 'next';
import { CampaignsList } from './CampaignsList';

export const metadata: Metadata = {
  title: 'Campanhas · Meu Funil',
  description: 'Todas as campanhas do workspace, com verba, status e retorno.',
  openGraph: { title: 'Campanhas · Meu Funil', description: 'Do briefing à publicação, com aprovação humana.' },
};

export default function Page() {
  return <CampaignsList />;
}
