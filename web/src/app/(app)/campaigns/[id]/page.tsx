import type { Metadata } from 'next';
import { CampaignDetail } from './CampaignDetail';

export const metadata: Metadata = {
  title: 'Campanha · Meu Funil',
  description: 'Estratégia, copies, criativos, performance e publicação da campanha.',
  openGraph: { title: 'Campanha · Meu Funil', description: 'Fluxo completo com aprovação humana antes de publicar.' },
};

export default function Page() {
  return <CampaignDetail />;
}
