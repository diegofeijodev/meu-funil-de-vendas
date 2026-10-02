import { api, apiErrorMessage } from '@/modules/shared/infrastructure/http';

/**
 * `useServerFn(fn)` do TanStack Start devolvia uma função que chama a server
 * function. As ações portadas (`src/lib/**\/<nome>.functions.ts`) já são
 * funções comuns que falam com a API, então aqui é identidade.
 */
export function useServerFn<F extends (...args: never[]) => unknown>(fn: F): F {
  return fn;
}

/** `createWorkspaceReport` -> `create-workspace-report` (nome da rota REST da ação). */
export function kebab(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}

/**
 * Fábrica dos shims `*.functions.ts`: cada export é `(opts?: { data?: T }) => Promise<R>`
 * e faz `POST <path>` com `opts.data` no corpo — o mesmo contrato `{ data }` das
 * server functions do protótipo, então `run({ data: {...} })` nas telas não muda.
 *
 * `path` é `'/v1/<módulo>/<nome-em-kebab>'` ou uma função do `data` (rotas com
 * `:workspaceId` na URL). Erros viram `Error` cuja `message` é a mensagem pt-BR
 * da API (`{ error: { message } }`), como o `e.message` que as telas já exibem.
 * Ações que no protótipo devolviam `{ ok:false, error }` recebem isso da API com
 * HTTP 200 e passam direto.
 *
 *   export const generateStrategy = serverFnPost<{ workspaceId: string; campaignId: string }, Strategy>(
 *     (d) => `/v1/workspaces/${d.workspaceId}/campaigns/${d.campaignId}/${kebab('generateStrategy')}`,
 *   );
 */
export function serverFnPost<T = void, R = unknown>(path: string | ((data: T) => string)) {
  return async (opts?: { data?: T }): Promise<R> => {
    const data = opts?.data as T;
    const url = typeof path === 'function' ? path(data) : path;
    try {
      const res = await api.post<R>(url, opts?.data ?? {});
      return res.data;
    } catch (e) {
      throw new Error(apiErrorMessage(e));
    }
  };
}
