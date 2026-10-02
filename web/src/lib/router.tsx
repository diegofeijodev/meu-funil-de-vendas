'use client';

/**
 * Compat com `@tanstack/react-router` para que as telas portadas fiquem 1:1 com
 * o protótipo. Mesmas assinaturas de chamada que as páginas usam:
 *
 *   <Link to="/campaigns/$id" params={{ id }} search={{ tab: 'x' }} />
 *   const navigate = useNavigate(); navigate({ to, params, search, replace })
 *   const { tab } = useSearch();           // era Route.useSearch()
 *   const { id } = useParams<{ id: string }>();   // era Route.useParams()
 *   const pathname = useRouterState({ select: (s) => s.location.pathname });
 *   throw redirect({ to: '/instagram', search: { tab: 'calendar' } });
 *
 * `createFileRoute`/`Route` NÃO existem aqui: no Next o arquivo `page.tsx` é a
 * rota (e não pode exportar `Route`). `head()` vira `export const metadata` num
 * `page.tsx` de servidor ou fica de fora em páginas só-cliente.
 */
import NextLink from 'next/link';
import {
  RedirectType,
  redirect as nextRedirect,
  useParams as useNextParams,
  usePathname,
  useRouter as useNextRouter,
  useSearchParams,
} from 'next/navigation';
import { useCallback, useMemo, type ComponentProps } from 'react';

type Primitive = string | number | boolean | null | undefined;
export type RouteParams = Record<string, string | number>;
export type RouteSearch = Record<string, Primitive>;

export type NavTarget = {
  to?: string;
  params?: RouteParams;
  search?: RouteSearch;
  hash?: string;
  replace?: boolean;
};

/** `/brands/$id` + `{ id }` -> `/brands/abc`; `search` vira querystring (sem undefined/null). */
export function buildHref({ to = '/', params, search, hash }: Pick<NavTarget, 'to' | 'params' | 'search' | 'hash'>): string {
  let path = to;
  if (params) {
    path = path.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (_, name: string) =>
      name in params ? encodeURIComponent(String(params[name])) : `$${name}`,
    );
  }
  if (search) {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(search)) {
      if (v !== undefined && v !== null) q.set(k, String(v));
    }
    const s = q.toString();
    if (s) path += (path.includes('?') ? '&' : '?') + s;
  }
  if (hash) path += hash.startsWith('#') ? hash : `#${hash}`;
  return path;
}

export type LinkProps = Omit<ComponentProps<typeof NextLink>, 'href'> & {
  to: string;
  params?: RouteParams;
  search?: RouteSearch;
  hash?: string;
};

/** `Button asChild` + `<Link>` funciona: tudo (inclusive `ref`) vai para o `<a>` do Next. */
export function Link({ to, params, search, hash, ...rest }: LinkProps) {
  return <NextLink href={buildHref({ to, params, search, hash })} {...rest} />;
}

export function useNavigate(opts?: { from?: string }) {
  const router = useNextRouter();
  const pathname = usePathname();
  const from = opts?.from;
  return useCallback(
    ({ to, params, search, hash, replace }: NavTarget) => {
      const href = buildHref({ to: to ?? from ?? pathname, params, search, hash });
      if (replace) router.replace(href);
      else router.push(href);
    },
    [router, pathname, from],
  );
}

export function useSearch<T extends Record<string, unknown> = Record<string, string | undefined>>(): T {
  const sp = useSearchParams();
  const str = sp.toString();
  // Valores sempre string (como a querystring crua). Validação ("whitelist") fica na página.
  return useMemo(() => Object.fromEntries(new URLSearchParams(str).entries()) as unknown as T, [str]);
}

export function useParams<T extends Record<string, string> = Record<string, string>>(): T {
  return useNextParams() as unknown as T;
}

export function useLocation() {
  const pathname = usePathname();
  const search = useSearch();
  const str = useSearchParams().toString();
  return { pathname, search, searchStr: str ? `?${str}` : '', hash: typeof window === 'undefined' ? '' : window.location.hash };
}

type RouterState = { location: ReturnType<typeof useLocation> };

export function useRouterState<T = RouterState>(opts?: { select?: (s: RouterState) => T }): T {
  const location = useLocation();
  const state: RouterState = { location };
  return (opts?.select ? opts.select(state) : state) as T;
}

export function useRouter() {
  const router = useNextRouter();
  const navigate = useNavigate();
  return useMemo(
    () => ({
      navigate,
      push: router.push,
      replace: router.replace,
      back: router.back,
      /** `router.invalidate()` do TanStack = reler os dados da rota. */
      invalidate: () => router.refresh(),
      history: { back: () => router.back() },
    }),
    [router, navigate],
  );
}

/** `throw redirect({ to, search })` do `beforeLoad`; no Next, chame durante o render. */
export function redirect({ to, params, search, hash, replace }: NavTarget & { to: string }): never {
  return nextRedirect(buildHref({ to, params, search, hash }), replace ? RedirectType.replace : RedirectType.push);
}
