import type { Metadata } from 'next';
import { Approvals } from './Approvals';

export const metadata: Metadata = {
  title: 'Aprovações · Meu Funil',
  description: 'Nada vai ao ar sem aprovação humana: campanhas, criativos e recomendações.',
  openGraph: { title: 'Aprovações · Meu Funil', description: 'Controle humano sobre tudo que a IA propõe.' },
};

export default function Page() {
  return <Approvals />;
}
