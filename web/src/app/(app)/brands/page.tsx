import type { Metadata } from 'next';
import { BrandsPage } from './BrandsPage';

export const metadata: Metadata = {
  title: 'Brands · Meu Funil',
  description: 'Marcas do workspace e o DNA que alimenta os agentes de IA.',
  openGraph: { title: 'Brands · Meu Funil', description: 'Brand Brain: identidade, produtos, personas e tom de voz.' },
};

export default function Page() {
  return <BrandsPage />;
}
