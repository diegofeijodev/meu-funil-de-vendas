import type { Metadata } from 'next';
import { AuthPage } from './AuthPage';

export const metadata: Metadata = {
  title: 'Entrar · Meu Funil',
  description: 'Acesse o Meu Funil e transforme marketing em vendas com inteligência artificial.',
  openGraph: {
    title: 'Entrar · Meu Funil',
    description: 'A IA que transforma marketing em vendas.',
    type: 'website',
  },
  twitter: { card: 'summary_large_image' },
};

export default function Page() {
  return <AuthPage />;
}
