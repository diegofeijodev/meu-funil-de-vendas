import type { Metadata } from 'next';
import { LibraryPage } from './LibraryPage';

export const metadata: Metadata = {
  title: 'Biblioteca de mídia · Meu Funil',
  description: 'Todas as imagens e vídeos da marca no tamanho certo para Instagram e anúncios, prontos para baixar, exportar e publicar.',
  openGraph: {
    title: 'Biblioteca de mídia · Meu Funil',
    description: 'Imagens e vídeos padronizados para Feed, Story, Reels e anúncios da Meta.',
    type: 'website',
  },
  twitter: { card: 'summary' },
};

export default function Page() {
  return <LibraryPage />;
}
