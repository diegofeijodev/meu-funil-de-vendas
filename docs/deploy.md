# Deploy do Meu Funil (Vercel + EC2)

Mesmo desenho do gestao-de-time: **web na Vercel** (pasta `web/`), **API + Postgres em contêineres no EC2 do Freela**
(`56.124.127.54`, mesma máquina do api-freela). Código no GitHub em `diegofeijodev/meu-funil-de-vendas`, branch **`stack-freela`**
(a `main` desse repositório é o protótipo do Lovable — não mexer). Hosts: `api-meufunil.freelaservicosapp.com.br` (API) e a URL
`*.vercel.app` do projeto (web). O domínio do protótipo (`meufunildevendas.com.br`) **não** é tocado aqui: trocar o DNS dele é uma virada
à parte (os dados do Lovable não são migrados — decisão do spec).

## 1. DNS (Locaweb, zona `freelaservicosapp.com.br`)

| Registro | Tipo | Valor |
|---|---|---|
| `api-meufunil` | A | `56.124.127.54` |

Sem o `A` o certbot não emite o certificado e a web não fala com a API.

## 2. EC2 — API e banco

```bash
# na sua máquina: empacota a árvore (sem node_modules/dist/uploads/.git/web) e manda
cd /home/doutor/coding/freela/meu-funil
tar czf /tmp/meufunil-src.tgz --anchored --exclude=api/uploads --exclude=api/coverage --exclude=api/.cache --exclude=api/.env \
  --exclude=api/dist --exclude=api/node_modules --no-anchored --exclude=node_modules --exclude=.git --exclude='*.log' \
  api docker-compose.prod.yml docs/deploy
tar tzf /tmp/meufunil-src.tgz | grep -E '(^|/)\.env|^api/uploads|node_modules'   # só os .env.example podem aparecer
scp /tmp/meufunil-src.tgz ubuntu@56.124.127.54:/tmp/
# no EC2
ssh ubuntu@56.124.127.54
sudo mkdir -p /opt/meu-funil && sudo chown ubuntu: /opt/meu-funil
cd /opt/meu-funil && tar xzf /tmp/meufunil-src.tgz && rm /tmp/meufunil-src.tgz
cp docs/deploy/.env.prod.example .env && chmod 600 .env   # preencha os segredos (openssl rand -hex 32) e as URLs
docker compose -f docker-compose.prod.yml up -d --build    # build no EC2; migrations rodam no boot
curl -s http://127.0.0.1:3015/health
# nginx + TLS (depois do DNS)
sudo cp docs/deploy/nginx-api-meufunil.conf /etc/nginx/sites-available/meufunil-api
sudo ln -sf /etc/nginx/sites-available/meufunil-api /etc/nginx/sites-enabled/meufunil-api
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d api-meufunil.freelaservicosapp.com.br --redirect -m tecnologia.3dfranquias@gmail.com --agree-tos -n
```

- `tar --exclude` **ancorado** (`--anchored --exclude=api/uploads`): sem âncora ele leva junto pastas de código com o mesmo nome, e
  `./api/uploads` não casa com os nomes dentro do tar (que começam em `api/`) — os uploads locais iriam junto.
- Tetos de memória no compose (API 1 GB, Postgres 384 MB): a máquina é do Freela de produção.
- **Banco nasce vazio** (só `prisma migrate deploy`; **nunca** `npm run seed` em produção). Cadastro é aberto: o 1º usuário cria a conta pela tela.
- `CREDENTIALS_ENCRYPTION_KEY` não muda depois de salvar credenciais (o cofre fica ilegível).

Atualizar depois: repita o `tar`/`scp`/`tar xzf` e `docker compose -f docker-compose.prod.yml up -d --build api`.
Rollback: antes de atualizar, `docker tag meufunil-api:latest meufunil-api:pre-AAAA-MM-DD`; para voltar,
`IMAGE_TAG=pre-AAAA-MM-DD docker compose -f docker-compose.prod.yml up -d --no-build api`.

## 3. Vercel — web

```bash
cd web
npx vercel link --yes --project meu-funil              # cria/associa o projeto (framework: Next.js)
npx vercel env add NEXT_PUBLIC_API_URL production      # https://api-meufunil.freelaservicosapp.com.br
npx vercel --prod                                      # build remoto (nada pesado nesta máquina)
```

Vercel Hobby **bloqueia** deploy quando o autor do último commit não é membro do time (`readyState BLOCKED`): faça o deploy de uma
cópia sem git (`tar` do `web/` sem `node_modules`/`.next`/`.env.local`, **com** `.vercel/`) e rode `npx vercel --prod --yes` nela.
Depois ponha a URL de produção da Vercel em `APP_URL` e `CORS_ORIGINS` no `.env` do EC2 e recrie a API
(`docker compose -f docker-compose.prod.yml up -d api`).

## 4. Chaves (depois do ar)

Sem chave nenhuma o app sobe e funciona sem IA nem integrações (as telas mostram "não conectado"). Por ordem de impacto:
1. **IA**: `AI_GATEWAY_URL` + `AI_GATEWAY_API_KEY` (gateway compatível com OpenAI) — ⚠️ cadastro aberto = qualquer conta gasta deste saldo.
   Alternativa sem custo central: cada empresa salva a própria chave OpenAI/Gemini em Integrações (BYO).
2. **Instagram/Meta**: `META_APP_ID` + `META_APP_SECRET` (app da Meta com o redirect `https://api-meufunil.freelaservicosapp.com.br/...` do contrato).
3. **Login com Google**: `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET`.
4. Resend (e-mail do CRM), Cal.com, Google Ads, TikTok, WhatsApp: conforme o uso.

## 5. Verificação

`curl https://api-meufunil.freelaservicosapp.com.br/health` → 200; `docker logs meufunil-api | grep "successfully started"`;
abrir a URL da Vercel, criar a conta, conferir o painel. Os smokes do repositório **não** rodam contra produção (a limpeza apaga dados).
