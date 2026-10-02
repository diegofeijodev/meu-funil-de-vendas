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

Verificações (uma por vez — a máquina é pequena): `npm test`, `npm run typecheck`, e com a API de pé (`npm run start:smoke`) `npm run smoke`.

### Variáveis principais (`api/.env.example` lista todas)

- `DATABASE_URL`, `JWT_SECRET`, `PORT=3015`, `CORS_ORIGINS`, `PUBLIC_URL`, `APP_URL`, `TRUST_PROXY`.
- `UPLOADS_DIR` — arquivos em disco (`<bucket>/<chave>`), servidos por URL assinada.
- `CREDENTIALS_ENCRYPTION_KEY` — cofre AES-256-GCM; **obrigatória em produção**.
- `AI_GATEWAY_URL` / `AI_GATEWAY_API_KEY` / `AI_MODEL_*` — gateway de IA compatível com OpenAI. Sem eles a IA do app responde "IA do app não configurada."
  (o cliente ainda pode usar a própria chave OpenAI/Gemini por workspace).
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — login com Google (opcional; sem eles o endpoint responde 503).
- `SCHEDULER_ENABLED` — jobs agendados (substituem o pg_cron); ligue em **uma** instância só.

### Docker completo

```bash
JWT_SECRET=... CREDENTIALS_ENCRYPTION_KEY=... docker compose --profile full up --build
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
