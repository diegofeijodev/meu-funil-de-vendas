import type { Metadata } from 'next';
import { AgencyPage } from './AgencyPage';

export const metadata: Metadata = {
  title: 'Agência · Meu Funil',
  description: 'Todas as empresas lado a lado: verba, leads, CPL, posts da semana e aprovações pendentes.',
};

export default function Page() {
  return <AgencyPage />;
}
