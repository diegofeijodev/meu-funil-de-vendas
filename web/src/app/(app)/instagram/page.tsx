import type { Metadata } from 'next';
import { InstagramPage } from './InstagramPage';

export const metadata: Metadata = {
  title: 'Instagram · Meu Funil',
  description: 'Planeje, gere com IA, aprove e publique posts, carrosséis, Reels e Stories no Instagram.',
  openGraph: { title: 'Instagram · Meu Funil', description: 'Publicação automática no Instagram com criativos e legendas gerados por IA.' },
};

export default function Page() {
  return <InstagramPage />;
}
