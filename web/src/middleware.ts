import { NextResponse, type NextRequest } from 'next/server';
import { isKnownAppPath } from '@/lib/app-routes';

/**
 * Rota desconhecida = HTTP 404 de verdade, decidido aqui pela lista de rotas (`lib/app-routes.ts`; um `notFound()` dentro de uma página
 * só vira 404 se a resposta ainda não começou a ser transmitida). A tela é o `not-found.tsx` do root ("Page not found", sem shell).
 * Toda rota tem página real (não há catch-all); `app-routes.test.ts` garante que a lista e as páginas não se separem.
 */
const PUBLICAS = new Set(['/', '/auth', '/calendar']);

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLICAS.has(pathname) || isKnownAppPath(pathname)) return NextResponse.next();
  return NextResponse.rewrite(new URL('/nao-encontrada', req.url), { status: 404 });
}

export const config = {
  // Fora: arquivos estáticos (com ponto), `_next/` e `api/` (rewrite para a API: `/api/public/*`) — o prefixo exato, para não engolir rotas como `/apis` ou `/next-steps`.
  matcher: ['/((?!_next/|__next|api/|api$|.*\\..*).*)'],
};
