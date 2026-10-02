import type { Metadata } from 'next';
import { Studio } from './StudioPage';

export const metadata: Metadata = {
  title: 'Creative Studio · Meu Funil',
  description: 'Gere criativos por formato com prompt automático a partir do Brand Brain.',
  openGraph: { title: 'Creative Studio · Meu Funil', description: 'Imagens, vídeos, carrosséis e UGC em um só lugar.' },
};

export default function Page() {
  return <Studio />;
}
