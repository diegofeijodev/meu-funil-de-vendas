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

## Estado

Task 0 (fundação da API + banco com todas as tabelas) concluída. Próximas: web (Task 1), marca/visão geral/configurações/agência, campanhas,
criativos, Instagram, anúncios, CRM — ver `docs/superpowers/plans/`.
