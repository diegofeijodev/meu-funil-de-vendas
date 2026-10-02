import type { Metadata } from 'next';
import { SettingsPage } from './SettingsPage';

export const metadata: Metadata = {
  title: 'Configurações · Meu Funil',
  description: 'Workspace, perfil, papéis do time e registro de atividades.',
  openGraph: { title: 'Configurações · Meu Funil', description: 'Controle de acesso por workspace com papéis.' },
};

export default function Page() {
  return <SettingsPage />;
}
