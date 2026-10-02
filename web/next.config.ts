import type { NextConfig } from 'next';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3015';

const nextConfig: NextConfig = {
  // O selo do dev (canto inferior esquerdo) cobre o botão "Sair" do menu lateral.
  devIndicators: false,
  // As rotas públicas do protótipo (`/api/public/**`: webhooks, OAuth, descadastro…)
  // vivem na API com o mesmo caminho. Os links exibidos na tela usam a origem do
  // web, então o Next repassa.
  async rewrites() {
    return [{ source: '/api/public/:path*', destination: `${API_URL}/api/public/:path*` }];
  },
  // `/calendar` era um link legado do protótipo (redirect em beforeLoad).
  async redirects() {
    return [{ source: '/calendar', destination: '/instagram?tab=calendar', permanent: false }];
  },
};

export default nextConfig;
