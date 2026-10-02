import type { Metadata } from 'next';
import { InsightsPage } from './InsightsPage';

export const metadata: Metadata = {
  title: 'AI Insights · Meu Funil',
  description: 'Recomendações do AI Optimizer com justificativa e impacto estimado.',
  openGraph: { title: 'AI Insights · Meu Funil', description: 'Otimização contínua com aprovação humana.' },
};

export default function Page() {
  return <InsightsPage />;
}
