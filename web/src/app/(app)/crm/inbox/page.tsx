import type { Metadata } from 'next';
import { InboxPage } from './InboxPage';

export const metadata: Metadata = {
  title: 'CRM · Inbox do WhatsApp · Meu Funil',
  description: 'Conversas de WhatsApp do workspace, com não lidas e filtro por responsável.',
  openGraph: { title: 'CRM · Inbox do WhatsApp', description: 'Responda leads de todas as campanhas em um só lugar.' },
};

export default function Page() {
  return <InboxPage />;
}
