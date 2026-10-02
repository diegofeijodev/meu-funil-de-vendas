'use client';

import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { usePathname } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { isKnownAppPath } from '@/lib/app-routes';
import { WorkspaceProvider } from '@/lib/workspace';
import { useAuth } from '@/modules/auth/application/use-auth';
import { me } from '@/modules/auth/infrastructure/auth.api';

const loading = <div className="grid min-h-screen place-items-center text-sm text-muted-foreground">Carregando…</div>;

/**
 * Guarda de sessão das telas internas (era `_authenticated/route.tsx`).
 *
 * O portão fica no LAYOUT: a página nem monta sem sessão — senão cada tela já
 * teria disparado seu `useQuery` autenticado e o console encheria de 401 no meio
 * do redirecionamento. Como o `getUser()` do protótipo, a sessão é validada na
 * API (`GET /v1/auth/me`) antes de montar o shell.
 *
 * Caminho desconhecido (404 do `[...rest]`) passa sem guarda nem shell, como o
 * `notFoundComponent` do root do protótipo.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (!isKnownAppPath(pathname)) return <>{children}</>;
  return <Guarded>{children}</Guarded>;
}

function Guarded({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user, loading: hydrating } = useAuth();

  useEffect(() => {
    if (!hydrating && !user) router.replace('/auth');
  }, [hydrating, user, router]);

  const check = useQuery({ queryKey: ['auth', 'me'], queryFn: me, enabled: !!user, retry: false });

  if (hydrating || !user) return loading;
  if (check.isError) {
    // 401 já foi tratado pelo interceptor (refresh e, se falhar, volta para /auth).
    return (
      <div className="grid min-h-screen place-items-center px-4 text-center text-sm text-muted-foreground">
        <div>
          <p>Não foi possível validar sua sessão.</p>
          <button className="mt-3 font-medium text-primary hover:underline" onClick={() => check.refetch()}>
            Tentar de novo
          </button>
        </div>
      </div>
    );
  }
  if (!check.isSuccess) return loading;

  return (
    <WorkspaceProvider user={user}>
      <AppShell>{children}</AppShell>
    </WorkspaceProvider>
  );
}
