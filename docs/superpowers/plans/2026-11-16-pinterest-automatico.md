# Referências do Pinterest automáticas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Toda arte, post, vídeo e story de vaga recebe referência de estilo escolhida pelo assunto do pedido, sem ninguém configurar nada na hora, e a empresa enxerga e troca as referências na tela da Marca.

**Architecture:** Tudo continua no módulo `api/src/modules/style-refs` (notas de estilo em texto; o pixel de terceiro nunca vai ao gerador). A leitura fica mais rica (v2: `categorias`, `assunto`, `acabamento`) e falha transitória volta para a fila. A escolha das notas passa a olhar a categoria do pedido e cada peça grava quais referências seguiu. A "Seleção do Meu Funil" é uma empresa interna comum (`STYLE_LIBRARY_WORKSPACE_ID`), sem tabela nova. As vagas ganham um montador próprio só com paleta, luz e clima, atrás de um interruptor por empresa.

**Tech Stack:** NestJS 11 + Prisma + PostgreSQL (jest com `FakeTable`/`IgTable`, IA e fetch falsos), Next.js 15 + TanStack Query + zod (vitest em `src/**/*.test.ts`, browser-check em Playwright).

**Spec:** `docs/superpowers/specs/2026-11-16-pinterest-automatico-design.md` (v3, aprovado em 16/11) e `docs/superpowers/specs/2026-11-16-pinterest-automatico-ui.md` (textos de tela). Ramo `feat/pinterest-automatico`, base `d9fb28b`.

## Global Constraints

Fazem parte dos requisitos de **toda** tarefa: as decisões P1–P15 (o que o desenho deixou para quem constrói, §7) e as regras de sempre logo abaixo. Cada tarefa cita a decisão pelo número.

### Decisões do plano

- **P1. Tentativas da leitura (Fatia 0).** Coluna `style_references.attempts` (int, 0–3) = leituras que falharam de forma transitória. Nova leitura só depois de 10 min (trava vencida, `attempts = 0`), 30 min (`attempts = 1`) ou 3 h (`attempts = 2`), contados de `claimed_at`; na 3ª falha transitória vira `failed`. O filtro vai no `where` da consulta, não depois do `take`. Definitiva (vira `failed` na hora): resposta sem notas, formato fora do esperado ou recusa em **todas** as chaves (`format`, `rejected`, `other`), arquivo da imagem sumido. O resto é transitória: sem crédito, limite do dia, pedidos demais, fora do ar, tempo esgotado, rede, chave recusada, modelo indisponível, `AI_NOT_CONFIGURED` e erro do gateway. Para isso o `AiService` passa a lançar `AiKeysFailedError` (subclasse de `AiError`, mesma mensagem) com o caso de cada chave.
- **P2. Frase de falha.** A API continua gravando `"Não conseguimos ler o estilo desta referência. Remova e tente outra."` em `error`. O painel novo não lê `error`: escreve o texto do ui.md pelo `status` e pelo `attempts`.
- **P3. Leitura v2.** `paleta` até 4 cores de até 20 letras. `luz` até 70 letras; `clima`, `enquadramento` e `composicao` até 80 cada. `acabamento` até 300. `assunto` com até 6 palavras e 50 letras. `categorias` com até 3 ids da lista fechada. `evitar` com até 3 itens de 30 letras. Tudo passa por `cleanFree`, que muda de `creative/video-director.ts` para `api/src/common/text/clean-free.ts`; o `video-director` reexporta, para `style-refs` não depender de `creative`.
- **P4. Linha de cada nota.** O formato é `"{i}) [{rótulo1}, {rótulo2}] «{partes separadas por '; '}»"`, com os rótulos entrando só na Fatia 3 e no máximo 2. As partes entram em ordem de prioridade: `assunto`, `paleta`, `luz`, `acabamento`, `clima`, `enquadramento`, `composição`, `evitar`. A parte que não cabe nos 600 é pulada e as seguintes ainda são tentadas. Com os tetos da P3, rótulos + `assunto` + `paleta` + `luz` + `acabamento` somam no máximo 592: o corte nunca cai em `assunto` nem em `acabamento`, e no pior caso só `clima` e as seguintes saem. Nota reduzida (sem categoria em comum, Fatia 3) = só `paleta` e `luz`.
- **P5. Bloco.** É o cabeçalho, depois as linhas separadas por um espaço, tudo ≤ 2500 **contando o cabeçalho**. Entram até 4 notas; a primeira que não cabe encerra o bloco. Cabeçalho final (fixo desde a Fatia 1): `INSPIRAÇÃO DE ESTILO (referências da marca; não copie composição, pessoas, marcas nem textos; use cores, luz, clima e acabamento só das que combinam com o briefing):`. Com 4 notas no teto entram 3.
- **P6. Registro por peça.** Coluna nova `style_refs jsonb` em `creatives` e em `ig_posts`, no formato `{ "own": [uuid], "library": [uuid], "brand_id": uuid|null }`. `null` quer dizer peça antiga ou prompt escrito à mão (o diretor não rodou), e a tela não mostra a linha. Fora do `creative_brief` porque o `PATCH ig-posts` deixa o cliente reescrever o brief. O vídeo assíncrono do Estúdio leva o registro em `creative_generation_jobs.options.style_refs`.
- **P7. Lista de categorias.** Os ids e rótulos nascem na Fatia 1 (a leitura já marca as categorias). O dicionário e `subjectCategories` entram na Fatia 3. Tabela na Task 2 (ids e rótulos) e na Task 8 (sinônimos).
- **P8. Pedido sem categoria reconhecida.** Toda nota entra completa, como hoje. Nota sem `categorias` (v1, ou a IA não marcou nenhuma) num pedido com categoria entra reduzida, como o desenho manda.
- **P9. Campanha na escolha.** As notas da campanha ficam com no máximo 2 das 4 vagas enquanto houver nota da marca. Vaga que sobra é preenchida com as notas restantes da campanha.
- **P10. Assunto por chamador.** `styleSubject(...partes)` junta as partes com espaço, até 500 letras. Post e vídeo: tema, gancho, pedido e produto. Estúdio e piloto (via `directArt`): título, pedido, `offer_product` e ângulo; o título do piloto já é "campanha · ângulo". Vagas: `Vaga de {função}`.
- **P11. Seleção do Meu Funil.** **[SUBSTITUÍDA em 17/11 pelas P16–P30 — sem empresa central; ver "Rodada 2" no fim]** `brands.style_library_enabled` (bool, padrão `true`) e `brands.style_library_segment` (text nulo) têm três estados: `NULL` = automático pelo texto de `brands.segment`, id de categoria = escolhido, `'none'` = "Nenhum desses". Na empresa Biblioteca, cada marca leva em `style_library_segment` o ramo que ela serve, e o ramo usa as prontas de **todas** as marcas da Biblioteca com aquele valor. Os ramos oferecidos são os que têm ao menos 1 pronta. A chave só fica ativa com `STYLE_LIBRARY_ENABLED=true`, `STYLE_LIBRARY_WORKSPACE_ID` preenchido e a empresa ≠ a Biblioteca; mal configurada, não faz nada e não derruba a geração. O bloqueio de exclusão vale sempre que o id estiver preenchido.
- **P12. Textos que o ui.md não traz** (passar pelo ux-designer antes de divulgar):
  - ~~Bloqueio de exclusão~~ (sai em 17/11 com a empresa central, P28).
  - Linha fixa do painel na campanha: `"Pin colado aqui vale só para esta campanha. Pasta ou perfil vale para a marca inteira."`
  - Convite com 1 referência: `"Estilo: seguiu 1 referência sua."`
  - Convite só com a seleção: `"Estilo: seguiu a Seleção do Meu Funil."`, com o mesmo botão.
  - Região viva: `"Lendo o estilo…"`, `"Referência pronta. O estilo já está em uso."`, `"Não conseguimos ler uma referência."`
  - Pasta sem título: `"Pasta do Pinterest"`.
  - Foto da marca na grade: `"Foto de: {tipo}"`, ou `"Foto da sua marca"` sem tipo.
  - Envio de várias fotos: `"{n} fotos enviadas. Elas podem aparecer nas artes."`
- **P13. Pacote do piloto.** As miniaturas têm 56 px, então o convite vira uma linha só, embaixo da lista de peças. Ela mostra o maior `own` entre as peças prontas com registro.
- **P14. Vagas.** A foto usa a mesma escolha de notas (`pickNotes`, com próprias e seleção; assunto `Vaga de {função}`). Nota completa dá `paleta`, `luz` e `clima`; nota reduzida dá `paleta` e `luz`. O `loadPhotoStyle` junta os itens sem repetição, até 8 por lista. O `photoStyleLines` **filtra primeiro** e depois fica com até 4 cores, 2 luzes e 2 climas. O filtro compara cada item depois de `normalizeText` (minúsculas, sem acento):
  - Sai o item com uma **palavra inteira** de negação: `sem`, `nao`, `nada`, `nenhum`, `nenhuma`, `nunca`, `evite`, `evitar`, `exceto`.
  - Sai o item com uma palavra que **começa** por um radical de objeto com escrita: `cardapi`, `letreir`, `placa`, `garraf`, `rotul`, `texto`, `letra`, `logo`, `marca`, `neon`, `menu`, `quadro`, `lousa`, `embalag`, `etiquet`, `palavra`, `numero`, `fachad`, `cartaz`. O radical pega plural e derivados ("garrafas", "letreiros", "rotulos", "cartazes").
  - Se nada sobrar, a foto sai sem estilo e o registro fica vazio.
  - "Em uso" nos Ajustes = `pickNotes(...).length` sem assunto (próprias + seleção, até 4).
- **P15. Reler notas antigas.** É um SQL no roteiro de subida (flag `--reler-notas-v1`), não um script TS. Produção tem zero notas hoje.

### Regras de sempre

- Anti-objetivos 1–3 do desenho: a imagem do Pinterest nunca vai como pixel ao gerador, à Biblioteca de mídia, à Meta ou ao Instagram; nada de busca interna nem raspagem do Pinterest; texto, marca, logotipo ou pessoa da referência não aparecem na arte.
- Orçamento: nota ≤ 600 letras, bloco ≤ 2500, até 4 notas, corte sempre na fronteira de uma nota. `style_notes.v = 2`; nota sem `v` continua válida.
- `CLAUDE.md` da raiz: contrato `docs/api-contract.md` atualizado **antes** do código de cada tarefa que muda rota ou resposta; wire snake_case; erros `{ error: { code, message } }`; toda rota de workspace com `WorkspaceAccessGuard`/`WorkspaceAccessService.require` e todo id conferido no workspace; flag nova em `env.validation.ts` + `api/.env.example` + `docker-compose.yml` (+ `docs/deploy/.env.prod.example`, produção usa `env_file`).
- Padrões: `STYLE_LIBRARY_ENABLED=false`; `brands.style_library_enabled = true`; interruptor das vagas desligado; tudo que é novo nasce sem efeito em produção até alguém ligar.
- Migrações aditivas, escritas à mão em `api/prisma/migrations/2026111612xxxx_nome/migration.sql` + `schema.prisma` editado à mão; nunca editar migração aplicada. Aplicar local com `cd api && bash ../scripts/run-capped.sh 1500 npx prisma migrate deploy && bash ../scripts/run-capped.sh 1500 npx prisma generate` (Postgres local: `docker compose up -d postgres` na raiz).
- As tabelas em memória dos testes não aplicam default do banco: toda coluna nova entra nos defaults do `FakeTable`/`IgTable`/`MemTable` que a tabela usa.
- Nenhum teste faz rede (IA, fetch e vitrine falsos).
- Baixo consumo: um comando pesado por vez, sempre por `scripts/run-capped.sh`; nas tarefas só jest/vitest focado no arquivo; `tsc`, lint, smoke e browser-check só na Task 15. Nunca `npm run build`/`next build`.
- Textos de tela copiados **exatos** do ui.md; o que não está lá é a P12. "Referência" vale só para estilo; foto própria é "foto da sua marca".
- Commits em Conventional Commits pt-BR, um por tarefa (ou mais), terminando com a linha `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Fora desta versão: busca por palavra no Pinterest, vídeo como referência, trocar a marca das vagas pela tela, miniaturas da Seleção para as empresas.

## Review Focus

1. **Chave da empresa sem saldo por horas.** A referência continua em "Tentando de novo sozinho" e só vira `failed` depois de 3 tentativas espaçadas (30 min, depois 3 h), nunca na 1ª rodada do job. Teste na Task 1.
2. **Muitas referências esperando a vez.** Elas não podem travar as novas: 12 linhas em espera na frente e a nova ainda é lida na mesma rodada. Teste na Task 1.
3. **4 notas longas, no teto de cada campo.** O bloco fica ≤ 2500, entra a 3ª e não a 4ª, e nenhuma linha perde `assunto` ou `acabamento`. Teste na Task 2.
4. **Prompt escrito à mão** (`visual_prompt_override` ou direção editada sem ajuste). A peça não diz "seguiu N referências" (registro `null`). Testes na Task 3.
5. **Nota com negação ou objeto com escrita na foto da vaga** ("sem sombras", "letreiro luminoso", "rosa neon"). Essas frases não chegam ao gerador e o pedido ainda termina em "Sem nenhum texto…". Teste na Task 13.

---

## Mapa de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `api/src/common/text/clean-free.ts` (novo) | `cleanFree` (movido de `creative/video-director.ts`, que reexporta) |
| `api/src/modules/ai/ai-error.ts` | `AiKeysFailedError` com o caso de cada chave |
| `api/src/modules/style-refs/categories.ts` (novo) | lista fechada de categorias, sinônimos, `subjectCategories`, `subjectWords`, `styleSubject` |
| `api/src/modules/style-refs/style-notes.ts` | notas v2, prompt, normalização, linha/bloco com orçamento, registro, estilo da foto |
| `api/src/modules/style-refs/style-pick.ts` (novo) | ordem de escolha pura (campanha → categoria → assunto → mais novas; complemento da seleção) |
| `api/src/modules/style-refs/style-refs.service.ts` | fila com tentativas, lista da tela, `loadStyleNotes`, seleção, `loadPhotoStyle`, `notesInUse` |
| `api/src/modules/creative/{refs,creative}.service.ts`, `instagram/media-generation.service.ts` | assunto e registro por peça |
| `api/src/modules/vacancy-stories/{vacancy-prompts,vacancy-generator.service,vacancy-settings.service,vacancy-stories.dto}.ts` | foto das vagas com estilo, interruptor e Ajustes |
| `api/src/modules/workspaces/{workspace-deletion,workspace-deletion.service,features.service}.ts` | bloqueio da Biblioteca e `features.style_library` |
| `web/src/lib/style-refs.ts` (novo) + `.test.ts` | textos e regras puras do painel, convite e seleção |
| `web/src/components/style-refs-panel.tsx`, `components/style-invite.tsx` (novo), `components/style-library.tsx` (novo) | painel, convite e Seleção |
| `web/src/app/(app)/brands/[id]/BrandDetail.tsx`, `campaigns/[id]/CampaignDetail.tsx`, `studio/StudioPage.tsx`, `components/instagram/approvals.tsx`, `components/pilot/pilot-panel.tsx`, `components/instagram/vacancies/settings-panel.tsx` | onde as telas mudam |

---

### Task 1: Fatia 0 — falha transitória da leitura volta para a fila (até 3 tentativas)

**Files:**
- Create: `api/prisma/migrations/20261116120000_style_ref_attempts/migration.sql`
- Modify: `api/prisma/schema.prisma:1479-1503` (`style_references.attempts`), `api/src/modules/ai/ai-error.ts`, `api/src/modules/ai/ai.service.ts:193-204` (`requireGatewayOr`), `api/src/modules/style-refs/style-refs.service.ts:236-265` (`processPending`), `docs/api-contract.md:960`
- Test: `api/src/modules/ai/__tests__/ai.service.spec.ts`, `api/src/modules/style-refs/__tests__/style-refs.service.spec.ts`

**Interfaces:**
- Produces: `export type KeyFailureKind = VendorFailureKind | 'format' | 'other'`; `export class AiKeysFailedError extends AiError { constructor(message: string, readonly failures: { vendor: AiVendor; kind: KeyFailureKind }[]) }` em `ai-error.ts`.
- Produces: `export function isTransientReadError(e: unknown): boolean` em `style-refs.service.ts` (exportada para teste); constantes `READ_MAX_ATTEMPTS = 3`, `RETRY_AFTER_MS = [10 * 60_000, 30 * 60_000, 3 * 3600_000]`.
- Produces (linha): `RefRow.attempts: number`; `StyleRefView` ganha `attempts: number` na Task 4.

- [ ] **Step 1: Contrato.** Em `docs/api-contract.md` §28, troque a frase do job (linha 960) por: `Job style-refs-15min (*/15 * * * *): renova até 3 pastas com mais de 24 h (Pinterest fora do ar → last_error "O Pinterest não respondeu agora. Tentamos de novo amanhã.", as referências antigas continuam) e lê o estilo de até 10 pendentes (trava otimista claimed_at). Falha transitória (sem crédito, limite, pedidos demais, fora do ar, tempo esgotado, rede, chave recusada, modelo indisponível, sem IA configurada) volta para a fila com attempts + 1 e nova leitura depois de 30 min (attempts = 1) ou 3 h (attempts = 2); na 3ª vira failed. Falha definitiva (resposta sem notas, formato/recusa em todas as chaves, imagem sumida) vira failed na hora. failed → error "Não conseguimos ler o estilo desta referência. Remova e tente outra."` No §6 (IA), acrescente: `Sem gateway, a falha das chaves próprias sai como AiKeysFailedError (subclasse de AiError, mesma mensagem) com failures: [{ vendor, kind }] — kind = caso do vendor-failure ou format (resposta fora do formato) ou other (outro erro da IA).`

- [ ] **Step 2: Testes que falham — `ai.service.spec.ts`.**

```ts
it('sem gateway: a falha das chaves sai como AiKeysFailedError com o caso de cada uma (mensagem igual)', async () => {
  // reaproveita o cenário "sem gateway: chave própria que falha…" (401 OpenAI + NO_QUOTA Gemini)
  const e = await ai.json(WS, { prompt: 'P', schema, name: 'n' }).catch((x) => x);
  expect(e).toBeInstanceOf(AiKeysFailedError);
  expect(e.failures).toEqual([{ vendor: 'openai', kind: 'refused' }, { vendor: 'gemini', kind: 'noCredit' }]);
  expect(e.getResponse().message).toBe('Nenhuma IA funcionou: a chave do ChatGPT (OpenAI) foi recusada e a conta do Gemini (Google) está sem créditos. Confira as chaves em Integrações.');
});
it('resposta fora do formato → kind format; fetch que lança (rede/tempo) → kind down', async () => {
  // OpenAI responde chat('sem json'); Gemini: o fetch lança new TypeError('fetch failed')
  expect(e.failures).toEqual([{ vendor: 'openai', kind: 'format' }, { vendor: 'gemini', kind: 'down' }]);
});
```

- [ ] **Step 3: Testes que falham — `style-refs.service.spec.ts`.** No `setup()`, acrescente `attempts: 0` aos defaults de `style_references`. Troque o teste existente `'falha da visão: só aquela fica "failed"…'` (linhas 78-87) para provocar falha **definitiva** com `ai.json.mockResolvedValueOnce({})` no lugar de `mockRejectedValueOnce(new Error('caiu'))`; as asserções continuam. Novo `describe('StyleRefsService — falha transitória da leitura (Fatia 0)')`:

```ts
const noCredit = () => new AiKeysFailedError('Sua conta OpenAI está sem créditos…', [{ vendor: 'openai', kind: 'noCredit' }]);
it('sem crédito: volta para a fila (attempts 1, sem erro) e só relê depois de 30 min', async () => {
  // upload; ai.json.mockRejectedValueOnce(noCredit()); processPending(5)
  expect(row).toMatchObject({ status: 'processing', attempts: 1, error: null });
  expect(await svc.processPending(5)).toBe(0);           // ainda dentro dos 30 min
  row.claimed_at = new Date(Date.now() - 31 * 60_000);
  expect(await svc.processPending(5)).toBe(1);
  expect(row).toMatchObject({ status: 'ready' });
  expect(ai.json).toHaveBeenCalledTimes(2);
});
it('3 falhas transitórias espaçadas → failed com a frase e attempts 3', async () => {
  // 3× noCredit; antes da 2ª e da 3ª, recue claimed_at 31 min e 3 h + 1 min
  expect(row).toMatchObject({ status: 'failed', attempts: 3, error: 'Não conseguimos ler o estilo desta referência. Remova e tente outra.' });
});
it('tempo esgotado e rede (erro que não é da IA) são transitórios; AI_NOT_CONFIGURED também', () => {
  expect(isTransientReadError(Object.assign(new Error('aborted'), { name: 'TimeoutError' }))).toBe(true);
  expect(isTransientReadError(new TypeError('fetch failed'))).toBe(true);
  expect(isTransientReadError(new AiError(NO_AI_MESSAGE, 'AI_NOT_CONFIGURED'))).toBe(true);
  expect(isTransientReadError(new AiKeysFailedError('x', [{ vendor: 'openai', kind: 'format' }, { vendor: 'gemini', kind: 'noCredit' }]))).toBe(true);
  expect(isTransientReadError(new AiKeysFailedError('x', [{ vendor: 'openai', kind: 'format' }, { vendor: 'gemini', kind: 'rejected' }]))).toBe(false);
});
it('definitiva na hora: arquivo da imagem sumido → failed com attempts 0', async () => { /* files.delete antes do processPending */ });
it('Review Focus #2: 12 linhas esperando a vez não travam a nova', async () => {
  // 12 linhas processing, attempts 1, claimed_at = agora, created_at mais antigos; depois 1 upload novo
  expect(await svc.processPending(10)).toBe(1);
  expect(newRow.status).toBe('ready');
});
```

- [ ] **Step 4: Rodar e ver falhar.** `cd api && bash ../scripts/run-capped.sh 1500 npx jest src/modules/ai/__tests__/ai.service.spec.ts` e depois `bash ../scripts/run-capped.sh 1500 npx jest src/modules/style-refs/__tests__/style-refs.service.spec.ts`. Esperado: FAIL (`AiKeysFailedError` não existe; `attempts` indefinido).

- [ ] **Step 5: Migração.** `20261116120000_style_ref_attempts/migration.sql`: comentário de 2 linhas com o porquê (Fatia 0, 16/11/2026); `ALTER TABLE "style_references" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;` e `ALTER TABLE "style_references" ADD CONSTRAINT "style_references_attempts_check" CHECK ("attempts" BETWEEN 0 AND 3);`. `schema.prisma`: `attempts Int @default(0)` depois de `claimed_at`. Aplicar e gerar (comando das Global Constraints).

- [ ] **Step 6: Implementar.**
  - `AiService.requireGatewayOr` lança `AiKeysFailedError(mesma mensagem de hoje, fails.map(f => ({ vendor: f.vendor, kind: kindOf(f.error) })))` nos dois ramos (1 falha e 2 falhas). `kindOf`: `VendorKeyError` → `e.kind`; `AiError` com `FORMAT_MSG` → `'format'`; outro `AiError` → `'other'`; o resto → `'down'`. Sem chave nenhuma continua `AiError(NO_AI_MESSAGE, 'AI_NOT_CONFIGURED')`.
  - `isTransientReadError(e)`: `AiKeysFailedError` → `true` se algum `kind` ∉ {`format`, `rejected`, `other`}; qualquer outro erro → `true`. A falha definitiva própria do serviço é uma classe interna `ReadDefinitive extends Error`, lançada por "notas vazias" e pela falha de `files.read`, e `processPending` a testa antes de chamar `isTransientReadError`.
  - `processPending(limit)`: `findMany({ where: { status: 'processing', OR: [{ claimed_at: null }, ...RETRY_AFTER_MS.map((ms, i) => ({ attempts: i, claimed_at: { lt: new Date(now - ms) } }))] }, orderBy: { created_at: 'asc' }, take: limit })`. A trava continua condicional a `claimed_at`. Na falha transitória com `r.attempts + 1 < 3`, faz `updateMany({ where: { id, claimed_at: <da trava> }, data: { attempts: r.attempts + 1, claimed_at: new Date(), error: null } })` (sem `increment`: o `FakeTable` não o entende). Na 3ª falha transitória ou na definitiva: `status: 'failed', error: MSG_READ_FAILED`, e `attempts: 3` só na 3ª transitória. O `logger.warn` continua.

- [ ] **Step 7: Rodar e ver passar.** Os dois comandos do Step 4. Esperado: PASS.

- [ ] **Step 8: Commit.**

```bash
git add api/prisma docs/api-contract.md api/src/modules/ai api/src/modules/style-refs
git commit -m "fix(style-refs): falha transitória da leitura volta para a fila (até 3 tentativas)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2: Fatia 1 — leitura v2 (categorias, assunto, acabamento) e bloco com orçamento por nota

**Files:**
- Create: `api/src/common/text/clean-free.ts`, `api/src/modules/style-refs/categories.ts`, `api/src/modules/style-refs/__tests__/style-notes.spec.ts`
- Modify: `api/src/modules/creative/video-director.ts:98-103` (reexporta `cleanFree`), `api/src/modules/style-refs/style-notes.ts`, `api/src/modules/style-refs/style-refs.service.ts:144-156,254-257`, `api/src/modules/creative/refs.service.ts:56-66`, `docs/api-contract.md` §28
- Test: `style-notes.spec.ts` (novo), `style-refs.service.spec.ts`, `style-notes-in-briefs.spec.ts`

**Interfaces:**
- Produces (`categories.ts`): `export const STYLE_CATEGORY_IDS = [...] as const`; `export type StyleCategoryId = (typeof STYLE_CATEGORY_IDS)[number]`; `export const STYLE_CATEGORY_LABEL: Record<StyleCategoryId, string>`; `export function isStyleCategory(v: unknown): v is StyleCategoryId`.
- Produces (`style-notes.ts`):
  - `StyleNotes = { v?: 2; paleta: string[]; composicao: string; luz: string; enquadramento: string; clima: string; evitar: string[]; categorias: StyleCategoryId[]; assunto: string; acabamento: string }`
  - `StyleRefsUsed = { own: string[]; library: string[] }`; `StylePick = { text: string; used: StyleRefsUsed }`; `StyleRefsRecord = StyleRefsUsed & { brand_id: string | null }`
  - `NOTE_MAX = 600`, `BLOCK_MAX = 2500`, `MAX_NOTES = 4`, `STYLE_NOTES_HEADER` (texto da P5)
  - `noteLine(index: number, n: StyleNotes, opts?: { full?: boolean; labels?: string[] }): string`
  - `styleNotesText(items: { id: string; notes: StyleNotes; full?: boolean; labels?: string[] }[]): { text: string; ids: string[] } | null`
  - `styleRecord(pick: StylePick | null, brandId: string | null | undefined): StyleRefsRecord`; `asStyleRefsRecord(v: unknown): StyleRefsRecord | null`
- Produces (serviço): `StyleRefsService.loadStyleNotes(ws: string, brandId: string | null | undefined, campaignId?: string | null): Promise<StylePick | null>`; `RefsService.loadStyleNotes(...)` com o mesmo retorno (erro → `null` + aviso no log, como hoje). A Task 8 acrescenta o 4º parâmetro `subject`.

Categorias (P7), id → rótulo (≤ 20 letras): `comida_hamburguer` hambúrguer e lanches · `comida_pizza` pizza e massas · `comida_japonesa` comida japonesa · `comida_churrasco` churrasco e espeto · `comida_caseira` comida caseira · `frutos_do_mar` frutos do mar · `doces` doces e bolos · `acai_sorvete` açaí e sorvete · `cafe_padaria` café e padaria · `comida_saudavel` comida saudável · `bebida_bar` bebida e bar · `ambiente` ambiente e salão · `pessoas_trabalhando` pessoas trabalhando · `equipe_vagas` equipe e vagas · `produto_destaque` produto em destaque · `beleza` beleza e estética.

- [ ] **Step 1: Contrato §28.** Primeiro parágrafo: as notas passam a ser `paleta, composicao, luz, enquadramento, clima, evitar` + v2 `categorias` (até 3 ids de `style-refs/categories.ts`), `assunto` (até 6 palavras) e `acabamento` (até 300 letras), com `v: 2` (nota sem `v` vale). O texto ao diretor fica `"INSPIRAÇÃO DE ESTILO (referências da marca; não copie composição, pessoas, marcas nem textos; use cores, luz, clima e acabamento só das que combinam com o briefing): 1) «…» 2) «…»"`, com até 4 notas de até 600 letras cada, bloco ≤ 2500 contando o cabeçalho e corte na fronteira da nota. Ordem: da campanha primeiro, depois as mais novas da marca. `loadStyleNotes` devolve `{ text, used: { own, library } }`.

- [ ] **Step 2: Testes que falham — `style-notes.spec.ts`.**

```ts
const cap = (n: number) => 'x'.repeat(n);
const FULL: StyleNotes = { v: 2, paleta: ['a'.repeat(20), 'b'.repeat(20), 'c'.repeat(20), 'd'.repeat(20)], composicao: cap(80), luz: cap(70), enquadramento: cap(80), clima: cap(80), evitar: [cap(30), cap(30), cap(30)], categorias: ['comida_hamburguer', 'bebida_bar', 'ambiente'], assunto: cap(50), acabamento: cap(300) };

it('normaliza v2: categorias só da lista (até 3), assunto até 6 palavras/50 letras, acabamento até 300, paleta até 4 × 20, sem « » nem controle', () => {
  const n = normalizeStyleNotes({ paleta: ['laranja «queimado»', 'creme', 'preto', 'branco', 'azul'], luz: 'quente\nde lado', clima: 'aconchegante', categorias: ['comida_hamburguer', 'xyz', 'bebida_bar', 'ambiente', 'doces'], assunto: 'hambúrguer artesanal no balcão de madeira escura agora', acabamento: cap(400) })!;
  expect(n.paleta).toEqual(['laranja queimado', 'creme', 'preto', 'branco']);
  expect(n.luz).toBe('quente de lado');
  expect(n.categorias).toEqual(['comida_hamburguer', 'bebida_bar', 'ambiente']);
  expect(n.assunto).toBe('hambúrguer artesanal no balcão de madeira');
  expect(n.acabamento).toHaveLength(300);
});
it('nota v1 (sem v nem campos novos) continua válida', () => {
  expect(normalizeStyleNotes({ paleta: ['laranja'], luz: 'quente' })).toMatchObject({ categorias: [], assunto: '', acabamento: '' });
});
it('o prompt pede os campos novos no TEXTO (a chave própria não recebe o schema) e lista os ids', () => {
  for (const w of ['categorias', 'assunto', 'acabamento', ...STYLE_CATEGORY_IDS]) expect(STYLE_NOTES_PROMPT).toContain(w);
  expect(STYLE_NOTES_SCHEMA.required).toEqual(expect.arrayContaining(['categorias', 'assunto', 'acabamento']));
});
it('linha no teto: ≤ 600, mantém assunto e acabamento; só as partes de menor prioridade saem', () => {
  const l = noteLine(1, FULL, { labels: ['hambúrguer e lanches', 'bebida e bar'] });
  expect(l.length).toBeLessThanOrEqual(600);
  expect(l).toMatch(/^1\) \[hambúrguer e lanches, bebida e bar\] «assunto x+; paleta /);
  expect(l).toContain(`acabamento ${cap(300)}`);
  expect(l).not.toContain('evitar');
});
it('nota reduzida = só paleta e luz', () => {
  expect(noteLine(2, FULL, { full: false })).toBe(`2) «paleta ${FULL.paleta.join(', ')}; luz ${cap(70)}»`);
});
it('Review Focus #3: 4 notas no teto → bloco ≤ 2500 com o cabeçalho, entram 3, corte na fronteira', () => {
  const r = styleNotesText(['r1', 'r2', 'r3', 'r4'].map((id) => ({ id, notes: FULL, labels: ['hambúrguer e lanches', 'bebida e bar'] })))!;
  expect(r.text.startsWith(`${STYLE_NOTES_HEADER} 1) `)).toBe(true);
  expect(r.text.length).toBeLessThanOrEqual(2500);
  expect(r.ids).toEqual(['r1', 'r2', 'r3']);
  expect(r.text).not.toContain(' 4) ');
});
it('registro: styleRecord e asStyleRefsRecord', () => {
  expect(styleRecord(null, 'b1')).toEqual({ own: [], library: [], brand_id: 'b1' });
  expect(asStyleRefsRecord({ own: ['a'], library: [], brand_id: null })).toEqual({ own: ['a'], library: [], brand_id: null });
  expect(asStyleRefsRecord('x')).toBeNull();
});
```

- [ ] **Step 3: Testes que falham — serviço e diretores.**
  - `style-refs.service.spec.ts`: `NOTES` ganha `categorias: ['comida_hamburguer'], assunto: 'hambúrguer no balcão', acabamento: 'madeira escura, fundo desfocado'`. O teste `'loadStyleNotes: só as prontas…'` passa a esperar `pick.text` começando por `` `${STYLE_NOTES_HEADER} 1) «assunto hambúrguer no balcão; paleta laranja, creme` `` e `pick.used` igual a `{ own: [<id>], library: [] }`. Teste novo `'processPending grava v: 2'`, com `style_notes` contendo `{ v: 2, acabamento: 'madeira escura, fundo desfocado' }`. Teste novo `'empresa A não lê notas de B'`: insira uma nota pronta com `workspace_id = OTHER` e `brand_id = OTHER_BRAND`; espere `loadStyleNotes(WS, OTHER_BRAND, null)` → `null` e `loadStyleNotes(OTHER, OTHER_BRAND, null)` → texto. Teste novo `'até 4 notas, as da campanha primeiro'`: 6 prontas (2 da campanha, 4 da marca) devolvem `used.own` com as 2 da campanha e depois as 2 mais novas da marca.
  - `style-notes-in-briefs.spec.ts`: `NOTES = styleNotesText([{ id: 'r1', notes: { paleta: ['laranja'], composicao: 'centro', luz: 'quente', enquadramento: 'perto', clima: 'aconchegante', evitar: [], categorias: [], assunto: '', acabamento: 'madeira' } }])!.text`. As asserções existentes ficam.

- [ ] **Step 4: Rodar e ver falhar.** `cd api && bash ../scripts/run-capped.sh 1500 npx jest src/modules/style-refs` (os 5 arquivos da pasta). Esperado: FAIL.

- [ ] **Step 5: Implementar.**
  - `cleanFree` vai inteiro para `common/text/clean-free.ts`; `video-director.ts` faz `export { cleanFree } from '../../common/text/clean-free'` e importa de lá.
  - `normalizeStyleNotes`: aplica os tetos da P3 com `cleanFree`. `assunto` = primeiras 6 palavras, cortado em 40. `categorias` filtradas por `isStyleCategory`, sem repetição, até 3. Devolve `null` só quando nada útil, como hoje.
  - `STYLE_NOTES_SCHEMA`: `categorias` (`{ type: 'array', items: { type: 'string', enum: [...STYLE_CATEGORY_IDS] } }`), `assunto` e `acabamento` (string) em `properties` e `required`.
  - `STYLE_NOTES_PROMPT` (texto exato decidido pelo plano): troque a linha da paleta por `'- paleta: até 4 cores em palavras (ex.: "laranja queimado");'` e acrescente antes de `evitar`:
    - `'- categorias: de 1 a 3 destes códigos, os que dizem o assunto da imagem: {id (rótulo), …};'`
    - `'- assunto: o que a imagem mostra, em até 6 palavras, sem marca nem nome;'`
    - a linha da `luz` fica `'- luz: tipo e direção da luz, em até 10 palavras;'`
    - `'- acabamento: até 300 letras sobre superfície, tipo de fundo, profundidade de campo e textura (não descreva onde ficam os elementos nem as pessoas);'`
  - `noteLine`/`styleNotesText` seguem a P4 e a P5. Cada parte é `"<nome> <valor>"` (`composição` com acento no rótulo) e as listas vão juntas por `", "`.
  - `processPending` grava `{ ...notes, v: 2 }`. `loadStyleNotes`: prontas da marca no workspace (consulta de hoje), as da campanha primeiro, depois as mais novas, até `MAX_NOTES`. Monta com `styleNotesText`; `used.own` = `ids` devolvidos e `library: []`. `RefsService.loadStyleNotes` repassa o novo retorno.
  - Callers que só leem o texto até a Task 3: `creative.service.ts:127` e `media-generation.service.ts:404,547` usam `(await this.refs.loadStyleNotes(...))?.text ?? null`. O mock de `instagram/__tests__/harness.ts:314` continua `async () => null`.

- [ ] **Step 6: Rodar e ver passar.** O comando do Step 4, mais `bash ../scripts/run-capped.sh 1500 npx jest src/modules/creative/__tests__/video-director.spec.ts`. Esperado: PASS.

- [ ] **Step 7: Commit.** `feat(style-refs): leitura v2 com categorias, assunto e acabamento e bloco com orçamento por nota` + linha Co-Authored-By.

### Task 3: Fatia 1 — cada arte, post e vídeo guarda quais referências seguiu

**Files:**
- Create: `api/prisma/migrations/20261116121000_style_refs_record/migration.sql`
- Modify: `api/prisma/schema.prisma` (`creatives.style_refs`, `ig_posts.style_refs`), `api/src/modules/creative/creative.service.ts:110-138` (`directArt`), `:479-559` (`runArtDirected`), `:307-429` (`finalizeWith`), `:440-475` (poller), `:38` (`RunGenerationInput`), `api/src/modules/instagram/media-generation.service.ts:375-428` (`startVideo`), `:537-592` (imagem/carrossel), `docs/api-contract.md` §19.1 e §22.1
- Test: `api/src/modules/creative/__tests__/creative.service.spec.ts`, `api/src/modules/creative/__tests__/world.ts` (default `style_refs: null` em `creatives`), `api/src/modules/instagram/__tests__/media-generation.spec.ts`, `api/src/modules/instagram/__tests__/harness.ts:168` (default `style_refs: null` em `ig_posts`)

**Interfaces:**
- Consumes: `StylePick`, `StyleRefsRecord`, `styleRecord`, `asStyleRefsRecord` (Task 2).
- Produces: `directArt(...)` → `{ ad: ArtDirection; brief: ArtBrief; styleRefs: StyleRefsRecord | null }` (`null` quando a direção editada é reaproveitada sem ajuste). `RunGenerationInput.styleRefs?: StyleRefsRecord | null` (ausente = não mexe na coluna). Job do Estúdio: `options.style_refs`.

- [ ] **Step 1: Contrato.** No §19.1, a linha `GET /creatives` ganha: `style_refs` (jsonb | null, 16/11/2026) = `{ own: uuid[], library: uuid[], brand_id }`, as referências de estilo que o diretor seguiu (próprias e da Seleção); `null` = peça anterior ou prompt escrito à mão; gravado só pelo servidor. No §22.1, a linha `GET /ig-posts` ganha o mesmo `style_refs`, e a linha `PATCH /ig-posts/:id` diz que o campo não é aceito (`400 VALIDATION_ERROR`).

- [ ] **Step 2: Testes que falham.**
  - `creative.service.spec.ts`, `describe('registro do estilo (Fatia 1)')`:
    - `'imagem: o criativo guarda own/library/brand_id do que o diretor seguiu'`: `jest.spyOn(RefsService.prototype, 'loadStyleNotes').mockResolvedValue({ text: 'INSPIRAÇÃO…', used: { own: ['r1', 'r2'], library: [] } })`. Gere uma imagem com marca e espere a linha de `creatives` com `style_refs` igual a `{ own: ['r1', 'r2'], library: [], brand_id: <marca> }`.
    - `'Review Focus #4: direção editada reaproveitada sem ajuste → style_refs null'`: chama `generate` com `visualPrompt` e `artDirection` e sem `adjust`, e espera `style_refs` `null`.
    - `'vídeo assíncrono: o registro vai no options do job e o poller grava no criativo'`: espere `job.options.style_refs` igual ao registro e o criativo criado pelo `pollPendingCreatives` com o mesmo `style_refs`.
    - `'sem referência pronta → { own: [], library: [], brand_id }'`.
  - `media-generation.spec.ts`, `describe('registro do estilo (Fatia 1)')`. O `refs.loadStyleNotes` falso devolve `{ text: 'INSPIRAÇÃO…', used: { own: ['r1'], library: [] } }`.
    - Post `feed_image` gerado: `ig_posts.style_refs` = `{ own: ['r1'], library: [], brand_id: <marca do post> }`.
    - Carrossel: um registro só para o post.
    - Reels: o `startVideo` grava o registro.
    - Post com `visual_prompt_override` e `art_direction`, sem instrução: `style_refs` `null`.
    - `'mídia enviada pela pessoa (upload) zera o registro'`: depois de um post gerado com registro, o envio próprio (o caminho que grava `step: 'upload'`, `media-generation.service.ts:830-850`) deixa `style_refs` `null`. A arte não é mais só do sistema.

- [ ] **Step 3: Rodar e ver falhar.** `cd api && bash ../scripts/run-capped.sh 1500 npx jest src/modules/creative/__tests__/creative.service.spec.ts`, depois `… npx jest src/modules/instagram/__tests__/media-generation.spec.ts`. Esperado: FAIL.

- [ ] **Step 4: Migração.** `20261116121000_style_refs_record`: `ALTER TABLE "creatives" ADD COLUMN "style_refs" JSONB;` e o mesmo em `ig_posts`. CHECK `"<tabela>_style_refs_check" CHECK ("style_refs" IS NULL OR jsonb_typeof("style_refs") = 'object')` nas duas. Comentário com o porquê (P6). `schema.prisma`: `style_refs Json? @db.JsonB` nos dois modelos. Aplicar e gerar.

- [ ] **Step 5: Implementar.**
  - `directArt`: guarde o `pick` e passe `styleNotes: pick?.text ?? null`. No retorno antecipado (direção reaproveitada) devolva `styleRefs: null`; nos demais, `styleRecord(pick, brandId)`.
  - `runArtDirected`: `options` do job ganha `style_refs: styleRefs` (sempre). `creatives.create` da imagem grava `style_refs`. `base.styleRefs = styleRefs`.
  - `finalizeWith`: no `creatives.create`, `style_refs: input.styleRefs ?? null`; no `update` de criativo existente não mexe. Poller: `styleRefs: asStyleRefsRecord((job.options as Record<string, unknown>)['style_refs'])`.
  - `media-generation`: imagem/carrossel guarda o `pick`. `usedDirector = !(override && brief.art_direction)`. O `patchPost` da linha 592 inclui `style_refs: usedDirector ? styleRecord(pick, brand?.id) : null`. `startVideo`: o `patchPost` da linha 411 inclui `style_refs: override ? null : styleRecord(pick, brand?.id)`.
  - No envio próprio (`media-generation.service.ts:846`), o `patchPost` ganha `style_refs: null`. O `IgStore.patchPost` aceita `Record<string, any>`, então `ig-store.service.ts` não muda.
  - A coluna não entra em nenhum DTO.

- [ ] **Step 6: Rodar e ver passar.** Os dois comandos do Step 3, mais `bash ../scripts/run-capped.sh 1500 npx jest src/modules/campaign-pilot/__tests__/pilot-creatives.spec.ts` (o piloto passa por `generateAsSystem`). Esperado: PASS.

- [ ] **Step 7: Commit.** `feat(style-refs): cada arte, post e vídeo registra as referências que seguiu` + Co-Authored-By.

### Task 4: Fatia 2 (API) — a lista diz de onde vem cada referência

**Files:**
- Modify: `api/src/modules/style-refs/style-refs.service.ts:72-75` (`StyleRefView`), `:123-142` (`list`), `:286-301` (`view`), `docs/api-contract.md:954`
- Test: `api/src/modules/style-refs/__tests__/style-refs.service.spec.ts`

**Interfaces:**
- Consumes: `style_references.attempts` (Task 1).
- Produces: `StyleRefView` ganha `campaign_name: string | null`, `source_title: string | null`, `attempts: number`. Cada `sources[]` ganha `refs_count: number`. `limits` ganha `in_brand: number` (todas as referências da marca, de qualquer campanha).

- [ ] **Step 1: Contrato §28, linha do `GET`.** Acrescente ao item de `refs`: `campaign_name` (nome da campanha quando `campaign_id`), `source_title` (título da pasta quando veio de pasta acompanhada) e `attempts` (0–3, leituras que falharam de forma transitória; `processing` com `attempts > 0` = "tentando de novo"). Em `sources`: `refs_count`. Em `limits`: `in_brand`. Sem `campaign_id`, a lista traz as referências da marca **e as de todas as campanhas** (a tela diz "só na campanha {nome}").

- [ ] **Step 2: Teste que falha.**

```ts
it('lista da marca: nome da campanha, título da pasta, tentativa e quantas cada pasta tem', async () => {
  // upload com CAMP + pasta 5-star-recipes (2 Pins) como no teste de pasta
  const l = await svc.list(VIEWER, WS, BRAND);
  expect(l.refs.find((r) => r.campaign_id === CAMP)).toMatchObject({ campaign_name: 'Jundiaí', source_title: null, attempts: 0 });
  expect(l.refs.filter((r) => r.from_source).every((r) => r.source_title === '5 Star Recipes')).toBe(true);
  expect(l.sources[0]).toMatchObject({ title: '5 Star Recipes', refs_count: 2 });
  expect(l.limits).toMatchObject({ in_brand: 3, brand: 30, campaign: 8 });
});
```

- [ ] **Step 3: Rodar e ver falhar.** `cd api && bash ../scripts/run-capped.sh 1500 npx jest src/modules/style-refs/__tests__/style-refs.service.spec.ts`. Esperado: FAIL.

- [ ] **Step 4: Implementar.** Em `list`, uma consulta de `campaigns` (`where: { workspace_id: ws, id: { in: ids } }`, `select: { id, name }`) monta o mapa de nomes. O mapa de títulos vem das `sources` já lidas. `refs_count` = contagem por `source_id` nas linhas lidas. `in_brand` = `style_references.count({ where: { workspace_id: ws, brand_id } })`. `view(r, names)` recebe os mapas. Nenhuma consulta sem `workspace_id`.

- [ ] **Step 5: Rodar e ver passar.** O comando do Step 3. Esperado: PASS.

- [ ] **Step 6: Commit.** `feat(style-refs): lista com campanha, pasta, tentativa e contagem por pasta` + Co-Authored-By.

### Task 5: Fatia 2 (web) — painel "Estilo das artes" na Marca e na campanha

**Files:**
- Create: `web/src/lib/style-refs.ts`, `web/src/lib/style-refs.test.ts`
- Modify: `web/src/modules/style-refs/infrastructure/style-refs.api.ts`, `web/src/components/style-refs-panel.tsx`, `web/src/app/(app)/brands/[id]/BrandDetail.tsx:205,360-373`, `web/src/app/(app)/campaigns/[id]/CampaignDetail.tsx:1094`, `web/scripts/browser-check.mjs` (seções `marcas` e `campanhas`)

**Interfaces:**
- Consumes: campos da Task 4.
- Produces (`lib/style-refs.ts`):
  - `PANEL_TEXT` (constantes abaixo).
  - `type StyleRefLike = { source: 'upload' | 'pinterest'; from_source: boolean; source_title: string | null; campaign_id: string | null; campaign_name: string | null; status: 'processing' | 'ready' | 'failed'; attempts: number; summary: string | null }`.
  - Funções: `refOrigin(r): string`, `refScope(r): string`, `refStateText(r): string`, `removeLabel(r): string`, `brandCounter(n: number): string`, `stopSourceQuestion(n: number): string`, `removedToast(r: { from_source: boolean }): string`, `visibleRefs<T>(refs: T[], expanded: boolean): T[]`, `seeAllLabel(n: number): string` e `liveAnnouncement(prev: { id: string; status: string }[] | undefined, next: { id: string; status: string }[]): string | null`.
- Produces (api web): `refSchema` ganha `campaign_name: z.string().nullable().default(null)`, `source_title: z.string().nullable().default(null)` e `attempts: z.number().default(0)`. `sources[]` ganha `refs_count: z.number().default(0)` e `limits` ganha `in_brand: z.number().default(0)`; com os defaults, o web novo convive com a API antiga.

`PANEL_TEXT` (ui.md §2, exatos; `campaignOnly` é a P12):
- `title: "Estilo das artes"`
- `description: "Mostre imagens de que você gosta. O Meu Funil lê as cores, a luz e o clima e usa em todas as artes, posts e vídeos desta marca. A imagem nunca aparece na arte nem é publicada."`
- `field: "Link do Pinterest"`
- `help: "Pin, pasta ou perfil público. No Pinterest, toque em Compartilhar e em Copiar link. Com pasta ou perfil, os Pins novos entram sozinhos todo dia."`
- `add: "Adicionar"`, `adding: "Buscando…"`, `upload: "Enviar imagem"`, `uploading: "Enviando…"`
- `empty: "Nenhuma referência ainda. Cole o link de uma pasta do Pinterest com o estilo que você quer."`
- `loading: "Carregando as referências…"`
- `loadError: "Não conseguimos carregar as referências. Verifique a conexão e toque em Tentar de novo."`, `retry: "Tentar de novo"`
- `stopConfirm: "Parar de acompanhar"`, `stopCancel: "Continuar"`, `sources: "Pastas acompanhadas"`
- `campaignOnly: "Pin colado aqui vale só para esta campanha. Pasta ou perfil vale para a marca inteira."`

- [ ] **Step 1: Teste que falha — `style-refs.test.ts`.**

```ts
const r = (o: Partial<StyleRefLike> = {}): StyleRefLike => ({ source: 'upload', from_source: false, source_title: null, campaign_id: null, campaign_name: null, status: 'ready', attempts: 0, summary: 'cores laranja; luz quente', ...o });
it('origem e onde vale', () => {
  expect(refOrigin(r())).toBe('Imagem enviada');
  expect(refOrigin(r({ source: 'pinterest' }))).toBe('Pin do Pinterest');
  expect(refOrigin(r({ source: 'pinterest', from_source: true, source_title: 'Bares escuros' }))).toBe('Pasta Bares escuros');
  expect(refOrigin(r({ source: 'pinterest', from_source: true }))).toBe('Pasta do Pinterest');
  expect(refScope(r())).toBe('vale para toda a marca');
  expect(refScope(r({ campaign_id: 'c', campaign_name: 'Jundiaí' }))).toBe('só na campanha Jundiaí');
});
it('estados', () => {
  expect(refStateText(r({ status: 'processing' }))).toBe('Lendo o estilo…');
  expect(refStateText(r({ status: 'processing', attempts: 1 }))).toBe('Não deu para ler agora. Tentando de novo sozinho (2 de 3).');
  expect(refStateText(r())).toBe('Em uso. O que eu peguei: cores laranja; luz quente');
  expect(refStateText(r({ summary: null }))).toBe('Em uso. O que eu peguei: estilo lido.');
  expect(refStateText(r({ status: 'failed' }))).toBe('Não conseguimos ler esta imagem. Remova e tente outra.');
});
it('contador, parar, remover, lista de 4', () => {
  expect(brandCounter(12)).toBe('12 de 30 referências nesta marca. Quando enche, as mais antigas das pastas dão lugar às novas.');
  expect(stopSourceQuestion(5)).toBe('Parar de acompanhar esta pasta? As 5 referências que vieram dela saem da marca.');
  expect(removedToast({ from_source: true })).toBe('Referência removida. Ela não volta, mesmo continuando na pasta.');
  expect(removedToast({ from_source: false })).toBe('Referência removida.');
  expect(removeLabel(r({ source: 'pinterest' }))).toBe('Remover referência: Pin do Pinterest');
  expect(visibleRefs([1, 2, 3, 4, 5, 6], false)).toEqual([1, 2, 3, 4]);
  expect(visibleRefs([1, 2, 3, 4, 5, 6], true)).toHaveLength(6);
  expect(seeAllLabel(38)).toBe('Ver todas (38)');
});
it('região viva: anuncia leitura nova, pronta e falha (uma frase por vez)', () => {
  expect(liveAnnouncement(undefined, [{ id: 'a', status: 'processing' }])).toBeNull(); // 1ª carga não anuncia
  expect(liveAnnouncement([], [{ id: 'a', status: 'processing' }])).toBe('Lendo o estilo…');
  expect(liveAnnouncement([{ id: 'a', status: 'processing' }], [{ id: 'a', status: 'ready' }])).toBe('Referência pronta. O estilo já está em uso.');
  expect(liveAnnouncement([{ id: 'a', status: 'processing' }], [{ id: 'a', status: 'failed' }])).toBe('Não conseguimos ler uma referência.');
});
```

- [ ] **Step 2: Rodar e ver falhar.** `cd web && bash ../scripts/run-capped.sh 1500 yarn test src/lib/style-refs.test.ts`. Esperado: FAIL (módulo não existe).

- [ ] **Step 3: Implementar `lib/style-refs.ts`** (funções puras com os textos acima; `liveAnnouncement` prioriza falha > pronta > lendo).

- [ ] **Step 4: Rodar e ver passar.** O comando do Step 2. Esperado: PASS.

- [ ] **Step 5: Painel e telas.**
  - `style-refs-panel.tsx`: a descrição sai do painel e passa para a `Section` de quem chama. Estados:
    - `isLoading` → `<p>` com `PANEL_TEXT.loading`.
    - `isError` → `PANEL_TEXT.loadError` (cor de erro) e o botão `PANEL_TEXT.retry` (`refetch`).
    - Sem refs e sem pastas → `PANEL_TEXT.empty`.
  - Campo e botões:
    - Campo com `Label` = `PANEL_TEXT.field` e `id` de `useId()`, sem placeholder; `Input` e botão `h-11`; ajuda `PANEL_TEXT.help` em `text-sm`.
    - Botões `add`/`adding` e `upload`/`uploading`.
    - Na campanha (`campaignId`), a linha fixa `campaignOnly` e o contador de hoje (`"{in_campaign} de 8 referências nesta campanha."`); na Marca, `brandCounter(limits.in_brand)`.
  - Lista de referências:
    - Uma coluna: miniatura + texto numa linha e "Remover" **embaixo** do texto (`aria-label={removeLabel(r)}`).
    - Cada linha mostra `refOrigin(r) · refScope(r)` e `refStateText(r)`; `failed` em cor de erro.
    - `visibleRefs` com o botão `seeAllLabel(n)`.
  - Pastas:
    - Cada pasta tem "Parar", que abre o `AlertDialog` (`components/ui/alert-dialog`) com `stopSourceQuestion(s.refs_count)` e as ações `stopConfirm`/`stopCancel`.
    - O `last_error` da pasta aparece com o ícone `AlertTriangle` em `text-destructive text-sm`.
  - Uma única região `<p aria-live="polite" className="sr-only">`, com `liveAnnouncement` calculado entre a lista anterior (`useRef`) e a nova. O `role="status"` da linha "Lendo o estilo…" sai.
  - Toasts:
    - Remover → `removedToast(r)`.
    - Pasta colada → `r.added ? \`Pasta acompanhada: ${r.added} Pin(s) novos. Ela é atualizada sozinha todo dia.\` : "Pasta acompanhada. Ela é atualizada sozinha todo dia."`, o mesmo de hoje (nenhum texto diz "vira fonte").
  - `BrandDetail.tsx`: a aba inicial vem de `useSearch<{ tab?: string }>().tab` quando é uma das 6 (`dna|identidade|guia|produtos|personas|aprendizados`), senão `dna`. Na aba `guia`, **antes** do `<VisualGuide>`, entra `<Section title={PANEL_TEXT.title} description={PANEL_TEXT.description}><StyleRefsPanel workspaceId brandId={id} campaignId={null} canEdit={canEdit} /></Section>`.
  - `CampaignDetail.tsx:1094`: `title={PANEL_TEXT.title}` (sem "(opcional)") e `description={PANEL_TEXT.description}`.
  - `browser-check.mjs`:
    - Em `marcas`, **depois** dos checks da aba Identidade visual e **antes** da exclusão da marca (logo depois de criar, o `goto` quebra o `#description`): `page.goto(brandUrl + '?tab=guia')` e `check` de `"Estilo das artes"`, `PANEL_TEXT.empty`, `"0 de 30 referências nesta marca."` e `"Enviar imagem"`.
    - Em `campanhas`, no detalhe da campanha do check, `getByRole('tab', { name: 'Briefing' })` e `check` de que o corpo tem `"Estilo das artes"` e não tem `"Estilo das artes (opcional)"`.

- [ ] **Step 6: Commit.** `feat(web): painel Estilo das artes na Marca, com estados, confirmação de parar e lista que diz a origem` + Co-Authored-By.

### Task 6: Fatia 2 (web) — "Logo e fotos da sua marca" (decisão 4 do dono)

**Files:**
- Modify: `web/src/lib/style-refs.ts`, `web/src/lib/style-refs.test.ts`, `web/src/app/(app)/brands/[id]/BrandDetail.tsx:9-20,176-181,290-320,643`, `web/scripts/browser-check.mjs` (`marcas`)

**Interfaces:**
- Produces: `BRAND_PHOTOS_TEXT` (constantes abaixo), `photoLabel(tagLabel: string | null): string` e `brandPhotosToast(n: number): string`.

`BRAND_PHOTOS_TEXT` (ui.md §1, exatos):
- `title: "Logo e fotos da sua marca"`
- `description: "Fotos de verdade do seu negócio. Elas podem aparecer nas artes."`
- `button: "Foto da sua marca"`, `option: (tag: string) => \`Foto de: ${tag}\``, `selectLabel: "Tipo da foto da sua marca"`
- `warning: "Só envie aqui fotos que são suas. Imagem do Pinterest ou de outra empresa vai em Estilo das artes, na aba Guia visual."`
- `guide: "Como as fotos da marca devem parecer. O diretor de arte usa isto em todo criativo. Envie as fotos da sua marca na aba Identidade visual."`

- [ ] **Step 1: Teste que falha.**

```ts
it('fotos da marca: rótulo da grade e aviso de envio', () => {
  expect(photoLabel('Produto')).toBe('Foto de: Produto');
  expect(photoLabel(null)).toBe('Foto da sua marca');
  expect(brandPhotosToast(1)).toBe('Foto enviada. Ela pode aparecer nas artes.');
  expect(brandPhotosToast(3)).toBe('3 fotos enviadas. Elas podem aparecer nas artes.');
  expect(BRAND_PHOTOS_TEXT.option('Ambiente')).toBe('Foto de: Ambiente');
});
```

- [ ] **Step 2: Rodar e ver falhar.** `cd web && bash ../scripts/run-capped.sh 1500 yarn test src/lib/style-refs.test.ts`. Esperado: FAIL.

- [ ] **Step 3: Implementar e aplicar no `BrandDetail.tsx`.**
  - O `ASSET_KINDS` de `reference` passa a usar `label: BRAND_PHOTOS_TEXT.button`, e o `kindLabel` de `photo|reference` vira `photoLabel(a.tag ? REFERENCE_TAGS[a.tag] ?? a.tag : null)`.
  - A `Section` da aba Identidade usa `title`/`description` novos; o `select` usa `BRAND_PHOTOS_TEXT.option(v)` e `aria-label={selectLabel}`.
  - O aviso `BRAND_PHOTOS_TEXT.warning` (fixo, `text-sm`, com ícone `AlertTriangle`) fica logo acima do `LOGO_HINT` quando `canEdit`.
  - No `uploadAssets`, com `kind === 'reference'`, o toast é `brandPhotosToast(ok)`; os outros tipos ficam como estão.
  - O `VisualGuide` usa `description={BRAND_PHOTOS_TEXT.guide}`.
  - Em `marcas`, o browser-check confere `"Logo e fotos da sua marca"` e o aviso na aba Identidade visual.

- [ ] **Step 4: Rodar e ver passar.** O comando do Step 2. Esperado: PASS.

- [ ] **Step 5: Commit.** `feat(web): fotos próprias viram "Logo e fotos da sua marca", com aviso para o Pinterest ir em Estilo das artes` + Co-Authored-By.

### Task 7: Fatia 2 (web) — convite "Estilo: …" no Estúdio, em Aprovações e no Pacote do piloto

**Files:**
- Create: `web/src/components/style-invite.tsx`
- Modify: `web/src/lib/style-refs.ts`, `web/src/lib/style-refs.test.ts`, `web/src/modules/style-refs/infrastructure/style-refs.api.ts` (`styleRefsRecordSchema`), `web/src/modules/creative/infrastructure/creative.api.ts:10-23`, `web/src/modules/instagram/infrastructure/instagram.api.ts` (schema `post`), `web/src/modules/campaigns/infrastructure/campaigns.api.ts:85-95`, `web/src/app/(app)/studio/StudioPage.tsx:468-478`, `web/src/components/instagram/approvals.tsx` (cartão do post, perto da linha 66), `web/src/components/pilot/pilot-panel.tsx:43,414-437`

**Interfaces:**
- Consumes: `style_refs` de `creatives`/`ig_posts` (Task 3).
- Produces:
  - `styleRefsRecordSchema = z.object({ own: z.array(z.string()).default([]), library: z.array(z.string()).default([]), brand_id: z.string().nullable().default(null) })`, ligado com `.nullish()` em `creativeRow`, no `post` do Instagram e no `creative` da campanha.
  - `type StyleRecordLike = { own: string[]; library: string[]; brand_id: string | null }`.
  - `styleInvite(rec: StyleRecordLike | null | undefined): { text: string; cta: boolean; brandId: string | null } | null`, `packageInvite(recs: (StyleRecordLike | null | undefined)[]): ReturnType<typeof styleInvite>` e `INVITE_CTA = "Mostrar o estilo que eu quero"`.
  - `<StyleInvite record={...} />`.

- [ ] **Step 1: Teste que falha.**

```ts
it('convite onde a arte é vista', () => {
  expect(styleInvite(null)).toBeNull();                    // peça antiga / prompt escrito à mão
  expect(styleInvite({ own: [], library: [], brand_id: 'b1' })).toEqual({ text: 'Estilo: sem referências.', cta: true, brandId: 'b1' });
  expect(styleInvite({ own: ['a'], library: [], brand_id: 'b1' })).toEqual({ text: 'Estilo: seguiu 1 referência sua.', cta: false, brandId: 'b1' });
  expect(styleInvite({ own: ['a', 'b', 'c'], library: [], brand_id: null })?.text).toBe('Estilo: seguiu 3 referências suas.');
  expect(packageInvite([null, { own: ['a'], library: [], brand_id: 'b' }, { own: ['a', 'b'], library: [], brand_id: 'b' }])?.text).toBe('Estilo: seguiu 2 referências suas.');
  expect(packageInvite([undefined, null])).toBeNull();
});
```

- [ ] **Step 2: Rodar e ver falhar.** `cd web && bash ../scripts/run-capped.sh 1500 yarn test src/lib/style-refs.test.ts`. Esperado: FAIL.

- [ ] **Step 3: Implementar.**
  - `StyleInvite` mostra `<p className="text-sm text-muted-foreground">{text}</p>` e, com `cta`, um `Button asChild variant="link" className="h-11 px-0 sm:h-auto"` com o `Link` do `lib/router`: `to="/brands/$id" params={{ id: brandId }} search={{ tab: 'guia' }}`, ou `to="/brands"` sem marca, rótulo `INVITE_CTA`.
  - Onde entra:
    - Estúdio: no cartão do criativo, depois da linha de formato/versão.
    - Aprovações: no cartão do `IgApprovalList`, abaixo do tema.
    - Pacote do piloto: uma linha embaixo da lista de peças, com `packageInvite(slots.filter(x => x.status === 'done').map(x => thumb.get(x.creative_id!)?.style_refs))` (P13). O tipo `creatives` do `PilotPanel` ganha `style_refs?: StyleRecordLike | null`.

- [ ] **Step 4: Rodar e ver passar.** O comando do Step 2. Esperado: PASS.

- [ ] **Step 5: Commit.** `feat(web): convite "Estilo" onde a arte é vista (Estúdio, Aprovações e Pacote do piloto)` + Co-Authored-By.

### Task 8: Fatia 3 — escolha pela categoria, com rótulos para o diretor

**Files:**
- Create: `api/src/modules/style-refs/style-pick.ts`, `api/src/modules/style-refs/__tests__/categories.spec.ts`, `api/src/modules/style-refs/__tests__/style-pick.spec.ts`
- Modify: `api/src/modules/style-refs/categories.ts`, `api/src/modules/style-refs/style-refs.service.ts` (`loadStyleNotes`), `api/src/modules/creative/refs.service.ts` (repassa `subject`), `docs/api-contract.md` §28
- Test: os dois specs novos e `style-refs.service.spec.ts`

**Interfaces:**
- Consumes: `StyleNotes`, `STYLE_CATEGORY_LABEL`, `styleNotesText(items)` com `full`/`labels`, `MAX_NOTES` e `StylePick` (Task 2).
- Produces (serviço, carregador único da escolha): `StyleRefsService.pickNotes(ws: string, brandId: string, campaignId: string | null, subject: string | null): Promise<PickedNote[]>`. Lê as prontas da marca no workspace e chama `chooseNotes`. A Task 10 acrescenta a seleção aqui dentro; `loadStyleNotes` (aqui) e `loadPhotoStyle`/`notesInUse` (Task 13) só chamam `pickNotes`.
- Produces (`categories.ts`): `CATEGORY_SYNONYMS: Record<StyleCategoryId, readonly string[]>`, `normalizeText(t: string): string` (minúsculas, sem acento, só `[a-z0-9 ]`, espaços simples), `subjectCategories(text: string | null | undefined): StyleCategoryId[]` (na ordem da lista), `subjectWords(text: string | null | undefined): string[]` e `styleSubject(...parts: (string | null | undefined)[]): string`.
- Produces (`style-pick.ts`): `type PickRow = { id: string; campaign_id: string | null; created_at: Date; notes: StyleNotes }`; `type PickedNote = { row: PickRow; full: boolean; library: boolean }`; `chooseNotes(own: PickRow[], campaignId: string | null, subject: string | null | undefined, library?: PickRow[]): PickedNote[]` (até `MAX_NOTES`).
- Produces: `StyleRefsService.loadStyleNotes(ws, brandId, campaignId?, subject?: string | null)`; `RefsService.loadStyleNotes(workspaceId, brandId, campaignId?, subject?)`.

Sinônimos (P7), já normalizados. Casam por palavra inteira, e os de duas palavras casam pela sequência:

| id | sinônimos |
|---|---|
| comida_hamburguer | hamburguer hamburgueres hamburgueria burger burgers cheeseburger smash lanche lanches lanchonete sanduiche sanduiches "hot dog" "cachorro quente" |
| comida_pizza | pizza pizzas pizzaria massa massas macarrao lasanha italiana italiano calzone |
| comida_japonesa | sushi sashimi temaki japonesa japones oriental poke yakisoba uramaki "hot roll" |
| comida_churrasco | churrasco churrascaria espeto espetos espetinho espetinhos picanha costela carne carnes parrilla grelhado grelhados |
| comida_caseira | marmita marmitas marmitex feijoada "prato feito" caseira caseiro almoco executivo "self service" buffet |
| frutos_do_mar | peixe peixes camarao camaroes "frutos do mar" moqueca marisco mariscos polvo |
| doces | doce doces bolo bolos confeitaria brigadeiro brigadeiros sobremesa sobremesas torta tortas chocolate brownie cupcake docinho docinhos |
| acai_sorvete | acai acaiteria sorvete sorvetes sorveteria gelato picole picoles frozen milkshake "milk shake" |
| cafe_padaria | cafe cafes cafeteria padaria pao paes croissant cappuccino expresso espresso "cafe da manha" salgado salgados coxinha |
| comida_saudavel | salada saladas saudavel saudaveis fit vegano vegana vegetariano vegetariana natural bowl suco sucos detox |
| bebida_bar | bar bares boteco botequim chope chopp chopes chopps choperia cerveja cervejas cervejaria drink drinks drinque drinques coquetel coqueteis caipirinha caipirinhas "happy hour" vinho vinhos adega pub bebida bebidas gin whisky |
| ambiente | ambiente salao mesa mesas decoracao espaco interior restaurante lounge varanda "area externa" |
| pessoas_trabalhando | garcom garcons garconete garconetes cozinheiro cozinheira cozinheiros chef barista bartender bartenders barman atendente atendimento entregador entregadores motoboy delivery cumim copeiro copeira auxiliar recepcionista servindo |
| equipe_vagas | vaga vagas equipe contratando contratacao freela freelas freelancer freelancers emprego empregos trabalhe recrutamento oportunidade oportunidades |
| produto_destaque | promocao promocoes promo oferta ofertas combo combos lancamento novidade novidades desconto descontos produto produtos cardapio "black friday" |
| beleza | barbearia barbeiro barba cabelo cabelos cabeleireiro cabeleireira "salao de beleza" manicure unha unhas estetica maquiagem sobrancelha sobrancelhas spa depilacao |

`subjectWords`: palavras normalizadas com 4 letras ou mais, fora de `para como mais essa esse este esta pela pelo numa sobre entre muito muita todo toda seus suas voce`. `styleSubject`: partes não vazias e aparadas, unidas por espaço, cortadas em 500.

Algoritmo de `chooseNotes` (P8, P9):

```text
cats = subjectCategories(subject); words = subjectWords(subject)
common(r) = |r.notes.categorias ∩ cats|; overlap(r) = |subjectWords(r.notes.assunto) ∩ words|
rank = ordena por (common > 0) desc, common desc, overlap desc, created_at desc
usable = own com campaign_id null ou === campaignId (campaignId nulo → só campaign_id null)
camp = rank(usable da campanha); brand = rank(usable com campaign_id null)
out = camp[0..2) ++ brand; se out < 4: ++ camp[2..]; corta em 4
se library: out ++ rank(library) até 4 (library: true)
full(r) = cats vazio || common(r) > 0
```

No serviço, cada `PickedNote` vira item do `styleNotesText` com `full` e `labels = row.notes.categorias.slice(0, 2).map(id => STYLE_CATEGORY_LABEL[id])`. Os `ids` devolvidos se dividem em `used.own`/`used.library` por `library`.

- [ ] **Step 1: Contrato §28.** O texto ao diretor vira `"{i}) [rótulo, rótulo] «…»"`. Ordem: até 2 da campanha, depois as da marca com categoria em comum com o pedido, desempate pelo `assunto`, depois as mais novas; vaga que sobra volta para a campanha. Nota sem categoria em comum entra só com paleta e luz; pedido sem categoria reconhecida usa as notas inteiras. `loadStyleNotes(ws, brandId, campaignId, subject)`.

- [ ] **Step 2: Testes que falham.**
  - `categories.spec.ts`:

```ts
it.each([
  ['Hambúrguer artesanal com cheddar', ['comida_hamburguer']],
  ['X-Burger da casa', ['comida_hamburguer']],
  ['cachorro-quente na chapa', ['comida_hamburguer']],
  ['Chope gelado', ['bebida_bar']], ['chopp', ['bebida_bar']],
  ['Barbearia do Zé', ['beleza']],                       // "bar" não casa com "barbearia"
  ['Açaí na tigela', ['acai_sorvete']],
  ['Vaga de Garçom', ['pessoas_trabalhando', 'equipe_vagas']],
  ['', []],
])('subjectCategories(%s)', (t, out) => expect(subjectCategories(t)).toEqual(out));
it('subjectWords e styleSubject', () => {
  expect(subjectWords('Hambúrguer artesanal para você')).toEqual(['hamburguer', 'artesanal']);
  expect(styleSubject('  Tema ', null, 'pedido', undefined)).toBe('Tema pedido');
  expect(styleSubject('x'.repeat(600))).toHaveLength(500);
});
```

  - `style-pick.spec.ts`. Linhas: `c1` da campanha, `['bebida_bar']`, t=1; `c2` da campanha, `['comida_hamburguer']`, t=2; `c3` da campanha, `['comida_hamburguer']`, assunto `'hambúrguer artesanal'`, t=3; `b1` da marca, `['comida_hamburguer']`, t=4; `b2` da marca, `['bebida_bar']`, t=5; `b3` da marca, `[]`, t=6.
    - `'campanha (≤ 2) → categoria em comum → assunto → mais novas'`: `chooseNotes(rows, CAMP, 'Hambúrguer artesanal')` dá ids `['c3', 'c2', 'b1', 'b3']` e full `[true, true, true, false]`.
    - `'pedido sem categoria: notas inteiras, mais novas'`: com `''`, dá ids `['c3', 'c2', 'b3', 'b2']` e todas full.
    - `'sem nota da marca, a campanha ocupa as vagas'`: só `c1`, `c2` e `c3` dão `['c3', 'c2', 'c1']`.
    - `'campanha nula: notas de campanha ficam fora'`: `chooseNotes(rows, null, '')` dá `['b3', 'b2', 'b1']`.
  - `style-refs.service.spec.ts`, `'texto rotulado e nota reduzida'`: 5 prontas (as de cima menos a `c1`, com o `NOTES` do spec e as categorias e assuntos de cada uma), `loadStyleNotes(WS, BRAND, CAMP, 'Hambúrguer artesanal')`. O `text` contém `' 1) [hambúrguer e lanches] «assunto hambúrguer artesanal; '` e termina em `' 4) «paleta laranja, creme; luz de fim de tarde»'` (a `b3`, sem categoria em comum). `used.own` = `[c3, c2, b1, b3]`.
  - Asserção da Task 2 que muda: em `'loadStyleNotes: só as prontas…'`, a nota tem `categorias: ['comida_hamburguer']` e agora ganha rótulo. O início esperado vira `` `${STYLE_NOTES_HEADER} 1) [hambúrguer e lanches] «assunto hambúrguer no balcão; paleta laranja, creme` ``.

- [ ] **Step 3: Rodar e ver falhar.** `cd api && bash ../scripts/run-capped.sh 1500 npx jest src/modules/style-refs`. Esperado: FAIL.

- [ ] **Step 4: Implementar** (tabela, algoritmo e regras acima). `pickNotes` lê as prontas como o `loadStyleNotes` de hoje e chama `chooseNotes(rows, campaignId, subject)`. `loadStyleNotes(ws, brandId, campaignId, subject)` = `pickNotes` + `styleNotesText`; sem `brandId` ou sem nota → `null`.

- [ ] **Step 5: Rodar e ver passar.** O comando do Step 3. Esperado: PASS.

- [ ] **Step 6: Commit.** `feat(style-refs): escolha das referências pela categoria do pedido, com rótulos para o diretor` + Co-Authored-By.

### Task 9: Fatia 3 — cada chamador manda o assunto do pedido

**Files:**
- Modify: `api/src/modules/creative/creative.service.ts:110-138` (`directArt`), `api/src/modules/instagram/media-generation.service.ts:400-405,540-547`
- Test: `api/src/modules/creative/__tests__/creative.service.spec.ts`, `api/src/modules/instagram/__tests__/media-generation.spec.ts`

**Interfaces:**
- Consumes: `styleSubject` (Task 8) e `RefsService.loadStyleNotes(ws, brandId, campaignId, subject)`.

- [ ] **Step 1: Testes que falham.**
  - `creative.service.spec.ts`, `'o assunto do pedido vai à escolha das referências (título + pedido + oferta + ângulo)'`: `jest.spyOn(RefsService.prototype, 'loadStyleNotes')`. Campanha com `offer_product: 'Combo smash'`; `generate` com `title: 'Burger da casa'`, `prompt: 'close no hambúrguer'` e `angle: 'preço'`. Espere a chamada `(WS, brandId, campaignId, 'Burger da casa close no hambúrguer Combo smash preço')`.
  - `media-generation.spec.ts`, `'post e vídeo mandam tema + gancho + pedido + produto'`: post com `theme: 'Smash da semana'`, `hook: 'Chegou o smash'`, `creative_brief.prompt: 'close no smash'` e produto `'Smash duplo'`. Espere `refs.loadStyleNotes` chamado com o 4º argumento `'Smash da semana Chegou o smash close no smash Smash duplo'`, no `feed_image` e no `reel`.

- [ ] **Step 2: Rodar e ver falhar.** `cd api && bash ../scripts/run-capped.sh 1500 npx jest src/modules/creative/__tests__/creative.service.spec.ts`, depois `… npx jest src/modules/instagram/__tests__/media-generation.spec.ts`. Esperado: FAIL.

- [ ] **Step 3: Implementar.**
  - `directArt`: `styleSubject(input.title, input.prompt, input.campaign?.offer_product, input.angle)`.
  - `media-generation`, imagem e vídeo: `styleSubject(post.theme, post.hook, brief.prompt, ctx.product?.name)`.

- [ ] **Step 4: Rodar e ver passar.** Os dois comandos do Step 2. Esperado: PASS.

- [ ] **Step 5: Commit.** `feat(style-refs): assunto do pedido em cada chamador (Estúdio, piloto, posts e vídeo)` + Co-Authored-By.

### Task 10: Fatia 4 (API) — a Seleção do Meu Funil completa a escolha, atrás de `STYLE_LIBRARY_ENABLED`

**Files:**
- Create: `api/prisma/migrations/20261116122000_style_library/migration.sql`
- Modify: `api/prisma/schema.prisma` (`brands`), `api/src/common/config/env.validation.ts`, `api/.env.example`, `docker-compose.yml`, `docs/deploy/.env.prod.example`, `api/src/modules/brands/dto/brands.dto.ts:12-30`, `api/src/modules/style-refs/style-pick.ts`, `api/src/modules/style-refs/style-refs.service.ts` (ENV, `loadStyleNotes`), `docs/api-contract.md` §10 (PATCH) e §28
- Test: `api/src/common/__tests__/env-and-guard.spec.ts`, `api/src/modules/style-refs/__tests__/style-pick.spec.ts`, `api/src/modules/style-refs/__tests__/style-refs.service.spec.ts` (defaults de `brands`: `segment: null, style_library_enabled: true, style_library_segment: null`; `setup()` recebe `env`)

**Interfaces:**
- Consumes: `chooseNotes(own, campaignId, subject, library)`, `PickRow`, `PickedNote`, `pickNotes` e `normalizeText`/`subjectCategories` (Task 8); `STYLE_CATEGORY_IDS` (Task 2).
- Produces:
  - `private libraryFor(ws: string, brand: { segment: string | null; style_library_enabled: boolean; style_library_segment: string | null }): Promise<{ available: Set<StyleCategoryId>; resolved: { segment: StyleCategoryId | null; source: 'auto' | 'chosen' | 'none' }; rows: PickRow[] }>` no `StyleRefsService`. É a leitura única da Biblioteca, reaproveitada pela Task 11.
  - `pickNotes` passa a completar com `libraryFor(...).rows`. O `loadStyleNotes` não muda: continua só chamando `pickNotes`.
  - Env: `STYLE_LIBRARY_ENABLED: boolean` (`bool('false')`) e `STYLE_LIBRARY_WORKSPACE_ID: string` (`z.string().default('')`; preenchido e sem ser uuid → erro de subida `STYLE_LIBRARY_WORKSPACE_ID inválido: "<valor>"`, no `superRefine`).
  - `resolveLibrarySegment(brand: { segment: string | null; style_library_segment: string | null }, available: ReadonlySet<StyleCategoryId>): { segment: StyleCategoryId | null; source: 'auto' | 'chosen' | 'none' }` em `style-pick.ts`.
  - `StyleRefsService.libraryActiveFor(ws: string): boolean`: compara os ids em minúsculas.
  - `UpdateBrandDto.style_library_enabled?: boolean` (`@IsOptional() @IsBoolean()`) e `style_library_segment?: string` (`@IsOptional() @IsIn([...STYLE_CATEGORY_IDS, 'none'])`), sem default.

- [ ] **Step 1: Contrato.**
  - §10, linha do `PATCH`: acrescente `style_library_enabled` (bool) e `style_library_segment` (id de categoria de `style-refs/categories.ts` ou `none`). A resposta traz as duas colunas.
  - §28, parágrafo novo "Seleção do Meu Funil (Fatia 4)": com `STYLE_LIBRARY_ENABLED=true` e `STYLE_LIBRARY_WORKSPACE_ID` (empresa interna "Biblioteca Meu Funil"), a marca com menos de 4 notas próprias prontas e `style_library_enabled` completa com as prontas das marcas da Biblioteca do mesmo ramo, pela mesma ordem. A própria sempre vem antes. Ramo: o escolhido (`style_library_segment`), senão o reconhecido em `brands.segment`; `none` = sem seleção. Flag desligada, id vazio ou empresa inexistente = nada muda. `used.library` traz os ids da seleção.

- [ ] **Step 2: Testes que falham.**
  - `env-and-guard.spec.ts`: `STYLE_LIBRARY_WORKSPACE_ID: 'abc'` derruba a validação citando a variável; um uuid válido passa; o padrão é `''` com `STYLE_LIBRARY_ENABLED === false`.
  - `style-pick.spec.ts`, `resolveLibrarySegment`:
    - Texto `'Açaiteria Frutá'` com `acai_sorvete` disponível → `{ segment: 'acai_sorvete', source: 'auto' }`.
    - `style_library_segment: 'bebida_bar'` → `chosen`.
    - `'none'` → `{ segment: null, source: 'none' }`.
    - Texto reconhecido sem ramo disponível → `{ segment: null, source: 'auto' }`.
    - `chooseNotes` com `library`: 1 própria + 3 da seleção → a própria primeiro e as 3 com `library: true`.
  - `style-refs.service.spec.ts`, `describe('Seleção do Meu Funil (Fatia 4)')`. Biblioteca `LIB` com a marca `'Açaí'` (`style_library_segment: 'acai_sorvete'`) e 3 prontas, mais a marca `'Bar'` (`bebida_bar`) com 2 prontas. Marca cliente com `segment: 'Açaiteria Frutá'`. O `env` é `{ STYLE_REFS_PINTEREST_ENABLED: true, STYLE_LIBRARY_ENABLED: true, STYLE_LIBRARY_WORKSPACE_ID: LIB }`.
    - `'1 própria + 3 da seleção; a própria vem primeiro'`: `used = { own: [p1], library: [3 ids da Açaí] }`.
    - `'4 próprias → a seleção não entra'`.
    - `'interruptor da marca desligado → só as próprias'`.
    - `'"Nenhum desses" → só as próprias'`.
    - `'ramo escolhido vale mais que o texto'`: com `bebida_bar`, entram as da `'Bar'`.
    - `'empresa A não lê notas de B'`: a empresa B (cliente) tem prontas numa marca de açaí; os ids de B nunca aparecem em `used` de A, nem os da marca `'Bar'` da Biblioteca quando o ramo é açaí.
    - `'flag desligada → nenhuma consulta à Biblioteca'`: `jest.spyOn(prisma.style_references, 'findMany')` nunca é chamado com `workspace_id: LIB`.
    - `'flag ligada sem id → inerte; id de empresa inexistente → só as próprias, sem erro'`.
    - `'a própria Biblioteca não se completa com ela mesma'`.

- [ ] **Step 3: Rodar e ver falhar.** `cd api && bash ../scripts/run-capped.sh 1500 npx jest src/modules/style-refs`, depois `… npx jest src/common/__tests__/env-and-guard.spec.ts`. Esperado: FAIL.

- [ ] **Step 4: Migração e flag.**
  - Migração `20261116122000_style_library`, com comentário do porquê (Fatia 4; P11):
    - `ALTER TABLE "brands" ADD COLUMN "style_library_enabled" BOOLEAN NOT NULL DEFAULT true;`
    - `ALTER TABLE "brands" ADD COLUMN "style_library_segment" TEXT;`
    - `ALTER TABLE "brands" ADD CONSTRAINT "brands_style_library_segment_check" CHECK ("style_library_segment" IS NULL OR "style_library_segment" ~ '^[a-z_]{2,40}$');`
    - `CREATE INDEX "brands_style_library_segment_idx" ON "brands"("workspace_id", "style_library_segment") WHERE "style_library_segment" IS NOT NULL;`
  - `schema.prisma`: `style_library_enabled Boolean @default(true)` e `style_library_segment String?`. Aplicar e gerar.
  - Flag:
    - `api/.env.example`: `# STYLE_LIBRARY_ENABLED=false   # Seleção do Meu Funil (Fatia 4): só ligar depois das decisões 1–3 do dono` e `# STYLE_LIBRARY_WORKSPACE_ID=   # uuid da empresa interna "Biblioteca Meu Funil" (a exclusão dela fica bloqueada)`.
    - `docker-compose.yml`: `STYLE_LIBRARY_ENABLED: ${STYLE_LIBRARY_ENABLED:-false}` e `STYLE_LIBRARY_WORKSPACE_ID: ${STYLE_LIBRARY_WORKSPACE_ID:-}`, depois da linha 103.
    - `docs/deploy/.env.prod.example`: as duas linhas comentadas, depois da 38.

- [ ] **Step 5: Implementar.**
  - `StyleRefsService` recebe `Pick<Env, 'STYLE_REFS_PINTEREST_ENABLED' | 'STYLE_LIBRARY_ENABLED' | 'STYLE_LIBRARY_WORKSPACE_ID'>`. `libraryActiveFor(ws)` = flag && id && `ws.toLowerCase() !== id.toLowerCase()`.
  - `pickNotes`: escolhe as próprias. Se forem menos de 4 e `libraryActiveFor(ws)` (passos 2 e 3 = `libraryFor`):
    1. Lê a marca com `workspace_id: ws` (`segment`, `style_library_enabled`, `style_library_segment`). Desligada → só as próprias.
    2. Lê as marcas da Biblioteca com ramo (`workspace_id: LIB`, `style_library_segment: { not: null }`) e as prontas delas (`workspace_id: LIB`, `brand_id in`, `status: 'ready'`).
    3. `available` = ramos com ao menos 1 pronta; `resolveLibrarySegment`; `library` = prontas das marcas daquele ramo.
    4. `chooseNotes(own, campaignId, subject, library)`.
  - Nenhum erro da Biblioteca derruba a escolha: `try/catch` que registra no log e segue só com as próprias.

- [ ] **Step 6: Rodar e ver passar.** Os comandos do Step 3. Esperado: PASS.

- [ ] **Step 7: Commit.** `feat(style-refs): Seleção do Meu Funil completa as referências da marca (chave STYLE_LIBRARY_ENABLED desligada)` + Co-Authored-By.

### Task 11: Fatia 4 (API) — rota da Seleção, `features`, bloqueio de exclusão e conferência dos jobs

**Files:**
- Modify: `api/src/modules/style-refs/style-refs.controller.ts` (`@Get('library')`), `api/src/modules/style-refs/style-refs.service.ts` (`library`), `api/src/modules/workspaces/features.service.ts`, `api/src/modules/workspaces/workspace-deletion.ts:10,72-104`, `api/src/modules/workspaces/workspace-deletion.service.ts:66-73,143-146`, `docs/api-contract.md` §3 (features), §28 e §31
- Test: `style-refs.service.spec.ts`, `api/src/modules/workspaces/__tests__/features.spec.ts`, `api/src/modules/workspaces/__tests__/workspace-deletion.spec.ts` (construtor da linha 194 ganha `{ STYLE_LIBRARY_WORKSPACE_ID: '' }`)

**Interfaces:**
- Consumes: `libraryActiveFor`, `libraryFor` (Task 10), `notesSummary` (style-notes), `STYLE_CATEGORY_LABEL` (Task 2) e `deletionBlockers`/`BlockerCode` de hoje (`workspace-deletion.ts:10,72`).
- Produces:
  - `StyleLibraryView = { segment: string | null; segment_label: string | null; segment_source: 'auto' | 'chosen' | 'none'; brand_segment: string | null; options: { id: string; label: string }[]; count: number; descriptions: string[]; enabled: boolean; own_ready: number; in_use: boolean }`.
  - `StyleRefsService.library(userId: string, ws: string, brandId: string): Promise<StyleLibraryView>`.
  - Rota `GET /v1/workspaces/:workspaceId/brands/:brandId/style-refs/library` (read).
  - `WorkspaceFeatures.style_library: boolean`.
  - `BlockerCode` ganha `'STYLE_LIBRARY'`; `deletionBlockers(input: { live: LiveCampaign[]; memberships: number; styleLibrary?: boolean })`.
  - `WorkspaceDeletionService` recebe `@Inject(ENV) env: Pick<Env, 'STYLE_LIBRARY_WORKSPACE_ID'>` como 4º argumento.

- [ ] **Step 1: Contrato.**
  - §3 (`features`): acrescente `style_library` = `STYLE_LIBRARY_ENABLED` com `STYLE_LIBRARY_WORKSPACE_ID` preenchido e a empresa ≠ a Biblioteca.
  - §28, linha nova na tabela: `GET /style-refs/library` (read). Responde `StyleLibraryView`:
    - `count` = prontas do ramo; `descriptions` = o resumo de cada uma, **só texto**, sem id, link, título nem imagem.
    - `options` = ramos que têm seleção, `{ id, label }`; `own_ready` = próprias prontas.
    - `in_use` = `enabled && segment && count > 0 && own_ready < 4`.
    - Fora da chave → `404 "Não encontrado."`.
  - §28, parágrafo "Biblioteca e os jobs" (conferido em 16/11 pelo grep das consultas `findMany` sem `workspace_id` nos módulos dos jobs; refazer no Step 5). A empresa Biblioteca é empresa comum para os jobs: só `style-refs-15min` a varre de propósito (lê as pastas dela com a chave de IA dela). Os demais olham tabelas que a Biblioteca não usa:
    - `instagram-*`: `ig_*`, `publishing_jobs`, `instagram_accounts`.
    - `crm-*`: `crm_*`.
    - `ads-*`: campanhas com canal e contas da Meta.
    - `creative-poll-5min`: jobs `generating`.
    - `vacancy-stories-10min`: `vacancy_story_settings` + lista.
    - `campaign-pilot-5min`: `campaign_pilot_runs` + lista.
    - `exports-cleanup-hourly`: arquivos.
  - Regra de operação: na Biblioteca não se conecta Instagram, Meta nem CRM, não se cria campanha e ela não entra nas listas `*_WORKSPACE_IDS`.
  - §31: bloqueio `STYLE_LIBRARY` (primeiro da lista) com a mensagem da P12, sempre que `STYLE_LIBRARY_WORKSPACE_ID` for a empresa.

- [ ] **Step 2: Testes que falham.**
  - `style-refs.service.spec.ts`, `describe('GET library')`, com o mundo da Task 10:
    - `'ramo reconhecido: quantas, descrições só em texto'`: `count: 3`, `segment: 'acai_sorvete'`, `segment_label: 'açaí e sorvete'`, `segment_source: 'auto'` e `in_use: true` com 1 própria. `JSON.stringify(view)` não contém nenhum id das prontas da Biblioteca, nem `'http'`, nem o título do Pin.
    - `'não reconhecido → segment null e as opções com seleção'`: com `segment: 'Floricultura'`, `options` dá `[{ id: 'acai_sorvete', label: 'açaí e sorvete' }, { id: 'bebida_bar', label: 'bebida e bar' }]`.
    - `'in_use false com 4 próprias e com o interruptor desligado'`.
    - `'chave desligada → 404; viewer lê; não-membro 403; marca de outra empresa 404'`.
  - `features.spec.ts`: `style_library` só é `true` com a flag, o id e a empresa ≠ id. Os `toEqual` existentes ganham `style_library: false`.
  - `workspace-deletion.spec.ts`:
    - Puro: `deletionBlockers({ live: [], memberships: 2, styleLibrary: true })` → `[{ code: 'STYLE_LIBRARY', message: 'Esta empresa guarda a Seleção do Meu Funil, usada por outras empresas. Ela não pode ser apagada.' }]`, e ele vem antes de `LIVE_META_CAMPAIGNS`.
    - Serviço: com o id = a empresa, o `preview` mostra o bloqueio e o `remove` dá `409 STYLE_LIBRARY` sem apagar nada.

- [ ] **Step 3: Rodar e ver falhar.** `cd api && bash ../scripts/run-capped.sh 1500 npx jest src/modules/style-refs/__tests__/style-refs.service.spec.ts`, depois `… npx jest src/modules/workspaces`. Esperado: FAIL.

- [ ] **Step 4: Implementar.**
  - `library()` exige `read`, confere a marca no workspace e reaproveita a leitura da Task 10.
  - O controller põe `@Get('library')` antes das rotas com parâmetro.
  - `FeaturesService` recebe as duas variáveis: `style_library` = flag && id && `workspaceId.toLowerCase() !== id.toLowerCase()`.
  - `WorkspaceDeletionService.blockers` passa `styleLibrary: id === env.STYLE_LIBRARY_WORKSPACE_ID.toLowerCase()`.
  - O web de exclusão (`web/src/lib/workspace-deletion.ts`) já mostra `message` de qualquer `code`: não muda.

- [ ] **Step 5: Rodar e ver passar.** Os comandos do Step 3. Esperado: PASS.

- [ ] **Step 6: Conferir de novo a auditoria dos jobs.** Rode `grep -rn "findMany(" api/src/modules/{instagram,crm,crm-channels,ads,campaign-pilot,creative,vacancy-stories,style-refs} --include=*.ts | grep -v __tests__ | grep -v workspace_id`.
  - Esperado: só varreduras de `ig_*`, `publishing_jobs`, `instagram_accounts`, `crm_*`, `creative_generation_jobs`, `campaign_pilot_runs`, `vacancy_*`, `media_assets` (por post) e `style_*`.
  - Se aparecer outra tabela que a Biblioteca preencha, ela precisa de filtro `workspace_id: { not: LIB }` e de um teste nesta tarefa.

- [ ] **Step 7: Commit.** `feat(style-refs): rota da Seleção do Meu Funil, features e exclusão bloqueada da Biblioteca` + Co-Authored-By.

### Task 12: Fatia 4 (web) — "Seleção do Meu Funil" no painel da Marca

**Files:**
- Create: `web/src/components/style-library.tsx`
- Modify: `web/src/lib/style-refs.ts`, `web/src/lib/style-refs.test.ts`, `web/src/modules/style-refs/infrastructure/style-refs.api.ts` (`getStyleLibrary`), `web/src/modules/features/infrastructure/features.api.ts` (`style_library: z.boolean().default(false)`, também no `ALL_OFF`), `web/src/app/(app)/brands/[id]/BrandDetail.tsx` (seção da Task 5)

**Interfaces:**
- Consumes: `StyleLibraryView` (Task 11) e `updateBrand(ws, id, body)`.
- Produces:
  - `LIBRARY_TEXT` (constantes abaixo).
  - `libraryLine(label: string, n: number): string`.
  - `libraryState(v: { enabled: boolean; in_use: boolean; own_ready: number }): 'on' | 'idle' | 'off'`.
  - `unrecognizedLine(brandSegment: string | null): string`.
  - `styleInvite` ganha o caso só-seleção (P12).

`LIBRARY_TEXT` (ui.md §3, exatos):
- `toggle: "Usar a seleção do Meu Funil"`, `toggleHint: "Vale na hora, sem precisar salvar."`
- `on: "Suas referências vêm primeiro; a seleção completa quando você tem menos de 4."`
- `idle: "Sem uso agora: você já tem 4 ou mais referências suas."`
- `off: "As artes seguem só as suas referências."`
- `seeDescriptions: "Ver as descrições"`, `none: "Nenhum desses"`

- [ ] **Step 1: Teste que falha.**

```ts
it('Seleção do Meu Funil', () => {
  expect(libraryLine('açaí e sorvete', 12)).toBe('Seleção do Meu Funil para açaí e sorvete: 12 referências escolhidas pela nossa equipe. Outras empresas do mesmo ramo também usam.');
  expect(libraryState({ enabled: true, in_use: true, own_ready: 1 })).toBe('on');
  expect(libraryState({ enabled: true, in_use: false, own_ready: 4 })).toBe('idle');
  expect(libraryState({ enabled: false, in_use: false, own_ready: 0 })).toBe('off');
  expect(unrecognizedLine('Floricultura')).toBe('Ainda não temos seleção para "Floricultura". Escolha o ramo mais parecido:');
  expect(unrecognizedLine(null)).toBe('Escolha o ramo mais parecido:');
  expect(styleInvite({ own: [], library: ['x'], brand_id: 'b' })).toEqual({ text: 'Estilo: seguiu a Seleção do Meu Funil.', cta: true, brandId: 'b' });
});
```

- [ ] **Step 2: Rodar e ver falhar.** `cd web && bash ../scripts/run-capped.sh 1500 yarn test src/lib/style-refs.test.ts`. Esperado: FAIL.

- [ ] **Step 3: Implementar.**
  - `StyleLibrary` só aparece na Marca, com `features.style_library`. Ele lê `["style-library", ws, brandId]`.
  - Ramo resolvido: `libraryLine` e "Ver as descrições" (`Collapsible` com a lista de `descriptions`, sem imagem).
  - `Switch` (`components/ui/switch`) com `toggle`/`toggleHint` e o texto do estado. Muda na hora com `updateBrand(ws, brandId, { style_library_enabled })` e invalida `style-library` e `["brand", brandId]`.
  - Ramo não resolvido (ou `none`): `unrecognizedLine(brand_segment)` com rádios de 44 px para `options` + `LIBRARY_TEXT.none`. A escolha chama `updateBrand(ws, brandId, { style_library_segment })`.
  - Viewer vê tudo desabilitado.
  - O "Salvar Brand Brain" continua mandando só os campos do formulário, nunca `style_library_*`.

- [ ] **Step 4: Rodar e ver passar.** O comando do Step 2. Esperado: PASS.

- [ ] **Step 5: Commit.** `feat(web): Seleção do Meu Funil no painel da Marca (interruptor que vale na hora e escolha do ramo)` + Co-Authored-By.

### Task 13: Fatia 5 (API) — foto das vagas com paleta, luz e clima, atrás de um interruptor por empresa

**Files:**
- Create: `api/prisma/migrations/20261116123000_vacancy_style_refs/migration.sql`
- Modify: `api/prisma/schema.prisma:1394-1423`, `api/src/modules/style-refs/style-notes.ts` (`PhotoStyle`), `api/src/modules/style-refs/style-refs.service.ts` (`loadPhotoStyle`, `notesInUse`), `api/src/modules/creative/refs.service.ts` (`loadPhotoStyle`), `api/src/modules/vacancy-stories/vacancy-prompts.ts:44-51`, `vacancy-generator.service.ts:47,310-354,409-457`, `vacancy-settings.service.ts:92-117,126-137,146-211`, `vacancy-stories.dto.ts:9-16`, `docs/api-contract.md` §26
- Test:
  - `vacancy-stories/__tests__/generator.spec.ts`: `setup({ styleRefs? })` passa o falso ao `RefsService`.
  - `__tests__/actions.spec.ts`: a prévia; o `setup` (linha 45) ganha `styleRefs?`, que vai como 5º argumento do `RefsService` do gerador.
  - `__tests__/settings.spec.ts` e `__tests__/world.ts`: `vacancyWorld({ styleRefs? })` passa o falso ao `VacancySettingsService`.
  - `instagram/__tests__/harness.ts:196`: o default `style_refs_enabled: false`.

**Interfaces:**
- Consumes: `pickNotes` (Task 8, com a seleção da Task 10), `normalizeText` (Task 8), `StyleRefsUsed` (Task 2) e `ig_posts.style_refs` (Task 3).
- Produces:
  - `type PhotoStyle = { paleta: string[]; luz: string[]; clima: string[] }`.
  - `StyleRefsService.loadPhotoStyle(ws: string, brandId: string | null, subject: string): Promise<{ style: PhotoStyle; used: StyleRefsUsed } | null>` e `StyleRefsService.notesInUse(ws: string, brandId: string): Promise<number>`.
  - `RefsService.loadPhotoStyle(...)`, com o mesmo retorno (erro → `null` + log).
  - `photoStyleLines(style: PhotoStyle): string[]` e `photoPrompt(funcao: string, styleLines: string[] = []): string`.
  - `ArtResult.styleRefs: StyleRefsUsed | null`.
  - `VacancySettingsView` ganha `style_refs_enabled: boolean`, `style_brand: { id: string; name: string } | null` e `style_refs_in_use: number`.
  - `UpdateVacancySettingsDto.style_refs_enabled?: boolean` (`@IsOptional() @IsBoolean()`).
  - `VacancySettingsService` recebe `@Optional() styleRefs?: StyleRefsService` como último argumento.

Regras (P14):
- `photoStyleLines` monta até 3 frases afirmativas: `"Cores da cena: {c1}, {c2}."`, `"Luz {l1}; {l2}."` e `"Clima {k1}; {k2}."`. Cada item passa pelo filtro da P14 antes; frase sem item não entra; o total fica ≤ 300, tirando as últimas frases.
- `photoPrompt(funcao, [])` é **idêntico** ao de hoje. Com frases, elas entram logo antes de `"Sem nenhum texto, letra, número, placa, fachada, nome ou logo."`, que continua por último.
- `makeArt`:
  - `style = s.style_refs_enabled ? await this.refs.loadPhotoStyle(ws, s.brand_id, \`Vaga de ${f.funcao}\`) : null`.
  - `lines = style ? photoStyleLines(style.style) : []`.
  - A tentativa 1 usa `photoPrompt(f.funcao, lines)`, a 2 usa `photoPrompt(f.funcao)`.
  - `styleRefs = style.used` só quando a foto aceita foi a 1ª e `lines.length > 0`.
- `handOff` grava `ig_posts.style_refs = { ...(art.styleRefs ?? { own: [], library: [] }), brand_id: s.brand_id }` quando `s.style_refs_enabled`, e `null` com ele desligado.

- [ ] **Step 1: Contrato §26.**
  - `VacancySettingsView` ganha:
    - `style_refs_enabled: boolean` (padrão `false`).
    - `style_brand: { id, name } | null` (a marca das vagas, a mesma da arte modelo).
    - `style_refs_in_use: number` (quantas referências a escolha usaria, próprias + seleção, até 4).
  - `PATCH settings` aceita `style_refs_enabled?: boolean`.
  - Regra: ligado, a 1ª foto leva só paleta, luz e clima afirmativos das referências da marca (assunto "Vaga de {função}"); a 2ª tentativa vai sem; vale para a prévia; o post de vaga grava `style_refs`.

- [ ] **Step 2: Testes que falham.**
  - `generator.spec.ts`, `describe('pedido da foto da vaga')`:

```ts
it('com estilo: frases afirmativas antes do "Sem nenhum texto…", que fica por último', () => {
  const p = photoPrompt('Garçom', photoStyleLines({ paleta: ['laranja queimado', 'creme'], luz: ['de fim de tarde'], clima: ['aconchegante'] }));
  expect(p).toContain('Cores da cena: laranja queimado, creme. Luz de fim de tarde. Clima aconchegante. Sem nenhum texto, letra, número, placa, fachada, nome ou logo.');
  expect(p.endsWith('Sem nenhum texto, letra, número, placa, fachada, nome ou logo.')).toBe(true);
  expect(photoPrompt('Garçom', [])).toBe(photoPrompt('Garçom'));
});
it('Review Focus #5: negação e objeto com escrita saem (com e sem acento, plural e derivados)', () => {
  const l = photoStyleLines({
    paleta: ['laranja', 'rosa neon'],
    luz: ['sem sombras duras', 'nao ha sombra', 'quente de fim de tarde'],
    clima: ['bar com letreiros luminosos', 'garrafas âmbar ao fundo', 'rotulos coloridos', 'fachada iluminada', 'cartazes na parede', 'aconchegante'],
  });
  expect(l).toEqual(['Cores da cena: laranja.', 'Luz quente de fim de tarde.', 'Clima aconchegante.']);
  // "fachada" e "letra" já estão na frase final fixa ("Sem nenhum texto, letra, número, placa, fachada…"): confira pelo resto do item
  expect(photoPrompt('Garçom', l)).not.toMatch(/cardápio|letreiro|garrafa|rótulo|rotulo|neon|sombra|cartaz|iluminada/i);
  expect(photoStyleLines({ paleta: ['neon'], luz: ['nada de sombra'], clima: [] })).toEqual([]);
});
```

  - `generator.spec.ts`, em `makeArt`/`generateDue`. O falso é `styleRefs = { loadPhotoStyle: jest.fn(async () => ({ style: { paleta: ['laranja queimado'], luz: [], clima: [] }, used: { own: ['r1'], library: [] } })) }`.
    - `'interruptor desligado (padrão): nenhuma consulta e o pedido de hoje'`: `loadPhotoStyle` não é chamado e `imageCalls()[0].prompt === photoPrompt('Garçom')`.
    - `'ligado: 1ª foto com estilo; com letras, a 2ª vai sem notas e o registro fica vazio'`: `settings: { style_refs_enabled: true }`, leituras `[readFor(v, ['BAR DO ZÉ']), readFor(v)]`. O `loadPhotoStyle` é chamado com `(WS_A, brand.id, 'Vaga de Garçom')`. `imageCalls()[0].prompt` contém `'Cores da cena: laranja queimado.'`, `imageCalls()[1].prompt === photoPrompt('Garçom')` e `art.styleRefs` é `null`.
    - `'ligado e aceita de primeira: o post de vaga guarda style_refs'`: `posts()[0].style_refs` = `{ own: ['r1'], library: [], brand_id: brand.id }`.
  - `actions.spec.ts`, `'a prévia segue o interruptor da empresa'`: com `style_refs_enabled: true` e o falso, a 1ª chamada de `image` da prévia contém `'Cores da cena'`.
  - `settings.spec.ts`:
    - `'PATCH style_refs_enabled grava; o padrão é desligado'`.
    - `'view: style_brand com o nome e style_refs_in_use pela escolha'`: com o falso `{ notesInUse: async () => 3 }`, dá `style_brand: { id, name: 'Freela Serviços' }` e `style_refs_in_use: 3`.
    - `'sem marca → style_brand null e 0'`.

- [ ] **Step 3: Rodar e ver falhar.** `cd api && bash ../scripts/run-capped.sh 1500 npx jest src/modules/vacancy-stories/__tests__/generator.spec.ts`, depois `… actions.spec.ts` e `… settings.spec.ts`. Esperado: FAIL.

- [ ] **Step 4: Migração.** `20261116123000_vacancy_style_refs`: `ALTER TABLE "vacancy_story_settings" ADD COLUMN "style_refs_enabled" BOOLEAN NOT NULL DEFAULT false;` com comentário (Fatia 5, desligado por padrão; medir `used_fallback` por uma semana). `schema.prisma`: `style_refs_enabled Boolean @default(false)`. Aplicar e gerar.

- [ ] **Step 5: Implementar.**
  - Regras acima.
  - `loadPhotoStyle` chama `pickNotes(ws, brandId, null, subject)` (Task 8, com a seleção da Task 10). Nota completa dá `paleta`, `luz` e `clima`; nota reduzida dá `paleta` e `luz`. Os itens são juntados sem repetição, até 8 por lista (o corte 4/2/2 é do `photoStyleLines`, depois do filtro). `used` = notas que deram algum item; sem nota → `null`.
  - `notesInUse(ws, brandId)` = `(await pickNotes(ws, brandId, null, null)).length`.
  - `VacancySettingsService.view`: `style_brand` vem de `brands.findFirst({ where: { id: s.brand_id, workspace_id }, select: { id, name } })`. `style_refs_in_use` = `styleRefs?.notesInUse(ws, brand.id) ?? 0` (sem marca, 0).
  - `update` grava `style_refs_enabled` quando vier.

- [ ] **Step 6: Rodar e ver passar.** Os três comandos do Step 3. Esperado: PASS.

- [ ] **Step 7: Commit.** `feat(vagas): foto do story pode seguir paleta, luz e clima das referências da marca (desligado por padrão)` + Co-Authored-By.

### Task 14: Fatia 5 (web) — "Estilo da foto" nos Ajustes das Vagas

**Files:**
- Modify: `web/src/modules/vacancy-stories/infrastructure/vacancy-stories.api.ts:63,150` (schema + `VacancySettingsPatch`), `web/src/lib/vacancy-stories.ts`, `web/src/lib/vacancy-stories.test.ts`, `web/src/components/instagram/vacancies/settings-panel.tsx:55,264-271`, `web/scripts/browser-check.mjs` (`vagas`)

**Interfaces:**
- Consumes: campos da Task 13.
- Produces:
  - Schema: `style_refs_enabled: z.boolean().default(false)`, `style_brand: z.object({ id: z.string(), name: z.string() }).nullable().default(null)` e `style_refs_in_use: z.number().default(0)`. `VacancySettingsPatch` ganha `style_refs_enabled?: boolean`.
  - `photoStyleTexts(s: { style_brand: { id: string; name: string } | null; style_refs_in_use: number }): { title: string; option: string | null; help: string; warning: string | null; noBrand: string | null; cta: string | null; brandId: string | null }`.

Textos (ui.md §4, exatos): `title: "Estilo da foto"`, `option: "Seguir as referências da marca {nome}"`, `help: "Muda só as cores, a luz e o clima da foto. Textos, arte modelo e selos continuam iguais. Se a foto sair com letras, o sistema refaz sem as referências. Gere uma prévia para ver."`, `warning: "A marca {nome} ainda não tem referências em uso; ligar agora não muda nada."` com `cta: "Pôr referências"`, `noBrand: "As vagas ainda não estão ligadas a uma marca. Envie a arte modelo e a marca entra sozinha."`.

- [ ] **Step 1: Teste que falha.**

```ts
it('Estilo da foto nos Ajustes', () => {
  const t = photoStyleTexts({ style_brand: { id: 'b1', name: 'Freela' }, style_refs_in_use: 0 });
  expect(t).toMatchObject({ title: 'Estilo da foto', option: 'Seguir as referências da marca Freela', warning: 'A marca Freela ainda não tem referências em uso; ligar agora não muda nada.', cta: 'Pôr referências', brandId: 'b1', noBrand: null });
  expect(photoStyleTexts({ style_brand: { id: 'b1', name: 'Freela' }, style_refs_in_use: 2 }).warning).toBeNull();
  expect(photoStyleTexts({ style_brand: null, style_refs_in_use: 0 })).toMatchObject({ option: null, noBrand: 'As vagas ainda não estão ligadas a uma marca. Envie a arte modelo e a marca entra sozinha.' });
});
```

- [ ] **Step 2: Rodar e ver falhar.** `cd web && bash ../scripts/run-capped.sh 1500 yarn test src/lib/vacancy-stories.test.ts`. Esperado: FAIL.

- [ ] **Step 3: Implementar.**
  - `FIELDS` ganha `"style_refs_enabled"`.
  - Depois do `Field` "Quem faz a foto" entra `<Field title={t.title} hint={t.help}>`:
    - Com marca, um `Option type="checkbox"` com `t.option`, marcado por `value("style_refs_enabled")` e alterado com `set(...)`; entra no "Salvar ajustes".
    - `t.warning` aparece com o link `t.cta` para `/brands/$id?tab=guia`.
    - Sem marca, só `t.noBrand`.
  - `browser-check.mjs`, seção `vagas`: abrir os Ajustes e `check` de `"Estilo da foto"`.

- [ ] **Step 4: Rodar e ver passar.** O comando do Step 2. Esperado: PASS.

- [ ] **Step 5: Commit.** `feat(web): Estilo da foto nos Ajustes das Vagas` + Co-Authored-By.

### Task 15: Verificação final e roteiro de subida

**Files:**
- Create (texto pronto aqui; quem cria o arquivo é o Denner, fora do repositório): `~/meufunil-deploy/subir-pinterest-automatico.sh`
- Modify: nenhum arquivo do repositório, salvo correções que a verificação apontar (cada uma num commit `fix(...)`)

Rode **um comando por vez**, nesta ordem, cada um esperando o anterior. Se der 75 (sem memória livre), espere 2 min e repita. Se der 137 (estourou o teto), **não** suba o teto.

- [ ] **Step 1: jest das pastas mexidas.** `cd api && bash ../scripts/run-capped.sh 1500 npx jest src/modules/style-refs src/modules/ai src/modules/creative src/modules/instagram/__tests__/media-generation.spec.ts src/modules/vacancy-stories src/modules/workspaces src/modules/campaign-pilot src/common/__tests__/env-and-guard.spec.ts`. Esperado: todos PASS.
- [ ] **Step 2: tsc da API (uma vez).** `cd api && bash ../scripts/run-capped.sh 1500 npm run typecheck`. Esperado: sem erro.
- [ ] **Step 3: lint da API.** `cd api && bash ../scripts/run-capped.sh 1500 npm run lint`. Esperado: sem erro.
- [ ] **Step 4: vitest, tsc e lint do web (um por vez).**
  - `cd web && bash ../scripts/run-capped.sh 1500 yarn test`
  - `bash ../scripts/run-capped.sh 1500 yarn typecheck`
  - `bash ../scripts/run-capped.sh 1500 yarn lint`
  - Esperado: sem erro.
- [ ] **Step 5: smoke.** Na raiz: `scripts/run-capped.sh 1300 bash api/scripts/smoke-capped.sh`. Esperado: o resumo sem falha, e a subida loga "notas de estilo das referências ligadas".
- [ ] **Step 6: browser-check só dos grupos tocados**, um por vez, na raiz: `bash web/scripts/browser-check-sections.sh 1`, depois `2`, `4` e `9` (marcas; campanhas, com Aprovações; instagram; vagas). Mais o `3` (estúdio): o convite muda o `StudioPage`. Esperado: cada grupo com 0 falhas.
- [ ] **Step 7: Commit das correções** (se houver), uma por assunto.

**Quando subir (o desenho pede fatia a fatia, cada uma verificada antes da seguinte):**

| Depois da tarefa | Fatia | Sobe | O que conferir em produção |
|---|---|---|---|
| 1 | 0 | API | migração `20261116120000`; uma referência com a chave sem saldo fica `processing` com `attempts` 1 |
| 3 | 1 | API | migração `20261116121000`; refazer o antes e depois (`docs/superpowers/plans/2026-11-16-pinterest-teste-antes-depois.md`) comparando a nota do crítico; `--reler-notas-v1` (hoje 0 linhas) |
| 7 | 2 | API + web | Marca → Guia visual com o painel; "Logo e fotos da sua marca"; convite no Estúdio. **Não divulgar** às empresas até a Fatia 4 estar ligada |
| 9 | 3 | API | antes e depois de novo, com um pedido que casa com a categoria e um que não casa |
| 12 | 4 | API + web | migração `20261116122000`; `STYLE_LIBRARY_ENABLED` continua `false` até as decisões 1–3 do dono |
| 14 | 5 | API + web | migração `20261116123000`; interruptor desligado; `week.fallback` dos Ajustes anotado como "antes" |

Antes de cada subida, os Steps 1–6 acima rodam no commit daquela fatia.

**Roteiro** (`~/meufunil-deploy/subir-pinterest-automatico.sh`, no padrão do `subir-qualidade-artes.sh`; o Denner roda com `!`):

```bash
#!/usr/bin/env bash
# Sobe o Meu Funil com as referências do Pinterest automáticas (ramo feat/pinterest-automatico). Migrações aditivas
# (20261116120000…123000) rodam na subida da API. Chaves novas nascem DESLIGADAS (STYLE_LIBRARY_ENABLED=false; Estilo da foto
# das vagas desligado por empresa). Confere o servidor antes do build (16/11: dois builds juntos travaram a EC2 por 5h30).
# Uso: bash ~/meufunil-deploy/subir-pinterest-automatico.sh [--so-conferir] [--web] [--reler-notas-v1]
# Voltar a API: ssh ubuntu@56.124.127.54 'cd /opt/meu-funil && IMAGE_TAG=<TAG impresso abaixo> docker compose -f docker-compose.prod.yml up -d --no-build api'
#   (as colunas novas ficam; a imagem antiga não as usa). Voltar o web: subir de novo o ramo anterior com subir-web.sh.
set -euo pipefail
HOST=ubuntu@56.124.127.54
export BRANCH=feat/pinterest-automatico
export TAG=pre-pinterest-automatico-$(date +%Y%m%d-%H%M)
MIN_FREE_MB=1200
SO_CONFERIR=; WEB=; RELER=
for a in "$@"; do case "$a" in --so-conferir) SO_CONFERIR=1;; --web) WEB=1;; --reler-notas-v1) RELER=1;; esac; done

echo "=== conferindo o servidor antes de construir"
PRE=$(ssh -o ConnectTimeout=15 "$HOST" 'bash -s' <<'REMOTE'
set -u
builds=$(pgrep -af 'docker(-compose| compose| buildx)? .*(build|--build)|buildkit-runc|docker-buildx' | grep -v pgrep | head -5 || true)
echo "free_mb=$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo)"
echo "total_mb=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)"
echo "swap=$(awk '/SwapTotal/ {t=int($2/1024)} /SwapFree/ {f=int($2/1024)} END {print (t-f)" MB em uso de "t" MB"}' /proc/meminfo)"
echo "load=$(cut -d' ' -f1-3 /proc/loadavg)"
echo "disco=$(df -h / | awk 'NR==2 {print $5" usado, "$4" livres"}')"
echo "containers=$(docker ps --format '{{.Names}}' | tr '\n' ' ')"
echo "builds=${builds:-nenhum}"
REMOTE
)
echo "$PRE"
FREE=$(echo "$PRE" | sed -n 's/^free_mb=//p')
BUILDS=$(echo "$PRE" | sed -n 's/^builds=//p')
if [ "$BUILDS" != "nenhum" ]; then echo "PAREI: já existe um build rodando no servidor. Espere ele terminar e rode de novo."; exit 2; fi
if [ "${FREE:-0}" -lt "$MIN_FREE_MB" ]; then echo "PAREI: só ${FREE:-?} MB livres no servidor (mínimo $MIN_FREE_MB). Não vou construir assim."; exit 3; fi
[ -n "$SO_CONFERIR" ] && { echo "Servidor livre. (--so-conferir: não subi nada.)"; exit 0; }

# 2) API: backup do banco + imagem de volta $TAG + build + espera do /health (subir-api.sh já faz, com BRANCH/TAG do ambiente)
bash "$(dirname "$0")/subir-api.sh"

# 3) as migrações DESTA entrega (o subir-api.sh só lista 202610%)
ssh "$HOST" "docker exec meufunil-postgres psql -U meufunil -d meufunil -X -At -c \"select migration_name, finished_at is not null from _prisma_migrations where migration_name like '20261116%' order by 1\""
ssh "$HOST" 'docker logs --since 10m meufunil-api 2>&1 | grep -E "notas de estilo|successfully started" | tail -3'

# 4) só com --reler-notas-v1 (Fatia 1): conta e manda reler as notas antigas (sem "v"); o job style-refs-15min relê com a chave de cada empresa
if [ -n "$RELER" ]; then
  ssh "$HOST" "docker exec meufunil-postgres psql -U meufunil -d meufunil -X -At -c \"select count(*) from style_references where status='ready' and not (style_notes ? 'v')\""
  ssh "$HOST" "docker exec meufunil-postgres psql -U meufunil -d meufunil -X -At -c \"update style_references set status='processing', claimed_at=null, attempts=0, error=null where status='ready' and not (style_notes ? 'v')\""
fi

# 5) web na Vercel por CÓPIA sem git (só com --web e só depois da API nova no ar)
[ -n "$WEB" ] && BRANCH=$BRANCH bash "$(dirname "$0")/subir-web.sh"

# 6) conferir de fora
for u in https://api-meufunil.freelaservicosapp.com.br/health https://api.freelaservicosapp.com.br/health; do
  curl -s -m 15 -o /dev/null -w "$u -> %{http_code} em %{time_total}s\n" "$u"
done
ssh -o ConnectTimeout=15 "$HOST" 'docker logs --since 10m meufunil-api 2>&1 | grep -ciE "error|exception" | sed "s/^/linhas com erro no log da API nos últimos 10 min: /"; docker ps --format "{{.Names}}\t{{.Status}}" | grep -E "meufunil|freela" | head -8'
echo "Imagem de volta: meufunil-api:$TAG"
```

Operação depois da Fatia 4, **só com as decisões 1–3 do dono** (desenho §5.1):
1. Criar pela tela a empresa "Biblioteca Meu Funil" e uma marca por ramo, com `style_library_segment` gravado por SQL (sugestão do desenho: `equipe_vagas`, `acai_sorvete`, `bebida_bar`, `comida_churrasco`).
2. Decisão 2: chave de IA própria na Biblioteca, ou `ai_inherit_from` = Freela App.
3. Colar as pastas pela tela da Fatia 2.
4. No `/opt/meu-funil/.env`: `STYLE_LIBRARY_WORKSPACE_ID=<uuid>` e `STYLE_LIBRARY_ENABLED=true`, depois `docker compose -f docker-compose.prod.yml up -d --no-build api`.
5. Nunca conectar Instagram, Meta nem CRM na Biblioteca (Task 11).

Fatia 5: ligar o interruptor só na Freela App e comparar o `week.fallback` dos Ajustes (stories sem foto) de 7 dias antes e depois. Se piorar, desligar.

## Auto-revisão (feita ao fechar o plano)

1. **Cobertura do desenho.**
   - Fatia 0: Task 1. Fatia 1: Tasks 2 e 3; reler notas antigas na P15 e no roteiro.
   - Fatia 2: API na Task 4; painel, estados e celular na 5; renomear as fotos na 6; convite na 7.
   - Fatia 3: Tasks 8 e 9. Fatia 4: Tasks 10–12; auditoria dos jobs, bloqueio de exclusão e "A não lê B" nas 2, 10 e 11. Fatia 5: Tasks 13 e 14.
   - Verificação (§6): Task 15.
   - "Só divulgar com a Fatia 4": tabela da Task 15. Medir `used_fallback`: roteiro.
2. **Passos.** Cada passo de código traz a assinatura e os valores fixados. Os algoritmos que a assinatura não determina estão escritos: orçamento (P4/P5), ordem (Task 8), filtro da foto (P14) e intervalo das tentativas (P1).
3. **Tipos.**
   - `StylePick`/`StyleRefsUsed`/`StyleRefsRecord` (Task 2) são usados iguais nas Tasks 3, 7, 10 e 13.
   - `loadStyleNotes` ganha o `subject` só na Task 8.
   - `chooseNotes` (Task 8) é reaproveitado nas Tasks 10 e 13.
   - `styleInvite` (Task 7) ganha o caso só-seleção na Task 12.
4. **Review Focus.** Os 5 itens têm teste na tarefa dona (1, 1, 2, 3, 13).
5. **Proporção.** O plano tem cerca de 1.000 linhas, contra 276 do desenho e das telas juntos. O excesso vem do que o desenho delegou (§7): a lista de categorias e os sinônimos, os textos de prompt e de tela, as regras de orçamento e de filtro e o roteiro de subida. Corpos de função não foram escritos; ficaram só assinaturas, testes e esses valores.

---

## Rodada 2 (17/11) — Seleção do Meu Funil automática, em cada empresa

Desenho: Fatia 4 v4 (`…-design.md`, §5.1 com as respostas do Denner de 17/11) e ui.md §3 v4. Substitui as P11 e o bloqueio de exclusão
da P12. As Tasks 10–12 já construídas (empresa central) são **desfeitas** nas Tasks 17–19; nada delas está em produção.

### Decisões do plano (rodada 2)

- **P16. Catálogo** (`api/src/modules/style-refs/selection-catalog.ts`), montado em 17/11: pastas achadas por WebSearch (domínio
  pinterest.com), cada uma conferida pelo RSS oficial com o User-Agent da API (200 e ≥ 16 Pins com imagem `i.pinimg.com`) e por uma folha
  de 12 miniaturas 236x (foto de verdade do ramo). Recusadas: `railma104maria/acai` (artes com texto), `nikxpope09/smoothie-bowl-mood-board`
  (paletas e infográficos), `jeffzoet/beer-photography` (rótulos e logos), `anjomercado/burger-mood-board` (anúncios de marca),
  `sarajanegraham/…` (8 Pins), `abhikamble7/kebab-photography` (404). Toda URL na forma `https://www.pinterest.com/<usuario>/<pasta>/`.

  | ramo (id) | pastas (usuário/pasta) |
  |---|---|
  | `equipe_vagas` | `dickylesmana/chef-group-photos`, `sarahnathan2710/chef-photoshoot`, `denmar_85/bartender` |
  | `acai_sorvete` | `stellarfooddiary/acai-bowls-photography`, `amyrosehancock/smoothie-bowl-food-photography` |
  | `comida_hamburguer` | `abedelkarem/burger-photography`, `tsscreative/burger-mood-board`, `danneville338/burger-photography` |
  | `comida_churrasco` | `kosherburrito/grilling-photos`, `setarehahmadi137122/kebab-photo`, `illiquid1/food-photography-steak` |
  | `bebida_bar` | `jswordie/public-houses`, `hixfarmbrewery/beer-photography`, `hb834311/cocktail-bar-photo-shoot` |
  | `ambiente` | `kcarter1927/menu-photoshoot`, `emmacarava/restaurant-ambiance`, `thegalleryau/fresh-food-interiors` |

  - `SELECTION_BRANCHES` = a ordem acima (é também a prioridade do reconhecimento): uma marca "vagas para bares e restaurantes" cai em
    `equipe_vagas`, não em `bebida_bar`.
  - `selectionBranchFor(segment)`: categorias de `subjectCategories(segment)` **mais** os apelidos só de reconhecimento
    `SEGMENT_ALIASES` (`gastronomia`, `gastronomica`, `gastronomico`, `restaurantes` → `ambiente`), e devolve o primeiro ramo de
    `SELECTION_BRANCHES` presente. `CATEGORY_SYNONYMS` não muda (ele também ordena as notas, Task 8).
  - Teste sem rede: cada URL passa em `parsePinterestLink` como `board`; todo ramo é id de `STYLE_CATEGORY_IDS`; 2 ou 3 pastas por ramo; sem
    URL repetida.
- **P17. Origem.** `style_ref_sources.origin` e `style_references.origin`: `text NOT NULL DEFAULT 'own'`, CHECK `in ('own','selection')`. A
  referência herda a origem da pasta no `sync`; envio e Pin colado são sempre `own`.
- **P18. Seleção ligada** = `STYLE_LIBRARY_ENABLED && STYLE_REFS_PINTEREST_ENABLED` (a Seleção só existe pelo RSS). Igual em
  `features.style_library` e no serviço. **Desligada = inerte**: nada é criado, renovado, lido nem usado na escolha, e nada é apagado.
- **P19. Ramo da marca.** `brands.style_library_segment`: `NULL` = automático por `selectionBranchFor(brands.segment)`; id de ramo do
  catálogo = escolhido; `'none'` = "Nenhum desses". Valor gravado que não é ramo do catálogo = automático. `UpdateBrandDto` aceita só os
  ramos do catálogo, `'none'` e `null`. `resolveSelectionBranch(brand)` → `{ segment: StyleCategoryId | null; source: 'auto' | 'chosen' | 'none' }`.
- **P20. Reconciliação** (`StyleRefsService.reconcileSelection(ws, brandId)`, idempotente):
  - Só com a Seleção ligada (P18). Alvo `T` = pastas do ramo resolvido quando `style_library_enabled` e ramo ≠ nulo; senão `T = []`.
  - Pasta `origin='selection'` da marca fora de `T` sai com as referências dela (linha + arquivo). Isso vale sempre, com ou sem chave.
  - Pasta de `T` que falta é criada (`origin='selection'`, `created_by = null`, `last_synced_at = null`) **só se a empresa tem chave de IA**
    (`AiKeysService.get(ws,'openai') || get(ws,'gemini')`; herdada da agência conta, é a mesma que a leitura usa). Colisão no índice único
    com uma pasta própria igual = fica a própria (não cria).
  - Grava `brands.style_library_checked_at = now()`.
  - Gatilhos: (a) `BrandsService.update` quando o corpo traz `segment`, `style_library_enabled` ou `style_library_segment` — erro da
    reconciliação vai para o log e **não** derruba o `PATCH`; (b) job `style-refs-15min`: `reconcileDueBrands(10)` = marcas com
    `style_library_checked_at` nulo ou com mais de 6 h, nulas primeiro. Depois de criar pastas, um "chute" em segundo plano (atrás de
    `autoProcess`, como o `kick` de hoje) sincroniza as pastas novas da marca e lê as pendentes.
- **P21. Tetos da Seleção.**
  - `SELECTION_REFS_CAP = 12` referências da Seleção por marca; `SELECTION_PINS_PER_SYNC = 4` por pasta em cada sincronização;
    `SELECTION_DAILY_NEW = 12` referências da Seleção criadas por marca em 24 h corridas (conta `created_at`) — é a cota diária de leitura.
  - **A Seleção não gira:** só preenche vaga (até o teto), nunca tira referência antiga para pôr nova.
  - A Seleção só traz Pins novos quando é útil: a marca tem **menos de 4** próprias prontas sem campanha e a empresa tem chave. Senão o sync
    só grava `last_synced_at` (sem erro).
  - Total da marca ≤ 30 (`BRAND_CAP`): a Seleção só usa o espaço livre e nunca tira referência própria. Ao pôr uma própria, `makeRoom` tira
    primeiro as da Seleção (mais antigas), depois as próprias vindas de pasta, como hoje.
  - `SOURCE_CAP` (5 pastas) conta só `origin='own'`. Referência da Seleção `failed` sai no início do sync daquela pasta (o Pin fica em
    `seen_pin_ids` e não volta).
- **P22. Renovação das pastas no job.** `refreshDueSources(5)`: o vencimento vai no `where` (`last_synced_at` nulo ou com mais de 24 h,
  nulos primeiro); pastas da Seleção só entram com a Seleção ligada (P18).
- **P23. Escolha.** `pickNotes` lê as prontas da marca como hoje e separa por `origin`: as próprias vão para `chooseNotes(own, …)`; as da
  Seleção (sem campanha) entram como `library` só com a Seleção ligada e `style_library_enabled` da marca. Nenhuma consulta sem
  `workspace_id` = a empresa. O registro por peça (P6) não muda de forma: `style_refs.library` = ids das referências da Seleção da própria
  empresa.
- **P24. `GET /style-refs/library`** (read; 404 com a Seleção desligada):
  `{ segment, segment_label, segment_source, brand_segment, options: [{ id, label }] (ramos do catálogo na ordem de P16), enabled,
  needs_ai_key, sources_count, count (prontas da Seleção na marca), reading (da Seleção em processing), own_ready, in_use }`, com
  `in_use = enabled && segment && count > 0 && own_ready < 4`. Sai `descriptions`.
- **P25. `GET /style-refs`.** `refs[].origin` e `sources[].origin`; `limits.in_brand` passa a contar só as próprias; `limits.in_selection` =
  referências da Seleção na marca.
- **P26. Parar pasta da Seleção:** `DELETE /style-refs/sources/:id` numa pasta `origin='selection'` → `400` com o texto do ui.md §3 (a
  reconciliação a recriaria). Remover uma referência da Seleção continua valendo (o Pin fica em `seen_pin_ids`).
- **P27. Convite "Estilo: …"** (Estúdio, Aprovações, Pacote do piloto) só aparece com `features.style_library`.
- **P28. Sai a empresa central:** `STYLE_LIBRARY_WORKSPACE_ID` (`env.validation.ts` + `superRefine`, `api/.env.example`, `docker-compose.yml`,
  `docs/deploy/.env.prod.example`, testes), `libraryActiveFor`, `libraryFor`, o bloqueio `STYLE_LIBRARY` da exclusão (`workspace-deletion.ts`,
  `ERR_STYLE_LIBRARY`, o 4º argumento do `WorkspaceDeletionService`), o parágrafo "Biblioteca e os jobs" do contrato §28 e o item do §31.
- **P29. Migração nova** `20261117120000_style_selection` (aditiva): as duas colunas `origin` (+ CHECK) e `brands.style_library_checked_at
  timestamptz`. A `20261116122000_style_library` **não é editada** (já aplicada no banco local; o índice parcial dela fica sem uso e é
  inofensivo).
- **P30. Textos novos** = ui.md §3 v4, depois da revisão do ux-designer (os textos finais ficam lá; as tarefas copiam de lá).

### Revisão do software-architect (17/11) — incorporada; vale MAIS que as P16–P30 acima onde elas divergem

- **P20′. Gatilho, fila por marca e corridas.**
  - O `BrandsService.update` grava, no MESMO `update`, `style_library_checked_at = null` quando o corpo traz `segment`, `style_library_enabled`
    ou `style_library_segment` (o "Salvar" da Marca manda `segment` sempre). Depois põe `reconcileSelection(ws, brandId)` na fila **em segundo
    plano, sem esperar** (o `PATCH` nunca fica lento nem falha por causa da Seleção; erro vai para o log). O job pega primeiro as marcas com
    `checked_at` nulo, depois as com mais de 6 h.
  - **Fila em memória por marca** (`KeyedQueue`, chave `ws:brand`; a API roda numa instância só, `CLAUDE.md`): reconciliação, `sync` (própria e
    da Seleção) e `removeSource` da mesma marca rodam um de cada vez. A reconciliação relê a marca com `{ id, workspace_id }` dentro da fila.
  - Violação do índice único ao criar a pasta = a pasta já existe (segue). Se o `updateMany` final do `sync` devolver `count 0` (pasta apagada
    no meio, ex.: cascade), o `sync` apaga as referências e os arquivos que ele mesmo criou nesta rodada.
  - **Chave herdada da agência conta** como chave da empresa (é a mesma que a leitura usa). **(decisão do plano; vai ao dono)**
- **P21′. Tetos, cota e falhas (troca a P21).**
  - Vaga da Seleção = `min(12 − referências da Seleção na marca, 30 − total da marca, cota que sobra hoje)`, calculada **sem apagar nada**
    (o `sync` da Seleção nunca chama o `makeRoom` de hoje). A vaga é decidida **antes** de buscar o RSS: vaga 0 = só grava `last_synced_at`
    (sem rede). Até 4 por pasta em cada `sync`.
  - **Útil** = a marca tem menos de 4 próprias (prontas **ou** `processing`) sem campanha. **Sem gasto com a chave em apuros:** não traz Pin
    novo se `AiCreditAlertsService.status(ws)` não é nulo (sem saldo ou limite do dia) ou se alguma referência da Seleção da marca está
    `processing` **esperando nova tentativa** (`attempts > 0`; leitura nova não freia — Ruling R11 de 17/11, senão a marca nova enchia 1 pasta por dia).
  - **Cota por dia de Brasília:** colunas `brands.style_selection_day date` e `brands.style_selection_reads int NOT NULL DEFAULT 0`. Dia ≠
    `todaySp()` → zera. Máximo 12 novas por marca por dia, gravadas por `updateMany` condicionado aos valores lidos (sem `increment`). Ligar,
    desligar e trocar de ramo não zeram a cota.
  - **Falha da leitura:** `failed` transitória esgotada (`attempts = 3`) da Seleção **volta para a fila** (`processing`, `attempts 0`,
    `claimed_at null`, `error null`) no `sync` da pasta quando não há aviso de crédito nem referência da Seleção esperando nova tentativa. Só a
    `failed` definitiva (`attempts < 3`) sai, e o Pin fica em `seen_pin_ids`.
  - Ao pôr uma própria, `makeRoom` tira primeiro as da Seleção (mais antigas), depois as próprias vindas de pasta, como hoje. `SOURCE_CAP` (5)
    conta só as próprias.
- **P22′. Leitura e renovação.** `processPending(limit)` faz duas consultas: próprias primeiro; com o que sobrar do `limit`, as da Seleção (só
  com a Seleção ligada). Com a Seleção desligada, nada da Seleção é lido; a `list` também esconde pastas e referências da Seleção.
  `refreshDueSources` como na P22 (vencimento no `where`, `orderBy: { last_synced_at: { sort: 'asc', nulls: 'first' } }`).
- **P26′. Colisões = promover para própria.** Colar o link de uma pasta que já é da Seleção na marca promove a pasta e as referências dela a
  `origin='own'` (confere o teto de 5 próprias com a mensagem de hoje). Colar um Pin que a Seleção já trouxe promove essa referência a
  própria e a devolve (sem "já está"). `DELETE` de pasta da Seleção → `400` (texto do ui.md §3).
- **P31. Só a chave da empresa.** `AiService.json` ganha a opção `ownKeysOnly` (sem cair no gateway do app; sem chave → `AI_NOT_CONFIGURED`,
  falha das chaves → `AiKeysFailedError`). A leitura de referência `origin='selection'` usa `ownKeysOnly: true`.
- **P32. `FakeTable` (`api/src/modules/brands/__tests__/fake-prisma.ts`).** Corrigir o `not` (hoje, pela precedência, nunca exclui a linha
  igual ao valor), aceitar `nulls` no `orderBy` e criar `deleteMany`. O espião do teste de isolamento cobre `findMany`/`findFirst`/`count`/
  `create`/`updateMany`/`delete`. Depois de mexer no `FakeTable`, rodar por arquivo os specs que o usam (`grep -rl fake-prisma api/src`).
  Código novo não usa `AND`, `NOT`, `notIn`, `equals` nem filtro por relação (o fake devolve `true` em silêncio).
- **P33. Pasta do catálogo quebrada** (404, privada, vazia): o painel já mostra o `last_error` da pasta; o roteiro de subida ganha
  `--conferir-selecao`, que lista as pastas da Seleção com erro. Trocar a pasta = editar o catálogo (a reconciliação troca nas marcas).
- **Ficou como está (com o porquê):** "Pins fixos em vez de pastas" — a ordem do dono é pasta acompanhada pelo RSS; com a vaga decidida
  antes do RSS, pasta cheia não gera chamada nenhuma. "Ligar por lista de empresas": a chave do servidor é uma só (ordem do coordenador);
  o risco de gastar a chave de todos ao ligar vai ao dono.
- **Acréscimos à P28:** comentários de `env.validation.ts` e `schema.prisma` sobre a Biblioteca; `web/src/lib/style-refs.ts` ("Outras empresas
  do mesmo ramo também usam."), `LIBRARY_*`/`StyleLibraryView` antigos; o roteiro de subida. Filtro das migrações no roteiro:
  `migration_name ~ '^2026111[67]'` (o `LIKE` não entende `[67]`).
- **Tasks:** a migração da Task 16 leva também `style_selection_day`/`style_selection_reads`; o `FakeTable` (P32) entra na Task 16; P31 e P26′
  entram na Task 18; P22′ (as duas consultas) na Task 18.

### Revisão do ux-designer (17/11) — incorporada (textos finais no ui.md §3, revisado)

- **P34. Vista `GET /style-refs/library` (troca a P24):** `{ segment, segment_label, segment_source, brand_segment, options: [{ id, label }],
  enabled, needs_ai_key, ai_credit: null | 'no_credit' | 'daily_limit', daily_left, sources_count, count, reading, own_ready, in_use }`.
  `ai_credit` vem do `AiCreditAlertsService.status(ws)` (o motivo do 1º provedor em alerta; `null` sem alerta). `daily_left` = `12 −
  style_selection_reads` (dia de hoje) ou 12. `own_ready` conta as próprias prontas **e** em `processing` sem campanha (a mesma régua do
  "útil" da P21′). Sai `descriptions`.
- **P35. Rótulos e ordem de tela da Seleção** (no catálogo, `SELECTION_OPTIONS`): "Açaí e sorvete" (`acai_sorvete`), "Hamburgueria e lanches"
  (`comida_hamburguer`), "Churrasco e espetinho" (`comida_churrasco`), "Bar e bebidas" (`bebida_bar`), "Restaurante" (`ambiente`), "Vagas e equipe"
  (`equipe_vagas`), nesta ordem. `options[].label` e `segment_label` usam esses rótulos. A prioridade do reconhecimento (P16) não muda.
- **P36. Colar algo que já veio da Seleção** (P26′) devolve `promoted: true` (pasta: `{ kind, added, promoted }`; Pin: o item + `promoted`).
  O `400` de parar pasta da Seleção tem `code: 'SELECTION_SOURCE'` e a mensagem do ui.md §3.9.
- **P37. Chave cadastrada em Integrações** (`integrations/ai-keys-actions.service.ts`, ao gravar uma chave) põe as marcas da empresa e das que
  herdam dela (`ai_inherit_from`) na frente da fila: `brands.style_library_checked_at = null` (só banco; erro vai para o log e não derruba a
  gravação da chave).
- **P38. Tela** (Tasks 19–20): pastas e referências da Seleção ficam **dentro** do bloco "Seleção do Meu Funil", abaixo do interruptor; a
  lista de cima mostra só as próprias ("Suas pastas acompanhadas", "Suas referências"); estados 1–12 da §3.3; troca de ramo com
  [Usar este ramo] (tocar só marca); confirmação ao desligar com referências; a tela esconde na hora as referências da Seleção ao desligar
  ou trocar; região viva única na seção "Estilo das artes" da Marca; conferência da vista a cada 10 s por até 10 min nos estados 10b/11/12
  com `reading` > 0; "Abrir Integrações" só para dono ou administrador (`useWorkspace().role`). Convite misto na §5.
- **Fica com o dono:** `brands.style_library_enabled` nasce `true` (automático, como o dono pediu) — ao ligar a chave do servidor, toda marca
  com chave de IA e menos de 4 próprias passa a gastar até 12 leituras por dia (o ui.md §3.2 diz isso na tela). Estimativa de custo em reais
  não entra (sem fonte).
- **Tasks:** a Task 19 vira duas: **Task 19** (web) = textos/regras puras (`lib/style-refs.ts`), esquemas da API, painel de cima só com as
  próprias e convite (§5 + P27); **Task 20** (web) = bloco da Seleção (estados, ramo, ligar/desligar, lista da Seleção, região viva,
  conferência). A verificação passa a ser a **Task 21**. A Task 17 já entrega a vista da P34; a Task 18 entrega P36 e P37.

### Regras desta rodada (além das de sempre)

- Memória: antes de cada comando pesado, `awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo` ≥ 2300; senão esperar 60 s e conferir de
  novo. Jest **por arquivo**, nunca a pasta inteira. Um subagente por vez; smoke e browser-check só na Task 20, um grupo por vez.
- O Postgres local sobe para as migrações e para no fim (`docker compose stop postgres`).

### Task 16: Migração `origin` + catálogo de pastas por ramo (sem mudar comportamento)

**Files:** Create `api/prisma/migrations/20261117120000_style_selection/migration.sql`, `api/src/modules/style-refs/selection-catalog.ts`,
`api/src/modules/style-refs/__tests__/selection-catalog.spec.ts`. Modify `api/prisma/schema.prisma` (`style_ref_sources.origin`,
`style_references.origin`, `brands.style_library_checked_at`), `style-refs.service.ts` (`store` grava a origem recebida; `sync` repassa a da
pasta), `__tests__/style-refs.service.spec.ts` (defaults `origin: 'own'` nas duas tabelas e `style_library_checked_at: null` em `brands`).

**Interfaces (Produces):** `SELECTION_CATALOG: Readonly<Partial<Record<StyleCategoryId, readonly string[]>>>`, `SELECTION_BRANCHES:
readonly StyleCategoryId[]`, `isSelectionBranch(v: unknown): v is StyleCategoryId`, `selectionBranchFor(segment: string | null | undefined):
StyleCategoryId | null`, `SEGMENT_ALIASES`.

- [ ] Teste que falha (`selection-catalog.spec.ts`): forma do catálogo (P16); `selectionBranchFor`: `'Açaiteria Frutá'` → `acai_sorvete`;
  `'Hamburgueria do Zé'` → `comida_hamburguer`; `'Espetinho e chopp'` → `comida_churrasco`; `'Vagas para bares e restaurantes'` →
  `equipe_vagas`; `'Gastronomia contemporânea'` → `ambiente`; `'Restaurante'` → `ambiente`; `'Floricultura'` → `null`; `''`/`null` → `null`.
- [ ] Migração (comentário com o porquê, P17/P29) e `schema.prisma`; aplicar e gerar (`run-capped 1500 npx prisma migrate deploy` e
  `… npx prisma generate`; conferir com `npx prisma migrate status`).
- [ ] Implementar, rodar `selection-catalog.spec.ts` e `style-refs.service.spec.ts` (um por vez). Commit `feat(style-refs): catálogo de pastas
  da Seleção por ramo e origem das pastas e referências`.

### Task 17: Sai a empresa central; a escolha e a tela leem a Seleção da própria marca

**Files:** `docs/api-contract.md` (§3, §10, §28, §31) **antes**; `style-refs.service.ts` (sem `libraryWs`/`libraryActiveFor`/`libraryFor`;
`selectionOn()`; `pickNotes` por origem, P23; `library()` com a vista da P24, `needs_ai_key` pelo `AiKeysService` injetado), `style-pick.ts`
(`resolveSelectionBranch` no lugar de `resolveLibrarySegment`), `brands/dto/brands.dto.ts` (P19), `common/config/env.validation.ts`,
`api/.env.example`, `docker-compose.yml`, `docs/deploy/.env.prod.example`, `workspaces/{features.service,workspace-deletion,
workspace-deletion.service}.ts` (P18, P28). Testes: `style-refs.service.spec.ts` (troca o mundo da Biblioteca pelo da própria marca),
`style-pick.spec.ts`, `brands-dto.spec.ts`, `env-and-guard.spec.ts`, `features.spec.ts`, `workspace-deletion.spec.ts`.

- [ ] Testes que falham, entre eles: própria primeiro e Seleção completando (`used.library` = ids da Seleção **da mesma empresa**);
  interruptor da marca desligado → só próprias; Seleção desligada (cada uma das duas chaves) → linhas `origin='selection'` não entram e
  nenhuma consulta extra; "empresa A não lê notas de B": A e B com a **mesma** pasta da Seleção, espião em `findMany`/`count` prova
  `workspace_id === WS` em toda consulta de A e nenhum id de B em `used`; `library()`: vista da P24 (sem `descriptions`, `needs_ai_key`
  true/false pelo fake de chaves, `options` = catálogo), 404 com a Seleção desligada, viewer lê, não-membro 403, marca de outra empresa 404;
  `features.style_library` = as duas chaves; o env não conhece mais `STYLE_LIBRARY_WORKSPACE_ID`; a exclusão não tem mais o bloqueio.
- [ ] Implementar e rodar cada spec tocado, um por vez. Commit `refactor(style-refs): Seleção do Meu Funil sai da empresa central e passa a
  ser da própria marca`.

### Task 18: Reconciliação automática, sincronização e tetos da Seleção

**Files:** `docs/api-contract.md` §28 **antes**; `style-refs.service.ts` (`reconcileSelection`, `reconcileDueBrands`, `refreshDueSources`
P22, `sync` P21, `makeRoom` P21, `SOURCE_CAP` só própria, `list` P25, `removeSource` P26), `style-refs-cron.service.ts` (`tick` =
reconciliar → renovar → ler), `brands/brands.service.ts` (gatilho da P20; injeta `StyleRefsService`, que é `@Global`), testes
`style-refs.service.spec.ts` e `brands` (spec que já cobre o `update`, ou um novo `__tests__/brands-selection.spec.ts`).

- [ ] Testes que falham, entre eles: ramo resolvido + chave → cria as pastas do catálogo com `origin='selection'`; sem chave → nada e
  `needs_ai_key`; desligar / `'none'` / trocar de ramo → saem as pastas e as referências da Seleção (e entram as do ramo novo); Seleção
  desligada → reconciliação não faz nada (nem apaga); pasta própria igual à do catálogo → fica a própria; `PATCH` com erro na reconciliação
  ainda responde 200; job pega marca com `checked_at` nulo e não repete antes de 6 h; sync da Seleção: até 4 por pasta, teto 12, cota 12/24 h,
  não gira, não passa de 30 no total, não tira própria, só com < 4 próprias prontas e com chave; própria nova tira a da Seleção primeiro;
  6ª pasta própria com 3 da Seleção é aceita; `removeSource` da Seleção → 400; `refreshDueSources` com 200 pastas em dia e 1 vencida acha a
  vencida; `list` com `origin`, `in_brand` só próprias e `in_selection`.
- [ ] Implementar e rodar cada spec tocado, um por vez. Commit `feat(style-refs): Seleção do Meu Funil automática em cada marca (pastas do
  catálogo pelo ramo, com a chave de IA da empresa)`.

### Task 19 (web): painel com a Seleção da própria marca e convite atrás de `features`

**Files:** `web/src/lib/style-refs.ts` + `.test.ts` (textos do ui.md §3 v4; `refOrigin` com a origem; estado "sem chave" e "lendo"),
`web/src/modules/style-refs/infrastructure/style-refs.api.ts` (`origin` com default `'own'`, vista da P24 com defaults), `web/src/components/
style-library.tsx` (sem "Ver as descrições"; "Trocar o ramo"; aviso sem chave com link para `/integrations`), `web/src/components/
style-refs-panel.tsx` (pasta da Seleção sem "Parar", rótulos), `web/src/components/style-invite.tsx` (P27, `useWorkspace` + `useFeatures`),
`web/scripts/browser-check.mjs` (só se algum texto conferido mudar).

- [ ] Testes que falham (vitest de `lib/style-refs.test.ts`); implementar; rodar o arquivo. Commit `feat(web): Seleção do Meu Funil
  automática no painel da Marca e convite só com a Seleção ligada`.

### Task 21: Verificação, merge do `fix/texto-cortado-arte`, roteiro e revisão final (coordenador)

Jest por arquivo dos specs tocados nas Tasks 16–20 e dos de sempre (`creative.service`, `media-generation`, `compose`); `tsc` da API e do web
uma vez cada; lint sem `--fix`; smoke; browser-check grupos 1 (marcas/configuração) e 3 (Estúdio), um por vez. `git merge
fix/texto-cortado-arte` e de novo os testes de compose, `creative.service` e `media-generation`. Roteiro
`~/meufunil-deploy/subir-pinterest-automatico.sh`: migração `20261117120000`, filtro `~ '^2026111[67]'`, sem `STYLE_LIBRARY_WORKSPACE_ID`,
notas de como ligar; `bash -n`, sem executar. `code-reviewer-pro` no ramo inteiro e correção de críticos/importantes.
