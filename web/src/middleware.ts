import { NextResponse, type NextRequest } from 'next/server';
import { isKnownAppPath } from '@/lib/app-routes';

/**
 * Rota desconhecida = HTTP 404 de verdade. O `notFound()` do catch-all `(app)/[...rest]` só vira 404 se a resposta ainda não
 * começou a ser transmitida (aqui já começou e saía 200), então o status é decidido antes, pela mesma lista de rotas
 * (`lib/app-routes.ts`). A tela continua sendo o `not-found.tsx` do root ("Page not found", sem shell).
 */
const PUBLICAS = new Set(['/', '/auth', '/calendar']);

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLICAS.has(pathname) || isKnownAppPath(pathname)) return NextResponse.next();
  return NextResponse.rewrite(new URL('/nao-encontrada', req.url), { status: 404 });
}

export const config = {
  // Fora: arquivos estáticos (com ponto), `_next` e `api` (rewrite para a API: `/api/public/*`).
  matcher: ['/((?!_next|api|.*\\..*).*)'],
};
