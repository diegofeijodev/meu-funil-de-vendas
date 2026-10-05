# Meu Funil

Versão própria (API + banco + web separados) do app Lovable "Meu Funil" — marca, campanhas, estrategista de IA, criativos, Instagram,
anúncios e CRM com SDR de IA. Port 1:1 do protótipo (`.prototype/`, só leitura).

| peça | stack | porta |
|---|---|---|
| `api/` | NestJS 11 + Fastify + Prisma 5.22 (npm) | 3015 |
| `web/` | Next.js 15 + React 19 + Tailwind 4 (yarn) | 3025 |
| Postgres | `postgres:16-alpine` (`meu-funil-postgres`) | 5439 |

Documentação: [`docs/api-contract.md`](docs/api-contract.md) (contrato da API), [`CLAUDE.md`](CLAUDE.md) (regras do projeto),
`docs/superpowers/` (design e plano), `docs/inventory/` (inventário do protótipo).

## Rodar a API

```bash
docker compose up -d postgres              # Postgres na 5439
cd api
npm install
cp .env.example .env                       # ajuste JWT_SECRET (16+ caracteres)
npx prisma migrate deploy                  # aplica a migração `init` (62 tabelas + users)
npm run seed                               # demo@meufunil.local / meufunil123
npm run start:dev                          # http://localhost:3015  (Swagger em /docs)
curl localhost:3015/health
```

Verificações (uma por vez — a máquina é pequena). **Todo comando pesado passa por `scripts/run-capped.sh <teto-MB> <comando>`**: roda num cgroup
com teto de memória e lock compartilhado (`.cache/heavy.lock`, fora do git; `HEAVY_LOCK` troca). Passou do teto → só o comando morre (137); sem memória livre → 75.

```bash
cd api && ../scripts/run-capped.sh 1500 npm test            # jest completo
cd api && ../scripts/run-capped.sh 1500 npm run typecheck
cd web && ../scripts/run-capped.sh 1500 yarn typecheck && ../scripts/run-capped.sh 1500 yarn lint
scripts/run-capped.sh 1300 bash api/scripts/smoke-capped.sh # fakes + API + `npm run smoke`, derruba tudo pelos PIDs
bash web/scripts/browser-check-sections.sh                  # browser-check por grupos de seções (cada grupo sob teto de 2400 MB)
bash web/scripts/browser-check-sections.sh 1 4              # só os grupos 1 e 4;  BC_ONLY=marcas,crm node web/scripts/browser-check.mjs = seções soltas
```

> **Atenção:** `npm run smoke` e `yarn browser-check` só devem rodar contra o banco local descartável. A limpeza deles apaga linhas que casam com padrões de teste (por exemplo `Browser[0-9]+`); nunca aponte `DATABASE_URL` para um banco com dados reais.

### Variáveis principais (`api/.env.example` lista todas)

- `DATABASE_URL`, `JWT_SECRET`, `PORT=3015`, `CORS_ORIGINS`, `PUBLIC_URL`, `APP_URL`, `TRUST_PROXY`.
- `TRUST_PROXY` — quantos proxies confiar para descobrir o IP do cliente (limite do formulário público, throttle). Aceita um **número de saltos** (`1`), uma **lista de IPs/CIDRs** (`10.0.0.0/8,172.16.0.1`) ou `false`/`true`.
  Cadeia de produção: cliente → nginx → rewrite do Next → API = **`TRUST_PROXY=1`**. O rewrite do Next 15 **não** acrescenta nada ao `X-Forwarded-For` (só preenche com o IP do peer se o cabeçalho faltar); o peer TCP da API é o servidor Next (1 salto confiável) e o `X-Forwarded-For` vem do nginx. Requisitos: o nginx **deve definir** o cabeçalho, de preferência **sobrescrevendo** (`proxy_set_header X-Forwarded-For $remote_addr;`; com `$proxy_add_x_forwarded_for` o `1` ainda pega o cliente, mas só se o nginx anexar); e a **porta da API não pode ser acessível publicamente** (só o Next/nginx falam com ela), senão qualquer um forja o IP.
  **`true` é inseguro**: confia em todo o `X-Forwarded-For` e o cliente forja o primeiro IP da cadeia (rotacionando-o, burla o limite de 5 envios/10 min). Fica só como atalho de desenvolvimento. `false` (padrão): `req.ip` é o do vizinho direto. Número de saltos só é seguro se a porta da API NÃO é alcançável de fora (um cliente direto poderia mandar o `X-Forwarded-For` que quisesse); se der para fixar os endereços dos proxies, prefira a lista de IPs/CIDRs (ex.: a sub-rede da rede docker).
- `UPLOADS_DIR` — arquivos em disco (`<bucket>/<chave>`), servidos por URL assinada.
- `CREDENTIALS_ENCRYPTION_KEY` — cofre AES-256-GCM; **obrigatória em produção**.
- `UNSUBSCRIBE_SECRET` — HMAC dos links de descadastro; **obrigatória em produção**.
- `AI_GATEWAY_URL` / `AI_GATEWAY_API_KEY` / `AI_MODEL_*` — gateway de IA compatível com OpenAI. Sem eles a IA do app responde "IA do app não configurada."
  (o cliente ainda pode usar a própria chave OpenAI/Gemini por workspace).
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — login com Google (opcional; sem eles o endpoint responde 503).
- `SCHEDULER_ENABLED` — jobs agendados (substituem o pg_cron); ligue em **uma** instância só. Nunca junto com um cron externo chamando
  `/api/public/cron/*` (rodaria tudo duas vezes): ou um ou outro.

### Agendador (UTC)

| job | cron | heartbeat | módulo |
|---|---|---|---|
| `crm-cadences-5min` | `*/5 * * * *` | `crm-cadences` | `crm-channels` |
| `instagram-queue-5min` / `-media-5min` / `-metrics-5min` | `*/5 * * * *` | `instagram-queue` / `-media` / `-metrics` | `instagram` |
| `instagram-autopilot-weekly` | `0 21 * * 0` | `instagram-weekly` | `instagram` |
| `instagram-optimizer-monday` | `0 12 * * 1` | `instagram-optimize` | `instagram` |
| `instagram-account-daily` | `25 10 * * *` | `instagram-account` | `instagram` |
| `ads-insights-3h` | `17 */3 * * *` | `ads-sync` | `ads` |
| `ads-rules-daily` | `40 12 * * *` | `ads-rules` | `ads` |
| `crm-daily` | `10 9 * * *` | `crm-daily` | `crm-channels` |
| `creative-poll-5min` (extra) | `*/5 * * * *` | `creative` | `creative` |
| `exports-cleanup-hourly` (extra) | `47 * * * *` | `exports_cleanup` | `integrations` |

Detalhes e rotas HTTP equivalentes: `docs/api-contract.md` §7.

### Docker completo

```bash
JWT_SECRET=... CREDENTIALS_ENCRYPTION_KEY=... UNSUBSCRIBE_SECRET=... docker compose --profile full up --build
```

## Rodar o web

```bash
cd web
yarn install
cp .env.example .env.local        # NEXT_PUBLIC_API_URL=http://localhost:3015
yarn dev                          # http://localhost:3025  (next dev -p 3025, webpack)
yarn typecheck | yarn lint
yarn browser-check                # com API (3015) e web (3025) de pé; login demo@meufunil.local / meufunil123
```

A API precisa liberar a origem do web: `CORS_ORIGINS=http://localhost:3025` no `api/.env` (está no `.env.example`).
Nunca `next build` durante uma tarefa comum (a máquina trava).

## Estado

Tasks 0 (API + banco) e 1 (fundação do web: login, shell, workspace, shims de rota) concluídas.
Próximas: marca/visão geral/configurações/agência, campanhas,
criativos, Instagram, anúncios, CRM — ver `docs/superpowers/plans/`.
