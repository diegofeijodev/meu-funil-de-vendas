import { notFound } from 'next/navigation';
import { isKnownAppPath } from '@/lib/app-routes';

/**
 * Placeholder das telas ainda não portadas: renderiza o shell com a área
 * principal vazia (a navegação do menu não cai em 404). Cada tarefa de página
 * cria o `page.tsx` real (ex.: `(app)/overview/page.tsx`) e o Next o prefere a
 * este catch-all. Rota fora das 29 do protótipo = 404 do root.
 */
export default async function Placeholder({ params }: { params: Promise<{ rest: string[] }> }) {
  const { rest } = await params;
  if (!isKnownAppPath('/' + rest.join('/'))) notFound();
  return null;
}
