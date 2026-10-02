import type { Metadata } from 'next';
import { PerformancePage } from './PerformancePage';

export const metadata: Metadata = {
  title: 'Performance e ROI · Meu Funil',
  description: 'CPM, CTR, CPC, CPL, CAC, ROAS e ROI real por campanha, criativo e público.',
  openGraph: { title: 'Performance e ROI · Meu Funil', description: 'Do gasto em mídia ao lucro, com custos extras incluídos.' },
};

export default function Page() {
  return <PerformancePage />;
}
