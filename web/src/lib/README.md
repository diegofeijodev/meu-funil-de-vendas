# `src/lib`

Libs de cliente do protótipo (`format`, `labels`, `metrics`, `crm`, `guides`, `utils`, `creative/visual-style`) copiadas verbatim.
Alterações permitidas: só imports.

## Shims de compat (mantêm as telas portadas 1:1)

- `router.tsx` — `Link`, `useNavigate`, `useSearch`, `useParams`, `useLocation`, `useRouterState`, `useRouter`, `redirect`
  com as assinaturas do TanStack Router que as páginas usam (`to` + `params` com `$id` + `search`).
- `server-fn.ts` — `useServerFn(fn)` (identidade) e `serverFnPost` (fábrica dos shims abaixo).

## Padrão dos shims `*.functions.ts`

Cada arquivo `src/lib/**/<nome>.functions.ts` do protótipo vira um arquivo com o MESMO nome e os MESMOS exports, cada um
`(opts?: { data?: T }) => Promise<R>` que faz `POST /v1/<módulo>/<nome-em-kebab>` com `opts.data` no corpo (ver `serverFnPost`).
Quem porta a tela troca só o import do `@tanstack/react-start`; `useServerFn(fn)` + `run({ data })` ficam iguais.
Cada tarefa de domínio cria os shims do seu domínio e acrescenta as rotas em `docs/api-contract.md`. Já existem: `setup`, `agency`, `creative` (`generateBrandGuide`) e `meta/ads-ops` (`syncAdsInsightsNow`, rota ainda a criar na tarefa de Meta).
Os `*.server.ts` NÃO são portados (a lógica mora na API).
