import type { Metadata } from 'next';
import { OverviewPage } from './OverviewPage';

export const metadata: Metadata = {
  title: 'Overview · Meu Funil',
  description: 'Investimento, receita atribuída, ROAS, ROI e recomendações prioritárias do mês.',
  openGraph: { title: 'Overview · Meu Funil', description: 'Painel geral de performance e insights de IA.' },
};

export default function Page() {
  return <OverviewPage />;
}
