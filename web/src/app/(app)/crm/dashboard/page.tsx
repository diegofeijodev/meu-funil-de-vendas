import type { Metadata } from 'next';
import { CrmDashboard } from './CrmDashboard';

export const metadata: Metadata = {
  title: 'CRM · Indicadores · Meu Funil',
  description: 'Conversão por etapa, SLA, origem, IA, ganhos e ranking de vendedores.',
  openGraph: { title: 'CRM · Indicadores', description: 'Indicadores do funil calculados pelo histórico de etapas.' },
};

export default function Page() {
  return <CrmDashboard />;
}
