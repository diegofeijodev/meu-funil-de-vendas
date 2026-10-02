import type { Metadata, Viewport } from 'next';
import { Inter, Manrope } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';

// O protótipo puxava as fontes por <link> do Google; aqui vêm por
// `next/font/google` (mesmas famílias e pesos), servidas do próprio domínio.
const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-inter',
  display: 'swap',
});

const manrope = Manrope({
  subsets: ['latin'],
  weight: ['600', '700', '800'],
  variable: '--font-manrope',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Meu Funil · Marketing e vendas com IA',
  description: 'Meu Funil transforma marketing em vendas com inteligência artificial.',
  authors: [{ name: 'Meu Funil' }],
  icons: { icon: [{ url: '/favicon.png', type: 'image/png' }] },
  openGraph: {
    title: 'Meu Funil',
    description: 'A IA que transforma marketing em vendas.',
    type: 'website',
  },
  twitter: { card: 'summary_large_image' },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className={`${inter.variable} ${manrope.variable}`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
