import type { Metadata } from 'next';
import { BrandDetail } from './BrandDetail';

export const metadata: Metadata = {
  title: 'Brand Kit · Meu Funil',
  description: 'DNA da marca: identidade, produtos, personas, tom de voz e aprendizados.',
  openGraph: { title: 'Brand Kit · Meu Funil', description: 'O contexto que alimenta todos os agentes de IA.' },
};

export default function Page() {
  return <BrandDetail />;
}
