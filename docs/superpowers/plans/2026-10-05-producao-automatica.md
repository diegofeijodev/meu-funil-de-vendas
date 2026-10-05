# Produção de conteúdo automática e criativos melhores — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O "Programar com IA" no modo "Totalmente automático" passa a funcionar sem nenhum clique depois de criado (estratégia aprovada sozinha, post reprovado reescrito pela IA ou pulado, criativo produzido entre 48 h e 24 h antes, agendado e publicado no horário), com criativos melhores (contexto completo na arte, fotos de referência no gateway, headline na arte, carrossel com nota por slide) e vídeos com roteiro detalhado por tomada, primeiro quadro da marca/produto, áudio configurável, nota de qualidade com 1 refação e conversão para o padrão do Instagram.

**Architecture:** Evolui o fluxo existente (`ig_auto_runs` + `ig_posts.run_id`), sem tabela de fila nova. Parte A mexe em `AutoCalendarService` (estratégia automática, reescrita `rewriteFlagged`), em um `ProductionService` novo chamado pelo job `instagram-media-5min` (rodízio por empresa feito na SQL com `ROW_NUMBER()`), e em `PublishingService`/`IgStore` (`failure_kind`, sem conta/token → `ready`). Parte B monta um `PostCreativeContext` num só lugar (`PostContextService`) e o repassa ao diretor de arte; o `AiService` passa a mandar as fotos de referência ao gateway por `/images/edits` com recuo para texto. Parte C cria o `video-director.ts` (JSON estruturado da IA → montador determinístico em pt-BR), a porta `FFMPEG_RUNNER` + `FfmpegService` (quadros e conversão confinados num diretório temporário dentro de `UPLOADS_DIR`), `VideoQualityService` (crítico com 3 quadros) e `VideoConformService` (conversão + reingestão), e liga tudo num caminho de vídeo próprio da `MediaGenerationService` (síncrono ou pelo poller).

**Tech Stack:** NestJS 11 + Fastify + Prisma 5.22 + PostgreSQL 16 (API, npm, jest com `maxWorkers: 1`); Next.js 15 + React 19 + TanStack Query + vitest (web, yarn); `ffmpeg-static` 5.x (binário) com `FFMPEG_PATH` opcional; jimp (imagens); gateway de IA compatível com OpenAI (`/chat/completions`, `/images/edits`, `/images/generations`, `/videos`) e Veo pela chave Gemini.

**Spec:** `docs/superpowers/specs/2026-10-05-producao-automatica-design.md`

## Global Constraints

- Decisões do dono (spec §1) são fixas: **zero cliques** no "Totalmente automático"; post reprovado refeito pela IA **até 2×**, depois o horário é **pulado com aviso**; produzir a partir de **48 h antes**, meta **pronto até 24 h antes**; vídeo **Veo 3.1 fast**, foto da marca/produto como primeiro quadro, roteiro por tomada, nota de qualidade com **1 refação**; áudio **configurável** (`ambiente_trilha` / `narracao` / `sem_audio` + instruções livres) por execução e por post; o piloto por **plano** (`automation = null`) fica como está.
- Valores exatos: `IG_PRODUCTION_PER_TICK` = 4, `IG_PRODUCTION_WINDOW_HOURS` = 48, `IG_PRODUCTION_TARGET_HOURS` = 24, `MIN_VIDEO_SCORE` = 28 (crítico de vídeo, total 50), `FFMPEG_PATH` opcional; `MAX_REWRITES` = 2; atraso máximo de publicação 12 h (`OVERDUE_MS`); vídeo de 8 s, 9:16, no máximo 3 tomadas cobrindo 0–8 s sem buracos; roteiro final de 250–450 palavras e ≤ 3000 caracteres; quadros do crítico em 15 %, 50 % e 85 % da duração, JPEG ≤ 768 px; ffmpeg com tempo-limite de 120 s; conversão H.264 High, `yuv420p`, 30 fps, 1080×1920 (escala + preenchimento), AAC 48 kHz (silêncio quando `sem_audio`), `+faststart`, ≤ 60 s; `AI_MODEL_VIDEO` padrão `veo-3.1-fast-generate-preview` (chave própria cai para `veo-3.0-fast-generate-preview`); instruções de áudio ≤ 500 caracteres; espera do vídeo dentro do tick ≈ 25 s (`VIDEO_WAIT_MS`).
- Migração: `ig_posts.review_attempts int NOT NULL DEFAULT 0`; `ig_posts.failure_kind text NULL CHECK (failure_kind IN ('media','publish'))`; `ig_auto_runs.video_audio jsonb NOT NULL DEFAULT '{"modo":"ambiente_trilha","instrucoes":""}'`; `ig_autopilot_events.kind` ganha `strategy_auto_approved`, `post_rewritten`, `post_skipped`, `video_regenerated` (texto livre, sem CHECK novo).
- Todo comando pesado passa por `scripts/run-capped.sh <teto-MB> <comando>`: jest, typecheck e lint com **1500** (`cd api && ../scripts/run-capped.sh 1500 npm test -- <caminho>` / `npm run typecheck` / `npm run lint`; `cd web && ../scripts/run-capped.sh 1500 yarn typecheck|lint|test`); smoke via `scripts/run-capped.sh 1300 bash api/scripts/smoke-capped.sh`; browser-check via `bash web/scripts/browser-check-sections.sh <grupos>` (grupo **4** = instagram, grupo **3** = estudio). Migração também capada (`../scripts/run-capped.sh 1500 npx prisma migrate deploy`).
- Nunca `npm run build` / `nest build` / `next build`. Só uma coisa pesada de pé por vez; `typecheck` roda uma vez, sozinho, no fim de cada tarefa.
- O contêiner do Postgres fica normalmente parado: a tarefa que precisar dele roda `docker compose up -d postgres` (na raiz) e `docker compose stop postgres` no fim dessa mesma tarefa.
- Todo texto para o usuário em pt-BR (mensagens, eventos, prompts, telas). Erros sempre `{ error: { code, message } }` (lance `UserError`/`notFound`/exceções do Nest); funções que devolvem `{ ok:false, error }` continuam assim (HTTP 200).
- Autorização: rota de workspace exige `WorkspaceAccessService.require(userId, ws, 'read'|'write'|'manage')` ou `WorkspaceAccessGuard`; viewer só lê; toda id recebida é conferida contra o workspace (`workspace_id` em toda consulta).
- Variável nova entra em `api/src/common/config/env.validation.ts`, `api/.env.example` **e** `docker-compose.yml` (o teste `env-and-guard.spec.ts` confere).
- Mudou rota ou formato de resposta/corpo → atualize `docs/api-contract.md` na mesma tarefa.
- IA só via `AiService` (porta `AI_FETCH`); nenhum teste faz rede — use fakes. ffmpeg só via a porta `FFMPEG_RUNNER` (fake no jest; binário real só no smoke/browser-check).
- Leases sempre por `ig_posts.lease_until` (`IgStore.claimLease` + `PostLease.renew()` antes de cada chamada de IA/ffmpeg + `release()` no `finally`); reescrita (A2) e produção (A3) nunca rodam juntas no mesmo post.
- Texto livre do usuário (instruções de áudio, ajuste, orientação do cliente, nota do crítico) entra nos prompts delimitado por `« »` (com `«`/`»` removidos do conteúdo) e com teto de tamanho.
- `.prototype/` é só leitura; `api/` usa npm, `web/` usa yarn; wire em snake_case; data "só dia" em Brasília.
- Commits em pt-BR terminando com a linha `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; `git add` só dos arquivos da própria tarefa (nunca `git add -A`/`.`).

## Review Focus

1. Instagram desconectado ou token vencido numa empresa com muitos posts prontos: as outras empresas continuam sendo agendadas no mesmo tick e os posts da empresa sem conta voltam sozinhos quando ela reconecta, sem refazer mídia — teste em **Task 4** ("Review Focus #1").
2. Roteiro de vídeo malformado pela IA (tomadas fora de ordem, sobrepostas, além de 8 s, mais de 3, sem `fim_s`, cor que não é `#RRGGBB`, fala fora do modo narração) sai sempre válido: 1–3 tomadas contíguas de 0 a 8 s, ≥ 1 s cada — teste em **Task 9** ("Review Focus #2").
3. Post do modo totalmente automático que passa mais de 12 h do horário ainda sem criativo (ideia ou em reescrita) é pulado uma única vez — sem gastar IA, sem evento repetido nos ticks seguintes — teste em **Task 5** ("Review Focus #3").
4. Crítico de vídeo fora do ar, refação que falha ou que fica pendente e depois falha: o primeiro vídeo fica, o post termina `ready` e nunca prende em `generating`/`failed` — teste em **Task 11** ("Review Focus #4").
5. Áudio salvo pelo editor com valores inválidos ou enormes (modo inexistente, 5 kB de instruções, `« »` e quebras de linha): cai no áudio da execução, corta em 500 caracteres e entra delimitado no prompt; o DTO da programação recusa — testes em **Task 9** e **Task 11** ("Review Focus #5").

## Mapa de arquivos

| arquivo | responsabilidade | tarefa |
|---|---|---|
| `api/prisma/migrations/20261005150000_producao_automatica/migration.sql` | colunas `review_attempts`, `failure_kind` (+CHECK), `video_audio`; índice parcial da produção | 1 |
| `api/src/modules/media/ffmpeg.ts` | porta `FFMPEG_RUNNER`, runner real (processo filho, tempo-limite, prioridade baixa), argumentos da conversão | 1 |
| `api/src/modules/media/ffmpeg.service.ts` | diretório temporário confinado em `UPLOADS_DIR/.ffmpeg-tmp`, quadros e conversão | 1 |
| `api/src/modules/instagram/ig-types.ts` | tipos de evento novos + constantes (`SKIP_PREFIX`, `OVERDUE_MS`, mensagens) | 2 |
| `api/src/modules/instagram/auto-calendar.service.ts` | A1 (estratégia automática, semanas com estratégia própria), A2 (reescrita), resumo do período | 2, 3, 4, 5, 11 |
| `api/src/modules/instagram/production.service.ts` | A3 — produção antecipada (janela, rodízio, prioridade, pulados) | 5 |
| `api/src/modules/instagram/publishing.service.ts` | A4 — `failure_kind`, sem conta → `ready`, prazo vencido no modo `publish` | 3, 4 |
| `api/src/modules/creative/creative-context.ts` | `PostCreativeContext` + JSON para prompts + escolha da foto do produto | 6 |
| `api/src/modules/instagram/post-context.service.ts` | monta o `PostCreativeContext` do post (sempre dentro da empresa) | 6 |
| `api/src/modules/creative/art-director.ts` | contexto e fio visual na direção de arte | 6, 7 |
| `api/src/modules/ai/ai.service.ts` | refs no gateway (`/images/edits`), Veo 3.1 + 8 s + áudio | 7, 8 |
| `api/src/modules/creative/video-director.ts` | roteiro de vídeo: schema, prompt, normalização, montador | 9 |
| `api/src/modules/creative/video-quality.service.ts` | crítico de vídeo (3 quadros) | 10 |
| `api/src/modules/media/video-conform.service.ts` | conversão para o padrão do Instagram + reingestão | 10 |
| `api/src/modules/instagram/media-generation.service.ts` | ligação de tudo na geração (contexto, carrossel, vídeo, poller, upload) | 4, 5, 6, 7, 11 |
| `web/src/lib/instagram/production.ts` | regras puras da tela (contagens, aprovações, layout, patch do vídeo) | 12 |
| `web/src/components/creative/video-direction-panel.tsx` | painel de vídeo do editor | 12 |
| `web/src/components/instagram/{auto-calendar,autopilot-panel,approvals,post-editor}.tsx` | diálogo com áudio, cartão do período e pulados, eventos novos, aprovações e editor de vídeo | 12 |
| `api/scripts/smoke.sh` | upload de vídeo real convertido, produção (rodízio, pulados, `failure_kind`) contra a API viva | 13 |
| `web/scripts/browser-check.mjs` | passeio "zero cliques" com Veo/crítico falsos e ffmpeg real | 13 |

---

### Task 1: Dados, configuração e a porta do ffmpeg

**Files:**
- Create: `api/prisma/migrations/20261005150000_producao_automatica/migration.sql`
- Modify: `api/prisma/schema.prisma:592` (depois de `review_score` em `ig_posts`) e `:692` (depois de `paused_reason` em `ig_auto_runs`)
- Modify: `api/src/common/config/env.validation.ts:119-120` (novas variáveis) e `:150-178` (`superRefine`)
- Modify: `api/.env.example:53-56`, `docker-compose.yml:71`
- Modify: `api/package.json` + `api/package-lock.json` (dependência `ffmpeg-static`)
- Create: `api/src/modules/media/ffmpeg.ts`, `api/src/modules/media/ffmpeg.service.ts`
- Modify: `api/src/modules/media/media.module.ts:12-25`
- Modify: `api/Dockerfile`
- Modify: `api/src/modules/instagram/__tests__/harness.ts:159,161` (defaults das colunas novas)
- Test: `api/src/modules/media/__tests__/ffmpeg.spec.ts` (novo), `api/src/common/__tests__/env-and-guard.spec.ts` (acrescentar)

**Interfaces:**
- Consumes: `Env` (`api/src/common/config/env.validation.ts`), `ENV` (`env.module.ts`), `UserError` (`media/user-error.ts`).
- Produces:
  - Prisma: `ig_posts.review_attempts: number` (padrão 0), `ig_posts.failure_kind: string | null` (`'media' | 'publish'`), `ig_auto_runs.video_audio: Prisma.JsonValue` (padrão `{ modo: 'ambiente_trilha', instrucoes: '' }`).
  - `Env`: `IG_PRODUCTION_PER_TICK: number`, `IG_PRODUCTION_WINDOW_HOURS: number`, `IG_PRODUCTION_TARGET_HOURS: number`, `MIN_VIDEO_SCORE: number`, `FFMPEG_PATH?: string`.
  - `ffmpeg.ts`: `FFMPEG_RUNNER: symbol`; `type FfmpegRunner = (args: string[], opts: { cwd: string; timeoutMs: number }) => Promise<void>`; `FFMPEG_TIMEOUT_MS = 120_000`; `FFMPEG_MAX_INPUT_BYTES = 200 * 1024 * 1024`; `resolveFfmpegPath(env: Pick<Env,'FFMPEG_PATH'>): string`; `createFfmpegRunner(env: Pick<Env,'FFMPEG_PATH'>): FfmpegRunner`; `conformArgs(silent: boolean): string[]`.
  - `FfmpegService` (exportado pelo `MediaModule`): `maxInputBytes: number`; `extractFrames(video: Uint8Array, durationSec: number, fractions: number[]): Promise<Uint8Array[]>`; `conformForInstagram(video: Uint8Array, opts: { silent: boolean }): Promise<Uint8Array>`.

- [ ] **Step 1: Escrever os testes que falham**

Crie `api/src/modules/media/__tests__/ffmpeg.spec.ts`:

```ts
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { conformArgs, createFfmpegRunner, FFMPEG_TIMEOUT_MS, FfmpegRunner, resolveFfmpegPath } from '../ffmpeg';
import { FfmpegService } from '../ffmpeg.service';

/** FfmpegService com o runner FALSO: grava o arquivo de saída (último argumento) dentro do `cwd`, nenhum binário. */
function world(write: (args: string[], cwd: string) => void = () => undefined) {
  const dir = mkdtempSync(path.join(tmpdir(), 'mf-ffmpeg-'));
  const calls: { args: string[]; cwd: string; timeoutMs: number; files: string[] }[] = [];
  const runner: FfmpegRunner = jest.fn(async (args: string[], opts: { cwd: string; timeoutMs: number }) => {
    calls.push({ args, cwd: opts.cwd, timeoutMs: opts.timeoutMs, files: readdirSync(opts.cwd) });
    write(args, opts.cwd);
  });
  const svc = new FfmpegService(runner, { UPLOADS_DIR: dir });
  return { dir, svc, runner, calls, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
const outName = (args: string[]) => args[args.length - 1]!;
const writeOut = (content: string) => (args: string[], cwd: string) => writeFileSync(path.join(cwd, outName(args)), Buffer.from(content || outName(args)));

describe('FfmpegService (porta FFMPEG_RUNNER — nenhum binário nos testes)', () => {
  it('quadros em 15/50/85 % da duração; entrada e saídas com nomes fixos num diretório temporário dentro de UPLOADS_DIR, apagado no fim', async () => {
    const w = world(writeOut(''));
    try {
      const frames = await w.svc.extractFrames(new Uint8Array([1, 2, 3]), 8, [0.15, 0.5, 0.85]);
      expect(frames.map((f) => Buffer.from(f).toString())).toEqual(['frame0.jpg', 'frame1.jpg', 'frame2.jpg']);
      expect(w.calls.map((c) => c.args[c.args.indexOf('-ss') + 1])).toEqual(['1.20', '4.00', '6.80']);
      for (const c of w.calls) {
        expect(path.dirname(c.cwd)).toBe(path.join(w.dir, '.ffmpeg-tmp'));
        expect(c.timeoutMs).toBe(FFMPEG_TIMEOUT_MS);
        expect(c.files).toContain('in.mp4');
        expect(c.args.slice(0, 4)).toEqual(['-hide_banner', '-nostdin', '-loglevel', 'error']);
        // Só nomes fixos, relativos ao diretório temporário: nada de caminho vindo de fora.
        expect(c.args.filter((a) => /\.(mp4|jpg)$/.test(a)).every((a) => /^(in\.mp4|frame\d\.jpg)$/.test(a))).toBe(true);
      }
      expect(readdirSync(path.join(w.dir, '.ffmpeg-tmp'))).toEqual([]);
    } finally {
      w.cleanup();
    }
  });

  it('conversão: H.264 High, yuv420p, 30 fps, 1080×1920 com preenchimento, AAC 48 kHz, +faststart, ≤ 60 s; silêncio só quando pedido', async () => {
    const w = world(writeOut('mp4-convertido'));
    try {
      const out = await w.svc.conformForInstagram(new Uint8Array([9]), { silent: false });
      expect(Buffer.from(out).toString()).toBe('mp4-convertido');
      const a = w.calls[0]!.args.join(' ');
      for (const t of ['-c:v libx264', '-profile:v high', '-t 60', 'fps=30', 'format=yuv420p', 'scale=1080:1920:force_original_aspect_ratio=decrease', 'pad=1080:1920', '-c:a aac', '-ar 48000', '-movflags +faststart', '-map 0:a:0?']) {
        expect(a).toContain(t);
      }
      expect(a).not.toContain('anullsrc');
      await w.svc.conformForInstagram(new Uint8Array([9]), { silent: true });
      const s = w.calls[1]!.args.join(' ');
      expect(s).toContain('anullsrc=channel_layout=stereo:sample_rate=48000');
      expect(s).toContain('-map 1:a:0');
      expect(s).not.toContain('0:a:0?');
      expect(outName(w.calls[1]!.args)).toBe('out.mp4');
      expect(conformArgs(true).filter((x) => x.endsWith('.mp4'))).toEqual(['in.mp4', 'out.mp4']);
    } finally {
      w.cleanup();
    }
  });

  it('ffmpeg falhou ou não gerou saída: erro claro e o diretório temporário é apagado mesmo assim', async () => {
    const boom = world(() => {
      throw new Error('ffmpeg falhou (código 1): Invalid data');
    });
    try {
      await expect(boom.svc.conformForInstagram(new Uint8Array([1]), { silent: false })).rejects.toThrow('ffmpeg falhou (código 1): Invalid data');
      expect(readdirSync(path.join(boom.dir, '.ffmpeg-tmp'))).toEqual([]);
    } finally {
      boom.cleanup();
    }
    const empty = world();
    try {
      await expect(empty.svc.extractFrames(new Uint8Array([1]), 8, [0.5])).rejects.toThrow('O ffmpeg não gerou o arquivo esperado.');
      expect(readdirSync(path.join(empty.dir, '.ffmpeg-tmp'))).toEqual([]);
    } finally {
      empty.cleanup();
    }
  });

  it('entrada vazia ou acima do teto é recusada sem chamar o ffmpeg', async () => {
    const w = world(writeOut('x'));
    try {
      w.svc.maxInputBytes = 4;
      await expect(w.svc.conformForInstagram(new Uint8Array(0), { silent: false })).rejects.toThrow('Vídeo vazio.');
      await expect(w.svc.extractFrames(new Uint8Array(5), 8, [0.5])).rejects.toThrow('Vídeo grande demais para processar.');
      expect(w.runner).not.toHaveBeenCalled();
    } finally {
      w.cleanup();
    }
  });
});

describe('createFfmpegRunner (processo filho real; o node faz o papel do binário)', () => {
  const env = { FFMPEG_PATH: process.execPath };
  const cwd = () => mkdtempSync(path.join(tmpdir(), 'mf-run-'));

  it('código 0 resolve; código ≠ 0 rejeita com o fim do stderr', async () => {
    const run = createFfmpegRunner(env);
    const dir = cwd();
    try {
      await expect(run(['-e', '0'], { cwd: dir, timeoutMs: 10_000 })).resolves.toBeUndefined();
      await expect(run(['-e', 'process.stderr.write("deu ruim"); process.exit(3)'], { cwd: dir, timeoutMs: 10_000 })).rejects.toThrow(/ffmpeg falhou \(código 3\): deu ruim/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('passou do tempo-limite: mata o processo e rejeita', async () => {
    const run = createFfmpegRunner(env);
    const dir = cwd();
    try {
      await expect(run(['-e', 'setTimeout(() => {}, 30000)'], { cwd: dir, timeoutMs: 300 })).rejects.toThrow(/tempo-limite/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('FFMPEG_PATH tem prioridade; sem ele e sem o ffmpeg-static, mensagem clara', () => {
    expect(resolveFfmpegPath({ FFMPEG_PATH: '/usr/bin/ffmpeg' })).toBe('/usr/bin/ffmpeg');
    jest.isolateModules(() => {
      jest.doMock('ffmpeg-static', () => null);
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { resolveFfmpegPath: r } = require('../ffmpeg');
      expect(() => r({})).toThrow('ffmpeg não encontrado: instale as dependências da API (ffmpeg-static) ou defina FFMPEG_PATH.');
    });
  });
});
```

Acrescente ao fim de `api/src/common/__tests__/env-and-guard.spec.ts`:

```ts
describe('validateEnv — produção automática e vídeo (05/10/2026)', () => {
  it('padrões: 4 por rodada, janela de 48 h, meta de 24 h, nota mínima 28; FFMPEG_PATH opcional', () => {
    const e = validateEnv({ ...base, NODE_ENV: 'test' });
    expect([e.IG_PRODUCTION_PER_TICK, e.IG_PRODUCTION_WINDOW_HOURS, e.IG_PRODUCTION_TARGET_HOURS, e.MIN_VIDEO_SCORE, e.FFMPEG_PATH]).toEqual([4, 48, 24, 28, undefined]);
    const c = validateEnv({ ...base, NODE_ENV: 'test', IG_PRODUCTION_PER_TICK: '2', MIN_VIDEO_SCORE: '30', FFMPEG_PATH: '/usr/bin/ffmpeg' });
    expect([c.IG_PRODUCTION_PER_TICK, c.MIN_VIDEO_SCORE, c.FFMPEG_PATH]).toEqual([2, 30, '/usr/bin/ffmpeg']);
  });

  it('valores fora da faixa e meta maior que a janela falham o boot', () => {
    expect(() => validateEnv({ ...base, NODE_ENV: 'test', IG_PRODUCTION_PER_TICK: '0' })).toThrow(/IG_PRODUCTION_PER_TICK/);
    expect(() => validateEnv({ ...base, NODE_ENV: 'test', MIN_VIDEO_SCORE: '51' })).toThrow(/MIN_VIDEO_SCORE/);
    expect(() => validateEnv({ ...base, NODE_ENV: 'test', IG_PRODUCTION_WINDOW_HOURS: '12', IG_PRODUCTION_TARGET_HOURS: '24' })).toThrow(/IG_PRODUCTION_TARGET_HOURS/);
  });
});
```

- [ ] **Step 2: Rodar os testes e ver falhar**

Run: `cd api && ../scripts/run-capped.sh 1500 npm test -- src/modules/media/__tests__/ffmpeg.spec.ts src/common/__tests__/env-and-guard.spec.ts`
Expected: FAIL — `Cannot find module '../ffmpeg'` e as asserções de `IG_PRODUCTION_PER_TICK` (`undefined`).

- [ ] **Step 3: Migração e schema**

Crie `api/prisma/migrations/20261005150000_producao_automatica/migration.sql`:

```sql
-- Produção de conteúdo automática (05/10/2026): reescritas do post reprovado no modo totalmente automático, tipo da falha
-- (mídia × publicação: falha de publicação não refaz a mídia) e o áudio dos vídeos da programação.
ALTER TABLE "ig_posts" ADD COLUMN "review_attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "failure_kind" TEXT;

ALTER TABLE "ig_posts" ADD CONSTRAINT "ig_posts_failure_kind_check" CHECK (failure_kind IN ('media','publish'));

ALTER TABLE "ig_auto_runs" ADD COLUMN "video_audio" JSONB NOT NULL DEFAULT '{"modo":"ambiente_trilha","instrucoes":""}';

-- Produção antecipada (ProductionService): posts de programação ainda sem criativo, pelo horário.
CREATE INDEX "ig_posts_production_idx" ON "ig_posts" ("scheduled_at") WHERE run_id IS NOT NULL AND status = 'idea';
```

Em `api/prisma/schema.prisma`, no `model ig_posts`, logo depois de `review_score        Decimal?              @db.Decimal`:

```prisma
  review_attempts     Int                   @default(0)
  failure_kind        String?
```

No `model ig_auto_runs`, logo depois de `paused_reason          String?`:

```prisma
  video_audio            Json             @default("{\"modo\":\"ambiente_trilha\",\"instrucoes\":\"\"}") @db.JsonB
```

- [ ] **Step 4: Variáveis de ambiente**

Em `api/src/common/config/env.validation.ts`, logo depois de `EXPORTS_TTL_HOURS: z.coerce.number().positive().default(24),`:

```ts
    /** Produção antecipada do "Programar com IA": posts por rodada de 5 min (no máximo 1 por empresa), janela e meta (horas antes do horário). */
    IG_PRODUCTION_PER_TICK: z.coerce.number().int().min(1).max(20).default(4),
    IG_PRODUCTION_WINDOW_HOURS: z.coerce.number().int().min(1).max(168).default(48),
    IG_PRODUCTION_TARGET_HOURS: z.coerce.number().int().min(1).max(168).default(24),
    /** Nota mínima (0–50) do crítico de vídeo; abaixo dela o vídeo é refeito 1 vez. */
    MIN_VIDEO_SCORE: z.coerce.number().int().min(0).max(50).default(28),
    /** Binário do ffmpeg (opcional). Sem ele: o `ffmpeg-static` das dependências. No contêiner: /usr/bin/ffmpeg. */
    FFMPEG_PATH: opt(),
```

E, dentro do `.superRefine((env, ctx) => {`, como primeira verificação:

```ts
    if (env.IG_PRODUCTION_TARGET_HOURS > env.IG_PRODUCTION_WINDOW_HOURS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['IG_PRODUCTION_TARGET_HOURS'],
        message: 'a meta (horas antes do horário) não pode ser maior que a janela de produção (IG_PRODUCTION_WINDOW_HOURS)',
      });
    }
```

Em `api/.env.example`, logo depois da linha `# EXPORTS_TTL_HOURS=24`:

```
# --- Produção automática do "Programar com IA" e vídeos ---
# IG_PRODUCTION_PER_TICK=4          # posts produzidos por rodada de 5 min (no máximo 1 por empresa)
# IG_PRODUCTION_WINDOW_HOURS=48     # começa a produzir 48 h antes do horário
# IG_PRODUCTION_TARGET_HOURS=24     # meta: pronto 24 h antes (quem está dentro dela passa à frente)
# MIN_VIDEO_SCORE=28                # nota mínima (0–50) do crítico de vídeo; abaixo dela refaz 1 vez
# FFMPEG_PATH=                      # ffmpeg do sistema; vazio = ffmpeg-static das dependências (no contêiner: /usr/bin/ffmpeg)
```

Em `docker-compose.yml`, logo depois de `      EXPORTS_TTL_HOURS: ${EXPORTS_TTL_HOURS:-}`:

```yaml
      IG_PRODUCTION_PER_TICK: ${IG_PRODUCTION_PER_TICK:-}
      IG_PRODUCTION_WINDOW_HOURS: ${IG_PRODUCTION_WINDOW_HOURS:-}
      IG_PRODUCTION_TARGET_HOURS: ${IG_PRODUCTION_TARGET_HOURS:-}
      MIN_VIDEO_SCORE: ${MIN_VIDEO_SCORE:-}
      # ffmpeg do sistema instalado no Dockerfile (o ffmpeg-static fica de reserva).
      FFMPEG_PATH: ${FFMPEG_PATH:-/usr/bin/ffmpeg}
```

- [ ] **Step 5: Dependência e Dockerfile**

Run: `cd api && npm install ffmpeg-static@^5.2.0`
Expected: `package.json` ganha `"ffmpeg-static": "^5.2.0"` em `dependencies` e o binário é baixado em `node_modules/ffmpeg-static/ffmpeg` (precisa de rede; só nesta etapa).

Substitua `api/Dockerfile` por:

```dockerfile
FROM node:22-alpine
# ffmpeg do sistema para a conversão de vídeos e os quadros do crítico (o ffmpeg-static das dependências fica de reserva).
RUN apk add --no-cache ffmpeg
ENV FFMPEG_PATH=/usr/bin/ffmpeg
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate && npm run build
EXPOSE 3015
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/main"]
```

- [ ] **Step 6: A porta do ffmpeg**

Crie `api/src/modules/media/ffmpeg.ts`:

```ts
/**
 * Porta do ffmpeg (processo filho). Tudo que roda o binário passa por aqui: nos testes entra um runner falso (nenhum binário).
 * O binário é o de `FFMPEG_PATH` (contêiner: /usr/bin/ffmpeg) ou o do pacote `ffmpeg-static`, resolvido só no primeiro uso.
 */
import { spawn } from 'node:child_process';
import { setPriority } from 'node:os';
import { Env } from '../../common/config/env.validation';

export const FFMPEG_RUNNER = Symbol('FFMPEG_RUNNER');
/** Roda o ffmpeg com `args` dentro de `cwd` (só nomes relativos de arquivos daquele diretório). Rejeita com o fim do stderr. */
export type FfmpegRunner = (args: string[], opts: { cwd: string; timeoutMs: number }) => Promise<void>;
export const FFMPEG_TIMEOUT_MS = 120_000;
/** Teto da entrada (= MAX_DOWNLOAD_BYTES da biblioteca de mídia). */
export const FFMPEG_MAX_INPUT_BYTES = 200 * 1024 * 1024;

export function resolveFfmpegPath(env: Pick<Env, 'FFMPEG_PATH'>): string {
  if (env.FFMPEG_PATH) return env.FFMPEG_PATH;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const p = require('ffmpeg-static') as string | null;
    if (p) return p;
  } catch {
    /* pacote ausente: cai na mensagem abaixo */
  }
  throw new Error('ffmpeg não encontrado: instale as dependências da API (ffmpeg-static) ou defina FFMPEG_PATH.');
}

/** Runner real: prioridade baixa (nice 10), stderr limitado, SIGKILL no tempo-limite. */
export function createFfmpegRunner(env: Pick<Env, 'FFMPEG_PATH'>): FfmpegRunner {
  return (args, opts) =>
    new Promise<void>((resolve, reject) => {
      let bin: string;
      try {
        bin = resolveFfmpegPath(env);
      } catch (e) {
        reject(e);
        return;
      }
      const child = spawn(bin, args, { cwd: opts.cwd, stdio: ['ignore', 'ignore', 'pipe'] });
      try {
        if (child.pid) setPriority(child.pid, 10);
      } catch {
        /* sem permissão para mudar a prioridade: segue na normal */
      }
      let stderr = '';
      child.stderr?.on('data', (c: Buffer) => {
        stderr = (stderr + c.toString('utf8')).slice(-2000);
      });
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`ffmpeg passou do tempo-limite (${Math.round(opts.timeoutMs / 1000)} s).`));
      }, opts.timeoutMs);
      child.on('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg falhou (código ${code}): ${stderr.trim().slice(-500)}`));
      });
    });
}

/** Padrão do Instagram: H.264 High + yuv420p, 30 fps, 1080×1920 (escala + preenchimento), AAC 48 kHz (silêncio se `silent`), +faststart, ≤ 60 s. */
export function conformArgs(silent: boolean): string[] {
  const vf = 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black,fps=30,format=yuv420p';
  return [
    '-y', '-i', 'in.mp4',
    ...(silent ? ['-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000'] : []),
    '-map', '0:v:0',
    ...(silent ? ['-map', '1:a:0', '-shortest'] : ['-map', '0:a:0?']),
    '-t', '60', '-vf', vf,
    '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'veryfast', '-crf', '21', '-threads', '2',
    '-c:a', 'aac', '-ar', '48000', '-b:a', '128k',
    '-movflags', '+faststart', 'out.mp4',
  ];
}
```

Crie `api/src/modules/media/ffmpeg.service.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { ENV } from '../../common/config/env.module';
import { Env } from '../../common/config/env.validation';
import { conformArgs, FFMPEG_MAX_INPUT_BYTES, FFMPEG_RUNNER, FFMPEG_TIMEOUT_MS, FfmpegRunner } from './ffmpeg';
import { UserError } from './user-error';

const BASE = ['-hide_banner', '-nostdin', '-loglevel', 'error'];
const MAX_OUTPUT_BYTES = 150 * 1024 * 1024;

/**
 * ffmpeg confinado: cada chamada ganha um diretório temporário próprio em `UPLOADS_DIR/.ffmpeg-tmp/<uuid>` (fora dos buckets servidos),
 * com nomes de arquivo fixos (`in.mp4`, `out.mp4`, `frameN.jpg`) — nenhum caminho vem de fora — e o diretório é apagado no `finally`.
 */
@Injectable()
export class FfmpegService {
  /** Teto da entrada; público só para os testes. */
  maxInputBytes = FFMPEG_MAX_INPUT_BYTES;
  private readonly root: string;

  constructor(
    @Inject(FFMPEG_RUNNER) private readonly runner: FfmpegRunner,
    @Inject(ENV) env: Pick<Env, 'UPLOADS_DIR'>,
  ) {
    this.root = path.join(path.resolve(env.UPLOADS_DIR), '.ffmpeg-tmp');
  }

  private async withWorkdir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
    const dir = path.join(this.root, randomUUID());
    await fs.mkdir(dir, { recursive: true });
    try {
      return await fn(dir);
    } finally {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private assertInput(bytes: Uint8Array) {
    if (!bytes.length) throw new UserError('Vídeo vazio.');
    if (bytes.length > this.maxInputBytes) throw new UserError('Vídeo grande demais para processar.');
  }

  private run(args: string[], dir: string) {
    return this.runner([...BASE, ...args], { cwd: dir, timeoutMs: FFMPEG_TIMEOUT_MS });
  }

  private async readOut(dir: string, name: string): Promise<Uint8Array> {
    const st = await fs.stat(path.join(dir, name)).catch(() => null);
    if (!st || !st.size) throw new UserError('O ffmpeg não gerou o arquivo esperado.');
    if (st.size > MAX_OUTPUT_BYTES) throw new UserError('O vídeo convertido ficou grande demais.');
    return new Uint8Array(await fs.readFile(path.join(dir, name)));
  }

  /** Quadros JPEG (≤ 768 px no maior lado) nas frações da duração (ex.: 0.15, 0.5, 0.85). */
  async extractFrames(video: Uint8Array, durationSec: number, fractions: number[]): Promise<Uint8Array[]> {
    this.assertInput(video);
    return this.withWorkdir(async (dir) => {
      await fs.writeFile(path.join(dir, 'in.mp4'), video);
      const out: Uint8Array[] = [];
      for (const [i, f] of fractions.entries()) {
        const t = Math.max(0, Math.min(Math.max(0, durationSec - 0.05), durationSec * f));
        const name = `frame${i}.jpg`;
        await this.run(['-y', '-ss', t.toFixed(2), '-i', 'in.mp4', '-frames:v', '1', '-vf', 'scale=768:768:force_original_aspect_ratio=decrease', '-q:v', '3', name], dir);
        out.push(await this.readOut(dir, name));
      }
      return out;
    });
  }

  /** Converte para o padrão do Instagram (ver `conformArgs`). */
  async conformForInstagram(video: Uint8Array, opts: { silent: boolean }): Promise<Uint8Array> {
    this.assertInput(video);
    return this.withWorkdir(async (dir) => {
      await fs.writeFile(path.join(dir, 'in.mp4'), video);
      await this.run(conformArgs(opts.silent), dir);
      return this.readOut(dir, 'out.mp4');
    });
  }
}
```

Em `api/src/modules/media/media.module.ts`, troque o bloco `providers`/`exports` por:

```ts
  providers: [
    // Única porta de rede do domínio de criativos/mídia/Canva/MCP — nos testes entra um fake.
    // Com guarda de conexão: o DNS é resolvido uma vez, endereços internos são recusados e a conexão é fixada no endereço verificado.
    { provide: EXTERNAL_FETCH, inject: [ENV], useFactory: (env: Env) => createGuardedFetch(testOverridesAllowed(env)) },
    // Única porta do ffmpeg (processo filho) — nos testes entra um runner falso.
    { provide: FFMPEG_RUNNER, inject: [ENV], useFactory: (env: Env) => createFfmpegRunner(env) },
    FfmpegService,
    ImageService,
    AssetsService,
    LibraryService,
    MediaQueryService,
  ],
  exports: [EXTERNAL_FETCH, ImageService, AssetsService, FfmpegService],
```

e acrescente os imports `import { createFfmpegRunner, FFMPEG_RUNNER } from './ffmpeg';` e `import { FfmpegService } from './ffmpeg.service';`.

Em `api/src/modules/instagram/__tests__/harness.ts`, no default de `ig_posts` (linha 159) acrescente `review_attempts: 0, failure_kind: null` ao objeto, e no default de `ig_auto_runs` (linha 161) acrescente `video_audio: { modo: 'ambiente_trilha', instrucoes: '' }`.

- [ ] **Step 7: Aplicar a migração e gerar o cliente**

```bash
docker compose up -d postgres
cd api && ../scripts/run-capped.sh 1500 npx prisma migrate deploy && ../scripts/run-capped.sh 1500 npx prisma generate && npx prisma migrate status
```
Expected: `Applying migration 20261005150000_producao_automatica`, depois `Database schema is up to date!`.

- [ ] **Step 8: Rodar os testes e ver passar**

Run: `cd api && ../scripts/run-capped.sh 1500 npm test -- src/modules/media/__tests__/ffmpeg.spec.ts src/common/__tests__/env-and-guard.spec.ts`
Expected: PASS (inclusive "toda chave aparece em docker-compose.yml … e em api/.env.example").

Run: `cd api && ../scripts/run-capped.sh 1500 npm run typecheck`
Expected: sem erros.

- [ ] **Step 9: Parar o Postgres e commitar**

```bash
docker compose stop postgres
git add api/prisma/migrations/20261005150000_producao_automatica/migration.sql api/prisma/schema.prisma api/src/common/config/env.validation.ts api/.env.example docker-compose.yml api/package.json api/package-lock.json api/Dockerfile api/src/modules/media/ffmpeg.ts api/src/modules/media/ffmpeg.service.ts api/src/modules/media/media.module.ts api/src/modules/media/__tests__/ffmpeg.spec.ts api/src/common/__tests__/env-and-guard.spec.ts api/src/modules/instagram/__tests__/harness.ts
git commit -m "feat(instagram): dados e configuração da produção automática + porta do ffmpeg

Colunas review_attempts, failure_kind (CHECK) e video_audio; variáveis IG_PRODUCTION_*, MIN_VIDEO_SCORE e FFMPEG_PATH;
ffmpeg-static e FfmpegService confinado num diretório temporário dentro de UPLOADS_DIR (porta FFMPEG_RUNNER).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: A1 — estratégia aprovada sozinha no modo "publish" e semanas repetidas com estratégia própria

**Files:**
- Modify: `api/src/modules/instagram/ig-types.ts:155` (tipo de evento + constantes)
- Modify: `api/src/modules/instagram/content-strategy.service.ts:18-30` (`StrategyArgs.guidance`) e `:44-61` (prompt)
- Modify: `api/src/modules/instagram/auto-calendar.service.ts:8-9` (imports), `:214-226` (passo da estratégia), novo `parentGuidance`, `:590-592` (`renewRecurring`)
- Modify: `docs/api-contract.md:457` (linha `fill-auto-calendar`)
- Test: `api/src/modules/instagram/__tests__/auto-calendar.spec.ts` (substituir o teste "semana recorrente herda a estratégia aprovada…" e acrescentar um `describe`)

**Interfaces:**
- Consumes: `ig_auto_runs.video_audio` (Task 1).
- Produces:
  - `AutopilotEventKind` com `'strategy_auto_approved' | 'post_rewritten' | 'post_skipped' | 'video_regenerated'`.
  - Constantes em `ig-types.ts`: `STRATEGY_AUTO_APPROVED: string`, `SKIP_PREFIX = 'Pulado automaticamente: '`, `isSkipped(p: { status: string; last_error?: string | null }): boolean`, `OVERDUE_MS = 12 * 3600e3`, `NO_ACCOUNT_MSG = 'Conecte o Instagram para publicar.'`, `TOKEN_EXPIRED_POST_MSG = 'Token da Meta expirado: reconecte o Instagram para publicar.'`.
  - `StrategyArgs.guidance?: string | null` em `ContentStrategyService.buildRunStrategy`.
  - `fillAutoRun` devolve `strategyReview: false` no modo `publish` (estratégia já `approved`).

- [ ] **Step 1: Escrever os testes que falham**

Em `api/src/modules/instagram/__tests__/auto-calendar.spec.ts`, **apague** o teste `it('semana recorrente herda a estratégia aprovada; sem aprovação nasce "pending"', …)` (dentro de `describe('estratégia do período (passo 1 do fillAutoRun)'`) e acrescente ao fim do arquivo:

```ts
// ---------------------------------------------------------------------------------------------------------------------
// Produção automática (05/10/2026) — A1: estratégia no modo totalmente automático e semanas repetidas.
// ---------------------------------------------------------------------------------------------------------------------

describe('A1 — estratégia no modo "publish" e semanas repetidas', () => {
  const STRAT = { ...STRATEGY, distribuicao_por_dia: [] };
  const onePost = () => ({ posts: [{ index: 0, theme: 'T0', pillar: 'A', persona: 'Ana', product_name: '', funnel_stage: 'atracao', objective_link: 'serve', hook: 'H', headline: 'M', caption: 'Legenda', hashtags: ['a'], cta: 'CTA', image_prompt: 'x', slides: [] }] });

  it('modo "publish": estratégia aprovada sozinha (sem passar por review), evento strategy_auto_approved; o próximo fill já gera os posts', async () => {
    const { w, s, auto } = setup();
    const r = run(w, plan(w), { mode: 'publish', slots: [slotAt(600, 0)], strategy: null, strategy_status: 'pending' });
    s.aiJson['ig_run_strategy'] = () => STRAT;
    expect(await auto.fillAutoRun(r.id)).toEqual({ filled: 0, total: 1, done: false, busy: false, strategyReview: false });
    expect(r).toMatchObject({ strategy_status: 'approved', locked_until: null, status: 'planning' });
    expect(w.t['ig_autopilot_events']!.rows.at(-1)).toMatchObject({ kind: 'strategy_auto_approved', level: 'info', message: 'Estratégia do período aprovada automaticamente (modo totalmente automático).' });
    expect(w.t['ig_posts']!.rows).toHaveLength(0);
    s.aiJson['ig_auto_calendar'] = onePost;
    expect(await auto.fillAutoRun(r.id)).toMatchObject({ filled: 1, done: true, strategyReview: false });
    expect(w.t['ig_posts']!.rows).toHaveLength(1);
  });

  it('zero cliques pelo tick: o 1º tick aprova a estratégia, o 2º gera os posts', async () => {
    const { w, s, auto } = setup();
    const r = run(w, plan(w), { mode: 'publish', slots: [slotAt(600, 0)], strategy: null, strategy_status: 'pending' });
    s.aiJson['ig_run_strategy'] = () => STRAT;
    s.aiJson['ig_auto_calendar'] = onePost;
    await auto.autoCalendarTick();
    expect(r.strategy_status).toBe('approved');
    expect(w.t['ig_posts']!.rows).toHaveLength(0);
    await auto.autoCalendarTick();
    expect(r.status).toBe('active');
    expect(w.t['ig_posts']!.rows).toHaveLength(1);
  });

  it('modo "approval" continua esperando a revisão (sem aprovação automática)', async () => {
    const { w, s, auto } = setup();
    const r = run(w, plan(w), { mode: 'approval', slots: [slotAt(600, 0)], strategy: null, strategy_status: 'pending' });
    s.aiJson['ig_run_strategy'] = () => STRAT;
    expect(await auto.fillAutoRun(r.id)).toMatchObject({ strategyReview: true });
    expect(r.strategy_status).toBe('review');
    expect(w.t['ig_autopilot_events']!.rows.some((e) => e.kind === 'strategy_auto_approved')).toBe(false);
  });

  it('semana repetida nasce SEM estratégia (pending) e herda modo, objetivo e o áudio dos vídeos da raiz', async () => {
    const { w, auto } = setup();
    const t = todaySP();
    const root = run(w, plan(w), {
      recurring: true, status: 'active', mode: 'publish', start_date: DATE(plusDays(t, -3)), end_date: DATE(plusDays(t, 3)), times: ['09:00'],
      strategy: { ...STRATEGY, texto_editado: 'nada de promoção' }, video_audio: { modo: 'narracao', instrucoes: 'voz calma' },
    });
    expect(await auto.renewRecurring()).toEqual({ created: 1 });
    const kid = w.t['ig_auto_runs']!.rows.at(-1);
    expect(kid).toMatchObject({ parent_id: root.id, strategy_status: 'pending', mode: 'publish', focus: OBJECTIVE, video_audio: { modo: 'narracao', instrucoes: 'voz calma' } });
    expect(kid.strategy ?? null).toBeNull();
  });

  it('a filha gera a estratégia das SUAS datas, com os ajustes da raiz como orientação (e como texto_editado); publish aprova, approval vai para review', async () => {
    const { w, s, auto } = setup();
    const p = plan(w);
    const root = run(w, p, { recurring: true, status: 'active', mode: 'publish', strategy: { ...STRATEGY, texto_editado: 'foque no prato executivo; nada de promoção' } });
    const kidSlots = [{ index: 0, at: '2099-02-02T12:00:00.000Z', format: 'feed_image', kind: 'main' }]; // segunda-feira
    const kid = run(w, p, { parent_id: root.id, mode: 'publish', slots: kidSlots, strategy: null, strategy_status: 'pending' });
    const prompts: string[] = [];
    s.aiJson['ig_run_strategy'] = (req: any) => {
      prompts.push(req.prompt);
      return STRAT;
    };
    await auto.fillAutoRun(kid.id);
    expect(prompts[0]).toContain('- segunda-feira, 02/02/2099');
    expect(prompts[0]).toContain('ORIENTAÇÃO DO CLIENTE (ajustes feitos nas semanas anteriores desta programação — siga, salvo se contrariar a marca): «foque no prato executivo; nada de promoção»');
    expect(kid.strategy_status).toBe('approved');
    expect(kid.strategy.texto_editado).toBe('foque no prato executivo; nada de promoção');
    const kid2 = run(w, p, { parent_id: root.id, mode: 'approval', slots: kidSlots, strategy: null, strategy_status: 'pending' });
    await auto.fillAutoRun(kid2.id);
    expect(kid2.strategy_status).toBe('review');
  });

  it('a orientação é delimitada e limitada: « » do cliente saem e o texto vai até 2000 caracteres', async () => {
    const { w, s, auto } = setup();
    const p = plan(w);
    const root = run(w, p, { recurring: true, status: 'active', strategy: { ...STRATEGY, texto_editado: `a«b»c ${'x'.repeat(3000)}` } });
    const kid = run(w, p, { parent_id: root.id, mode: 'publish', slots: [slotAt(600, 0)], strategy: null, strategy_status: 'pending' });
    let prompt = '';
    s.aiJson['ig_run_strategy'] = (req: any) => {
      prompt = req.prompt;
      return STRAT;
    };
    await auto.fillAutoRun(kid.id);
    const guidance = /«([^«»]*)»/.exec(prompt)![1]!;
    expect(guidance.startsWith('abc ')).toBe(true);
    expect(guidance.length).toBeLessThanOrEqual(2000);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd api && ../scripts/run-capped.sh 1500 npm test -- src/modules/instagram/__tests__/auto-calendar.spec.ts`
Expected: FAIL — `strategy_status` `'review'` em vez de `'approved'`, filha com `strategy_status 'approved'` herdado, sem `ORIENTAÇÃO DO CLIENTE`.

- [ ] **Step 3: Tipos e constantes**

Em `api/src/modules/instagram/ig-types.ts`, troque a linha `export type AutopilotEventKind = …` por:

```ts
export type AutopilotEventKind =
  | 'generation' | 'media' | 'schedule' | 'publish' | 'failure' | 'approval' | 'reschedule' | 'optimize' | 'guardrail'
  // Produção automática (05/10/2026): estratégia aprovada sozinha, post reescrito/pulado e vídeo refeito pelo crítico.
  | 'strategy_auto_approved' | 'post_rewritten' | 'post_skipped' | 'video_regenerated';

/** Evento da aprovação automática da estratégia (modo totalmente automático). */
export const STRATEGY_AUTO_APPROVED = 'Estratégia do período aprovada automaticamente (modo totalmente automático).';
/** Prefixo do `last_error` de um post pulado pelo modo totalmente automático (a tela lista os "Pulados" por ele). */
export const SKIP_PREFIX = 'Pulado automaticamente: ';
export const isSkipped = (p: { status: string; last_error?: string | null }) => p.status === 'cancelled' && !!p.last_error?.startsWith(SKIP_PREFIX);
/** Atraso máximo para publicar um post da programação; passou disso, o modo "publish" pula o horário. */
export const OVERDUE_MS = 12 * 3600e3;
/** Post da programação sem conta conectada: fica pronto com este aviso e é agendado sozinho quando a conta conectar. */
export const NO_ACCOUNT_MSG = 'Conecte o Instagram para publicar.';
/** Post da programação que estava na fila quando o token venceu: volta para "pronto" com este aviso. */
export const TOKEN_EXPIRED_POST_MSG = 'Token da Meta expirado: reconecte o Instagram para publicar.';
```

- [ ] **Step 4: Orientação no prompt da estratégia**

Em `api/src/modules/instagram/content-strategy.service.ts`, no tipo `StrategyArgs`, depois de `slots: { at: string; format: string }[];`:

```ts
  /** Semana repetida: ajustes que o cliente escreveu na estratégia da semana raiz (texto livre, delimitado no prompt). */
  guidance?: string | null;
```

No array do `buildRunStrategy`, logo depois da linha `` `4. PLANO: pilares …` ``, acrescente:

```ts
      args.guidance
        ? `ORIENTAÇÃO DO CLIENTE (ajustes feitos nas semanas anteriores desta programação — siga, salvo se contrariar a marca): «${args.guidance.replace(/[«»]/g, '').slice(0, 2000)}»`
        : '',
```

e troque o fechamento `].join('\n');` desse array por `].filter(Boolean).join('\n');`.

- [ ] **Step 5: Estratégia automática, orientação da raiz e renovação**

Em `api/src/modules/instagram/auto-calendar.service.ts`, troque a importação de `./ig-types` por:

```ts
import { ASPECT, fmtDate, IgFormat, STRATEGY_AUTO_APPROVED } from './ig-types';
```

Troque o bloco do passo da estratégia (de `// Passo "Estratégia": criada antes dos posts e revisada pelo usuário.` até o `return { … strategyReview: true };` + `}` que o fecha) por:

```ts
      // Passo "Estratégia": criada antes dos posts. Modo "publish" (totalmente automático) aprova sozinha; "approval" espera a revisão.
      // Semana repetida (filha) gera a PRÓPRIA estratégia para as suas datas, com os ajustes da raiz como orientação.
      if (!run.strategy || run.strategy_status === 'pending') {
        const guidance = await this.parentGuidance(run);
        const built = await this.contentStrategy.buildRunStrategy({
          workspaceId: run.workspace_id, objective: ctx.objective, brand: ctx.brand, products: ctx.products, personas: ctx.personas, plan: ctx.plan, slots: all, guidance,
        });
        const strategy: RunStrategy = guidance ? { ...built.strategy, texto_editado: guidance } : built.strategy;
        const auto = run.mode === 'publish';
        const saved = await this.prisma.ig_auto_runs.updateMany({
          where: { id: runId, locked_until: lock.until, strategy_status: run.strategy_status, filled: run.filled },
          data: { strategy: strategy as unknown as Prisma.InputJsonObject, strategy_status: auto ? 'approved' : 'review', locked_until: null, last_error: null, paused_reason: null },
        });
        if (!saved.count) throw new LeaseLost();
        await this.store.logEvent(
          auto
            ? { workspace_id: run.workspace_id, plan_id: run.plan_id, kind: 'strategy_auto_approved', message: STRATEGY_AUTO_APPROVED }
            : { workspace_id: run.workspace_id, plan_id: run.plan_id, kind: 'generation', message: 'Estratégia do período pronta: revise e aprove para gerar os posts.' },
        );
        return { filled: run.filled, total: all.length, done: false, busy: false, strategyReview: !auto };
      }
```

Logo depois do método `runContext`, acrescente:

```ts
  /** Ajustes que o cliente escreveu na estratégia da semana raiz (orientação para a estratégia de cada semana repetida). */
  private async parentGuidance(run: Prisma.ig_auto_runsGetPayload<object>): Promise<string | null> {
    if (!run.parent_id) return null;
    const root = await this.prisma.ig_auto_runs.findFirst({ where: { id: run.parent_id, workspace_id: run.workspace_id }, select: { strategy: true } });
    const text = (root?.strategy as { texto_editado?: unknown } | null)?.texto_editado;
    return typeof text === 'string' && text.trim() ? text.trim().slice(0, 2000) : null;
  }
```

Em `renewRecurring`, troque as duas linhas

```ts
              // Semana repetida herda a estratégia aprovada (só redistribui os dias).
              ...(root.strategy_status === 'approved' && root.strategy ? { strategy: root.strategy as Prisma.InputJsonObject, strategy_status: 'approved' } : { strategy_status: 'pending' }),
              mode: root.mode,
```

por

```ts
              // Cada semana repetida gera a PRÓPRIA estratégia (com as datas dela); a raiz entra só como orientação (`parentGuidance`).
              strategy_status: 'pending',
              mode: root.mode,
              video_audio: root.video_audio as Prisma.InputJsonObject,
```

- [ ] **Step 6: Contrato**

Em `docs/api-contract.md`, na linha que começa com `` | `fill-auto-calendar` ``, troque o trecho `grava \`strategy\` + \`strategy_status 'review'\`, solta o lease e responde \`strategyReview:true\` **sem gerar posts**;` por:

```
grava `strategy` + `strategy_status 'review'`, solta o lease e responde `strategyReview:true` **sem gerar posts**; **no modo `publish` (totalmente automático) a estratégia já nasce `approved`** (evento `strategy_auto_approved` "Estratégia do período aprovada automaticamente (modo totalmente automático).") e responde `strategyReview:false` — o próximo fill/tick gera os posts sem clique. **Semana repetida** (filha de uma recorrente): nasce `pending`, sem estratégia, com o `mode`, o `focus` e o `video_audio` da raiz, e gera a estratégia das SUAS datas; o `texto_editado` da raiz entra no prompt como orientação delimitada (≤ 2000 caracteres) e vira o `texto_editado` da filha;
```

- [ ] **Step 7: Rodar e ver passar**

Run: `cd api && ../scripts/run-capped.sh 1500 npm test -- src/modules/instagram/__tests__/auto-calendar.spec.ts src/modules/instagram/__tests__/content-strategy.spec.ts`
Expected: PASS.

Run: `cd api && ../scripts/run-capped.sh 1500 npm run typecheck`
Expected: sem erros.

- [ ] **Step 8: Commit**

```bash
git add api/src/modules/instagram/ig-types.ts api/src/modules/instagram/content-strategy.service.ts api/src/modules/instagram/auto-calendar.service.ts api/src/modules/instagram/__tests__/auto-calendar.spec.ts docs/api-contract.md
git commit -m "feat(instagram): estratégia aprovada sozinha no modo totalmente automático e semanas repetidas com estratégia própria

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: A2 — post reprovado no modo "publish" é reescrito pela IA (até 2×) ou pulado

**Files:**
- Modify: `api/src/modules/instagram/auto-calendar.service.ts` — imports (`:8-14`), `askPosts` (`:294-326`), mapeamento das linhas em `writeChunk` (`:328-428`), novos `postFields`, `rewriteFlagged`, `rewritePost`, `skipPost`, e o passo "2a" no `autoCalendarTick` (antes de `// 2) Mídia pronta…`, `:492`)
- Modify: `api/src/modules/instagram/publishing.service.ts:95` (`alignmentProblems` passa a ser público)
- Modify: `api/src/modules/instagram/instagram-resources.service.ts:131-133` (`pendingCount`)
- Modify: `docs/api-contract.md:422` (`pending-count`), `:457` (`fill-auto-calendar`), `:478` (task `media`)
- Test: `api/src/modules/instagram/__tests__/auto-calendar.spec.ts` (novo `describe`)

**Interfaces:**
- Consumes: `SKIP_PREFIX`, `OVERDUE_MS`, `PostRow` (`ig-types.ts`, Task 2); `ig_posts.review_attempts` (Task 1); `IgStore.claimLease(postId, workspaceId | null, where, data, ttlMs): Promise<PostLease | null>`; `ContentStrategyService.validatePosts(...)`.
- Produces:
  - `export const MAX_REWRITES = 2` (em `auto-calendar.service.ts`).
  - `AutoCalendarService.rewriteFlagged(): Promise<{ rewritten: number; retried: number; skipped: number }>`.
  - `AutoCalendarService.rewritePost(postId: string): Promise<'rewritten' | 'retried' | 'skipped' | null>`.
  - `PublishingService.alignmentProblems(post: PostRow, when: Date): Promise<string[]>` (público).
  - `autoCalendarTick()` devolve também `rewritten`.
  - `GET /ig-posts/pending-count` não conta `needs_review` do modo `publish` (a IA está reescrevendo).

- [ ] **Step 1: Escrever os testes que falham**

Acrescente ao fim de `api/src/modules/instagram/__tests__/auto-calendar.spec.ts`:

```ts
// ---------------------------------------------------------------------------------------------------------------------
// Produção automática (05/10/2026) — A2: reescrita do post reprovado no modo totalmente automático.
// ---------------------------------------------------------------------------------------------------------------------

describe('A2 — reescrita do post reprovado (modo "publish")', () => {
  const flagged = (w: IgWorld, r: any, over: Record<string, unknown> = {}) =>
    seedPost(w, {
      run_id: r.id, plan_id: r.plan_id, automation: 'publish', status: 'needs_review', media: [], approved_at: null,
      review_reason: 'fala de outro negócio', review_score: 3, review_attempts: 0, scheduled_at: new Date(Date.now() + 30 * 3600e3),
      theme: 'Velho', hook: 'Gancho velho', caption: 'Legenda velha', cta: 'CTA', objective_link: 'serve', pillar: 'A', persona: 'Ana',
      creative_brief: { prompt: 'cena velha', headline: 'Manchete velha', variations: 3 }, ...over,
    });
  const item = (over: Record<string, unknown> = {}) => ({
    posts: [{ index: 0, theme: 'Novo', pillar: 'A', persona: 'Ana', product_name: '', funnel_stage: 'atracao', objective_link: 'serve ao objetivo', hook: 'Gancho novo', headline: 'Manchete nova', caption: 'Legenda nova', hashtags: ['a'], cta: 'CTA', image_prompt: 'cena nova', slides: [], ...over }],
  });
  const approve = (s: ReturnType<typeof setup>['s'], nota = 8) => (s.aiJson['ig_post_review'] = () => ({ results: [{ index: 0, aprovado: true, nota_0_10: nota, motivo: 'ok' }] }));
  const reject = (s: ReturnType<typeof setup>['s'], motivo = 'ainda fora do segmento') => (s.aiJson['ig_post_review'] = () => ({ results: [{ index: 0, aprovado: false, nota_0_10: 2, motivo }] }));

  it('aprovado na 1ª reescrita: volta para "idea" com o texto novo, sem motivo, conta a tentativa e registra post_rewritten', async () => {
    const { w, s, auto } = setup();
    const r = run(w, plan(w), { status: 'active' });
    const post = flagged(w, r);
    s.aiJson['ig_auto_calendar'] = () => item();
    approve(s, 9);
    expect(await auto.rewritePost(post.id)).toBe('rewritten');
    expect(post).toMatchObject({ status: 'idea', theme: 'Novo', hook: 'Gancho novo', caption: 'Legenda nova', objective_link: 'serve ao objetivo', review_reason: null, review_score: 9, review_attempts: 1, last_error: null, lease_until: null });
    expect(post.creative_brief).toMatchObject({ prompt: 'cena nova', headline: 'Manchete nova', variations: 3 });
    expect(post.ai_generation_log.at(-1)).toMatchObject({ step: 'rewrite', attempt: 1, reason: 'fala de outro negócio', status: 'idea' });
    expect(w.t['ig_autopilot_events']!.rows.at(-1)).toMatchObject({ kind: 'post_rewritten', level: 'info', post_id: post.id });
  });

  it('o prompt da reescrita leva o motivo, a versão reprovada, a estratégia aprovada e as regras de data', async () => {
    const { w, s, auto } = setup();
    const r = run(w, plan(w), { status: 'active' });
    const post = flagged(w, r);
    let prompt = '';
    s.aiJson['ig_auto_calendar'] = (req: any) => {
      prompt = req.prompt;
      return item();
    };
    approve(s);
    await auto.rewritePost(post.id);
    expect(prompt).toContain('REFAÇA, reprovado antes por: fala de outro negócio');
    expect(prompt).toContain('VERSÃO REPROVADA (reescreva corrigindo o motivo; mantenha o que não foi criticado): {"tema":"Velho","gancho":"Gancho velho","headline":"Manchete velha","legenda":"Legenda velha","cta":"CTA"}');
    expect(prompt).toMatch(/2\. ESTRATÉGIA APROVADA: .*"mensagem_central":"Almoço rápido e gostoso"/);
    expect(prompt).toContain('Coerência com a data');
  });

  it('com mídia e o mesmo gancho/headline: volta "ready" mantendo a mídia; headline mudou: mídia descartada e volta "idea"', async () => {
    const { w, s, auto } = setup();
    const r = run(w, plan(w), { status: 'active' });
    const keep = flagged(w, r, { media: [{ url: 'https://cdn.test/a.jpg', type: 'image', order: 0 }], hook: 'Gancho novo', creative_brief: { prompt: 'x', headline: 'Manchete nova' } });
    s.aiJson['ig_auto_calendar'] = () => item();
    approve(s);
    await auto.rewritePost(keep.id);
    expect(keep).toMatchObject({ status: 'ready', caption: 'Legenda nova' });
    expect(keep.media).toHaveLength(1);
    const drop = flagged(w, r, { media: [{ url: 'https://cdn.test/b.jpg', type: 'image', order: 0 }] });
    await auto.rewritePost(drop.id);
    expect(drop).toMatchObject({ status: 'idea', media: [] });
  });

  it('reprovado: a 1ª reescrita vira tentativa 1 (continua em revisão com o novo motivo); a 2ª pula o horário (cancelado + post_skipped)', async () => {
    const { w, s, auto } = setup();
    const r = run(w, plan(w), { status: 'active' });
    const post = flagged(w, r);
    s.aiJson['ig_auto_calendar'] = () => item();
    reject(s, 'ainda fora do segmento');
    expect(await auto.rewritePost(post.id)).toBe('retried');
    expect(post).toMatchObject({ status: 'needs_review', review_reason: 'ainda fora do segmento', review_attempts: 1, theme: 'Velho' });
    expect(w.t['ig_autopilot_events']!.rows.at(-1)).toMatchObject({ kind: 'post_rewritten', level: 'warn' });
    reject(s, 'continua genérico');
    w.t['publishing_jobs']!.rows.push({ id: uuid(), ig_post_id: post.id, status: 'pending' });
    expect(await auto.rewritePost(post.id)).toBe('skipped');
    expect(post).toMatchObject({ status: 'cancelled', last_error: 'Pulado automaticamente: continua genérico', review_attempts: 2 });
    expect(w.t['publishing_jobs']!.rows[0]!.status).toBe('cancelled');
    expect(w.t['ig_autopilot_events']!.rows.at(-1)).toMatchObject({ kind: 'post_skipped', level: 'warn', post_id: post.id });
    expect(w.t['ig_autopilot_events']!.rows.at(-1)!.message).toMatch(/continuou reprovado depois de 2 reescrita\(s\) — continua genérico/);
  });

  it('reprovação por código também conta: data incoerente e checagem final (CTA fora da estratégia)', async () => {
    const { w, s, auto } = setup();
    const r = run(w, plan(w), { status: 'active' });
    const monday = new Date('2099-01-05T10:00:00-03:00');
    const a = flagged(w, r, { scheduled_at: monday });
    s.aiJson['ig_auto_calendar'] = () => item({ caption: 'Sextou com chope!' });
    approve(s);
    expect(await auto.rewritePost(a.id)).toBe('retried');
    expect(a.review_reason).toBe('Incoerência de data: "sextou" fora de sexta-feira.');
    const b = flagged(w, r);
    s.aiJson['ig_auto_calendar'] = () => item({ cta: 'Clique no link da bio' });
    expect(await auto.rewritePost(b.id)).toBe('retried');
    expect(b.review_reason).toBe('Checagem final: CTA fora dos CTAs da estratégia.');
  });

  it('IA fora do ar: não gasta tentativa, guarda last_error e tenta de novo no próximo tick', async () => {
    const { w, s, auto } = setup();
    const r = run(w, plan(w), { status: 'active' });
    const post = flagged(w, r);
    s.aiJson['ig_auto_calendar'] = () => {
      throw new Error('IA fora do ar');
    };
    expect(await auto.rewritePost(post.id)).toBeNull();
    expect(post).toMatchObject({ status: 'needs_review', review_attempts: 0, last_error: 'IA fora do ar', lease_until: null });
  });

  it('tentativas esgotadas (review_attempts = 2): pula sem chamar a IA; modo "approval" nunca é reescrito; lease vivo é respeitado', async () => {
    const { w, s, auto } = setup();
    const r = run(w, plan(w), { status: 'active' });
    const spent = flagged(w, r, { review_attempts: 2 });
    expect(await auto.rewritePost(spent.id)).toBe('skipped');
    expect(spent.last_error).toBe('Pulado automaticamente: fala de outro negócio');
    const human = flagged(w, r, { automation: 'approval' });
    const busy = flagged(w, r, { lease_until: new Date(Date.now() + 60e3) });
    expect(await auto.rewritePost(human.id)).toBeNull();
    expect(await auto.rewritePost(busy.id)).toBeNull();
    expect(s.ai.jsonWithEngine).not.toHaveBeenCalled();
    expect([human.status, busy.status]).toEqual(['needs_review', 'needs_review']);
  });

  it('tick: a reescrita roda ANTES de agendar; o post reprovado na checagem final só é reescrito no tick seguinte', async () => {
    const { w, s, auto } = setup();
    connected(w);
    const p = plan(w);
    const r = run(w, p, { status: 'active' });
    // gancho e headline iguais aos que a IA devolve: a reescrita mantém a mídia (volta "ready") e o passo 2 já agenda
    const post = seedPost(w, { run_id: r.id, plan_id: p.id, automation: 'publish', status: 'ready', persona: null, objective_link: 'serve', pillar: 'A', cta: 'CTA', hook: 'Gancho novo', creative_brief: { headline: 'Manchete nova' }, scheduled_at: new Date(Date.now() + 30 * 3600e3) });
    s.aiJson['ig_auto_calendar'] = () => item();
    approve(s);
    let out = await auto.autoCalendarTick();
    expect(post.status).toBe('needs_review'); // reprovado na checagem final do agendamento (passo 2)
    expect(out['rewritten']).toEqual({ rewritten: 0, retried: 0, skipped: 0 });
    out = await auto.autoCalendarTick();
    expect(out['rewritten']).toEqual({ rewritten: 1, retried: 0, skipped: 0 });
    expect(post.status).toBe('scheduled'); // reescrito (mesmo gancho/headline → mantém a mídia) e agendado no mesmo tick
  });

  it('o selo de aprovações (pending-count) não conta o post que a IA está reescrevendo', async () => {
    const { w, s } = setup();
    const r = run(w, plan(w), { status: 'active' });
    flagged(w, r);
    seedPost(w, { status: 'needs_review', automation: 'approval', review_reason: 'x' });
    seedPost(w, { status: 'needs_review', review_reason: 'x' }); // calendário do plano (automation null)
    seedPost(w, { status: 'pending_approval' });
    expect(await s.resources.pendingCount(WS_A)).toEqual({ count: 3 });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd api && ../scripts/run-capped.sh 1500 npm test -- src/modules/instagram/__tests__/auto-calendar.spec.ts -t "A2"`
Expected: FAIL — `auto.rewritePost is not a function`.

- [ ] **Step 3: `alignmentProblems` público e `pendingCount`**

Em `api/src/modules/instagram/publishing.service.ts`, troque `  private async alignmentProblems(post: PostRow, when: Date): Promise<string[]> {` por `  async alignmentProblems(post: PostRow, when: Date): Promise<string[]> {`.

Em `api/src/modules/instagram/instagram-resources.service.ts`, troque o corpo de `pendingCount` por:

```ts
  /** Selo do menu: aguardando aprovação + em revisão humana. O `needs_review` do modo "publish" fica de fora: a IA o reescreve sozinha. */
  async pendingCount(workspaceId: string) {
    return {
      count: await this.prisma.ig_posts.count({
        where: { workspace_id: workspaceId, OR: [{ status: 'pending_approval' }, { status: 'needs_review', OR: [{ automation: null }, { automation: 'approval' }] }] },
      }),
    };
  }
```

- [ ] **Step 4: Reescrita no `AutoCalendarService`**

Em `api/src/modules/instagram/auto-calendar.service.ts`, troque os imports de `./ig-types` e `./ig-store.service` por:

```ts
import { ASPECT, fmtDate, IgFormat, OVERDUE_MS, PostRow, SKIP_PREFIX, STRATEGY_AUTO_APPROVED } from './ig-types';
import { IgStore, errText, leaseFree, PublishClaimLost } from './ig-store.service';
```

Logo depois de `export const LOCK_MS = 240_000;`:

```ts
/** Modo "publish": quantas vezes a IA reescreve um post reprovado antes de pular o horário. */
export const MAX_REWRITES = 2;
/** Reescritas por tick (cada uma gasta 1 chamada de texto + 1 validação). */
const REWRITES_PER_TICK = 3;
```

Troque a assinatura e a linha dos horários do `askPosts`:

```ts
  private async askPosts(
    run: Prisma.ig_auto_runsGetPayload<object>,
    slots: Slot[],
    ctx: RunCtx,
    fixes: Map<number, string>,
    previous: Map<number, Record<string, unknown>> = new Map(),
  ) {
```

e

```ts
      ...slots.map(
        (sl) =>
          `- index ${sl.index}: ${fullDate(sl.at)} · ${sl.format}${fixes.get(sl.index) ? ` · REFAÇA, reprovado antes por: ${fixes.get(sl.index)}` : ''}${
            previous.get(sl.index) ? ` · VERSÃO REPROVADA (reescreva corrigindo o motivo; mantenha o que não foi criticado): ${JSON.stringify(previous.get(sl.index))}` : ''
          }`,
      ),
```

Em `writeChunk`, troque `const { plan, products } = ctx;` por `const { products } = ctx;` e troque o trecho de `const productId = (name: unknown) => {` até o fim do `slots.map(...)` que monta `rows` (inclusive o `});` que fecha o map) por:

```ts
    const rows: Prisma.ig_postsCreateManyInput[] = slots.map((sl) => {
      const f = final.get(sl.index)!;
      const p = f.p ?? {};
      const { brief, ...columns } = this.postFields(p, sl.format, ctx, `Post de ${weekdayName(sl.at)}`);
      const soon = new Date(sl.at).getTime() - Date.now() < 90 * MIN;
      const rejected = !!f.verdict && !f.verdict.aprovado;
      const empty = !asText(p.caption) && !asText(p.theme);
      const needsReview = rejected || empty;
      const at = new Date().toISOString();
      return {
        workspace_id: run.workspace_id,
        plan_id: run.plan_id,
        run_id: run.id,
        automation: run.mode,
        format: sl.format,
        status: needsReview ? 'needs_review' : 'idea',
        review_reason: needsReview ? f.verdict?.motivo || 'A IA não devolveu conteúdo para este horário.' : null,
        review_score: f.verdict?.nota ?? null,
        scheduled_at: new Date(sl.at),
        ...columns,
        creative_brief: {
          ...brief,
          aspect_ratio: ASPECT[sl.format],
          campaign_id: run.campaign_id ?? null,
          // Perto do horário: uma variação só, para a mídia ficar pronta a tempo.
          variations: soon ? 1 : 3,
        },
        ai_provider: f.provider,
        ai_generation_log: [
          {
            at,
            step: 'auto_calendar',
            provider: f.provider,
            run_id: run.id,
            attempts: f.attempts,
            review: f.verdict,
            ...(f.issues.length ? { warnings: f.issues } : {}),
            ...(needsReview ? { status: 'needs_review' } : {}),
          },
        ],
      };
    });
```

Logo depois de `writeChunk`, acrescente os métodos:

```ts
  /** Item da IA → colunas do post (a mesma normalização no lote e na reescrita). Produto só da marca do plano; etapa do funil normalizada. */
  private postFields(p: any, format: string, ctx: RunCtx, fallbackTheme: string) {
    const name = (asText(p.product_name) ?? '').toLowerCase();
    const productId = name ? (ctx.products.find((x) => x.name && (x.name.toLowerCase() === name || name.includes(x.name.toLowerCase())))?.id ?? null) : null;
    const t = (asText(p.funnel_stage) ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const stage = t.startsWith('conv') ? 'conversao' : t.startsWith('cons') || t.startsWith('cone') ? 'consideracao' : 'atracao';
    return {
      theme: asText(p.theme) ?? fallbackTheme,
      hook: asText(p.hook),
      caption: asText(p.caption),
      hashtags: normalizeHashtags(p.hashtags),
      cta: asText(p.cta) || ctx.plan.cta_default || null,
      objective_link: asText(p.objective_link),
      pillar: asText(p.pillar),
      persona: asText(p.persona),
      product_id: productId,
      funnel_stage: stage,
      brief: {
        prompt: asText(p.image_prompt) || asText(p.theme) || '',
        slides: format === 'feed_carousel' ? (asList(p.slides).slice(0, 10) as string[]) : [],
        headline: asText(p.headline),
        pillar: asText(p.pillar),
        funnel_stage: stage,
        product_name: asText(p.product_name),
      },
    };
  }

  /**
   * Modo "publish" (totalmente automático): post reprovado (validador no preenchimento ou checagem final no agendamento) é reescrito
   * pela IA com o motivo — um por vez, no tick, sob o lease do post. Até `MAX_REWRITES` reescritas; depois o horário é pulado.
   */
  async rewriteFlagged(): Promise<{ rewritten: number; retried: number; skipped: number }> {
    const out = { rewritten: 0, retried: 0, skipped: 0 };
    const posts = await this.prisma.ig_posts.findMany({
      where: { automation: 'publish', status: 'needs_review', run_id: { not: null }, scheduled_at: { gt: new Date(Date.now() - OVERDUE_MS) }, ...leaseFree() },
      orderBy: { scheduled_at: 'asc' },
      take: REWRITES_PER_TICK,
      select: { id: true },
    });
    for (const p of posts) {
      const r = await this.rewritePost(p.id).catch((e) => {
        this.logger.warn(`[auto-calendar] reescrita do post ${p.id} falhou: ${errText(e)}`);
        return null;
      });
      if (r) out[r]++;
    }
    return out;
  }

  /** Reescreve UM post reprovado do modo "publish" (lease do post); revalida por código (data, CTA, preço, ligação) e pelo validador. */
  async rewritePost(postId: string): Promise<'rewritten' | 'retried' | 'skipped' | null> {
    const lease = await this.store.claimLease(postId, null, { status: 'needs_review', automation: 'publish' }, {}, LOCK_MS);
    if (!lease) return null;
    try {
      const post = (await this.prisma.ig_posts.findUnique({ where: { id: postId } })) as PostRow | null;
      if (!post?.run_id || !post.scheduled_at) return null;
      const run = await this.prisma.ig_auto_runs.findFirst({ where: { id: post.run_id, workspace_id: post.workspace_id } });
      if (!run?.strategy || !['planning', 'active'].includes(run.status)) return null;
      const reason: string = post.review_reason || 'reprovado na revisão';
      const done: number = post.review_attempts ?? 0;
      if (done >= MAX_REWRITES) return (await this.skipPost(post, reason, done)) ? 'skipped' : null;
      const attempt = done + 1;
      const brief = (post.creative_brief ?? {}) as Record<string, unknown>;
      const at = new Date(post.scheduled_at).toISOString();
      let ctx: RunCtx;
      let items: Map<number, any>;
      let provider: string;
      try {
        ctx = await this.runContext(run);
        await lease.renew();
        const previous = { tema: post.theme, gancho: post.hook, headline: brief['headline'] ?? null, legenda: post.caption, cta: post.cta };
        const slot: Slot = { index: 0, at, format: post.format as IgFormat, kind: String(post.format).startsWith('story') ? 'story' : 'main' };
        ({ items, provider } = await this.askPosts(run, [slot], ctx, new Map([[0, reason]]), new Map([[0, previous]])));
      } catch (e) {
        if (e instanceof PublishClaimLost) throw e;
        // IA fora do ar / sem crédito: não gasta tentativa; o próximo tick tenta de novo.
        await this.prisma.ig_posts.updateMany({ where: { id: postId, status: 'needs_review' }, data: { last_error: errText(e) } });
        return null;
      }
      const p = items.get(0) ?? null;
      const fields = p ? this.postFields(p, post.format, ctx, post.theme ?? `Post de ${weekdayName(at)}`) : null;
      let verdict: Verdict | null = null;
      let problems: string[] = [];
      if (fields) {
        await lease.renew();
        const verdicts = await this.contentStrategy.validatePosts({
          workspaceId: post.workspace_id, brand: ctx.brand, objective: ctx.objective, strategy: run.strategy as unknown as RunStrategy, products: ctx.products,
          posts: [{ index: 0, at, theme: fields.theme, hook: fields.hook, caption: fields.caption, headline: fields.brief.headline, cta: fields.cta }],
        });
        verdict = verdicts.get(0) ?? null;
        const { brief: nextBrief, ...columns } = fields;
        problems = await this.publishing.alignmentProblems({ ...post, ...columns, creative_brief: { ...brief, ...nextBrief } }, new Date(at));
      }
      await lease.renew();
      if (fields && (!verdict || verdict.aprovado) && !problems.length) {
        const { brief: nextBrief, ...columns } = fields;
        const hadMedia = Array.isArray(post.media) && post.media.length > 0;
        // Só o texto mudou (mesmo gancho e mesma headline, que entram na arte): a mídia vale; senão ela é refeita pela produção.
        const keepMedia = hadMedia && (columns.hook ?? '') === (post.hook ?? '') && (nextBrief.headline ?? '') === ((brief['headline'] as string | null | undefined) ?? '');
        const got = await this.prisma.ig_posts.updateMany({
          where: { id: postId, status: 'needs_review' },
          data: {
            ...columns,
            creative_brief: { ...brief, ...nextBrief } as Prisma.InputJsonObject,
            status: keepMedia ? 'ready' : 'idea',
            ...(keepMedia ? {} : { media: [] }),
            review_reason: null,
            review_score: verdict?.nota ?? null,
            review_attempts: attempt,
            last_error: null,
            ai_provider: provider,
            ai_generation_log: this.store.appendLog(post, { step: 'rewrite', provider, attempt, reason, review: verdict, status: keepMedia ? 'ready' : 'idea' }) as unknown as Prisma.InputJsonArray,
          },
        });
        if (!got.count) return null;
        await this.store.logEvent({
          workspace_id: post.workspace_id, plan_id: post.plan_id, post_id: postId, kind: 'post_rewritten',
          message: `Post reescrito pela IA (tentativa ${attempt} de ${MAX_REWRITES}). Motivo anterior: ${reason}`,
        });
        return 'rewritten';
      }
      // O motivo do validador (que já inclui as regras de data por código) vem antes da checagem final do agendamento.
      const motivo = !fields
        ? 'A IA não devolveu conteúdo para este horário.'
        : verdict && !verdict.aprovado
          ? verdict.motivo || 'reprovado na revisão'
          : `Checagem final: ${problems.join('; ')}.`;
      if (attempt >= MAX_REWRITES) return (await this.skipPost(post, motivo, attempt)) ? 'skipped' : null;
      await this.prisma.ig_posts.updateMany({
        where: { id: postId, status: 'needs_review' },
        data: {
          review_reason: motivo,
          review_score: verdict?.nota ?? null,
          review_attempts: attempt,
          last_error: null,
          ai_generation_log: this.store.appendLog(post, { step: 'rewrite', provider, attempt, reason, review: verdict, problems, status: 'needs_review' }) as unknown as Prisma.InputJsonArray,
        },
      });
      await this.store.logEvent({
        workspace_id: post.workspace_id, plan_id: post.plan_id, post_id: postId, kind: 'post_rewritten', level: 'warn',
        message: `Reescrita ${attempt} de ${MAX_REWRITES} ainda reprovada: ${motivo} Nova tentativa no próximo ciclo.`,
      });
      return 'retried';
    } finally {
      await lease.release();
    }
  }

  /** Esgotou as reescritas: o horário é pulado (post cancelado com o motivo, job pendente cancelado) e o painel avisa. */
  private async skipPost(post: PostRow, reason: string, attempts: number): Promise<boolean> {
    const got = await this.prisma.ig_posts.updateMany({
      where: { id: post.id, status: 'needs_review' },
      data: { status: 'cancelled', last_error: `${SKIP_PREFIX}${reason}`, review_reason: reason, review_attempts: attempts },
    });
    if (!got.count) return false;
    await this.prisma.publishing_jobs.updateMany({ where: { ig_post_id: post.id, status: 'pending' }, data: { status: 'cancelled' } });
    await this.store.logEvent({
      workspace_id: post.workspace_id, plan_id: post.plan_id, post_id: post.id, kind: 'post_skipped', level: 'warn',
      message: `Horário de ${post.scheduled_at ? fmtDate(post.scheduled_at) : 'post'} pulado: "${post.theme ?? 'Post'}" continuou reprovado depois de ${attempts} reescrita(s) — ${reason}`,
    });
    return true;
  }
```

No `autoCalendarTick`, logo antes de `// 2) Mídia pronta e ainda não agendada (ou aprovada agora): vai para a fila.`, acrescente:

```ts
    // 2a) Modo totalmente automático: post reprovado é reescrito pela IA (até 2 vezes; depois o horário é pulado). Antes de agendar:
    //     o post reescrito com a mídia mantida já é agendado neste mesmo tick; o reprovado AGORA no agendamento espera o próximo.
    out['rewritten'] = await this.rewriteFlagged().catch((e) => ({ error: errText(e) }));
```

- [ ] **Step 5: Contrato**

Em `docs/api-contract.md`:
- Na linha de `` `GET /ig-posts/pending-count` ``, troque `de \`pending_approval\` **+ \`needs_review\`**` por `de \`pending_approval\` **+ \`needs_review\`** — exceto o \`needs_review\` do modo \`publish\` (\`automation 'publish'\`), que a IA reescreve sozinha`.
- Na linha de `` `fill-auto-calendar` ``, depois de `entra como \`needs_review\` com \`review_reason\`/\`review_score\`.`, acrescente: `No modo \`publish\` esse \`needs_review\` não espera ninguém: o tick reescreve o post com a IA (motivo + versão reprovada + estratégia + regras de data; até 2 reescritas, \`review_attempts\`), revalida por código e pelo validador; aprovado volta para \`idea\` (ou \`ready\` se já tinha mídia e gancho/headline não mudaram), reprovado na 2ª vira \`cancelled\` com \`last_error "Pulado automaticamente: <motivo>"\` e evento \`post_skipped\`; a checagem final do agendamento cai no mesmo ciclo.`
- Na linha da task `media` (§22.4), troque `agendar prontos,` por `reescrever os posts reprovados do modo \`publish\`, agendar prontos,` e a resposta `` `{ autoCalendar, autopilot }` `` fica igual nesta tarefa (o `autoCalendar` ganha a chave `rewritten: { rewritten, retried, skipped }`).

- [ ] **Step 6: Rodar e ver passar**

Run: `cd api && ../scripts/run-capped.sh 1500 npm test -- src/modules/instagram/__tests__/auto-calendar.spec.ts src/modules/instagram/__tests__/resources.spec.ts src/modules/instagram/__tests__/publishing.spec.ts`
Expected: PASS (os testes antigos do lote — `writeChunk` — continuam iguais).

Run: `cd api && ../scripts/run-capped.sh 1500 npm run typecheck`
Expected: sem erros.

- [ ] **Step 7: Commit**

```bash
git add api/src/modules/instagram/auto-calendar.service.ts api/src/modules/instagram/publishing.service.ts api/src/modules/instagram/instagram-resources.service.ts api/src/modules/instagram/__tests__/auto-calendar.spec.ts docs/api-contract.md
git commit -m "feat(instagram): post reprovado no modo totalmente automático é reescrito pela IA (até 2x) ou pulado com aviso

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: A4 — falha de publicação não refaz mídia; sem conta/token o post da programação volta sozinho

**Files:**
- Modify: `api/src/modules/instagram/publishing.service.ts` — `schedulePost` (`:85`), `scheduleAutomated` (`:114-140`), `sweepStalePublishing` (`:240-243`), `publishInner` (`:289`), `finishPublish` (`:337-344`), `runPublishingQueue` (`:408-442`)
- Modify: `api/src/modules/instagram/ig-store.service.ts:123-136` (`handleTokenExpired`)
- Modify: `api/src/modules/instagram/instagram-actions.service.ts:134` (`publishInstagramPost`)
- Modify: `api/src/modules/instagram/media-generation.service.ts:217-226` (`continueAssets`), `:314-330` (pipeline), `:357-367` (catch), `:389-392` (varredor), `:444` (poller)
- Modify: `api/src/modules/instagram/auto-calendar.service.ts:492-514` (passos 2 e 2b)
- Modify: `docs/api-contract.md:421` (`GET /ig-posts`), `:451-452` (`schedule-post`/`publish-instagram-post`), `:466-468` (fila)
- Test: `api/src/modules/instagram/__tests__/publishing.spec.ts` (ajustar `scheduleAutomated` e novo `describe`), `auto-calendar.spec.ts` (ajustar o teste do 2b), `media-generation.spec.ts` (ajustar o "vídeo assíncrono" e acrescentar `failure_kind`)

**Interfaces:**
- Consumes: `NO_ACCOUNT_MSG`, `TOKEN_EXPIRED_POST_MSG`, `SKIP_PREFIX`, `OVERDUE_MS` (Task 2); `ig_posts.failure_kind` (Task 1).
- Produces:
  - `scheduleAutomated(postId)` pode devolver `{ skipped: 'sem conta' }` e `{ skipped: 'prazo vencido' }`.
  - `runPublishingQueue()` pode devolver item `{ job, status: 'waiting_account', error }`.
  - Regra: `failure_kind = 'media'` em toda falha de geração; `'publish'` em toda falha de publicação; `null` em sucesso; o tick 2b só reabre `failure_kind = 'media'`; o tick 2 só agenda posts de empresas com conta conectada.

- [ ] **Step 1: Escrever os testes que falham**

Em `api/src/modules/instagram/__tests__/publishing.spec.ts`, no teste `describe('scheduleAutomated', …)`, troque as linhas do `lost` (de `const origin = Date.now() - 20 * 3600e3;` até `expect(w.t['ig_autopilot_events']!.rows.map((e) => e.message).join('|')).toMatch(/Horário perdido/);`) por:

```ts
    const origin = Date.now() - 20 * 3600e3;
    // Modo "approval" (já aprovado): mais de 12 h → mesmo horário do dia seguinte (regra antiga).
    const lost = seedPost(w, { automation: 'approval', status: 'approved', scheduled_at: new Date(origin) });
    const r2 = (await svc.scheduleAutomated(lost.id)) as { scheduled: string };
    expect(Date.parse(r2.scheduled)).toBeGreaterThan(Date.now() + 30 * 60e3);
    expect(Date.parse(r2.scheduled) - origin).toBe(86400e3);
    expect(w.t['ig_autopilot_events']!.rows.map((e) => e.message).join('|')).toMatch(/Horário perdido/);
    // Modo "publish": o cronograma é respeitado — mais de 12 h de atraso pula o horário (não empurra 1 dia).
    const skipped = seedPost(w, { automation: 'publish', status: 'ready', scheduled_at: new Date(origin) });
    expect(await svc.scheduleAutomated(skipped.id)).toEqual({ skipped: 'prazo vencido' });
    expect(skipped).toMatchObject({ status: 'cancelled', last_error: 'Pulado automaticamente: o horário passou há mais de 12 h.' });
    expect(w.t['ig_autopilot_events']!.rows.at(-1)).toMatchObject({ kind: 'post_skipped', level: 'warn', post_id: skipped.id });
    expect(w.t['publishing_jobs']!.rows.filter((j) => j.ig_post_id === skipped.id)).toHaveLength(0);
```

Acrescente ao fim do mesmo arquivo:

```ts
describe('A4 — falha de publicação não refaz mídia; sem conta/token o post da programação volta sozinho', () => {
  const runJob = (w: IgWorld, postId: string, over: Record<string, unknown> = {}) => {
    const j: any = { id: uuid(), workspace_id: WS, channel: 'instagram_organic', ig_post_id: postId, target: 'instagram', status: 'pending', mode: 'live', run_at: new Date(Date.now() - 1000), attempts: 0, locked_at: null, log: null, ...over };
    w.t['publishing_jobs']!.rows.push(j);
    return j;
  };

  it('scheduleAutomated sem conta: fica "pronto" com o aviso, sem job (nem simulado); quando a conta conecta, agenda e limpa o aviso', async () => {
    const w = igWorld();
    const svc = new PublishingService(w.store, w.graph, jest.fn() as any);
    const p = seedPost(w, { automation: 'publish', status: 'ready', run_id: uuid(), scheduled_at: new Date(Date.now() + 3 * 3600e3) });
    expect(await svc.scheduleAutomated(p.id)).toEqual({ skipped: 'sem conta' });
    expect(p).toMatchObject({ status: 'ready', last_error: 'Conecte o Instagram para publicar.' });
    expect(w.t['publishing_jobs']!.rows).toHaveLength(0);
    w.t['instagram_accounts']!.rows.push({ id: uuid(), workspace_id: WS, ig_user_id: IG, status: 'connected' });
    expect(await svc.scheduleAutomated(p.id)).toMatchObject({ scheduled: p.scheduled_at.toISOString() });
    expect(p).toMatchObject({ status: 'scheduled', last_error: null, failure_kind: null });
    expect(w.t['publishing_jobs']!.rows.map((j) => [j.mode, j.status])).toEqual([['live', 'pending']]);
  });

  it('fila: guardrail vira failure_kind "publish" (sem refazer mídia); erro comum que ainda vai tentar de novo não marca', async () => {
    const { w, svc } = setup();
    const mock = seedPost(w, { media: [{ url: 'https://picsum.photos/x', type: 'image', order: 0 }] });
    runJob(w, mock.id);
    await svc.runPublishingQueue();
    expect(mock).toMatchObject({ status: 'failed', failure_kind: 'publish' });
    w.respond((path, opts) => (path === `/${IG}/media` && opts.method === 'POST' ? new Error('A Meta recusou') : undefined));
    const flaky = seedPost(w);
    runJob(w, flaky.id);
    await svc.runPublishingQueue();
    expect(flaky.status).toBe('scheduled');
    expect(flaky.failure_kind ?? null).toBeNull();
  });

  it('fila: post da programação sem conta (guardrail) volta para "pronto" com o aviso — nunca "failed"', async () => {
    const w = igWorld();
    const svc = new PublishingService(w.store, w.graph, jest.fn(async () => new Response(null, { status: 200 })) as any);
    useVirtualClock(svc);
    const p = seedPost(w, { status: 'scheduled', automation: 'publish', run_id: uuid() });
    const j = runJob(w, p.id);
    const res = await svc.runPublishingQueue();
    expect(res[0]).toMatchObject({ job: j.id, status: 'waiting_account' });
    expect(p).toMatchObject({ status: 'ready', last_error: 'Conecte o Instagram para publicar.' });
    expect(p.failure_kind ?? null).toBeNull();
    // post SEM programação (plano/manual): segue o caminho antigo (failed + publish)
    const manual = seedPost(w, { status: 'scheduled' });
    runJob(w, manual.id);
    await svc.runPublishingQueue();
    expect(manual).toMatchObject({ status: 'failed', failure_kind: 'publish' });
  });

  it('token vencido: o post da fila e os agendados da programação voltam para "pronto" com o motivo; os do plano ficam como estavam', async () => {
    const { w, svc } = setup();
    w.respond((path, opts) => (path === `/${IG}/media` && opts.method === 'POST' ? new MetaError('O token da Meta é inválido ou expirou.', 190) : undefined));
    const runId = uuid();
    const p = seedPost(w, { status: 'scheduled', automation: 'publish', run_id: runId });
    runJob(w, p.id);
    const queued = seedPost(w, { status: 'scheduled', automation: 'publish', run_id: runId });
    const planPost = seedPost(w, { status: 'scheduled' });
    await svc.runPublishingQueue();
    expect(p).toMatchObject({ status: 'ready', last_error: 'Token da Meta expirado: reconecte o Instagram para publicar.' });
    expect(queued).toMatchObject({ status: 'ready', last_error: 'Token da Meta expirado: reconecte o Instagram para publicar.' });
    expect(planPost.status).toBe('scheduled');
  });

  it('varredor de publicação marca failure_kind "publish"; publicar com sucesso limpa', async () => {
    const { w, svc } = setup();
    const stuck = seedPost(w, { status: 'publishing', lease_until: null });
    await svc.sweepStalePublishing();
    expect(stuck).toMatchObject({ status: 'failed', failure_kind: 'publish' });
    const ok = seedPost(w, { failure_kind: 'publish' });
    await svc.publishInstagramPost(ok.id);
    expect(ok).toMatchObject({ status: 'published', failure_kind: null });
  });

  it('Review Focus #1 — empresa sem conta com muitos prontos não trava as outras; reconectou, agenda sozinho (sem refazer mídia)', async () => {
    const w = igWorld();
    const s = igServices(w);
    const auto = s.auto;
    w.t['instagram_accounts']!.rows.push({ id: uuid(), workspace_id: WS_B, ig_user_id: 'igB', status: 'connected' });
    const late = (ws: string, i: number) => seedPost(w, { workspace_id: ws, automation: 'publish', status: 'ready', run_id: uuid(), scheduled_at: new Date(Date.now() + (1 + i) * 60e3 + 3600e3) });
    const blocked = Array.from({ length: 25 }, (_, i) => late(WS, i)); // WS_A sem conta, horários mais cedo
    const other = seedPost(w, { workspace_id: WS_B, automation: 'publish', status: 'ready', run_id: uuid(), scheduled_at: new Date(Date.now() + 5 * 3600e3) });
    const out = await auto.autoCalendarTick();
    expect(out['scheduled']).toBe(1);
    expect(other.status).toBe('scheduled');
    expect(blocked.every((p) => p.status === 'ready')).toBe(true);
    // a conta de WS_A conecta: no tick seguinte os prontos entram na fila (20 por tick), sem nova geração de mídia
    w.t['instagram_accounts']!.rows.push({ id: uuid(), workspace_id: WS, ig_user_id: IG, status: 'connected' });
    await auto.autoCalendarTick();
    expect(blocked.filter((p) => p.status === 'scheduled')).toHaveLength(20);
    expect(s.pipeline.run).not.toHaveBeenCalled();
  });
});
```

E acrescente aos imports do topo de `publishing.spec.ts`: `import { igServices } from './harness';` (junto do import existente de `./harness`: `import { igServices, igWorld, IgWorld, seedPost, uuid } from './harness';`).

Em `api/src/modules/instagram/__tests__/auto-calendar.spec.ts`, no teste `it('2: agenda posts automáticos prontos …')`, troque as duas linhas `const failed = …` e `const failedTwice = …` por:

```ts
    const failed = seedPost(w, { automation: 'publish', status: 'failed', failure_kind: 'media', plan_id: p.id, run_id: r.id, scheduled_at: new Date(Date.now() + 3600e3), creative_brief: { prompt: 'x', variations: 3 } });
    const failedTwice = seedPost(w, { automation: 'publish', status: 'failed', failure_kind: 'media', plan_id: p.id, run_id: r.id, scheduled_at: new Date(Date.now() + 3600e3), creative_brief: { auto_retried: true } });
    const publishFail = seedPost(w, { automation: 'publish', status: 'failed', failure_kind: 'publish', plan_id: p.id, run_id: r.id, scheduled_at: new Date(Date.now() + 3600e3), creative_brief: { prompt: 'y' } });
```

e acrescente, depois de `expect(failedTwice.status).toBe('failed');`:

```ts
    expect(publishFail.status).toBe('failed'); // falha de publicação: a mídia não é refeita
```

Em `api/src/modules/instagram/__tests__/media-generation.spec.ts`, no teste `'vídeo assíncrono: guarda pending_job …'`, troque `expect(post.status).toBe('scheduled'); // automação "publish": …` por:

```ts
    expect(post).toMatchObject({ status: 'ready', last_error: 'Conecte o Instagram para publicar.' }); // sem conta: pronto, sem job simulado
```

e troque a linha `expect(post.last_error).toBeNull();` (logo abaixo) por `expect(w.t['publishing_jobs']!.rows).toHaveLength(0);`. No teste `'erro do provedor: post failed …'`, troque `expect(post).toMatchObject({ status: 'failed', last_error: 'x' });` por `expect(post).toMatchObject({ status: 'failed', last_error: 'x', failure_kind: 'media' });`. No teste `'poller: falha do provedor → failed …'`, troque `expect(failing).toMatchObject({ status: 'failed', last_error: 'O provedor informou falha na geração da mídia.' });` por `expect(failing).toMatchObject({ status: 'failed', last_error: 'O provedor informou falha na geração da mídia.', failure_kind: 'media' });`. No teste do varredor (`'varredor: "generating" sem pending_job …'`), troque `expect(dead).toMatchObject({ status: 'failed', last_error: 'Geração da mídia interrompida — tente gerar de novo.', lease_until: null });` por `expect(dead).toMatchObject({ status: 'failed', last_error: 'Geração da mídia interrompida — tente gerar de novo.', lease_until: null, failure_kind: 'media' });`. No primeiro teste do arquivo, troque `expect(post).toMatchObject({ last_error: null, ai_provider: 'gemini' });` por `expect(post).toMatchObject({ last_error: null, ai_provider: 'gemini', failure_kind: null });`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd api && ../scripts/run-capped.sh 1500 npm test -- src/modules/instagram/__tests__/publishing.spec.ts src/modules/instagram/__tests__/media-generation.spec.ts src/modules/instagram/__tests__/auto-calendar.spec.ts`
Expected: FAIL — `failure_kind` `undefined`, `{ scheduled: … }` em vez de `{ skipped: 'sem conta' }`, post da programação `failed` na fila.

- [ ] **Step 3: Publicação**

Em `api/src/modules/instagram/publishing.service.ts`, troque o import de `./ig-types` por `import { fmtDate, IgFormat, NO_ACCOUNT_MSG, OVERDUE_MS, PostRow, SKIP_PREFIX, TOKEN_EXPIRED_POST_MSG } from './ig-types';` e, logo depois de `export const PUBLISH_INTERRUPTED = …;`, acrescente:

```ts
/** Guardrail de publicação sem conta (texto do protótipo). Post da programação com ele volta para "pronto" em vez de falhar. */
export const NO_ACCOUNT_GUARDRAIL = 'Nenhuma conta do Instagram conectada nesta empresa. Conecte em Instagram → Visão geral e agende de novo.';
```

Em `publishInner`, troque `if (!acc) throw new Guardrail('Nenhuma conta do Instagram conectada nesta empresa. Conecte em Instagram → Visão geral e agende de novo.');` por `if (!acc) throw new Guardrail(NO_ACCOUNT_GUARDRAIL);`.

Em `schedulePost`, troque `this.prisma.ig_posts.update({ where: { id: postId }, data: { status: 'scheduled', scheduled_at: when, last_error: null } }),` por `this.prisma.ig_posts.update({ where: { id: postId }, data: { status: 'scheduled', scheduled_at: when, last_error: null, failure_kind: null } }),`.

Troque o método `scheduleAutomated` inteiro (com o comentário acima dele) por:

```ts
  /**
   * Agenda um post automático com mídia pronta. No modo "approval" só agenda depois de aprovado.
   * Sem conta do Instagram conectada: nada de job simulado — o post fica pronto com o aviso e o tick o agenda quando a conta conectar.
   * Mídia pronta depois do horário: publica o quanto antes (até 12 h de atraso); passou disso, o modo "publish" pula o horário
   * (o cronograma é respeitado) e o modo "approval" passa para o mesmo horário do dia seguinte.
   */
  async scheduleAutomated(postId: string): Promise<{ skipped: string } | { scheduled: string }> {
    const post = await this.prisma.ig_posts.findUnique({ where: { id: postId } });
    const media = (post?.media ?? []) as unknown[];
    if (!post?.automation || !Array.isArray(media) || !media.length) return { skipped: 'sem mídia' };
    if (!['ready', 'approved'].includes(post.status)) return { skipped: post.status };
    if (post.automation === 'approval' && !post.approved_at) return { skipped: 'aguardando aprovação' };
    if (!(await this.store.liveAccount(post.workspace_id))) {
      if (post.last_error !== NO_ACCOUNT_MSG && post.last_error !== TOKEN_EXPIRED_POST_MSG) {
        await this.prisma.ig_posts.updateMany({ where: { id: postId, status: post.status }, data: { last_error: NO_ACCOUNT_MSG } });
      }
      return { skipped: 'sem conta' };
    }
    const MIN = 60e3;
    let at = post.scheduled_at ? post.scheduled_at.getTime() : Date.now();
    const late = Date.now() - at;
    let msg: string;
    if (late <= 0) msg = `Agendado para ${fmtDate(new Date(at))}.`;
    else if (late <= OVERDUE_MS) {
      at = Date.now() + MIN;
      msg = 'A mídia ficou pronta depois do horário: publicando agora.';
    } else if (post.automation === 'publish') {
      const reason = 'o horário passou há mais de 12 h.';
      const got = await this.prisma.ig_posts.updateMany({ where: { id: postId, status: post.status }, data: { status: 'cancelled', last_error: `${SKIP_PREFIX}${reason}` } });
      if (got.count) await this.store.logEvent({ workspace_id: post.workspace_id, plan_id: post.plan_id, post_id: postId, kind: 'post_skipped', level: 'warn', message: `Horário pulado: ${reason}` });
      return { skipped: 'prazo vencido' };
    } else {
      while (at < Date.now() + 30 * MIN) at += 86400e3;
      msg = `Horário perdido: reagendado para ${fmtDate(new Date(at))}.`;
    }
    await this.schedulePost(post.workspace_id, postId, new Date(at));
    await this.store.logEvent({ workspace_id: post.workspace_id, plan_id: post.plan_id, post_id: postId, kind: 'schedule', message: msg });
    return { scheduled: new Date(at).toISOString() };
  }
```

Em `sweepStalePublishing`, troque `data: { status: 'failed', last_error: PUBLISH_INTERRUPTED, lease_until: null },` por `data: { status: 'failed', last_error: PUBLISH_INTERRUPTED, lease_until: null, failure_kind: 'publish' },`.

Em `finishPublish`, acrescente `failure_kind: null,` ao objeto do `patchPost` (depois de `last_error: null,`).

Em `runPublishingQueue`, troque o trecho de `const attempts = job.attempts + 1;` até `results.push({ job: job.id, status: retry ? 'retry' : 'failed', error: msg });` por:

```ts
        const attempts = job.attempts + 1;
        const rate = e instanceof RateLimited;
        const tokenExpired = e instanceof MetaError && e.code === 190;
        const blocked = e instanceof Guardrail;
        const retry = !tokenExpired && !blocked && (rate || attempts < MAX_ATTEMPTS);
        const post = job.ig_post_id ? await this.prisma.ig_posts.findUnique({ where: { id: job.ig_post_id } }) : null;
        if (tokenExpired && post) await this.store.handleTokenExpired(post.workspace_id, msg);
        // Post da programação sem conta/token: volta para "pronto" (sem refazer mídia) e é reagendado sozinho quando a conta reconectar.
        const backToReady = !!post?.run_id && (tokenExpired || (blocked && msg === NO_ACCOUNT_GUARDRAIL));
        if (post)
          await this.store.logEvent({
            workspace_id: post.workspace_id,
            plan_id: post.plan_id,
            post_id: post.id,
            kind: blocked ? 'guardrail' : 'failure',
            level: retry ? 'warn' : 'error',
            message: `${retry ? 'Falha (nova tentativa)' : 'Falha'} ao publicar: ${msg}`,
          });
        const delay = rate ? 60 * 60e3 : 5 * 60e3 * 2 ** (attempts - 1); // backoff 5, 10 min
        await this.prisma.publishing_jobs.update({
          where: { id: job.id },
          data: {
            status: retry ? 'pending' : 'failed',
            locked_at: null,
            attempts: rate ? job.attempts : attempts,
            ...(retry ? { run_at: new Date(Date.now() + delay) } : {}),
            log: logWith(msg),
          },
        });
        if (post)
          await this.store.patchPost(
            post.id,
            backToReady
              ? { status: 'ready', last_error: tokenExpired ? TOKEN_EXPIRED_POST_MSG : NO_ACCOUNT_MSG, ig_creation_id: null }
              : {
                  status: retry ? 'scheduled' : 'failed',
                  last_error: msg,
                  retry_count: (post.retry_count ?? 0) + (rate ? 0 : 1),
                  ...(retry ? { scheduled_at: new Date(Date.now() + delay) } : { failure_kind: 'publish' }),
                },
          );
        results.push({ job: job.id, status: backToReady ? 'waiting_account' : retry ? 'retry' : 'failed', error: msg });
```

Em `api/src/modules/instagram/ig-store.service.ts`, acrescente ao import de `./ig-types` o `TOKEN_EXPIRED_POST_MSG` e, em `handleTokenExpired`, logo depois do `publishing_jobs.updateMany(...)`:

```ts
    // Posts da programação que já estavam na fila voltam para "pronto" (com o motivo): reagendados sozinhos quando o token for renovado.
    await this.prisma.ig_posts.updateMany({
      where: { workspace_id: workspaceId, run_id: { not: null }, status: 'scheduled' },
      data: { status: 'ready', last_error: TOKEN_EXPIRED_POST_MSG },
    });
```

Em `api/src/modules/instagram/instagram-actions.service.ts`, troque `await this.store.patchPost(postId, { status: 'failed', last_error: msg });` por `await this.store.patchPost(postId, { status: 'failed', last_error: msg, failure_kind: 'publish' });`.

- [ ] **Step 4: Geração marca `failure_kind`**

Em `api/src/modules/instagram/media-generation.service.ts`:
- no `patchPost` final do `continueAssets` e no `patchPost` de sucesso do pipeline (imagem única), acrescente `failure_kind: null,` depois de `last_error: null,`;
- no `catch` do `generatePostAssets`, troque `status: 'failed',\n        last_error: errText(e),` por `status: 'failed',\n        last_error: errText(e),\n        failure_kind: 'media',`;
- no varredor `sweepStaleGenerating`, troque `data: { status: 'failed', last_error: GENERATION_INTERRUPTED, lease_until: null },` por `data: { status: 'failed', last_error: GENERATION_INTERRUPTED, lease_until: null, failure_kind: 'media' },`;
- no `catch` do `pollPendingMedia`, troque `await this.store.patchPost(post.id, { status: 'failed', last_error: errText(e), creative_brief: brief });` por `await this.store.patchPost(post.id, { status: 'failed', last_error: errText(e), failure_kind: 'media', creative_brief: brief });`.

- [ ] **Step 5: Tick — agenda só empresas conectadas; 2b só falha de mídia**

Em `api/src/modules/instagram/auto-calendar.service.ts`, troque o bloco do passo 2 (de `// 2) Mídia pronta e ainda não agendada …` até `out['scheduled'] = scheduled;`) por:

```ts
    // 2) Mídia pronta e ainda não agendada (ou aprovada agora): vai para a fila — só empresas com o Instagram conectado (sem conta o post
    //    fica pronto com o aviso e entra aqui sozinho quando a conta conectar; uma empresa sem conta não ocupa as 20 vagas das outras).
    const live = await this.prisma.instagram_accounts.findMany({ where: { status: 'connected', ig_user_id: { not: null } }, select: { workspace_id: true } });
    const ready = live.length
      ? await this.prisma.ig_posts.findMany({
          where: { automation: { not: null }, status: { in: ['ready', 'approved'] }, workspace_id: { in: live.map((a) => a.workspace_id) } },
          orderBy: { scheduled_at: 'asc' },
          take: 20,
          select: { id: true },
        })
      : [];
    let scheduled = 0;
    for (const p of ready) {
      const r = await this.publishing.scheduleAutomated(p.id).catch(async (e) => {
        await this.prisma.ig_posts.update({ where: { id: p.id }, data: { last_error: errText(e) } });
        return null;
      });
      if (r && 'scheduled' in r) scheduled++;
    }
    out['scheduled'] = scheduled;
```

E no passo 2b troque `where: { automation: { not: null }, status: 'failed', scheduled_at: { gt: new Date(Date.now() - 12 * 3600e3) } },` por:

```ts
      // Só falha de MÍDIA ganha nova geração; falha de publicação (conta, token, limite, guardrail) não refaz o criativo à toa.
      where: { automation: { not: null }, status: 'failed', failure_kind: 'media', scheduled_at: { gt: new Date(Date.now() - OVERDUE_MS) } },
```

- [ ] **Step 6: Contrato**

Em `docs/api-contract.md`:
- `GET /ig-posts`: depois de `` `review_score` (number). `` acrescente `` Produção automática (05/10/2026): `review_attempts` (int, reescritas da IA no modo `publish`) e `failure_kind` (`media\|publish\|null`, CHECK `ig_posts_failure_kind_check`: falha de publicação não refaz a mídia). ``
- `schedule-post`: depois de `post → \`scheduled\`.` acrescente `(limpa \`last_error\` e \`failure_kind\`).`
- `publish-instagram-post`: troque `(post \`failed\`)` por `(post \`failed\` + \`failure_kind 'publish'\`)`.
- §22.3, depois de `o post espelha (\`scheduled\`/\`failed\`, \`retry_count\`, \`last_error\`).` acrescente: `` Falha definitiva marca `failure_kind 'publish'` (o tick só refaz mídia de `failure_kind 'media'`). Post **da programação** (`run_id`) que falha por falta de conta (guardrail "Nenhuma conta do Instagram conectada…") ou token vencido (190) volta para `ready` com `last_error "Conecte o Instagram para publicar."` / `"Token da Meta expirado: reconecte o Instagram para publicar."` (item da resposta `status: 'waiting_account'`); o token vencido também devolve a `ready` os posts da programação que estavam `scheduled`. O agendamento automático (`scheduleAutomated`) nunca cria job simulado para posts da programação: sem conta o post fica `ready` com o aviso e o tick 2 o agenda quando a conta conectar (o tick só olha empresas com conta conectada). Atraso > 12 h no modo `publish` → `cancelled` com `"Pulado automaticamente: o horário passou há mais de 12 h."` + evento `post_skipped` (no modo `approval` continua indo para o dia seguinte). ``

- [ ] **Step 7: Rodar e ver passar**

Run: `cd api && ../scripts/run-capped.sh 1500 npm test -- src/modules/instagram/__tests__/publishing.spec.ts src/modules/instagram/__tests__/media-generation.spec.ts src/modules/instagram/__tests__/auto-calendar.spec.ts src/modules/instagram/__tests__/actions.spec.ts src/modules/instagram/__tests__/autopilot.spec.ts`
Expected: PASS.

Run: `cd api && ../scripts/run-capped.sh 1500 npm run typecheck`
Expected: sem erros.

- [ ] **Step 8: Commit**

```bash
git add api/src/modules/instagram/publishing.service.ts api/src/modules/instagram/ig-store.service.ts api/src/modules/instagram/instagram-actions.service.ts api/src/modules/instagram/media-generation.service.ts api/src/modules/instagram/auto-calendar.service.ts api/src/modules/instagram/__tests__/publishing.spec.ts api/src/modules/instagram/__tests__/media-generation.spec.ts api/src/modules/instagram/__tests__/auto-calendar.spec.ts docs/api-contract.md
git commit -m "feat(instagram): falha de publicação não refaz mídia; sem conta ou token vencido o post da programação volta sozinho

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: A3 — produção antecipada (janela de 48 h, meta de 24 h, rodízio por empresa) e painel do período

**Files:**
- Create: `api/src/modules/instagram/production.service.ts`
- Modify: `api/src/modules/instagram/instagram.module.ts:24-47` (provider)
- Modify: `api/src/modules/instagram/instagram-cron.service.ts:21-46` (construtor + `media()`)
- Modify: `api/src/modules/instagram/autopilot.service.ts:77-120` (só posts de plano)
- Modify: `api/src/modules/instagram/auto-calendar.service.ts:516-526` (remove o passo 2c) e `:631-657` (`summary`)
- Modify: `api/src/modules/instagram/media-generation.service.ts:21-28` (`VIDEO_WAIT_MS`) e `:192-197` (espera curta do vídeo)
- Modify: `api/src/modules/instagram/__tests__/harness.ts` (instancia o `ProductionService` com a consulta em memória)
- Modify: `docs/api-contract.md:414`, `:428`, `:478`
- Test: `api/src/modules/instagram/__tests__/production.spec.ts` (novo); `cron.spec.ts`, `autopilot.spec.ts`, `auto-calendar.spec.ts` (ajustes)

**Interfaces:**
- Consumes: `MediaGenerationService.generatePostAssets(workspaceId, postId, providerChoice?, instructions?)`; `PublishingService.scheduleAutomated(postId)` (Task 4); `OVERDUE_MS`, `SKIP_PREFIX`, `isSkipped` (Task 2); `Env.IG_PRODUCTION_*` (Task 1).
- Produces:
  - `type ProductionCandidate = { id: string; workspace_id: string; plan_id: string | null; scheduled_at: Date; late: boolean }`.
  - `rankProductionCandidates<T extends { id: string; workspace_id: string; scheduled_at: Date }>(rows: T[], o: { now: Date; perTick: number; targetHours: number }): (T & { late: boolean })[]`.
  - `ProductionService.candidates(now?: Date): Promise<ProductionCandidate[]>` (SQL com `ROW_NUMBER()`), `skipOverdue(now?: Date): Promise<number>`, `productionTick(): Promise<{ skipped: number; started: number; ready: number; pending: number; failed: number }>`.
  - `export const VIDEO_WAIT_MS = 25_000` (em `media-generation.service.ts`).
  - Cron `media` devolve `{ autoCalendar, production, autopilot }`.
  - `summary()` → `counts` ganha `produced, producing, queued, rewriting, skipped` (e `review` passa a ser só a revisão humana) + `skipped_posts: { id, theme, scheduled_at, reason }[]` (≤ 20).
  - Harness: `igServices(w).production` (com `candidates` em memória que espelha a SQL).

- [ ] **Step 1: Escrever os testes que falham**

Crie `api/src/modules/instagram/__tests__/production.spec.ts`:

```ts
import { WS_A, WS_B } from '../../media/__tests__/mem';
import { ProductionService, rankProductionCandidates } from '../production.service';
import { igServices, igWorld, IgWorld, seedPost, uuid } from './harness';

function setup() {
  const w: IgWorld = igWorld();
  const s = igServices(w);
  return { w, s, prod: s.production };
}
const connected = (w: IgWorld, ws: string = WS_A) => w.t['instagram_accounts']!.rows.push({ id: uuid(), workspace_id: ws, ig_user_id: `ig-${ws}`, status: 'connected' });
const inH = (h: number) => new Date(Date.now() + h * 3600e3);
const runFor = (w: IgWorld, ws: string = WS_A, over: Record<string, unknown> = {}): any => {
  const plan = { id: uuid(), workspace_id: ws, brand_id: null, status: 'active', requires_approval: false, auto_publish: false };
  w.t['ig_content_plans']!.rows.push(plan);
  const r = { id: uuid(), workspace_id: ws, plan_id: plan.id, mode: 'publish', status: 'active', strategy: null, strategy_status: 'approved', ...over };
  w.t['ig_auto_runs']!.rows.push(r);
  return r;
};
const idea = (w: IgWorld, r: any, at: Date, over: Record<string, unknown> = {}) =>
  seedPost(w, { workspace_id: r.workspace_id, plan_id: r.plan_id, run_id: r.id, automation: r.mode, status: 'idea', media: [], approved_at: null, scheduled_at: at, creative_brief: { prompt: 'copo de chope' }, objective_link: 'serve', pillar: 'A', persona: 'Ana', ...over });

describe('rankProductionCandidates (rodízio por empresa + prioridade da meta)', () => {
  const now = new Date('2099-01-01T12:00:00Z');
  const at = (h: number) => new Date(now.getTime() + h * 3600e3);
  it('1 post por empresa (o mais próximo dela); quem está a menos de 24 h passa à frente; até perTick', () => {
    const rows = [
      { id: 'a1', workspace_id: 'A', scheduled_at: at(30) },
      { id: 'a2', workspace_id: 'A', scheduled_at: at(40) },
      { id: 'b1', workspace_id: 'B', scheduled_at: at(20) },
      { id: 'b2', workspace_id: 'B', scheduled_at: at(2) },
      { id: 'c1', workspace_id: 'C', scheduled_at: at(47) },
    ];
    expect(rankProductionCandidates(rows, { now, perTick: 4, targetHours: 24 }).map((r) => [r.id, r.late])).toEqual([['b2', true], ['a1', false], ['c1', false]]);
    expect(rankProductionCandidates(rows, { now, perTick: 1, targetHours: 24 }).map((r) => r.id)).toEqual(['b2']);
  });
});

describe('ProductionService.candidates (consulta real)', () => {
  it('o rodízio é feito NA SQL (ROW_NUMBER por empresa), com janela, lease livre, prioridade da meta e limite por rodada', async () => {
    const queryRaw = jest.fn(async () => []);
    const svc = new ProductionService({ prisma: { $queryRaw: queryRaw } } as any, {} as any, {} as any, { IG_PRODUCTION_PER_TICK: 3, IG_PRODUCTION_WINDOW_HOURS: 48, IG_PRODUCTION_TARGET_HOURS: 24 } as any);
    await svc.candidates(new Date('2099-01-01T12:00:00Z'));
    const [strings, ...values] = queryRaw.mock.calls[0] as unknown as [string[], ...unknown[]];
    const sql = strings.join('$');
    expect(sql).toMatch(/ROW_NUMBER\(\) OVER \(PARTITION BY p\.workspace_id ORDER BY p\.scheduled_at ASC, p\.id ASC\) AS rn/);
    expect(sql).toMatch(/WHERE x\.rn = 1/);
    expect(sql).toMatch(/p\.run_id IS NOT NULL/);
    expect(sql).toMatch(/p\.status = 'idea'/);
    expect(sql).toMatch(/p\.lease_until IS NULL OR p\.lease_until < \$::timestamptz/);
    expect(sql).toMatch(/ORDER BY late DESC, x\.scheduled_at ASC/);
    expect(values).toEqual(['2099-01-02T12:00:00.000Z', '2099-01-01T00:00:00.000Z', '2099-01-03T12:00:00.000Z', '2099-01-01T12:00:00.000Z', 3]);
  });
});

describe('ProductionService.productionTick (janela 48 h → meta 24 h)', () => {
  it('produz 1 post por empresa por rodada (o mais próximo dela), agenda no horário e registra os eventos', async () => {
    const { w, prod } = setup();
    connected(w, WS_A);
    connected(w, WS_B);
    const ra = runFor(w, WS_A);
    const rb = runFor(w, WS_B);
    const a1 = idea(w, ra, inH(30));
    const a2 = idea(w, ra, inH(40));
    const b1 = idea(w, rb, inH(20));
    const far = idea(w, ra, inH(60)); // fora da janela de 48 h
    const planPost = seedPost(w, { status: 'idea', media: [], plan_id: ra.plan_id, scheduled_at: inH(5) }); // sem programação
    const out = await prod.productionTick();
    expect(out).toMatchObject({ skipped: 0, started: 2, ready: 2, pending: 0, failed: 0 });
    expect([a1.status, b1.status]).toEqual(['scheduled', 'scheduled']);
    expect([a2.status, far.status, planPost.status]).toEqual(['idea', 'idea', 'idea']);
    expect(w.t['publishing_jobs']!.rows.map((j) => j.run_at.getTime()).sort()).toEqual([a1.scheduled_at.getTime(), b1.scheduled_at.getTime()].sort());
    const msgs = w.t['ig_autopilot_events']!.rows.filter((e) => e.kind === 'media').map((e) => e.message);
    expect(msgs).toEqual(['Mídia produzida (gemini) — dentro das 24 h antes do horário.', 'Mídia produzida (gemini) com antecedência.']);
    await prod.productionTick();
    expect(a2.status).toBe('scheduled'); // rodada seguinte: o próximo da empresa A
    expect(far.status).toBe('idea');
  });

  it('prioridade: com 1 vaga por rodada, o post a menos de 24 h de outra empresa passa à frente', async () => {
    const { w, prod } = setup();
    (prod as any).perTick = 1;
    const ra = runFor(w, WS_A);
    const rb = runFor(w, WS_B);
    const a = idea(w, ra, inH(30));
    const b = idea(w, rb, inH(20));
    await prod.productionTick();
    expect(b.media).toHaveLength(1);
    expect(a.status).toBe('idea');
  });

  it('vídeo assíncrono: o tick só dispara (espera curta de 25 s), guarda o pending_job e segue; quem conclui é o poller', async () => {
    const { w, s, prod } = setup();
    s.provider.generateVideo.mockResolvedValueOnce({ status: 'generating', assetUrl: null, thumbnailUrl: null, externalJobId: 'veo:p1', cost: 6 });
    const r = runFor(w);
    const reel = idea(w, r, inH(10), { format: 'reel' });
    expect(await prod.productionTick()).toMatchObject({ started: 1, pending: 1, ready: 0 });
    expect(s.provider.generateVideo.mock.calls[0][0].maxWaitMs).toBe(25_000);
    expect(reel.status).toBe('generating');
    expect(reel.creative_brief.pending_job.jobId).toBe('veo:p1');
    expect(w.t['publishing_jobs']!.rows).toHaveLength(0);
    expect(w.t['ig_autopilot_events']!.rows.at(-1)!.message).toMatch(/^Mídia em produção \(gemini\); fica pronta sozinha/);
  });

  it('falha da geração: evento "failure", post failed com failure_kind "media"; o laço segue para a próxima empresa', async () => {
    const { w, s, prod } = setup();
    s.pipeline.run.mockRejectedValueOnce(new Error('Sem créditos'));
    const ra = runFor(w, WS_A);
    const rb = runFor(w, WS_B);
    const bad = idea(w, ra, inH(3));
    const good = idea(w, rb, inH(4));
    expect(await prod.productionTick()).toMatchObject({ started: 2, failed: 1, ready: 1 });
    expect(bad).toMatchObject({ status: 'failed', failure_kind: 'media', last_error: 'Sem créditos' });
    expect(good.media).toHaveLength(1);
    expect(w.t['ig_autopilot_events']!.rows.find((e) => e.kind === 'failure')).toMatchObject({ level: 'error', message: 'Falha ao gerar a mídia: Sem créditos', post_id: bad.id });
  });

  it('atrasado até 12 h (modo publish): produz agora e publica em ~1 min', async () => {
    const { w, prod } = setup();
    connected(w);
    const r = runFor(w);
    const late = idea(w, r, inH(-2));
    await prod.productionTick();
    expect(late.status).toBe('scheduled');
    expect(w.t['publishing_jobs']!.rows[0]!.run_at.getTime() - Date.now()).toBeLessThan(61e3);
  });

  it('Review Focus #3 — mais de 12 h sem criativo (ideia ou em reescrita, modo publish): pulado uma única vez, sem IA; approval e lease vivo ficam', async () => {
    const { w, s, prod } = setup();
    const r = runFor(w);
    const ra = runFor(w, WS_A, { mode: 'approval' });
    const old = idea(w, r, inH(-13));
    const rewriting = idea(w, r, inH(-20), { status: 'needs_review', review_reason: 'x' });
    const busy = idea(w, r, inH(-14), { lease_until: new Date(Date.now() + 60e3) });
    const recent = idea(w, r, inH(-11));
    const approval = idea(w, ra, inH(-13));
    const first = await prod.productionTick();
    expect(first.skipped).toBe(2);
    for (const p of [old, rewriting]) expect(p).toMatchObject({ status: 'cancelled', last_error: 'Pulado automaticamente: o horário passou há mais de 12 h sem o criativo pronto.' });
    expect([busy.status, approval.status]).toEqual(['idea', 'idea']);
    expect(recent.status).not.toBe('cancelled');
    const skippedEvents = () => w.t['ig_autopilot_events']!.rows.filter((e) => e.kind === 'post_skipped');
    expect(skippedEvents()).toHaveLength(2);
    expect(skippedEvents()[0]).toMatchObject({ level: 'warn' });
    expect((await prod.productionTick()).skipped).toBe(0);
    expect(skippedEvents()).toHaveLength(2);
    expect(s.ai.json).toHaveBeenCalledTimes(1); // só a mídia do "recent" (até 12 h de atraso) foi gerada
  });
});
```

Em `api/src/modules/instagram/__tests__/cron.spec.ts`, em `cronParts()`, depois da linha `const metrics = { … };` acrescente `const production = { productionTick: fn('productionTick', { started: 0 }) };`, troque a criação do serviço por `const svc = new InstagramCronService(scheduler, mediaGen as any, publishing as any, autoCalendar as any, autopilot as any, metrics as any, {} as any, production as any);` e devolva `production` no objeto de retorno. No teste `'media: calendário automático e depois o piloto; …'`, troque a expectativa do `media` por `expect(await svc.run('media')).toEqual({ autoCalendar: { filled: 0 }, production: { started: 0 }, autopilot: { media: 0 } });` e a lista de chamadas por `['autoCalendarTick', 'productionTick', 'autopilotTick', 'collectDueMetrics', 'learnFromTopPosts', 'runWeeklyAutopilot', 'runOptimizer', 'collectAllAccountInsights']`. No teste `'sem tarefa: …'`, troque as chaves por `['pendingMedia', 'queue', 'autoCalendar', 'production', 'autopilot', 'metrics', 'learning']` e `expect(calls).toHaveLength(7);`.

Em `api/src/modules/instagram/__tests__/autopilot.spec.ts`, troque o teste `it('posts de programação automática entram mesmo sem plano no piloto e são agendados pela regra própria', …)` por:

```ts
  it('posts das programações com IA (automation) NÃO são do piloto: ficam para a produção antecipada', async () => {
    const { w, s, ap } = setup();
    const p = plan(w); // plano no piloto
    const runPost = idea(w, { plan_id: p.id, automation: 'publish', run_id: uuid(), scheduled_at: inH(3) });
    expect((await ap.autopilotTick()).media).toBe(0);
    expect(runPost.status).toBe('idea');
    expect(s.pipeline.run).not.toHaveBeenCalled();
  });
```

Em `api/src/modules/instagram/__tests__/auto-calendar.spec.ts`, **apague** o teste `it('2c: automático "publish" vencido há menos de 12 h sem criativo é gerado agora e agendado', …)` (coberto agora por `production.spec.ts`) e acrescente ao fim:

```ts
describe('A3 — painel do período (summary)', () => {
  it('conta produzidos / produzindo / na fila / agendados / publicados / pulados, separa "em reescrita" de "em revisão" e lista os pulados com o motivo', async () => {
    const { w, auto } = setup();
    const p = plan(w);
    const r = run(w, p, { status: 'active', mode: 'publish' });
    const mk = (status: string, over: Record<string, unknown> = {}) => seedPost(w, { run_id: r.id, plan_id: p.id, automation: 'publish', status, ...over });
    mk('ready');
    mk('pending_approval', { automation: 'approval' });
    mk('generating');
    mk('idea');
    mk('idea');
    mk('scheduled');
    mk('published');
    mk('needs_review');
    mk('needs_review', { automation: 'approval' });
    mk('cancelled', { last_error: 'Pulado automaticamente: o horário passou há mais de 12 h sem o criativo pronto.', theme: 'Vencido', scheduled_at: new Date('2099-01-02T12:00:00Z') });
    mk('cancelled', { rejection_reason: 'não gostei' });
    const [row] = (await auto.summary(WS_A)) as any[];
    expect(row.counts).toMatchObject({ total: 11, produced: 2, producing: 1, queued: 2, scheduled: 1, published: 1, rewriting: 1, review: 1, skipped: 1 });
    expect(row.skipped_posts).toEqual([{ id: expect.any(String), theme: 'Vencido', scheduled_at: new Date('2099-01-02T12:00:00Z'), reason: 'o horário passou há mais de 12 h sem o criativo pronto.' }]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd api && ../scripts/run-capped.sh 1500 npm test -- src/modules/instagram/__tests__/production.spec.ts src/modules/instagram/__tests__/cron.spec.ts src/modules/instagram/__tests__/autopilot.spec.ts src/modules/instagram/__tests__/auto-calendar.spec.ts`
Expected: FAIL — `Cannot find module '../production.service'`, `s.production` indefinido, contagens novas ausentes.

- [ ] **Step 3: O `ProductionService`**

Crie `api/src/modules/instagram/production.service.ts`:

```ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ENV } from '../../common/config/env.module';
import { Env } from '../../common/config/env.validation';
import { OVERDUE_MS, SKIP_PREFIX } from './ig-types';
import { IgStore, errText, leaseFree } from './ig-store.service';
import { MediaGenerationService } from './media-generation.service';
import { PublishingService } from './publishing.service';

export type ProductionCandidate = { id: string; workspace_id: string; plan_id: string | null; scheduled_at: Date; late: boolean };
const OVERDUE_REASON = 'o horário passou há mais de 12 h sem o criativo pronto.';

/**
 * Ordem da produção (a mesma da SQL de `candidates`, usada nos testes): no máximo 1 post por empresa — o mais próximo dela —;
 * quem já está dentro da meta (`targetHours` antes do horário) passa à frente; depois, pelo horário.
 */
export function rankProductionCandidates<T extends { id: string; workspace_id: string; scheduled_at: Date }>(
  rows: T[],
  o: { now: Date; perTick: number; targetHours: number },
): (T & { late: boolean })[] {
  const first = new Map<string, T>();
  for (const r of [...rows].sort((a, b) => a.scheduled_at.getTime() - b.scheduled_at.getTime() || a.id.localeCompare(b.id))) {
    if (!first.has(r.workspace_id)) first.set(r.workspace_id, r);
  }
  const limit = o.now.getTime() + o.targetHours * 3600e3;
  return [...first.values()]
    .map((r) => ({ ...r, late: r.scheduled_at.getTime() <= limit }))
    .sort((a, b) => Number(b.late) - Number(a.late) || a.scheduled_at.getTime() - b.scheduled_at.getTime())
    .slice(0, o.perTick);
}

/**
 * Produção antecipada do "Programar com IA" (job `instagram-media-5min`): posts de programação em `idea` com horário dentro da janela
 * (agora + 48 h; até 12 h de atraso) ganham o criativo, no máximo 1 por empresa por rodada (rodízio na própria consulta), e são
 * agendados no horário do cronograma. Vídeo é assíncrono (espera curta; o poller conclui). Post do modo "publish" que passou mais de
 * 12 h do horário sem criativo é pulado — o cronograma é respeitado.
 */
@Injectable()
export class ProductionService {
  private readonly logger = new Logger(ProductionService.name);
  private readonly perTick: number;
  private readonly windowHours: number;
  private readonly targetHours: number;

  constructor(
    private readonly store: IgStore,
    private readonly mediaGen: MediaGenerationService,
    private readonly publishing: PublishingService,
    @Inject(ENV) env: Pick<Env, 'IG_PRODUCTION_PER_TICK' | 'IG_PRODUCTION_WINDOW_HOURS' | 'IG_PRODUCTION_TARGET_HOURS'>,
  ) {
    this.perTick = env.IG_PRODUCTION_PER_TICK;
    this.windowHours = env.IG_PRODUCTION_WINDOW_HOURS;
    this.targetHours = env.IG_PRODUCTION_TARGET_HOURS;
  }

  /** Rodízio NA consulta: ROW_NUMBER() por empresa (1 post cada, o mais próximo); atrasados para a meta primeiro; lease livre. */
  async candidates(now = new Date()): Promise<ProductionCandidate[]> {
    const target = new Date(now.getTime() + this.targetHours * 3600e3).toISOString();
    const since = new Date(now.getTime() - OVERDUE_MS).toISOString();
    const until = new Date(now.getTime() + this.windowHours * 3600e3).toISOString();
    return this.store.prisma.$queryRaw<ProductionCandidate[]>`
      SELECT x.id, x.workspace_id, x.plan_id, x.scheduled_at, (x.scheduled_at <= ${target}::timestamptz) AS late
        FROM (
          SELECT p.id, p.workspace_id, p.plan_id, p.scheduled_at,
                 ROW_NUMBER() OVER (PARTITION BY p.workspace_id ORDER BY p.scheduled_at ASC, p.id ASC) AS rn
            FROM ig_posts p
           WHERE p.run_id IS NOT NULL
             AND p.status = 'idea'
             AND p.scheduled_at > ${since}::timestamptz
             AND p.scheduled_at <= ${until}::timestamptz
             AND (p.lease_until IS NULL OR p.lease_until < ${now.toISOString()}::timestamptz)
        ) x
       WHERE x.rn = 1
       ORDER BY late DESC, x.scheduled_at ASC
       LIMIT ${this.perTick}`;
  }

  /** Modo "publish": post ainda sem criativo (ideia ou em reescrita) mais de 12 h depois do horário é pulado, uma única vez. */
  async skipOverdue(now = new Date()): Promise<number> {
    const prisma = this.store.prisma;
    const late = await prisma.ig_posts.findMany({
      where: { automation: 'publish', run_id: { not: null }, status: { in: ['idea', 'needs_review'] }, scheduled_at: { lt: new Date(now.getTime() - OVERDUE_MS) }, ...leaseFree(now) },
      orderBy: { scheduled_at: 'asc' },
      take: 50,
      select: { id: true, workspace_id: true, plan_id: true, status: true },
    });
    let n = 0;
    for (const p of late) {
      const got = await prisma.ig_posts.updateMany({ where: { id: p.id, status: p.status, AND: [leaseFree(now)] }, data: { status: 'cancelled', last_error: `${SKIP_PREFIX}${OVERDUE_REASON}` } });
      if (!got.count) continue;
      n++;
      await this.store.logEvent({ workspace_id: p.workspace_id, plan_id: p.plan_id, post_id: p.id, kind: 'post_skipped', level: 'warn', message: `Horário pulado: ${OVERDUE_REASON}` });
    }
    return n;
  }

  async productionTick(): Promise<{ skipped: number; started: number; ready: number; pending: number; failed: number }> {
    const out = { skipped: await this.skipOverdue(), started: 0, ready: 0, pending: 0, failed: 0 };
    for (const c of await this.candidates()) {
      out.started++;
      const ev = { workspace_id: c.workspace_id, plan_id: c.plan_id, post_id: c.id };
      const r = await this.mediaGen.generatePostAssets(c.workspace_id, c.id, 'auto').catch((e) => ({ ok: false as const, error: errText(e) }));
      if (!r.ok) {
        out.failed++;
        await this.store.logEvent({ ...ev, kind: 'failure', level: 'error', message: `Falha ao gerar a mídia: ${r.error}` });
        continue;
      }
      if (r.pending) {
        out.pending++;
        await this.store.logEvent({ ...ev, kind: 'media', message: `Mídia em produção (${r.provider}); fica pronta sozinha${c.late ? ` — já dentro das ${this.targetHours} h antes do horário` : ''}.` });
        continue;
      }
      out.ready++;
      await this.store.logEvent({ ...ev, kind: 'media', message: `Mídia produzida (${r.provider})${c.late ? ` — dentro das ${this.targetHours} h antes do horário` : ' com antecedência'}.` });
      await this.publishing.scheduleAutomated(c.id).catch((e) => this.store.logEvent({ ...ev, kind: 'failure', level: 'error', message: `Falha ao agendar: ${errText(e)}` }));
    }
    if (out.started || out.skipped) this.logger.log(`[produção] ${JSON.stringify(out)}`);
    return out;
  }
}
```

- [ ] **Step 4: Módulo, cron, piloto, tick e resumo**

Em `api/src/modules/instagram/instagram.module.ts`, acrescente `import { ProductionService } from './production.service';` e `ProductionService,` na lista `providers` (depois de `AutopilotService,`).

Em `api/src/modules/instagram/instagram-cron.service.ts`, acrescente `import { ProductionService } from './production.service';`, o parâmetro `private readonly production: ProductionService,` no FIM do construtor (depois de `account`) e troque `media()` por:

```ts
  /** `media`: calendário automático (lotes, reescrita, agendar, regras) + produção antecipada das programações + piloto dos planos. */
  private async media() {
    return {
      autoCalendar: await this.autoCalendar.autoCalendarTick().catch((e) => ({ error: errText(e) })),
      production: await this.production.productionTick().catch((e) => ({ error: errText(e) })),
      autopilot: await this.autopilot.autopilotTick().catch((e) => ({ error: errText(e) })),
    };
  }
```

Em `api/src/modules/instagram/autopilot.service.ts`, troque o passo 1 do `autopilotTick` (do comentário `// 1) Mídia dos posts "idea" futuros…` até o fim do `for (const p of ideas) { … }`) por:

```ts
    // 1) Mídia dos posts "idea" futuros dos planos no piloto, os mais próximos primeiro (limite baixo para não estourar a execução).
    //    Os posts das programações com IA (`automation`) são da produção antecipada (`ProductionService`), não daqui.
    const ideas = ids.length
      ? await this.prisma.ig_posts.findMany({
          where: { automation: null, plan_id: { in: ids }, status: 'idea', scheduled_at: { gt: new Date() } },
          orderBy: { scheduled_at: 'asc' },
          take: 2,
          select: { id: true, workspace_id: true, plan_id: true, scheduled_at: true },
        })
      : [];
    for (const p of ideas) {
      const plan = p.plan_id ? byId.get(p.plan_id) : undefined;
      const r = await this.mediaGen.generatePostAssets(p.workspace_id, p.id, 'auto');
      media++;
      if (!r.ok) {
        await this.store.logEvent({ workspace_id: p.workspace_id, plan_id: p.plan_id, post_id: p.id, kind: 'failure', level: 'error', message: `Falha ao gerar a mídia: ${r.error}` });
        continue;
      }
      if ('pending' in r && r.pending) {
        await this.store.logEvent({ workspace_id: p.workspace_id, plan_id: p.plan_id, post_id: p.id, kind: 'media', message: `Mídia em geração (${r.provider}); será concluída automaticamente.` });
        continue;
      }
      await this.store.logEvent({ workspace_id: p.workspace_id, plan_id: p.plan_id, post_id: p.id, kind: 'media', message: `Mídia gerada (${r.provider}).` });
      if (!plan?.requires_approval) {
        try {
          await this.publishing.schedulePost(p.workspace_id, p.id, p.scheduled_at!);
          await this.store.logEvent({ workspace_id: p.workspace_id, plan_id: p.plan_id, post_id: p.id, kind: 'schedule', message: `Agendado para ${fmtDate(p.scheduled_at!)}.` });
        } catch (e) {
          await this.store.logEvent({ workspace_id: p.workspace_id, plan_id: p.plan_id, post_id: p.id, kind: 'failure', level: 'error', message: `Falha ao agendar: ${errText(e)}` });
        }
      }
    }
```

Em `api/src/modules/instagram/auto-calendar.service.ts`, apague o bloco inteiro do passo 2c (de `// 2c) Modo automático cujo criativo não ficou pronto a tempo (até 12 h): gera agora e publica em seguida.` até o `}` do `for (const p of overdue)`). Troque o import de `./ig-types` por `import { ASPECT, fmtDate, IgFormat, isSkipped, OVERDUE_MS, PostRow, SKIP_PREFIX, STRATEGY_AUTO_APPROVED } from './ig-types';` e troque o método `summary` inteiro por:

```ts
  /** Resumo das programações para a tela (`ig_auto_runs` raízes + semanas + contagem por situação + pulados com o motivo). */
  async summary(workspaceId: string) {
    const roots = await this.prisma.ig_auto_runs.findMany({ where: { workspace_id: workspaceId, parent_id: null }, orderBy: { created_at: 'desc' }, take: 8 });
    if (!roots.length) return [];
    const kids = await this.prisma.ig_auto_runs.findMany({ where: { workspace_id: workspaceId, parent_id: { in: roots.map((r) => r.id) } }, select: { id: true, parent_id: true } });
    const groups = new Map<string, string[]>(roots.map((r) => [r.id, [r.id]]));
    for (const k of kids) groups.get(k.parent_id as string)?.push(k.id);
    const posts = await this.prisma.ig_posts.findMany({
      where: { workspace_id: workspaceId, run_id: { in: [...groups.values()].flat() } },
      select: { id: true, run_id: true, status: true, automation: true, last_error: true, theme: true, scheduled_at: true },
    });
    return roots.map((r) => {
      const ids = new Set(groups.get(r.id));
      const mine = posts.filter((p) => p.run_id && ids.has(p.run_id));
      const st = mine.map((p) => p.status);
      const c = (s: string[]) => st.filter((x) => s.includes(x)).length;
      const skipped = mine.filter(isSkipped).sort((a, b) => (b.scheduled_at?.getTime() ?? 0) - (a.scheduled_at?.getTime() ?? 0));
      return {
        ...r,
        weeks: ids.size,
        counts: {
          total: st.length,
          media: c(['pending_approval', 'ready', 'approved', 'scheduled', 'publishing', 'published']),
          waiting: c(['pending_approval']),
          scheduled: c(['scheduled', 'publishing']),
          published: c(['published']),
          failed: c(['failed']),
          // Revisão HUMANA (modo aprovação/sem programação); o needs_review do modo "publish" é a IA reescrevendo.
          review: mine.filter((p) => p.status === 'needs_review' && p.automation !== 'publish').length,
          // Painel do período (produção automática): produzidos / produzindo / na fila / agendados / publicados / pulados.
          produced: c(['ready', 'approved', 'pending_approval']),
          producing: c(['generating']),
          queued: c(['idea']),
          rewriting: mine.filter((p) => p.status === 'needs_review' && p.automation === 'publish').length,
          skipped: skipped.length,
        },
        skipped_posts: skipped.slice(0, 20).map((p) => ({ id: p.id, theme: p.theme, scheduled_at: p.scheduled_at, reason: (p.last_error ?? '').slice(SKIP_PREFIX.length) })),
      };
    });
  }
```

Em `api/src/modules/instagram/media-generation.service.ts`, logo depois de `export const GENERATION_INTERRUPTED = …;`:

```ts
/** Quanto a geração de vídeo espera dentro da requisição/tick (como o Estúdio); depois disso o poller (`instagram-queue`) conclui. */
export const VIDEO_WAIT_MS = 25_000;
```

e, em `continueAssets`, troque `...(isVideoFormat(format) ? {} : extra),` por `...(isVideoFormat(format) ? { maxWaitMs: VIDEO_WAIT_MS } : extra),`.

- [ ] **Step 5: Harness**

Em `api/src/modules/instagram/__tests__/harness.ts`, acrescente os imports `import { ProductionService, rankProductionCandidates } from '../production.service';` e `import { OVERDUE_MS } from '../ig-types';` (junto dos imports de serviços), e logo depois de `const autopilot = new AutopilotService(...);`:

```ts
  const production = new ProductionService(w.store, mediaGen, publishing, { IG_PRODUCTION_PER_TICK: 4, IG_PRODUCTION_WINDOW_HOURS: 48, IG_PRODUCTION_TARGET_HOURS: 24 } as any);
  // A consulta real é SQL (ROW_NUMBER por empresa — conferida em production.spec e no smoke); aqui, o mesmo filtro e a mesma ordem em memória.
  production.candidates = async (now = new Date()) => {
    const p = production as any;
    const rows = w.t['ig_posts']!.rows.filter(
      (r) =>
        r.run_id && r.status === 'idea' && r.scheduled_at &&
        r.scheduled_at.getTime() > now.getTime() - OVERDUE_MS &&
        r.scheduled_at.getTime() <= now.getTime() + p.windowHours * 3600e3 &&
        (!r.lease_until || r.lease_until.getTime() < now.getTime()),
    );
    return rankProductionCandidates(rows as any[], { now, perTick: p.perTick, targetHours: p.targetHours });
  };
```

e acrescente `production` ao objeto devolvido por `igServices`.

- [ ] **Step 6: Contrato**

Em `docs/api-contract.md`:
- §22 (parágrafo que começa "Os laços do navegador"): acrescente ao fim `` Fora do navegador, a **produção antecipada** (`ProductionService`, no job `instagram-media-5min`) gera o criativo dos posts de programação em `idea` com horário entre agora − 12 h e agora + `IG_PRODUCTION_WINDOW_HOURS` (48 h): no máximo 1 post por empresa por rodada (rodízio na SQL, `ROW_NUMBER()` por `workspace_id`), até `IG_PRODUCTION_PER_TICK` (4) por rodada, quem está a menos de `IG_PRODUCTION_TARGET_HOURS` (24 h) primeiro; vídeo espera ~25 s e o poller conclui; pronto → `scheduleAutomated`. O piloto por plano (`autopilotTick`) só trata posts com `automation = null`. ``
- `GET /ig-auto-runs`: troque `` `counts { total, media, waiting, scheduled, published, failed, review }` dos posts (`review` = `needs_review`, fora de `media`/`waiting`) `` por `` `counts { total, media, waiting, scheduled, published, failed, review, produced, producing, queued, rewriting, skipped }` dos posts (`review` = `needs_review` à espera de uma pessoa; `rewriting` = `needs_review` do modo `publish`, que a IA reescreve; `produced` = `ready\|approved\|pending_approval`; `producing` = `generating`; `queued` = `idea`; `skipped` = cancelados com `last_error "Pulado automaticamente: …"`) e `skipped_posts [{ id, theme, scheduled_at, reason }]` (≤ 20, mais recentes primeiro) ``; e acrescente `` `video_audio` (jsonb `{ modo, instrucoes }`) `` à lista de campos trazidos.
- Linha da task `media` (§22.4): troque a descrição por `` calendário automático (lotes da estrategista — pula programação com estratégia em `review` —, reescrita dos reprovados do modo `publish`, agendar prontos de empresas com conta conectada, nova tentativa só de falhas de mídia, aprovação 10 min antes, recorrentes, concluir) + **produção antecipada** das programações (pulados > 12 h, até 4 posts, 1 por empresa) + piloto dos planos (até 2 mídias, regra das 2 h) `` e a resposta por `` `{ autoCalendar, production: { skipped, started, ready, pending, failed }, autopilot }` ``.

- [ ] **Step 7: Rodar e ver passar**

Run: `cd api && ../scripts/run-capped.sh 1500 npm test -- src/modules/instagram/__tests__/`
Expected: PASS (todo o módulo do Instagram).

Run: `cd api && ../scripts/run-capped.sh 1500 npm run typecheck`
Expected: sem erros.

- [ ] **Step 8: Commit**

```bash
git add api/src/modules/instagram/production.service.ts api/src/modules/instagram/instagram.module.ts api/src/modules/instagram/instagram-cron.service.ts api/src/modules/instagram/autopilot.service.ts api/src/modules/instagram/auto-calendar.service.ts api/src/modules/instagram/media-generation.service.ts api/src/modules/instagram/__tests__/harness.ts api/src/modules/instagram/__tests__/production.spec.ts api/src/modules/instagram/__tests__/cron.spec.ts api/src/modules/instagram/__tests__/autopilot.spec.ts api/src/modules/instagram/__tests__/auto-calendar.spec.ts docs/api-contract.md
git commit -m "feat(instagram): produção antecipada das programações (janela de 48 h, meta de 24 h, rodízio por empresa) e painel do período

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: B1/B3 — contexto completo do post na direção de arte, foto do produto primeiro e headline na arte

**Files:**
- Create: `api/src/modules/creative/creative-context.ts`
- Create: `api/src/modules/instagram/post-context.service.ts`
- Modify: `api/src/modules/creative/art-director.ts:1-7` (imports), `:48-68` (`ArtBrief`), `:103-121` (briefing, linhas novas e negativo)
- Modify: `api/src/modules/creative/refs.service.ts:11` (`BrandRef.name`) e `:82` (preenche `name`)
- Modify: `api/src/modules/instagram/media-generation.service.ts` — imports, construtor (`:52-63`), `generatePostAssets` (refs, `artBrief`, layout padrão `:294`)
- Modify: `api/src/modules/instagram/instagram.module.ts` (provider `PostContextService`)
- Modify: `api/src/modules/instagram/__tests__/harness.ts` (instancia `PostContextService`)
- Modify: `docs/api-contract.md:446` (`generate-post-assets`)
- Test: `api/src/modules/creative/__tests__/creative-context.spec.ts` (novo), `api/src/modules/instagram/__tests__/post-context.spec.ts` (novo), `api/src/modules/creative/__tests__/art-critic.spec.ts` e `api/src/modules/instagram/__tests__/media-generation.spec.ts` (acrescentar)

**Interfaces:**
- Consumes: `RunStrategy` (`content-strategy.ts`), `StrategistService.currentStrategy(ws, campaignId)`, `strategyBrief(...)` (`strategist/strategist.prompt.ts`), `BrandRef` (`refs.service.ts`).
- Produces:
  - `creative-context.ts`: `type PostCreativeContext = { product: { name: string; description: string | null; price: number | null } | null; pillar: string | null; persona: { name: string; pains: string | null; desires: string | null } | null; funnelStage: string | null; objective: string | null; strategy: { mensagem_central: string; publico_foco: string; proibicoes: string[] } | null; campaign: { offer: string | null; promise: string | null; brief: unknown } | null; scheduledAt: string | null }`; `seasonOf(iso: string): 'verão' | 'outono' | 'inverno' | 'primavera'`; `contextForPrompt(ctx): Record<string, unknown> | null`; `contextProhibitions(ctx): string[]`; `firstFrameRef<T extends { tag: string | null; name?: string | null }>(refs: T[], productName: string | null): T | null`; `orderRefsForProduct<T>(refs: T[], productName: string | null): T[]`.
  - `PostContextService.build(post: PostRow, brandId: string | null): Promise<PostCreativeContext>` (exportado do módulo do Instagram).
  - `ArtBrief.context?: PostCreativeContext | null`.
  - `BrandRef` ganha `name?: string | null`.
  - `MediaGenerationService` recebe `postContext: PostContextService` como 11º parâmetro do construtor; harness: `igServices(w).postContext`.

- [ ] **Step 1: Escrever os testes que falham**

Crie `api/src/modules/creative/__tests__/creative-context.spec.ts`:

```ts
import { contextForPrompt, contextProhibitions, firstFrameRef, orderRefsForProduct, PostCreativeContext, seasonOf } from '../creative-context';

const CTX: PostCreativeContext = {
  product: { name: 'Chope Pilsen', description: 'claro e gelado', price: 12.9 },
  pillar: 'Bastidores',
  persona: { name: 'Ana', pains: 'sem tempo', desires: 'relaxar' },
  funnelStage: 'conversao',
  objective: 'Lotar o happy hour de sexta',
  strategy: { mensagem_central: 'O melhor chope da cidade', publico_foco: 'adultos de Valinhos', proibicoes: ['falar de preço baixo', '', 'concorrentes'] },
  campaign: { offer: 'Chope em dobro', promise: 'até as 20h', brief: { big_idea: 'Dobradinha' } },
  scheduledAt: '2099-01-02T21:00:00.000Z',
};

describe('creative-context (contexto do post para a direção de arte e o roteiro de vídeo)', () => {
  it('estação do Brasil (hemisfério sul) pelo mês em São Paulo', () => {
    expect(['2099-01-15T12:00:00Z', '2099-04-15T12:00:00Z', '2099-07-15T12:00:00Z', '2099-10-15T12:00:00Z', '2099-12-01T12:00:00Z'].map(seasonOf)).toEqual(['verão', 'outono', 'inverno', 'primavera', 'verão']);
    expect(seasonOf('2099-03-01T02:00:00Z')).toBe('verão'); // 28/02, 23:00 em São Paulo
  });

  it('JSON para os prompts: produto, persona, funil por extenso, objetivo, estratégia, campanha e data com estação; nulo sem contexto', () => {
    expect(contextForPrompt(null)).toBeNull();
    expect(contextForPrompt(CTX)).toEqual({
      produto: { nome: 'Chope Pilsen', descricao: 'claro e gelado', preco: 12.9 },
      pilar: 'Bastidores',
      persona: { nome: 'Ana', dores: 'sem tempo', desejos: 'relaxar' },
      etapa_do_funil: 'conversão — produto em destaque e convite claro',
      objetivo_do_periodo: 'Lotar o happy hour de sexta',
      mensagem_central: 'O melhor chope da cidade',
      publico: 'adultos de Valinhos',
      campanha: { oferta: 'Chope em dobro', promessa: 'até as 20h', estrategia: { big_idea: 'Dobradinha' } },
      data: 'sexta-feira, 02/01/2099 (verão)',
    });
  });

  it('proibições da estratégia sem vazios (até 12)', () => {
    expect(contextProhibitions(CTX)).toEqual(['falar de preço baixo', 'concorrentes']);
    expect(contextProhibitions(null)).toEqual([]);
    expect(contextProhibitions({ ...CTX, strategy: { ...CTX.strategy!, proibicoes: Array.from({ length: 20 }, (_, i) => `p${i}`) } })).toHaveLength(12);
  });

  it('foto do primeiro quadro: a do produto do post (nome do arquivo, sem acento nem caixa), senão outra de produto, senão a primeira', () => {
    const ref = (id: string, tag: string | null, name: string) => ({ id, tag, name });
    const refs = [ref('a', 'ambiente', 'bar.jpg'), ref('b', 'produto', 'outro.jpg'), ref('c', 'produto', 'Chope-Pilsén.PNG')];
    expect(firstFrameRef(refs, 'Chope Pilsen')?.id).toBe('c');
    expect(firstFrameRef(refs, 'Inexistente')?.id).toBe('b');
    expect(firstFrameRef(refs, null)?.id).toBe('a');
    expect(firstFrameRef([ref('a', 'ambiente', 'x.jpg')], 'Chope')?.id).toBe('a');
    expect(firstFrameRef([], 'Chope')).toBeNull();
    expect(orderRefsForProduct(refs, 'Chope Pilsen').map((r) => r.id)).toEqual(['c', 'a', 'b']);
    expect(orderRefsForProduct(refs, null).map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });
});
```

Crie `api/src/modules/instagram/__tests__/post-context.spec.ts`:

```ts
import { WS_A, WS_B } from '../../media/__tests__/mem';
import { igServices, igWorld, seedPost, uuid } from './harness';

function world() {
  const w = igWorld();
  const s = igServices(w);
  const brand = { id: uuid(), workspace_id: WS_A, name: 'Zé' };
  w.t['brands']!.rows.push(brand);
  const plan = { id: uuid(), workspace_id: WS_A, brand_id: brand.id, objective: 'objetivo do plano' };
  w.t['ig_content_plans']!.rows.push(plan);
  return { w, s, brand, plan };
}

describe('PostContextService (contexto completo do post, sempre dentro da empresa)', () => {
  it('produto, persona (dores/desejos), pilar, funil, objetivo e estratégia da execução, campanha (oferta + estratégia aprovada) e data', async () => {
    const { w, s, brand, plan } = world();
    const prod = { id: uuid(), workspace_id: WS_A, brand_id: brand.id, name: 'Chope Pilsen', description: 'claro', price: '12.90' };
    w.t['products']!.rows.push(prod);
    w.t['personas']!.rows.push({ id: uuid(), workspace_id: WS_A, brand_id: brand.id, name: 'Ana', pains: 'sem tempo', desires: 'relaxar' });
    const camp = { id: uuid(), workspace_id: WS_A, offer_product: 'Chope em dobro', offer_promise: 'até as 20h' };
    w.t['campaigns']!.rows.push(camp);
    s.strategist.currentStrategy.mockResolvedValue({ big_idea: 'Dobradinha', mensagem_principal: 'm', angulos_detalhados: [], objecoes: [], briefing_criativo: { direcao_visual: 'copos cheios', cta: 'Venha' } });
    const run = { id: uuid(), workspace_id: WS_A, plan_id: plan.id, focus: 'Lotar o happy hour de sexta', campaign_id: camp.id, strategy: { mensagem_central: 'O melhor chope', publico_foco: 'adultos', proibicoes: ['preço baixo'] } };
    w.t['ig_auto_runs']!.rows.push(run);
    const post = seedPost(w, { run_id: run.id, plan_id: plan.id, product_id: prod.id, persona: 'Ana', pillar: 'Bastidores', funnel_stage: 'conversao', scheduled_at: new Date('2099-01-02T21:00:00Z') });
    expect(await s.postContext.build(post, brand.id)).toEqual({
      product: { name: 'Chope Pilsen', description: 'claro', price: 12.9 },
      pillar: 'Bastidores',
      persona: { name: 'Ana', pains: 'sem tempo', desires: 'relaxar' },
      funnelStage: 'conversao',
      objective: 'Lotar o happy hour de sexta',
      strategy: { mensagem_central: 'O melhor chope', publico_foco: 'adultos', proibicoes: ['preço baixo'] },
      campaign: { offer: 'Chope em dobro', promise: 'até as 20h', brief: expect.objectContaining({ big_idea: 'Dobradinha', direcao_visual: 'copos cheios' }) },
      scheduledAt: '2099-01-02T21:00:00.000Z',
    });
    expect(s.strategist.currentStrategy).toHaveBeenCalledWith(WS_A, camp.id);
  });

  it('produto, campanha e execução de OUTRA empresa nunca entram; sem execução vale o objetivo do plano e o nome do produto do briefing', async () => {
    const { w, s, brand, plan } = world();
    const alienProd = { id: uuid(), workspace_id: WS_B, brand_id: uuid(), name: 'Alheio', description: null, price: 1 };
    const alienCamp = { id: uuid(), workspace_id: WS_B, offer_product: 'Oferta alheia', offer_promise: null };
    w.t['products']!.rows.push(alienProd);
    w.t['campaigns']!.rows.push(alienCamp);
    const post = seedPost(w, { plan_id: plan.id, product_id: alienProd.id, persona: 'Bia', creative_brief: { campaign_id: alienCamp.id, product_name: 'Chope da Casa', pillar: 'Promo', funnel_stage: 'atracao' } });
    const ctx = await s.postContext.build(post, brand.id);
    expect(ctx).toMatchObject({ product: { name: 'Chope da Casa', description: null, price: null }, campaign: null, objective: 'objetivo do plano', strategy: null, pillar: 'Promo', funnelStage: 'atracao', persona: { name: 'Bia', pains: null, desires: null } });
    expect(s.strategist.currentStrategy).not.toHaveBeenCalled();
  });
});
```

Acrescente a `api/src/modules/creative/__tests__/art-critic.spec.ts`, dentro de `describe('diretor de arte', …)`:

```ts
  it('contexto do post entra no briefing (sem virar texto na imagem); as proibições da estratégia vão para o prompt e para o negativo', async () => {
    const ai = { json: jest.fn(async () => ART) };
    const context = {
      product: { name: 'Chope Pilsen', description: 'gelado', price: 12.9 }, pillar: 'Bastidores', persona: null, funnelStage: 'atracao', objective: 'Lotar',
      strategy: { mensagem_central: 'M', publico_foco: 'P', proibicoes: ['preço baixo', 'concorrente'] }, campaign: { offer: 'Chope em dobro', promise: null, brief: null }, scheduledAt: null,
    };
    const ad = await buildVisualPrompt(ai as any, brief({ context }));
    const prompt = (ai.json.mock.calls[0] as any)[1].prompt as string;
    expect(prompt).toContain('CONTEXTO DO POST (traduza em cena visual concreta — produto, público, momento do funil, data e estação; nunca escreva estes textos na imagem):');
    expect(prompt).toContain('"oferta":"Chope em dobro"');
    expect(prompt).toContain('"produtos":[{"nome":"Chope Pilsen","descricao":"gelado"}]');
    expect(prompt).toContain('PROIBIDO NA CENA (estratégia do período): preço baixo; concorrente.');
    expect(ad.negative).toBe('blurry, logos de concorrentes, texto, preço baixo, concorrente');
  });
```

Acrescente ao fim de `api/src/modules/instagram/__tests__/media-generation.spec.ts`:

```ts
describe('B — contexto completo na direção de arte, foto do produto primeiro e headline na arte', () => {
  const ctxWorld = () => {
    const { w, s, gen } = setup();
    const brand = { id: uuid(), workspace_id: WS_A, name: 'Zé', visual_style: {} };
    w.t['brands']!.rows.push(brand);
    const p = plan(w, { brand_id: brand.id, objective: 'objetivo do plano' });
    const prod = { id: uuid(), workspace_id: WS_A, brand_id: brand.id, name: 'Chope Pilsen', description: 'claro e gelado', price: '12.90' };
    w.t['products']!.rows.push(prod);
    w.t['personas']!.rows.push({ id: uuid(), workspace_id: WS_A, brand_id: brand.id, name: 'Ana', pains: 'sem tempo', desires: 'relaxar' });
    const r = { id: uuid(), workspace_id: WS_A, plan_id: p.id, focus: 'Lotar o happy hour de sexta', campaign_id: null, strategy: { mensagem_central: 'O melhor chope da cidade', publico_foco: 'adultos de Valinhos', proibicoes: ['falar de preço baixo'] } };
    w.t['ig_auto_runs']!.rows.push(r);
    return { w, s, gen, p, prod, r };
  };

  it('a direção de arte recebe produto, pilar, persona, funil, objetivo/mensagem/público da estratégia e as proibições (também no negativo)', async () => {
    const { w, s, gen, p, prod, r } = ctxWorld();
    const post = idea(w, { plan_id: p.id, run_id: r.id, product_id: prod.id, persona: 'Ana', pillar: 'Bastidores', funnel_stage: 'conversao', scheduled_at: new Date('2099-01-02T21:00:00Z') });
    await gen.generatePostAssets(WS_A, post.id);
    const prompt = s.ai.json.mock.calls[0][1].prompt as string;
    expect(prompt).toContain('CONTEXTO DO POST (traduza em cena visual concreta');
    for (const t of ['"nome":"Chope Pilsen"', '"preco":12.9', '"pilar":"Bastidores"', '"dores":"sem tempo"', 'conversão — produto em destaque', '"objetivo_do_periodo":"Lotar o happy hour de sexta"', '"mensagem_central":"O melhor chope da cidade"', 'sexta-feira, 02/01/2099 (verão)']) {
      expect(prompt).toContain(t);
    }
    expect(prompt).toContain('PROIBIDO NA CENA (estratégia do período): falar de preço baixo.');
    expect(prompt).toContain('"produtos":[{"nome":"Chope Pilsen","descricao":"claro e gelado"}]');
    expect(s.pipeline.run.mock.calls[0][0].ad.negative).toContain('falar de preço baixo');
  });

  it('produto de OUTRA empresa não entra no contexto (nem na arte)', async () => {
    const { w, s, gen, p } = ctxWorld();
    const alien = { id: uuid(), workspace_id: WS_B, brand_id: uuid(), name: 'Produto Alheio', description: null, price: 1 };
    w.t['products']!.rows.push(alien);
    const post = idea(w, { plan_id: p.id, product_id: alien.id });
    await gen.generatePostAssets(WS_A, post.id);
    expect(s.ai.json.mock.calls[0][1].prompt).not.toContain('Produto Alheio');
  });

  it('fotos de referência: a do produto do post vai primeiro (nome do arquivo), depois as demais na ordem da marca', async () => {
    const { w, s, gen, p, prod } = ctxWorld();
    const ref = (id: string, tag: string, name: string) => ({ id, tag, name, url: `https://cdn.test/${name}`, bytes: new Uint8Array([1]), mime: 'image/jpeg' });
    s.refs.loadBrandRefs.mockResolvedValueOnce([ref('a', 'produto', 'outro-produto.jpg'), ref('b', 'ambiente', 'bar.jpg'), ref('c', 'produto', 'Chope-Pilsen.png')]);
    const post = idea(w, { plan_id: p.id, product_id: prod.id });
    await gen.generatePostAssets(WS_A, post.id);
    expect(s.pipeline.run.mock.calls[0][0].refs.map((r: any) => r.id)).toEqual(['c', 'a', 'b']);
  });

  it('headline na arte: feed e story de imagem com headline usam "titulo_topo" (título = headline); sem headline, "limpo"; o layout do editor vale', async () => {
    const { w, s, gen } = setup();
    const withHead = idea(w, { creative_brief: { prompt: 'x', headline: 'Chope em dobro' } });
    const story = idea(w, { format: 'story_image', creative_brief: { prompt: 'x', headline: 'Hoje tem' } });
    const noHead = idea(w, { creative_brief: { prompt: 'x' } });
    const chosen = idea(w, { creative_brief: { prompt: 'x', headline: 'H', layout: 'cta_rodape' } });
    for (const p of [withHead, story, noHead, chosen]) await gen.generatePostAssets(WS_A, p.id);
    expect(s.pipeline.run.mock.calls.map((c: any) => [c[0].layout, c[0].text.title])).toEqual([['titulo_topo', 'Chope em dobro'], ['titulo_topo', 'Hoje tem'], ['limpo', null], ['cta_rodape', 'H']]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd api && ../scripts/run-capped.sh 1500 npm test -- src/modules/creative/__tests__/creative-context.spec.ts src/modules/instagram/__tests__/post-context.spec.ts src/modules/creative/__tests__/art-critic.spec.ts src/modules/instagram/__tests__/media-generation.spec.ts`
Expected: FAIL — `Cannot find module '../creative-context'`, `s.postContext` indefinido, layout `'limpo'` em vez de `'titulo_topo'`.

- [ ] **Step 3: `creative-context.ts`**

Crie `api/src/modules/creative/creative-context.ts`:

```ts
/**
 * Contexto completo de um post para a direção de arte e o roteiro de vídeo (puro). O serviço do Instagram o monta num lugar só
 * (`PostContextService`); os diretores só leem. Nada daqui vira texto na imagem: tudo é traduzido em cena.
 */
export type PostCreativeContext = {
  product: { name: string; description: string | null; price: number | null } | null;
  pillar: string | null;
  persona: { name: string; pains: string | null; desires: string | null } | null;
  funnelStage: string | null;
  /** Objetivo do período (execução) ou do plano. */
  objective: string | null;
  /** Estratégia da execução (mensagem central, público, proibições). */
  strategy: { mensagem_central: string; publico_foco: string; proibicoes: string[] } | null;
  /** Campanha ligada: oferta + estratégia aprovada (`strategyBrief`). */
  campaign: { offer: string | null; promise: string | null; brief: unknown } | null;
  /** Horário do post (ISO): data e estação do ano para a cena. */
  scheduledAt: string | null;
};

const SP = 'America/Sao_Paulo';
const FUNNEL: Record<string, string> = {
  atracao: 'atração — parar o scroll e apresentar a marca',
  consideracao: 'consideração — mostrar detalhe, uso e prova',
  conversao: 'conversão — produto em destaque e convite claro',
};

/** Estação do ano no Brasil (hemisfério sul) pelo mês em São Paulo (UTC-3 fixo). */
export function seasonOf(iso: string): 'verão' | 'outono' | 'inverno' | 'primavera' {
  const m = new Date(new Date(iso).getTime() - 3 * 3600e3).getUTCMonth() + 1;
  return m === 12 || m <= 2 ? 'verão' : m <= 5 ? 'outono' : m <= 8 ? 'inverno' : 'primavera';
}

const dateBr = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString('pt-BR', { weekday: 'long', timeZone: SP })}, ${d.toLocaleDateString('pt-BR', { timeZone: SP, day: '2-digit', month: '2-digit', year: 'numeric' })}`;
};

/** Contexto como JSON curto para os prompts. */
export function contextForPrompt(ctx: PostCreativeContext | null | undefined): Record<string, unknown> | null {
  if (!ctx) return null;
  return {
    produto: ctx.product ? { nome: ctx.product.name, descricao: ctx.product.description, preco: ctx.product.price } : null,
    pilar: ctx.pillar,
    persona: ctx.persona ? { nome: ctx.persona.name, dores: ctx.persona.pains, desejos: ctx.persona.desires } : null,
    etapa_do_funil: ctx.funnelStage ? (FUNNEL[ctx.funnelStage] ?? ctx.funnelStage) : null,
    objetivo_do_periodo: ctx.objective,
    mensagem_central: ctx.strategy?.mensagem_central || null,
    publico: ctx.strategy?.publico_foco || null,
    campanha: ctx.campaign ? { oferta: ctx.campaign.offer, promessa: ctx.campaign.promise, estrategia: ctx.campaign.brief } : null,
    data: ctx.scheduledAt ? `${dateBr(ctx.scheduledAt)} (${seasonOf(ctx.scheduledAt)})` : null,
  };
}

/** Proibições da estratégia da execução (entram no prompt e no negativo). */
export const contextProhibitions = (ctx: PostCreativeContext | null | undefined): string[] =>
  (ctx?.strategy?.proibicoes ?? []).map((p) => String(p).trim()).filter(Boolean).slice(0, 12);

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Foto que vira o primeiro quadro do vídeo (e a primeira referência da arte): a foto de produto cujo nome de arquivo contém o nome
 * do produto do post; senão outra foto de produto; senão a primeira referência da marca (a lista já vem com produto primeiro).
 */
export function firstFrameRef<T extends { tag: string | null; name?: string | null }>(refs: T[], productName: string | null): T | null {
  if (productName) {
    const p = norm(productName);
    const named = p ? refs.find((r) => r.tag === 'produto' && norm(r.name ?? '').includes(p)) : undefined;
    if (named) return named;
    const anyProduct = refs.find((r) => r.tag === 'produto');
    if (anyProduct) return anyProduct;
  }
  return refs[0] ?? null;
}

/** Referências com a foto do produto do post em primeiro lugar (o resto na ordem original). */
export function orderRefsForProduct<T extends { tag: string | null; name?: string | null }>(refs: T[], productName: string | null): T[] {
  const first = productName ? firstFrameRef(refs, productName) : null;
  return first ? [first, ...refs.filter((r) => r !== first)] : refs;
}
```

- [ ] **Step 4: `PostContextService`**

Crie `api/src/modules/instagram/post-context.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { PostCreativeContext } from '../creative/creative-context';
import { strategyBrief } from '../strategist/strategist.prompt';
import { StrategistService } from '../strategist/strategist.service';
import { RunStrategy } from './content-strategy';
import { PostRow } from './ig-types';
import { IgStore } from './ig-store.service';

/** Monta o `PostCreativeContext` de um post — tudo DENTRO da empresa do post (id de outra empresa nunca entra no prompt). */
@Injectable()
export class PostContextService {
  constructor(
    private readonly store: IgStore,
    private readonly strategist: StrategistService,
  ) {}

  async build(post: PostRow, brandId: string | null): Promise<PostCreativeContext> {
    const prisma = this.store.prisma;
    const ws: string = post.workspace_id;
    const brief = (post.creative_brief ?? {}) as Record<string, unknown>;
    const [product, persona, run, plan] = await Promise.all([
      post.product_id ? prisma.products.findFirst({ where: { id: post.product_id, workspace_id: ws }, select: { name: true, description: true, price: true } }) : null,
      post.persona && brandId ? prisma.personas.findFirst({ where: { workspace_id: ws, brand_id: brandId, name: post.persona }, select: { name: true, pains: true, desires: true } }) : null,
      post.run_id ? prisma.ig_auto_runs.findFirst({ where: { id: post.run_id, workspace_id: ws }, select: { focus: true, strategy: true, campaign_id: true } }) : null,
      post.plan_id ? prisma.ig_content_plans.findFirst({ where: { id: post.plan_id, workspace_id: ws }, select: { objective: true } }) : null,
    ]);
    const campaignId = run?.campaign_id ?? (typeof brief['campaign_id'] === 'string' ? (brief['campaign_id'] as string) : null);
    const campaign = campaignId ? await prisma.campaigns.findFirst({ where: { id: campaignId, workspace_id: ws }, select: { id: true, offer_product: true, offer_promise: true } }) : null;
    const approved = campaign ? strategyBrief(await this.strategist.currentStrategy(ws, campaign.id).catch(() => null)) : null;
    const s = (run?.strategy ?? null) as Partial<RunStrategy> | null;
    const productName = typeof brief['product_name'] === 'string' ? (brief['product_name'] as string).trim() : '';
    const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
    return {
      product: product
        ? { name: product.name, description: product.description, price: product.price == null ? null : Number(product.price) }
        : productName
          ? { name: productName, description: null, price: null }
          : null,
      pillar: text(post.pillar) ?? text(brief['pillar']),
      persona: persona ?? (text(post.persona) ? { name: text(post.persona)!, pains: null, desires: null } : null),
      funnelStage: text(post.funnel_stage) ?? text(brief['funnel_stage']),
      objective: text(run?.focus) ?? text(plan?.objective),
      strategy: s ? { mensagem_central: s.mensagem_central ?? '', publico_foco: s.publico_foco ?? '', proibicoes: Array.isArray(s.proibicoes) ? s.proibicoes : [] } : null,
      campaign: campaign ? { offer: campaign.offer_product, promise: campaign.offer_promise, brief: approved } : null,
      scheduledAt: post.scheduled_at ? new Date(post.scheduled_at).toISOString() : null,
    };
  }
}
```

Em `api/src/modules/instagram/instagram.module.ts`, acrescente `import { PostContextService } from './post-context.service';` e `PostContextService,` na lista `providers` (depois de `ContentStrategyService,`).

- [ ] **Step 5: Diretor de arte e referências**

Em `api/src/modules/creative/art-director.ts`, acrescente o import `import { contextForPrompt, contextProhibitions, PostCreativeContext } from './creative-context';`, e no tipo `ArtBrief`, depois de `strategy?: unknown;`:

```ts
  /** Contexto completo do post (produto, pilar, persona, funil, estratégia da execução, campanha, data) — nunca vira texto na imagem. */
  context?: PostCreativeContext | null;
```

No `JSON.stringify` do `BRIEFING:`, troque as linhas `oferta: …` e `produtos: …` por:

```ts
      oferta: b.offer ?? b.campaign?.offer_product ?? b.context?.campaign?.offer ?? null,
      pedido: b.userPrompt,
      produtos: (b.products ?? (b.context?.product ? [b.context.product] : [])).map((p) => ({ nome: p.name, descricao: p.description })).slice(0, 3),
```

(remova a linha `pedido: b.userPrompt,` antiga para não duplicar a chave). Logo depois da linha do `CONCEITO DA ESTRATÉGIA (…)`, acrescente:

```ts
    b.context
      ? `CONTEXTO DO POST (traduza em cena visual concreta — produto, público, momento do funil, data e estação; nunca escreva estes textos na imagem): ${JSON.stringify(contextForPrompt(b.context))}`
      : '',
    contextProhibitions(b.context).length ? `PROIBIDO NA CENA (estratégia do período): ${contextProhibitions(b.context).join('; ')}.` : '',
```

e troque `const forb = listField(vs.elementos_proibidos).join(', ');` por `const forb = [...listField(vs.elementos_proibidos), ...contextProhibitions(b.context)].join(', ');`.

Em `api/src/modules/creative/refs.service.ts`, troque o tipo por `export type BrandRef = AiImageInput & { id: string; tag: string | null; url: string; mime: string; name?: string | null };` e a linha do `out.push` por `out.push({ ...small, id: r.id, tag: r.tag ?? null, url: r.url ?? '', name: r.name ?? null });`.

- [ ] **Step 6: Geração de mídia**

Em `api/src/modules/instagram/media-generation.service.ts`, acrescente os imports `import { orderRefsForProduct } from '../creative/creative-context';` e `import { PostContextService } from './post-context.service';`, e o parâmetro `private readonly postContext: PostContextService,` no FIM do construtor (depois de `images`).

Em `generatePostAssets`, troque:

```ts
      const brief = post.creative_brief ?? {};
      const vs = (brand?.visual_style ?? {}) as VisualStyle;
      const refs = isVideoFormat(format) ? [] : await this.refs.loadBrandRefs(workspaceId, brand?.id, { max: 4, ids: vs.referencias?.length ? vs.referencias : undefined });
```

por:

```ts
      const brief = post.creative_brief ?? {};
      const vs = (brand?.visual_style ?? {}) as VisualStyle;
      // Contexto completo do post (produto, pilar, persona, funil, estratégia da execução, campanha) — montado num lugar só.
      const ctx = await this.postContext.build(post, brand?.id ?? null);
      // Fotos de referência com a do produto do post em primeiro lugar.
      const refs = isVideoFormat(format)
        ? []
        : orderRefsForProduct(await this.refs.loadBrandRefs(workspaceId, brand?.id, { max: 4, ids: vs.referencias?.length ? vs.referencias : undefined }), ctx.product?.name ?? null);
```

No objeto devolvido por `artBrief`, acrescente depois de `offer: post.cta,`:

```ts
        context: ctx,
        products: ctx.product ? [ctx.product] : undefined,
```

E troque `const layout = (brief.layout ?? 'limpo') as TextLayout;` por:

```ts
        // Headline na arte: com headline o padrão é o título no topo; sem headline, limpo. O editor pode trocar o layout.
        const layout = (brief.layout ?? (brief.headline ? 'titulo_topo' : 'limpo')) as TextLayout;
```

- [ ] **Step 7: Harness**

Em `api/src/modules/instagram/__tests__/harness.ts`, acrescente `import { PostContextService } from '../post-context.service';` e, antes da criação do `mediaGen`, `const postContext = new PostContextService(w.store, strategist);`; troque a criação por `const mediaGen = new MediaGenerationService(w.store, ai, providers, refs, pipeline, extras, assets, content, publishing, images, postContext);` e devolva `postContext` no objeto de `igServices`.

- [ ] **Step 8: Contrato**

Em `docs/api-contract.md`, na linha de `generate-post-assets`, troque `Imagem única = pipeline da §19 (variações → crítico → composição);` por `Imagem única = pipeline da §19 (variações → crítico → composição), com o **contexto completo do post** na direção de arte (produto do post com nome/descrição/preço, pilar, persona com dores/desejos, etapa do funil, objetivo/mensagem central/público/proibições da estratégia da execução, oferta e estratégia aprovada da campanha, data e estação) e a foto do produto como 1ª referência; com \`headline\` o layout padrão é \`titulo_topo\` (sem headline, \`limpo\`; \`creative_brief.layout\` escolhido no editor vale);`.

- [ ] **Step 9: Rodar e ver passar**

Run: `cd api && ../scripts/run-capped.sh 1500 npm test -- src/modules/creative/__tests__/ src/modules/instagram/__tests__/`
Expected: PASS.

Run: `cd api && ../scripts/run-capped.sh 1500 npm run typecheck`
Expected: sem erros.

- [ ] **Step 10: Commit**

```bash
git add api/src/modules/creative/creative-context.ts api/src/modules/instagram/post-context.service.ts api/src/modules/creative/art-director.ts api/src/modules/creative/refs.service.ts api/src/modules/instagram/media-generation.service.ts api/src/modules/instagram/instagram.module.ts api/src/modules/instagram/__tests__/harness.ts api/src/modules/creative/__tests__/creative-context.spec.ts api/src/modules/instagram/__tests__/post-context.spec.ts api/src/modules/creative/__tests__/art-critic.spec.ts api/src/modules/instagram/__tests__/media-generation.spec.ts docs/api-contract.md
git commit -m "feat(criativos): contexto completo do post na direção de arte, foto do produto primeiro e headline na arte por padrão

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: B2/B4 — fotos de referência no gateway (com recuo) e carrossel com fio visual e nota por slide

**Files:**
- Modify: `api/src/modules/ai/ai.service.ts:14-27` (constantes), `:234-262` (`image`, `editForm`), `:298-325` (gateway OpenAI e Gemini)
- Modify: `api/src/modules/creative/pipeline.service.ts:44-58` (`PipelineResult.notes`), `:81-192` (coleta)
- Modify: `api/src/modules/creative/art-director.ts` (`VisualThread`, `threadOf`, `withVisualThread`, `ArtBrief.visualThread`, linha no prompt)
- Modify: `api/src/modules/instagram/media-generation.service.ts` — imports, `continueAssets` (`:178-228`), novo `criticSlide`, `generatePostAssets` (direções do carrossel, log do pipeline)
- Modify: `api/src/modules/instagram/__tests__/harness.ts` (`ai.vision`, `images.shrink`)
- Modify: `docs/api-contract.md:150-154` (§6) e `:446`
- Test: `api/src/modules/ai/__tests__/ai.service.spec.ts`, `api/src/modules/creative/__tests__/art-critic.spec.ts`, `api/src/modules/creative/__tests__/pipeline-notes.spec.ts` (novo), `api/src/modules/instagram/__tests__/media-generation.spec.ts`

**Interfaces:**
- Consumes: `scoreCreative(ai, images, opts): Promise<AiScore>`, `MIN_SCORE` (`creative/critic.ts`); `BrandRef` (Task 6); `ArtDirection`, `listField`, `AiScore` (`creative/visual-style.ts`).
- Produces:
  - `export const REF_FALLBACK_NOTE = 'Gateway sem suporte a referência; gerado sem foto da marca.'` (em `ai.service.ts`); `AiService.image(...)` devolve `note` com esse aviso quando o gateway recusa a edição.
  - `PipelineResult` (não pendente) ganha `notes: string[]`.
  - `art-director.ts`: `type VisualThread = { paleta: string[]; estilo_fotografico: string; luz: string }`, `threadOf(ad: ArtDirection): VisualThread`, `withVisualThread(ad: ArtDirection, t: VisualThread): ArtDirection`, `ArtBrief.visualThread?: VisualThread | null`.
  - Itens de mídia do carrossel ganham `score: number | null`; o log de geração ganha `slide_scores: { slide, total, motivo, retried }[]` e `notes: string[]`; `creative_brief.visual_thread`.
  - Harness: `ai.vision` (nota 40 por padrão) e `images.shrink`.

- [ ] **Step 1: Escrever os testes que falham**

Acrescente ao fim de `api/src/modules/ai/__tests__/ai.service.spec.ts`:

```ts
describe('AiService.image — fotos de referência também pelo gateway (B2)', () => {
  const ref = { bytes: new Uint8Array([1, 2, 3]), mime: 'image/jpeg' };
  const png = (s: string) => json({ data: [{ b64_json: Buffer.from(s).toString('base64') }] });

  it('Gemini pelo gateway com referências: /images/edits (multipart com as fotos, sem "quality"), sem aviso', async () => {
    const f = fakeFetch([['/images/edits', () => png('EDIT')]]);
    const ai = setup({ ...gwEnv, AI_MODEL_IMAGE_GEMINI: 'gem-img' }, {}, f.fn);
    const r = await ai.image(WS, { prompt: 'copo', aspectRatio: '1:1', vendor: 'gemini', referenceImages: [ref, ref], appOnly: true });
    expect(r.bytes.toString()).toBe('EDIT');
    expect(r.note).toBeNull();
    const fd = f.calls[0]!.init!.body as FormData;
    expect(fd.get('model')).toBe('gem-img');
    expect(fd.getAll('image[]')).toHaveLength(2);
    expect(fd.has('quality')).toBe(false);
    expect(String(fd.get('prompt'))).toContain('Proporção da imagem: 1:1.');
  });

  it.each([400, 404, 415, 422])('edição recusada pelo gateway (%i): gera só com o texto e avisa no note', async (st) => {
    const f = fakeFetch([['/images/edits', () => new Response('x', { status: st })], ['/images/generations', () => png('TXT')]]);
    const r = await setup(gwEnv, {}, f.fn).image(WS, { prompt: 'copo', aspectRatio: '1:1', vendor: 'gemini', referenceImages: [ref], appOnly: true });
    expect(r.bytes.toString()).toBe('TXT');
    expect(r.note).toBe('Gateway sem suporte a referência; gerado sem foto da marca.');
    expect(f.calls.map((c) => c.url.replace('https://gw.test/v1', ''))).toEqual(['/images/edits', '/images/generations']);
  });

  it('sem referências vai direto para /images/generations; erro de verdade (500) na edição não é engolido', async () => {
    const f = fakeFetch([['/images/generations', () => png('G')]]);
    expect((await setup(gwEnv, {}, f.fn).image(WS, { prompt: 'p', aspectRatio: '1:1', vendor: 'gemini' })).note).toBeNull();
    expect(f.calls).toHaveLength(1);
    const bad = fakeFetch([['/images/edits', () => new Response('boom', { status: 500 })]]);
    await expect(setup(gwEnv, {}, bad.fn).image(WS, { prompt: 'p', aspectRatio: '1:1', vendor: 'gemini', referenceImages: [ref] })).rejects.toThrow(/IA respondeu 500/);
  });

  it('ChatGPT pelo gateway também avisa quando a edição é recusada', async () => {
    const f = fakeFetch([['/images/edits', () => new Response('x', { status: 404 })], ['/images/generations', () => png('O')]]);
    const r = await setup(gwEnv, {}, f.fn).image(WS, { prompt: 'p', aspectRatio: '1:1', vendor: 'openai', referenceImages: [ref] });
    expect(r.note).toBe('Gateway sem suporte a referência; gerado sem foto da marca.');
  });
});
```

Crie `api/src/modules/creative/__tests__/pipeline-notes.spec.ts`:

```ts
import { WS_A } from '../../media/__tests__/mem';
import { PipelineService } from '../pipeline.service';
import { RefsService } from '../refs.service';
import { ART, creativeWorld } from './world';

describe('PipelineService — avisos do provedor', () => {
  it('o aviso do gateway sem referência volta em notes, uma vez só (vai para o log de geração do post)', async () => {
    const w = await creativeWorld();
    try {
      const note = 'Gateway sem suporte a referência; gerado sem foto da marca.';
      w.provider.image.mockImplementation(async () => ({ status: 'ready', assetUrl: null, bytes: w.png, mime: 'image/png', thumbnailUrl: null, externalJobId: null, cost: 1, note }));
      const pipeline = new PipelineService(w.prisma, w.ai as any, w.assets, w.images, new RefsService(w.prisma, w.files, w.assets, w.images));
      const res = await pipeline.run({ workspaceId: WS_A, brand: null, provider: w.provider, ad: ART as any, aspectRatio: '1:1', targetFormat: 'ig_feed_square', refs: [], variations: 2, layout: 'limpo', text: {}, title: 'Teste' });
      expect(res.pending).toBeNull();
      if (res.pending === null) expect(res.notes).toEqual([note]);
    } finally {
      w.cleanup();
    }
  });
});
```

Acrescente a `api/src/modules/creative/__tests__/art-critic.spec.ts`, dentro de `describe('diretor de arte', …)`, e acrescente `threadOf, withVisualThread` ao import de `../art-director`:

```ts
  it('carrossel: o fio visual (do 1º slide) entra no briefing dos demais e é repetido, uma vez só, no texto final', async () => {
    const ai = { json: jest.fn(async () => ART) };
    const thread = threadOf({ ...ART, color_palette: ['#c0392b', '#f5deb3'], style: 'foto realista', lighting: 'luz quente' } as any);
    expect(thread).toEqual({ paleta: ['#c0392b', '#f5deb3'], estilo_fotografico: 'foto realista', luz: 'luz quente' });
    await buildVisualPrompt(ai as any, brief({ slide: { index: 1, total: 4 }, visualThread: thread }));
    expect((ai.json.mock.calls[0] as any)[1].prompt).toContain(
      'FIO VISUAL DO CARROSSEL (obrigatório neste slide: mesma paleta, mesmo estilo fotográfico e mesma luz dos outros slides): {"paleta":["#c0392b","#f5deb3"],"estilo_fotografico":"foto realista","luz":"luz quente"}',
    );
    const ad = withVisualThread({ ...ART, prompt_final: 'Copo na mesa.' } as any, thread);
    expect(ad.prompt_final).toBe('Copo na mesa. Fio visual do carrossel (igual em todos os slides): paleta #c0392b, #f5deb3; estilo fotográfico foto realista; luz luz quente.');
    expect(withVisualThread(ad, thread).prompt_final).toBe(ad.prompt_final);
  });
```

Acrescente ao fim de `api/src/modules/instagram/__tests__/media-generation.spec.ts`:

```ts
describe('carrossel: fio visual único e nota do crítico por slide', () => {
  const carousel = (w: IgWorld, over: Record<string, unknown> = {}) => idea(w, { format: 'feed_carousel', creative_brief: { prompt: 'base', slides: ['s1', 's2', 's3'], compose: false }, ...over });

  it('o 1º slide define o fio visual (paleta, estilo, luz): vai no briefing dos demais e no texto final de todos', async () => {
    const { w, s, gen } = setup();
    const post = carousel(w);
    await gen.generatePostAssets(WS_A, post.id);
    const prompts = s.ai.json.mock.calls.map((c: any) => c[1].prompt as string);
    expect(prompts).toHaveLength(3);
    expect(prompts[0]).not.toContain('FIO VISUAL DO CARROSSEL');
    expect(prompts.slice(1).every((p: string) => p.includes('FIO VISUAL DO CARROSSEL') && p.includes('"paleta":["#fff"]'))).toBe(true);
    expect(s.provider.generateImage.mock.calls.every((c: any) => c[0].finalPrompt.includes('Fio visual do carrossel (igual em todos os slides): paleta #fff; estilo fotográfico foto; luz l.'))).toBe(true);
    expect(post.creative_brief.visual_thread).toEqual({ paleta: ['#fff'], estilo_fotografico: 'foto', luz: 'l' });
  });

  it('slide abaixo de 28/50 é refeito 1× com o motivo do crítico; fica o de maior nota; notas no item e no log', async () => {
    const { w, s, gen } = setup();
    const low = { produto: 3, fidelidade: 3, composicao: 3, defeitos: 3, paleta: 3, motivo: 'produto cortado' };
    const high = { produto: 9, fidelidade: 9, composicao: 9, defeitos: 9, paleta: 9, motivo: 'ótimo' };
    s.ai.vision.mockResolvedValueOnce(low).mockResolvedValueOnce(high);
    const post = carousel(w);
    await gen.generatePostAssets(WS_A, post.id);
    expect(s.provider.generateImage).toHaveBeenCalledTimes(4); // 3 slides + 1 refação do 1º
    const rebuild = s.ai.json.mock.calls.map((c: any) => c[1].prompt as string).find((p: string) => p.includes('AJUSTE PEDIDO'));
    expect(rebuild).toContain('AJUSTE PEDIDO (aplique com prioridade): Corrija: produto cortado');
    expect(post.media.map((m: any) => m.score)).toEqual([45, 40, 40]);
    expect(post.ai_generation_log.at(-1).slide_scores).toEqual([
      { slide: 1, total: 45, motivo: 'ótimo', retried: true },
      { slide: 2, total: 40, motivo: 'ok', retried: false },
      { slide: 3, total: 40, motivo: 'ok', retried: false },
    ]);
  });

  it('crítico fora do ar não bloqueia o carrossel (sem nota, sem refação)', async () => {
    const { w, s, gen } = setup();
    s.ai.vision.mockRejectedValue(new Error('visão indisponível'));
    const post = carousel(w);
    expect(await gen.generatePostAssets(WS_A, post.id)).toEqual({ ok: true, items: 3, provider: 'gemini' });
    expect(s.provider.generateImage).toHaveBeenCalledTimes(3);
    expect(post.media.map((m: any) => m.score)).toEqual([null, null, null]);
  });

  it('o aviso do gateway sem referência fica no log de geração do post', async () => {
    const { w, s, gen } = setup();
    s.provider.generateImage.mockResolvedValue({ status: 'ready', assetUrl: null, bytes: Buffer.from('89504e470d0a1a0a', 'hex'), mime: 'image/png', thumbnailUrl: null, externalJobId: null, cost: 1, note: 'Gateway sem suporte a referência; gerado sem foto da marca.' });
    const post = carousel(w);
    await gen.generatePostAssets(WS_A, post.id);
    expect(post.ai_generation_log.at(-1).notes).toEqual(['Gateway sem suporte a referência; gerado sem foto da marca.']);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd api && ../scripts/run-capped.sh 1500 npm test -- src/modules/ai/__tests__/ai.service.spec.ts src/modules/creative/__tests__/ src/modules/instagram/__tests__/media-generation.spec.ts`
Expected: FAIL — o Gemini pelo gateway chama `/images/generations` direto, `threadOf` não existe, `s.ai.vision` indefinido.

- [ ] **Step 3: `AiService` — referências no gateway**

Em `api/src/modules/ai/ai.service.ts`, logo depois de `const OPENAI_SIZE = …;`:

```ts
/** Gateway sem `/images/edits` (ou que recusa as fotos): a imagem sai só do texto e o aviso vai para o log de geração do post. */
export const REF_FALLBACK_NOTE = 'Gateway sem suporte a referência; gerado sem foto da marca.';
/** Respostas do gateway que significam "não sei editar com imagens" (cai para a geração só com texto). */
const EDIT_UNSUPPORTED = new Set([400, 404, 415, 422]);
```

No método `image`, troque as duas últimas linhas por:

```ts
    const r = req.vendor === 'openai' ? await this.gatewayOpenaiImage(req) : await this.gatewayGeminiImage(req);
    return { ...r, cost: req.vendor === 'openai' ? AI_COST.chatgptImage : AI_COST.geminiImage, note: r.note };
```

Troque `editForm` por:

```ts
  private editForm(model: string, req: AiImageRequest, size: string, withQuality = true): FormData {
    const fd = new FormData();
    fd.append('model', model);
    fd.append('prompt', req.prompt.slice(0, 30000));
    fd.append('size', size);
    if (withQuality) fd.append('quality', 'high');
    (req.referenceImages ?? []).slice(0, 4).forEach((r, i) => fd.append('image[]', new Blob([r.bytes as BlobPart], { type: r.mime }), `ref${i}.jpg`));
    return fd;
  }
```

Troque `gatewayOpenaiImage` e `gatewayGeminiImage` por:

```ts
  private async gatewayOpenaiImage(req: AiImageRequest): Promise<{ bytes: Buffer; mime: string; ext: string; note: string | null }> {
    const model = this.model('openai/gpt-image-2.5-sunburst');
    const size = OPENAI_SIZE[req.aspectRatio] ?? '1024x1024';
    let note: string | null = null;
    if (req.referenceImages?.length) {
      // Edição com as fotos de referência; se o endpoint recusar, gera sem elas e avisa no log.
      const res = await this.gw('/images/edits', { body: this.editForm(model, req, size) });
      if (EDIT_UNSUPPORTED.has(res.status)) {
        this.logger.warn(`edição com referências recusada: ${res.status}`);
        note = REF_FALLBACK_NOTE;
      } else {
        if (!res.ok) throw await this.gatewayError(res);
        const j = (await res.json()) as { data?: { b64_json?: string }[] };
        return { ...this.pngResult(j.data?.[0]?.b64_json, 'A IA'), note: null };
      }
    }
    const res = await this.gw('/images/generations', { json: { model, prompt: req.prompt, size, quality: 'high' } });
    if (!res.ok) throw await this.gatewayError(res);
    const j = (await res.json()) as { data?: { b64_json?: string }[] };
    return { ...this.pngResult(j.data?.[0]?.b64_json, 'A IA'), note };
  }

  private async gatewayGeminiImage(req: AiImageRequest): Promise<{ bytes: Buffer; mime: string; ext: string; note: string | null }> {
    const model = this.model('google/gemini-3.1-flash-image');
    const size = OPENAI_SIZE[req.aspectRatio] ?? '1024x1024';
    const prompt = `${req.prompt}\nProporção da imagem: ${req.aspectRatio}.`;
    let note: string | null = null;
    if (req.referenceImages?.length) {
      // Fotos de referência (produto primeiro) também pelo gateway: edição com imagens (compatível com OpenAI), sem "quality"
      // (parâmetro só do gpt-image). Gateway sem suporte → gera só com o texto e avisa no log de geração.
      const res = await this.gw('/images/edits', { body: this.editForm(model, { ...req, prompt }, size, false) });
      if (EDIT_UNSUPPORTED.has(res.status)) {
        this.logger.warn(`edição com referências (Gemini) recusada pelo gateway: ${res.status}`);
        note = REF_FALLBACK_NOTE;
      } else {
        if (!res.ok) throw await this.gatewayError(res);
        const j = (await res.json()) as { data?: { b64_json?: string }[] };
        return { ...this.pngResult(j.data?.[0]?.b64_json, 'A IA'), note: null };
      }
    }
    const res = await this.gw('/images/generations', { json: { model, prompt, size } });
    if (!res.ok) throw await this.gatewayError(res);
    const j = (await res.json()) as { data?: { b64_json?: string }[] };
    return { ...this.pngResult(j.data?.[0]?.b64_json, 'A IA'), note };
  }
```

- [ ] **Step 4: Pipeline devolve os avisos**

Em `api/src/modules/creative/pipeline.service.ts`, no tipo `PipelineResult` (variante `pending: null`), depois de `cost: number;` acrescente `/** Avisos do provedor (ex.: gateway sem referência), sem repetição — vão para o log de geração. */\n      notes: string[];`. Em `run`, logo depois de `const pool: PoolItem[] = [];` acrescente `const notes: string[] = [];`, e dentro de `round`, logo depois de `const ready = ok.filter(...)` (antes do `if (!ready.length)`), acrescente:

```ts
      for (const r of ok) if (r.note && !notes.includes(r.note)) notes.push(r.note);
```

e no `return` final acrescente `notes,` depois de `cost,`.

- [ ] **Step 5: Fio visual no diretor de arte**

Em `api/src/modules/creative/art-director.ts`, acrescente depois de `COMPOSITION`:

```ts
/** Carrossel: o "fio visual" único (paleta, estilo fotográfico, luz) definido pelo 1º slide e repetido em todos. */
export type VisualThread = { paleta: string[]; estilo_fotografico: string; luz: string };

export const threadOf = (ad: ArtDirection): VisualThread => ({
  paleta: listField(ad.color_palette).slice(0, 6),
  estilo_fotografico: String(ad.style ?? '').trim(),
  luz: String(ad.lighting ?? '').trim(),
});

/** Repete o fio visual no texto final do slide (o modelo de imagem não vê os outros slides). Idempotente. */
export function withVisualThread(ad: ArtDirection, t: VisualThread): ArtDirection {
  const parts = [t.paleta.length ? `paleta ${t.paleta.join(', ')}` : '', t.estilo_fotografico ? `estilo fotográfico ${t.estilo_fotografico}` : '', t.luz ? `luz ${t.luz}` : ''].filter(Boolean);
  if (!parts.length || ad.prompt_final.includes('Fio visual do carrossel')) return ad;
  return { ...ad, prompt_final: `${ad.prompt_final} Fio visual do carrossel (igual em todos os slides): ${parts.join('; ')}.` };
}
```

No tipo `ArtBrief`, depois de `context?: …`, acrescente `/** Carrossel: fio visual repetido em todos os slides. */\n  visualThread?: VisualThread | null;`. No prompt, logo depois das linhas do contexto (Task 6), acrescente:

```ts
    b.visualThread
      ? `FIO VISUAL DO CARROSSEL (obrigatório neste slide: mesma paleta, mesmo estilo fotográfico e mesma luz dos outros slides): ${JSON.stringify(b.visualThread)}`
      : '',
```

- [ ] **Step 6: Carrossel com crítico na geração**

Em `api/src/modules/instagram/media-generation.service.ts`, ajuste os imports:

```ts
import { buildVisualPrompt, providerPrompt, threadOf, VisualThread, withVisualThread } from '../creative/art-director';
import { MIN_SCORE, scoreCreative } from '../creative/critic';
import { BrandRef, RefsService } from '../creative/refs.service';
import { AiScore, ArtDirection, listField, TextLayout, VisualStyle } from '../creative/visual-style';
```

(substituindo as linhas atuais de `art-director`, `refs.service` e `visual-style`), e logo depois do tipo `RefImages`:

```ts
/** Carrossel: o que o crítico por slide precisa para refazer 1 slide (direções, referências, paleta e a reconstrução com o motivo). */
type SlideQa = {
  ads: ArtDirection[];
  refs: BrandRef[];
  palette: string[];
  extra: RefImages;
  rebuild: (i: number, motivo: string) => Promise<ArtDirection>;
};
```

Troque a assinatura do `continueAssets` acrescentando `qa?: SlideQa,` depois de `lease?: PostLease,`. Dentro dele, logo antes do `for`, declare:

```ts
    const slideScores: { slide: number; total: number | null; motivo: string | null; retried: boolean }[] = [];
    const notes: string[] = [];
```

e troque o trecho de `cost += r.cost;` até `media = [...media, item];` por:

```ts
      cost += r.cost;
      let result = r;
      let itemPrompt = req.finalPrompt;
      let score: AiScore | null = null;
      if (format === 'feed_carousel' && qa) {
        const checked = await this.criticSlide(post, provider, r, i, prompts.length, qa, lease);
        result = checked.result;
        score = checked.score;
        cost += checked.cost;
        if (checked.prompt) itemPrompt = checked.prompt;
        slideScores.push({ slide: i + 1, total: score?.total ?? null, motivo: score?.motivo ?? null, retried: checked.retried });
      }
      if (result.note && !notes.includes(result.note)) notes.push(result.note);
      const composed = format === 'feed_carousel' ? await this.composeSlide(post, result, i, prompts.length) : null;
      const item: Record<string, any> = await this.libraryItem(post, composed ? { bytes: composed, mime: 'image/jpeg' } : this.srcOf(result), i, provider.id, itemPrompt, result.cost);
      if (format === 'feed_carousel' && qa) item['score'] = score?.total ?? null;
      if (isVideoFormat(format)) Object.assign(item, await this.videoCover(post, provider, req.finalPrompt, item['asset_id']));
      media = [...media, item];
```

No `appendLog` do `patchPost` final do `continueAssets`, troque `{ step: 'media', provider: provider.id, provider_log: providerLog(provider), items: media.length, cost, instructions }` por `{ step: 'media', provider: provider.id, provider_log: providerLog(provider), items: media.length, cost, instructions, ...(slideScores.length ? { slide_scores: slideScores } : {}), ...(notes.length ? { notes } : {}) }`.

Logo depois do `continueAssets`, acrescente:

```ts
  /** Carrossel: nota do crítico no slide; abaixo de MIN_SCORE refaz 1× com o motivo e fica a de maior nota. Crítico fora do ar não bloqueia. */
  private async criticSlide(post: PostRow, provider: ChainedProvider, first: GenerationResult, i: number, total: number, qa: SlideQa, lease?: PostLease) {
    const bytesOf = async (r: GenerationResult) => (r.bytes ? new Uint8Array(r.bytes) : (await this.assets.download(r.assetUrl!)).bytes);
    const score = async (r: GenerationResult): Promise<AiScore | null> => {
      try {
        return await scoreCreative(this.ai, this.images, {
          workspaceId: post.workspace_id, image: await bytesOf(r), refs: qa.refs, palette: qa.palette, aspectRatio: ASPECT.feed_carousel, subject: qa.ads[i]?.subject ?? post.theme ?? 'post',
        });
      } catch (e) {
        this.logger.warn(`[instagram] crítico do slide ${i + 1} falhou: ${errText(e)}`);
        return null;
      }
    };
    let best: { result: GenerationResult; score: AiScore | null; prompt: string | null } = { result: first, score: await score(first), prompt: null };
    let cost = 0;
    let retried = false;
    const firstTotal = best.score?.total ?? null;
    if (best.score && firstTotal !== null && firstTotal < MIN_SCORE) {
      try {
        await lease?.renew();
        const ad = await qa.rebuild(i, best.score.motivo);
        qa.ads[i] = ad;
        const finalPrompt = `${providerPrompt(ad)} (imagem ${i + 1} de ${total} do carrossel)`;
        const again = await provider.generateImage({ finalPrompt, aspectRatio: ASPECT.feed_carousel, kind: 'image', ...qa.extra });
        if (again.status === 'ready' && (again.bytes || again.assetUrl)) {
          retried = true;
          cost += again.cost;
          const s2 = await score(again);
          if ((s2?.total ?? -1) > firstTotal) best = { result: again, score: s2, prompt: finalPrompt };
        }
      } catch (e) {
        if (e instanceof PublishClaimLost) throw e;
        this.logger.warn(`[instagram] nova tentativa do slide ${i + 1} falhou: ${errText(e)}`);
      }
    }
    return { ...best, cost, retried };
  }
```

Em `generatePostAssets`, troque o bloco das direções:

```ts
      const ads = await Promise.all(
        briefs.map(async (p, i) => (override && brief.art_direction ? { ...brief.art_direction, prompt_final: String(brief.visual_prompt_override) } : buildVisualPrompt(this.ai, artBrief(p, i)))),
      );
      const prompts = ads.map((ad) => providerPrompt(ad));
      post.creative_brief = {
        ...brief,
        art_direction: ads[0],
        art_directions: format === 'feed_carousel' ? ads : undefined,
        visual_prompt: ads[0]!.prompt_final,
      };
```

por:

```ts
      let thread: VisualThread | null = null;
      let ads: ArtDirection[];
      if (format === 'feed_carousel') {
        // Fio visual único: a direção do 1º slide define paleta, estilo fotográfico e luz; os demais slides repetem.
        const first = await buildVisualPrompt(this.ai, artBrief(briefs[0]!, 0));
        const t = threadOf(first);
        thread = t;
        const rest = await Promise.all(briefs.slice(1).map((p, k) => buildVisualPrompt(this.ai, { ...artBrief(p, k + 1), visualThread: t })));
        ads = [first, ...rest].map((ad) => withVisualThread(ad, t));
      } else {
        ads = await Promise.all(
          briefs.map(async (p, i) => (override && brief.art_direction ? { ...brief.art_direction, prompt_final: String(brief.visual_prompt_override) } : buildVisualPrompt(this.ai, artBrief(p, i)))),
        );
      }
      const prompts = ads.map((ad) => providerPrompt(ad));
      post.creative_brief = {
        ...brief,
        art_direction: ads[0],
        art_directions: format === 'feed_carousel' ? ads : undefined,
        visual_prompt: ads[0]!.prompt_final,
        ...(thread ? { visual_thread: thread } : {}),
      };
```

No log do pipeline (imagem única), troque `cost: res.cost,\n              instructions,` por `cost: res.cost,\n              instructions,\n              ...(res.notes?.length ? { notes: res.notes } : {}),`. Troque o `return await this.continueAssets(` final (o dos carrosséis/vídeos, com `referenceImages: refs.map(...)`) por:

```ts
      const extra: RefImages = { referenceImages: refs.map((r) => ({ bytes: r.bytes, mime: r.mime })), referenceUrls: refs.map((r) => r.url) };
      const palette = listField(vs.paleta_hex).length ? listField(vs.paleta_hex) : ([brand?.primary_color, brand?.secondary_color].filter(Boolean) as string[]);
      const qa: SlideQa | undefined =
        format === 'feed_carousel'
          ? {
              ads, refs, palette, extra,
              rebuild: (i, motivo) =>
                buildVisualPrompt(this.ai, { ...artBrief(briefs[i]!, i), visualThread: thread, previousPrompt: ads[i]!.prompt_final, adjust: `Corrija: ${motivo}` }).then((ad) => (thread ? withVisualThread(ad, thread) : ad)),
            }
          : undefined;
      return await this.continueAssets(post, provider, prompts, 0, [], 0, instructions, extra, lease, qa);
```

- [ ] **Step 7: Harness**

Em `api/src/modules/instagram/__tests__/harness.ts`, troque o objeto `ai` por:

```ts
  const ai = {
    jsonWithEngine: jest.fn(async (_ws: string, req: any) => ({ content: aiJson[req.name]?.(req) ?? {}, engine: 'IA do app' })),
    json: jest.fn(async () => ({ ...ART })),
    // Crítico visual (carrossel): 40/50 por padrão.
    vision: jest.fn(async () => ({ produto: 8, fidelidade: 8, composicao: 8, defeitos: 8, paleta: 8, motivo: 'ok' })),
  } as any;
```

e `const images = {} as any;` por:

```ts
  const images = { shrink: jest.fn(async (b: Uint8Array) => ({ bytes: new Uint8Array(b), mime: 'image/jpeg' })) } as any;
```

- [ ] **Step 8: Contrato**

Em `docs/api-contract.md` §6, troque o item do `image(ws, …)` por: `` - `image(ws, { prompt, aspectRatio, referenceImages?, vendor: 'openai'|'gemini', strict?, appOnly? })` → `{ bytes, mime, ext, cost, note }`. Com fotos de referência o gateway (ChatGPT **e** Gemini) usa `/images/edits` (multipart `image[]`; sem `quality` no Gemini); `400\|404\|415\|422` na edição → gera só com o texto e devolve `note "Gateway sem suporte a referência; gerado sem foto da marca."` (vai para o log de geração). `` Na linha `generate-post-assets`, troque `carrossel = 1 imagem por slide (gancho no 1º, CTA no último, logo em todos);` por `carrossel = 1 imagem por slide (gancho no 1º, CTA no último, logo em todos) com **fio visual único** (paleta/estilo/luz do 1º slide repetidos em todos, \`creative_brief.visual_thread\`) e **nota do crítico por slide** (abaixo de 28/50 o slide é refeito 1× com o motivo e fica o de maior nota; \`media[].score\`, \`slide_scores\` no log);`.

- [ ] **Step 9: Rodar e ver passar**

Run: `cd api && ../scripts/run-capped.sh 1500 npm test -- src/modules/ai/__tests__/ src/modules/creative/__tests__/ src/modules/instagram/__tests__/`
Expected: PASS.

Run: `cd api && ../scripts/run-capped.sh 1500 npm run typecheck`
Expected: sem erros.

- [ ] **Step 10: Commit**

```bash
git add api/src/modules/ai/ai.service.ts api/src/modules/creative/pipeline.service.ts api/src/modules/creative/art-director.ts api/src/modules/instagram/media-generation.service.ts api/src/modules/instagram/__tests__/harness.ts api/src/modules/ai/__tests__/ai.service.spec.ts api/src/modules/creative/__tests__/art-critic.spec.ts api/src/modules/creative/__tests__/pipeline-notes.spec.ts api/src/modules/instagram/__tests__/media-generation.spec.ts docs/api-contract.md
git commit -m "feat(criativos): fotos de referência também pelo gateway (com recuo e aviso) e carrossel com fio visual e nota por slide

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: C1 — Veo 3.1 fast, 8 s e o áudio do modo (gateway, chave própria e Higgsfield)

**Files:**
- Modify: `api/src/common/config/env.validation.ts:106` (padrão de `AI_MODEL_VIDEO`), `api/.env.example:43`
- Modify: `api/src/modules/ai/ai.types.ts:49-57` (`AiVideoRequest.audio`)
- Modify: `api/src/modules/ai/ai.service.ts:369-428` (`veoParams`, `gatewayVideo`, `geminiDirectVideo`)
- Modify: `api/src/modules/creative/creative.types.ts:274-285` (`GenerationRequest.audio`)
- Modify: `api/src/modules/creative/providers/ai-creative.provider.ts:38-40`, `api/src/modules/creative/providers/higgsfield.provider.ts:102`
- Modify: `docs/api-contract.md:152` (§6)
- Test: `api/src/modules/ai/__tests__/ai.service.spec.ts`, `api/src/modules/creative/__tests__/providers.spec.ts` (acrescentar)

**Interfaces:**
- Consumes: nada novo.
- Produces:
  - `AiVideoRequest.audio?: boolean` e `GenerationRequest.audio?: boolean` (`false` = sem áudio; ausente = com áudio).
  - Corpo do Veo (gateway e chave própria): `parameters = { aspectRatio, resolution, durationSeconds: 8, generateAudio: audio !== false }` (+ `sampleCount: 1` no gateway); chave própria tenta `[AI_MODEL_VIDEO, 'veo-3.0-fast-generate-preview']` e, se o modelo recusar o flag (400/422), repete sem `generateAudio`.
  - Higgsfield: `sound: audio !== false`.
  - `Env.AI_MODEL_VIDEO` padrão `'veo-3.1-fast-generate-preview'`.

- [ ] **Step 1: Escrever os testes que falham**

Acrescente ao fim de `api/src/modules/ai/__tests__/ai.service.spec.ts`:

```ts
describe('AiService.video — Veo 3.1 fast, 8 s e o áudio do modo (C1)', () => {
  const op = { done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: 'https://files.googleapis.com/v.mp4' } }] } } };

  it('AI_MODEL_VIDEO padrão é o Veo 3.1 fast', () => {
    expect(validateEnv(baseEnv).AI_MODEL_VIDEO).toBe('veo-3.1-fast-generate-preview');
  });

  it('gateway: 8 s, generateAudio segue o modo (false = sem áudio) e a foto do primeiro quadro vai em instances[0].image', async () => {
    const f = fakeFetch([
      ['/videos/job1/content', () => new Response(Buffer.from('MP4'))],
      ['/videos/job1', () => json({ id: 'job1', status: 'completed' })],
      ['/videos', () => json({ id: 'job1', status: 'queued' })],
    ]);
    const ai = setup(gwEnv, {}, f.fn);
    await ai.video(WS, { prompt: 'roteiro', aspectRatio: '9:16', audio: false, referenceImages: [{ bytes: new Uint8Array([7]), mime: 'image/jpeg' }] });
    const creates = () => f.calls.filter((c) => c.url.endsWith('/videos'));
    const body = JSON.parse(String(creates()[0]!.init!.body));
    expect(body.model).toBe('veo-3.1-fast-generate-preview');
    expect(body.parameters).toEqual({ aspectRatio: '9:16', resolution: '1080p', durationSeconds: 8, generateAudio: false, sampleCount: 1 });
    expect(body.instances[0]).toEqual({ prompt: 'roteiro', image: { bytesBase64Encoded: Buffer.from([7]).toString('base64'), mimeType: 'image/jpeg' } });
    await ai.video(WS, { prompt: 'p', aspectRatio: '9:16' });
    expect(JSON.parse(String(creates()[1]!.init!.body)).parameters.generateAudio).toBe(true);
  });

  it('chave própria: o 3.1 fast primeiro, com 8 s e o flag de áudio; sem acesso a ele cai no 3.0 fast', async () => {
    const calls: Call[] = [];
    const fn: AiFetch = async (url, init) => {
      calls.push({ url, init });
      if (url.includes('veo-3.1-fast-generate-preview:predictLongRunning')) return new Response('sem acesso', { status: 403 });
      if (url.includes('veo-3.0-fast-generate-preview:predictLongRunning')) return json({ name: 'operations/op1' });
      if (url.endsWith('operations/op1')) return json(op);
      return new Response(Buffer.from('MP4'));
    };
    const r = await setup(gwEnv, { gemini: 'gk' }, fn).video(WS, { prompt: 'p', aspectRatio: '9:16', audio: true, strict: true });
    expect(r.status).toBe('ready');
    const creates = calls.filter((c) => c.url.includes(':predictLongRunning'));
    expect(creates.map((c) => /models\/([^:]+):/.exec(c.url)![1])).toEqual(['veo-3.1-fast-generate-preview', 'veo-3.0-fast-generate-preview']);
    expect(JSON.parse(String(creates[0]!.init!.body)).parameters).toEqual({ aspectRatio: '9:16', resolution: '1080p', durationSeconds: 8, generateAudio: true });
  });

  it('chave própria que recusa o flag de áudio (400 em 1080p e 720p): repete sem ele', async () => {
    const bodies: unknown[] = [];
    const fn: AiFetch = async (url, init) => {
      if (url.includes(':predictLongRunning')) {
        const b = JSON.parse(String(init!.body));
        bodies.push(b.parameters);
        return 'generateAudio' in b.parameters ? new Response('Invalid JSON payload: generateAudio', { status: 400 }) : json({ name: 'operations/op1' });
      }
      if (url.endsWith('operations/op1')) return json(op);
      return new Response(Buffer.from('MP4'));
    };
    const r = await setup(gwEnv, { gemini: 'gk' }, fn).video(WS, { prompt: 'p', aspectRatio: '9:16', audio: false, strict: true });
    expect(r.status).toBe('ready');
    expect(bodies).toEqual([
      { aspectRatio: '9:16', resolution: '1080p', durationSeconds: 8, generateAudio: false },
      { aspectRatio: '9:16', resolution: '720p', durationSeconds: 8, generateAudio: false },
      { aspectRatio: '9:16', resolution: '720p', durationSeconds: 8 },
    ]);
  });
});
```

Acrescente ao fim de `api/src/modules/creative/__tests__/providers.spec.ts`:

```ts
describe('áudio do vídeo nos provedores (C4)', () => {
  it('Gemini/Veo recebe `audio`; Higgsfield manda `sound` conforme o modo', async () => {
    const ai = { video: jest.fn(async () => ({ status: 'pending' as const, jobId: 'veo:j', cost: 6, note: null })) };
    const gem = createAiProvider(ai as any, 'ws', 'gemini', { hasOwnKey: false, owns: async () => true });
    await gem.generateVideo({ ...req, kind: 'video', aspectRatio: '9:16', audio: false });
    expect((ai.video.mock.calls[0] as any)[1].audio).toBe(false);
    const mcp = {
      callTool: jest.fn(async (_c: any, name: string) =>
        name === 'generate_video' ? { text: JOB, structured: null, mediaUrl: null } : { text: '{"status":"success"}', structured: null, mediaUrl: 'https://cdn.h.ai/v.mp4' },
      ),
    };
    const h = createHiggsfieldProvider(mcp as any, { server_url: 'https://mcp.higgsfield.ai/mcp', access_token: 'tok' }, async () => undefined);
    await h.generateVideo({ ...req, kind: 'video', aspectRatio: '9:16', audio: false });
    await h.generateVideo({ ...req, kind: 'video', aspectRatio: '9:16' });
    const gens = mcp.callTool.mock.calls.filter((c) => c[1] === 'generate_video');
    expect(gens.map((c) => (c[2] as any).params.sound)).toEqual([false, true]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd api && ../scripts/run-capped.sh 1500 npm test -- src/modules/ai/__tests__/ai.service.spec.ts src/modules/creative/__tests__/providers.spec.ts`
Expected: FAIL — `AI_MODEL_VIDEO` ainda `veo-3.0…`, `generateAudio: true` fixo, sem `durationSeconds` na chave própria, `sound: true` fixo.

- [ ] **Step 3: Tipos, padrão e provedores**

Em `api/src/common/config/env.validation.ts`, troque `AI_MODEL_VIDEO: z.string().default('veo-3.0-fast-generate-preview'),` por `AI_MODEL_VIDEO: z.string().default('veo-3.1-fast-generate-preview'),`. Em `api/.env.example`, troque `# AI_MODEL_VIDEO=veo-3.0-fast-generate-preview   # google/veo-3.1-fast` por `# AI_MODEL_VIDEO=veo-3.1-fast-generate-preview   # google/veo-3.1-fast (a chave própria do Gemini cai para veo-3.0-fast-generate-preview)`.

Em `api/src/modules/ai/ai.types.ts`, no `AiVideoRequest`, depois de `appOnly?: boolean;`:

```ts
  /** Áudio do vídeo: `false` = sem áudio (modo "sem áudio"); ausente = com áudio. */
  audio?: boolean;
```

Em `api/src/modules/creative/creative.types.ts`, no `GenerationRequest`, depois de `maxWaitMs?: number;`:

```ts
  /** Vídeo: `false` = sem áudio (Veo `generateAudio:false`, Higgsfield `sound:false`); ausente = com áudio. */
  audio?: boolean;
```

Em `api/src/modules/creative/providers/ai-creative.provider.ts`, troque a chamada do `ai.video` por:

```ts
      const r = await ai.video(workspaceId, {
        prompt: req.finalPrompt, aspectRatio: req.aspectRatio, referenceImages: req.referenceImages, maxWaitMs: req.maxWaitMs, strict: opts.strict, appOnly: opts.appOnly, audio: req.audio,
      });
```

Em `api/src/modules/creative/providers/higgsfield.provider.ts`, troque `if (video) Object.assign(params, { duration: 10, sound: true });` por `if (video) Object.assign(params, { duration: 10, sound: req.audio !== false });`.

- [ ] **Step 4: `AiService` — parâmetros do Veo**

Em `api/src/modules/ai/ai.service.ts`, logo depois de `const isVertical = …;`:

```ts
/** Duração dos vídeos do Veo (o roteiro é escrito para 8 s). */
const VEO_SECONDS = 8;
/** Modelo de reserva quando a chave própria não tem acesso ao `AI_MODEL_VIDEO`. */
export const VEO_FALLBACK_MODEL = 'veo-3.0-fast-generate-preview';
```

Logo depois de `veoInstance`, acrescente:

```ts
  /** Parâmetros do Veo: 9:16/16:9, resolução, 8 s e o áudio do modo (`audio:false` = sem áudio). */
  private veoParams(req: AiVideoRequest, resolution: string, withAudioFlag = true): Record<string, unknown> {
    return {
      aspectRatio: isVertical(req.aspectRatio) ? '9:16' : '16:9',
      resolution,
      durationSeconds: VEO_SECONDS,
      ...(withAudioFlag ? { generateAudio: req.audio !== false } : {}),
    };
  }
```

No `gatewayVideo`, troque a linha `parameters: { durationSeconds: 8, resolution, aspectRatio: isVertical(req.aspectRatio) ? '9:16' : '16:9', sampleCount: 1, generateAudio: true },` por `parameters: { ...this.veoParams(req, resolution), sampleCount: 1 },`.

Troque o `geminiDirectVideo` inteiro por:

```ts
  private async geminiDirectVideo(key: string, req: AiVideoRequest, deadline: number) {
    let lastErr: unknown = null;
    // Veo 3.1 fast (padrão de AI_MODEL_VIDEO) e, se a chave não tiver acesso, o 3.0 fast.
    for (const model of [...new Set([this.env.AI_MODEL_VIDEO, VEO_FALLBACK_MODEL])]) {
      try {
        const create = (resolution: string, audioFlag: boolean) =>
          this.http(`${GEMINI}/models/${model}:predictLongRunning`, {
            method: 'POST',
            headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
            body: JSON.stringify({ instances: [this.veoInstance(req)], parameters: this.veoParams(req, resolution, audioFlag) }),
            signal: AbortSignal.timeout(120_000),
          });
        let res = await create('1080p', true);
        if (res.status === 400 || res.status === 422) res = await create('720p', true);
        // Modelo que não aceita o flag de áudio: repete sem ele (vídeo "sem áudio" é silenciado depois, na conversão).
        if (res.status === 400 || res.status === 422) res = await create('720p', false);
        if (!res.ok) throw await this.vendorError('gemini', res);
        const op = (await res.json()) as { name: string };
        return await this.geminiVideoWait(key, op.name, deadline);
      } catch (e) {
        if (e instanceof AiDownloadBlockedError) throw e; // bloqueio de segurança/tamanho: não tenta outro modelo
        lastErr = e;
        this.warn(`vídeo com ${model}`, e);
      }
    }
    throw lastErr ?? new AiError('Nenhum modelo Veo disponível na sua chave Gemini.');
  }
```

- [ ] **Step 5: Contrato**

Em `docs/api-contract.md` §6, troque o item do `video(ws, …)` por: `` - `video(ws, { prompt, aspectRatio, referenceImages?, maxWaitMs?, audio? })` → `{ status:'ready', bytes… }` ou `{ status:'pending', jobId }`; `videoStatus(ws, jobId)` para o cron. Veo com `durationSeconds: 8`, `generateAudio: audio !== false` e a 1ª referência como `instances[0].image` (primeiro quadro). Chave própria do Gemini: `AI_MODEL_VIDEO` (padrão `veo-3.1-fast-generate-preview`) e, sem acesso, `veo-3.0-fast-generate-preview`; modelo que recusa o flag de áudio (400/422) recebe o pedido sem ele. Higgsfield (`kling2_6`, 10 s): `sound: audio !== false`. ``

- [ ] **Step 6: Rodar e ver passar**

Run: `cd api && ../scripts/run-capped.sh 1500 npm test -- src/modules/ai/__tests__/ src/modules/creative/__tests__/providers.spec.ts src/modules/integrations/__tests__/ai-diagnostics.spec.ts src/common/__tests__/env-and-guard.spec.ts`
Expected: PASS.

Run: `cd api && ../scripts/run-capped.sh 1500 npm run typecheck`
Expected: sem erros.

- [ ] **Step 7: Commit**

```bash
git add api/src/common/config/env.validation.ts api/.env.example api/src/modules/ai/ai.types.ts api/src/modules/ai/ai.service.ts api/src/modules/creative/creative.types.ts api/src/modules/creative/providers/ai-creative.provider.ts api/src/modules/creative/providers/higgsfield.provider.ts api/src/modules/ai/__tests__/ai.service.spec.ts api/src/modules/creative/__tests__/providers.spec.ts docs/api-contract.md
git commit -m "feat(ia): Veo 3.1 fast por padrão, 8 s e áudio conforme o modo (gateway, chave própria e Higgsfield)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: C2 — `video-director.ts`: roteiro estruturado, prompt pt-BR completo e montador determinístico

**Files:**
- Create: `api/src/modules/creative/video-director.ts`
- Test: `api/src/modules/creative/__tests__/video-director.spec.ts` (novo)

**Interfaces:**
- Consumes: `AiService.json(ws, { prompt, schema, name })`; `PostCreativeContext`, `contextForPrompt`, `contextProhibitions` (Task 6); `VisualStyle`, `listField` (`visual-style.ts`); `UserError`.
- Produces (todos exportados de `video-director.ts`):
  - `AUDIO_MODES = ['ambiente_trilha', 'narracao', 'sem_audio'] as const`; `type AudioMode`; `type VideoAudio = { modo: AudioMode; instrucoes: string }`; `DEFAULT_VIDEO_AUDIO`; `MAX_AUDIO_INSTRUCTIONS = 500`.
  - `VIDEO_SECONDS = 8`, `MAX_SHOTS = 3`, `VIDEO_PROMPT_MIN_WORDS = 250`, `VIDEO_PROMPT_MAX_WORDS = 450`, `VIDEO_PROMPT_MAX_CHARS = 3000`.
  - `type VideoShot = { inicio_s: number; fim_s: number; enquadramento: string; acao: string; movimento_camera: string; lente: string }`; `type VideoDirection = { gancho_visual: string; sujeito: string; cenario: string; tomadas: VideoShot[]; iluminacao: string; paleta_hex: string[]; estilo: string; ritmo: string; cta_visual: string; audio: { modo: AudioMode; descricao: string; fala: string }; evitar: string[] }`.
  - `VIDEO_SCHEMA` (JSON schema estrito); `type VideoBrief` (ver código).
  - `cleanFree(v: unknown, max: number): string`; `resolveAudio(...layers: unknown[]): VideoAudio`.
  - `videoDirectorPrompt(b: VideoBrief): string`; `normalizeDirection(json: unknown, audio: VideoAudio, fallbackPalette?: string[]): VideoDirection`; `assembleVideoPrompt(d: VideoDirection, o: { audio: VideoAudio; hasFirstFrame: boolean; extraAvoid?: string[] }): string`; `directVideo(ai: AiService, b: VideoBrief): Promise<{ direction: VideoDirection; prompt: string }>`; `stillPrompt(d: VideoDirection): string`.

- [ ] **Step 1: Escrever os testes que falham**

Crie `api/src/modules/creative/__tests__/video-director.spec.ts`:

```ts
import {
  assembleVideoPrompt, AUDIO_MODES, DEFAULT_VIDEO_AUDIO, directVideo, normalizeDirection, resolveAudio, stillPrompt, VIDEO_SCHEMA, VideoBrief, videoDirectorPrompt,
} from '../video-director';

const words = (t: string) => t.split(/\s+/).filter(Boolean).length;
const DIR = {
  gancho_visual: 'o chope é servido até a borda em câmera lenta',
  sujeito: 'copo de chope gelado com colarinho cremoso',
  cenario: 'balcão de madeira de um bar aconchegante',
  tomadas: [
    { inicio_s: 0, fim_s: 2.5, enquadramento: 'close', acao: 'o chope é servido até a borda', movimento_camera: 'travelling lento para a frente', lente: '85 mm' },
    { inicio_s: 2.5, fim_s: 5.5, enquadramento: 'plano médio', acao: 'a mão desliza o copo até a frente', movimento_camera: 'câmera parada', lente: '50 mm' },
    { inicio_s: 5.5, fim_s: 8, enquadramento: 'plano aberto', acao: 'amigos brindam ao fundo', movimento_camera: 'leve recuo', lente: '35 mm' },
  ],
  iluminacao: 'luz quente de fim de tarde',
  paleta_hex: ['#c0392b', '#f5deb3'],
  estilo: 'comercial realista',
  ritmo: 'abre rápido e fecha firme',
  cta_visual: 'o copo em primeiro plano com o bar desfocado ao fundo',
  audio: { modo: 'ambiente_trilha', descricao: 'som do bar e trilha leve', fala: '' },
  evitar: ['copos de outras marcas', 'gente olhando para a câmera'],
};
const BRAND = {
  name: 'Bar do Zé', segment: 'bar', primary_color: '#c0392b', secondary_color: '#222222', banned_words: ['barato'],
  visual_style: { estilo_fotografico: 'realista', paleta_hex: ['#c0392b', '#f5deb3'], elementos_proibidos: ['copos de plástico'], exemplos_prompt: ['p1', 'p2', 'p3', 'p4'] },
};
const CTX = {
  product: { name: 'Chope Pilsen', description: 'chope claro', price: 12.9 }, pillar: 'Bastidores', persona: { name: 'Ana', pains: 'sem tempo', desires: 'relaxar' },
  funnelStage: 'conversao', objective: 'Lotar o happy hour de sexta', strategy: { mensagem_central: 'O melhor chope da cidade', publico_foco: 'adultos', proibicoes: ['falar de preço baixo'] },
  campaign: null, scheduledAt: '2099-01-02T21:00:00.000Z',
};
const brief = (over: Partial<VideoBrief> = {}): VideoBrief => ({
  workspaceId: 'ws', brand: BRAND, context: CTX, format: 'reel', theme: 'Happy hour', hook: 'Sextou com chope', cta: 'Reserve', userPrompt: 'chope sendo servido',
  audio: DEFAULT_VIDEO_AUDIO, hasFirstFrame: true, provider: 'gemini', ...over,
});

describe('roteiro de vídeo — prompt da IA (pt-BR)', () => {
  it('pede o JSON estruturado com todas as regras: 0–8 s sem buracos, ≤ 3 tomadas, 1 ação por tomada, sem texto, anatomia, produto fiel, data/estação, proibições', () => {
    const p = videoDirectorPrompt(brief());
    for (const t of [
      'Escreva TUDO em português do Brasil',
      'vertical 9:16 de 8 segundos para Reels',
      'de 1 a 3, em ordem, cobrindo de 0 a 8 s SEM buracos nem sobreposição',
      'UMA ação física clara e visível',
      'gancho_visual: o que prende o olhar nos 2 primeiros segundos',
      'NADA de texto, letras, números, legendas, placas legíveis ou logotipos gerados na cena',
      'anatomia natural',
      'O vídeo COMEÇA a partir da foto real enviada',
      'Coerência com a data e a estação',
      'PROIBIDO (marca e estratégia): copos de plástico; barato; falar de preço baixo.',
      'ÁUDIO (modo "ambiente_trilha"): Som da própria cena',
      'GUIA VISUAL DA MARCA:',
      'PROMPTS QUE FUNCIONARAM PARA ESTA MARCA',
      '"nome":"Chope Pilsen"',
      'sexta-feira, 02/01/2099 (verão)',
      '"pedido_visual":"chope sendo servido"',
    ]) {
      expect(p).toContain(t);
    }
    expect(p).toContain('\n- p2\n- p3\n- p4');
    expect(p).not.toContain('\n- p1\n');
    expect(VIDEO_SCHEMA.required).toHaveLength(11);
    expect((VIDEO_SCHEMA.properties.audio as any).properties.modo.enum).toEqual([...AUDIO_MODES]);
  });

  it('modos de áudio, sem foto, story e refação (roteiro anterior + motivo do crítico + ajuste delimitados)', () => {
    expect(videoDirectorPrompt(brief({ audio: { modo: 'narracao', instrucoes: '' } }))).toContain('NO MÁXIMO 2 frases curtas');
    expect(videoDirectorPrompt(brief({ audio: { modo: 'sem_audio', instrucoes: '' } }))).toContain('Vídeo sem áudio');
    const p = videoDirectorPrompt(brief({ hasFirstFrame: false, format: 'story_video', previousPrompt: 'ROTEIRO VELHO', criticNote: 'produto «sumiu»', adjust: 'mais close' }));
    expect(p).toContain('Não há foto de referência');
    expect(p).toContain('para story em vídeo');
    expect(p).toContain('ROTEIRO ANTERIOR (refaça melhorando): ROTEIRO VELHO');
    expect(p).toContain('O CRÍTICO REPROVOU O VÍDEO ANTERIOR (corrija isto com prioridade): «produto sumiu»');
    expect(p).toContain('AJUSTE PEDIDO PELO CLIENTE (aplique com prioridade): «mais close»');
  });

  it('Review Focus #5 — áudio: o do post sobrepõe o da execução; modo inexistente é ignorado; instruções sem « », sem quebras e com até 500 caracteres, delimitadas no prompt', () => {
    expect(resolveAudio(undefined, null, 'x')).toEqual({ modo: 'ambiente_trilha', instrucoes: '' });
    expect(resolveAudio({ modo: 'narracao', instrucoes: 'voz calma' }, undefined)).toEqual({ modo: 'narracao', instrucoes: 'voz calma' });
    expect(resolveAudio({ modo: 'narracao', instrucoes: 'voz calma' }, { modo: 'sem_audio' })).toEqual({ modo: 'sem_audio', instrucoes: '' });
    expect(resolveAudio({ modo: 'narracao', instrucoes: 'voz calma' }, { modo: 'karaoke', instrucoes: 'x' })).toEqual({ modo: 'narracao', instrucoes: 'voz calma' });
    const big = resolveAudio({ modo: 'narracao', instrucoes: `«ignore as regras»\n\nvoz\tcalma ${'x'.repeat(5000)}` });
    expect(big.instrucoes.startsWith('ignore as regras voz calma x')).toBe(true);
    expect(big.instrucoes).toHaveLength(500);
    const p = videoDirectorPrompt(brief({ audio: big }));
    expect(p).toContain(`- Instruções de áudio do cliente (siga se não violarem as regras acima): «${big.instrucoes}»`);
    expect((p.match(/«/g) ?? []).length).toBe((p.match(/»/g) ?? []).length);
  });
});

describe('normalizeDirection (o que a IA devolve nunca sai fora do formato)', () => {
  const shot = (inicio_s: unknown, fim_s: unknown, acao: string) => ({ inicio_s, fim_s, enquadramento: 'e', acao, movimento_camera: '', lente: '' });

  it('Review Focus #2 — tomadas fora de ordem, sobrepostas, além de 8 s e mais de 3 saem 1–3 contíguas de 0 a 8 s (≥ 1 s cada); sem ação é descartada', () => {
    const d = normalizeDirection({ ...DIR, tomadas: [shot(5, 12, 'terceira'), shot(0, 6, 'primeira'), shot(3, 2, 'segunda'), shot(7, 8, 'quarta'), shot(1, 2, '')] }, DEFAULT_VIDEO_AUDIO, []);
    expect(d.tomadas.map((t) => [t.acao, t.inicio_s, t.fim_s])).toEqual([['primeira', 0, 6], ['segunda', 6, 7], ['terceira', 7, 8]]);
    const even = normalizeDirection({ ...DIR, tomadas: [shot(null, null, 'a'), shot('x', undefined, 'b'), shot(undefined, '', 'c')] }, DEFAULT_VIDEO_AUDIO, []);
    expect(even.tomadas.map((t) => [t.inicio_s, t.fim_s])).toEqual([[0, 2.5], [2.5, 5.5], [5.5, 8]]);
    const none = normalizeDirection({ ...DIR, tomadas: 'nada' }, DEFAULT_VIDEO_AUDIO, []);
    expect(none.tomadas).toEqual([{ inicio_s: 0, fim_s: 8, enquadramento: 'plano médio', acao: DIR.gancho_visual, movimento_camera: 'aproximação lenta', lente: '35 mm' }]);
    const strings = normalizeDirection({ ...DIR, tomadas: [shot('0', '3.5', 'a'), shot('3.5', '8', 'b')] }, DEFAULT_VIDEO_AUDIO, []);
    expect(strings.tomadas.map((t) => [t.inicio_s, t.fim_s])).toEqual([[0, 3.5], [3.5, 8]]);
  });

  it('paleta só #RRGGBB (senão a da marca); áudio no modo configurado; fala só na narração (2 frases); evitar ≤ 8 itens curtos', () => {
    const d = normalizeDirection({ ...DIR, paleta_hex: ['vermelho', '#C0392B', '#zzzzzz', ' #f5deb3 '], audio: { modo: 'narracao', descricao: 'd', fala: 'Sextou!' }, evitar: Array.from({ length: 12 }, () => 'y'.repeat(200)) }, DEFAULT_VIDEO_AUDIO, ['#111111']);
    expect(d.paleta_hex).toEqual(['#C0392B', '#f5deb3']);
    expect(d.audio).toEqual({ modo: 'ambiente_trilha', descricao: 'd', fala: '' });
    expect(d.evitar).toHaveLength(8);
    expect(d.evitar.every((x) => x.length <= 80)).toBe(true);
    expect(normalizeDirection({ ...DIR, paleta_hex: ['azul'] }, DEFAULT_VIDEO_AUDIO, ['#111111', 'x']).paleta_hex).toEqual(['#111111']);
    const n = normalizeDirection({ ...DIR, audio: { modo: 'ambiente_trilha', descricao: 'bar', fala: 'Sextou! Venha brindar com a gente. Reserve agora. Mais texto.' } }, { modo: 'narracao', instrucoes: '' }, []);
    expect(n.audio).toEqual({ modo: 'narracao', descricao: 'bar', fala: 'Sextou! Venha brindar com a gente.' });
    expect(normalizeDirection(DIR, { modo: 'sem_audio', instrucoes: '' }, []).audio).toEqual({ modo: 'sem_audio', descricao: 'sem áudio', fala: '' });
  });
});

describe('assembleVideoPrompt (montador determinístico)', () => {
  const d = normalizeDirection(DIR, DEFAULT_VIDEO_AUDIO, []);

  it('texto pt-BR com marcas de tempo, câmera/lente/luz/paleta/estilo, áudio e "Evite:"; 250–450 palavras, ≤ 3000 caracteres; sempre igual para a mesma entrada', () => {
    const t = assembleVideoPrompt(d, { audio: DEFAULT_VIDEO_AUDIO, hasFirstFrame: true, extraAvoid: ['copos de plástico'] });
    for (const s of [
      'Vídeo vertical 9:16 de 8 segundos para Instagram',
      'Comece exatamente a partir da imagem de referência enviada (primeiro quadro)',
      'Gancho (0–2s): o chope é servido até a borda em câmera lenta.',
      'Roteiro por tomada:',
      '[0s–2,5s] close; o chope é servido até a borda; câmera: travelling lento para a frente; lente 85 mm.',
      '[2,5s–5,5s] plano médio;',
      '[5,5s–8s] plano aberto;',
      'Luz: luz quente de fim de tarde. Paleta: #c0392b, #f5deb3. Estilo: comercial realista. Ritmo: abre rápido e fecha firme.',
      'Último segundo: o copo em primeiro plano com o bar desfocado ao fundo.',
      'sem vozes, sem fala e sem canto',
      'Sem texto, letras, números, legendas ou logotipos gerados na cena.',
      'Evite: copos de outras marcas; gente olhando para a câmera; copos de plástico;',
    ]) {
      expect(t).toContain(s);
    }
    expect(words(t)).toBeGreaterThanOrEqual(250);
    expect(words(t)).toBeLessThanOrEqual(450);
    expect(t.length).toBeLessThanOrEqual(3000);
    expect(assembleVideoPrompt(d, { audio: DEFAULT_VIDEO_AUDIO, hasFirstFrame: true, extraAvoid: ['copos de plástico'] })).toBe(t);
  });

  it('áudio por modo: narração com a fala e as instruções do cliente; sem áudio', () => {
    const n = normalizeDirection({ ...DIR, audio: { modo: 'narracao', descricao: 'bar ao fundo', fala: 'Sextou! Reserve sua mesa.' } }, { modo: 'narracao', instrucoes: 'voz feminina calma' }, []);
    const t = assembleVideoPrompt(n, { audio: { modo: 'narracao', instrucoes: 'voz feminina calma' }, hasFirstFrame: false });
    expect(t).toContain('Áudio: narração em português do Brasil, voz natural e próxima, sobre o som ambiente da cena (bar ao fundo). A voz diz: "Sextou! Reserve sua mesa." Orientação do cliente para o áudio: voz feminina calma.');
    expect(t).not.toContain('primeiro quadro');
    const m = assembleVideoPrompt(normalizeDirection(DIR, { modo: 'sem_audio', instrucoes: '' }, []), { audio: { modo: 'sem_audio', instrucoes: '' }, hasFirstFrame: false });
    expect(m).toContain('Áudio: nenhum (vídeo sem som).');
  });

  it('roteiro enorme: corta descrições, nunca passa de 450 palavras nem de 3000 caracteres e mantém as 3 marcas de tempo', () => {
    const long = (n: number) => Array.from({ length: n }, (_, i) => `palavra${i}`).join(' ');
    const huge = normalizeDirection({
      ...DIR, gancho_visual: long(80), sujeito: long(80), cenario: long(80), iluminacao: long(80), estilo: long(80), ritmo: long(80), cta_visual: long(80),
      tomadas: DIR.tomadas.map((t) => ({ ...t, enquadramento: long(40), acao: long(80), movimento_camera: long(40), lente: long(20) })),
      audio: { modo: 'narracao', descricao: long(80), fala: long(80) }, evitar: Array.from({ length: 8 }, () => long(20)),
    }, { modo: 'narracao', instrucoes: long(90) }, []);
    const t = assembleVideoPrompt(huge, { audio: { modo: 'narracao', instrucoes: long(90) }, hasFirstFrame: true, extraAvoid: Array.from({ length: 10 }, () => long(15)) });
    expect(words(t)).toBeLessThanOrEqual(450);
    expect(t.length).toBeLessThanOrEqual(3000);
    for (const m of ['[0s–2,5s]', '[2,5s–5,5s]', '[5,5s–8s]']) expect(t).toContain(m);
  });

  it('roteiro mínimo: completa com padrões de qualidade até 250 palavras (sem passar de 450)', () => {
    const tiny = normalizeDirection({ sujeito: 'copo' }, DEFAULT_VIDEO_AUDIO, []);
    const t = assembleVideoPrompt(tiny, { audio: DEFAULT_VIDEO_AUDIO, hasFirstFrame: false });
    expect(words(t)).toBeGreaterThanOrEqual(250);
    expect(words(t)).toBeLessThanOrEqual(450);
    expect(t).toContain('Qualidade de comercial de cinema');
  });
});

describe('directVideo e stillPrompt', () => {
  it('chama a IA com o schema "video_direction", normaliza e monta o texto final; proibições da marca e da estratégia no "Evite"', async () => {
    const ai = { json: jest.fn(async () => DIR) };
    const r = await directVideo(ai as any, brief());
    const [ws, req] = ai.json.mock.calls[0] as any;
    expect(ws).toBe('ws');
    expect(req).toMatchObject({ name: 'video_direction', schema: VIDEO_SCHEMA });
    expect(r.direction.tomadas).toHaveLength(3);
    expect(r.prompt).toContain('copos de plástico');
    expect(r.prompt).toContain('falar de preço baixo');
  });

  it('IA sem roteiro (sem sujeito, gancho nem tomadas): erro claro', async () => {
    const ai = { json: jest.fn(async () => ({ cenario: 'bar' })) };
    await expect(directVideo(ai as any, brief())).rejects.toThrow('O diretor de vídeo não devolveu o roteiro.');
  });

  it('stillPrompt: descrição parada para a capa (sem marcas de tempo)', () => {
    const s = stillPrompt(normalizeDirection(DIR, DEFAULT_VIDEO_AUDIO, []));
    expect(s).toBe('copo de chope gelado com colarinho cremoso. balcão de madeira de um bar aconchegante. Luz: luz quente de fim de tarde. Estilo: comercial realista. Paleta: #c0392b, #f5deb3');
    expect(s).not.toMatch(/\[\d/);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd api && ../scripts/run-capped.sh 1500 npm test -- src/modules/creative/__tests__/video-director.spec.ts`
Expected: FAIL — `Cannot find module '../video-director'`.

- [ ] **Step 3: Implementar `video-director.ts`**

Crie `api/src/modules/creative/video-director.ts`:

```ts
/**
 * Diretor de vídeo. A IA devolve um ROTEIRO ESTRUTURADO (JSON, `VIDEO_SCHEMA`) e um montador DETERMINÍSTICO transforma o roteiro no
 * texto final em pt-BR enviado ao modelo de vídeo (Veo/Kling): marcas de tempo por tomada, câmera/lente/luz/paleta/estilo, direção de
 * áudio e "Evite: …", com 250–450 palavras e no máximo 3000 caracteres. A IA decide O QUE acontece; o código decide COMO o texto sai.
 */
import { AiService } from '../ai/ai.service';
import { UserError } from '../media/user-error';
import { contextForPrompt, contextProhibitions, PostCreativeContext } from './creative-context';
import { listField, VisualStyle } from './visual-style';

export const AUDIO_MODES = ['ambiente_trilha', 'narracao', 'sem_audio'] as const;
export type AudioMode = (typeof AUDIO_MODES)[number];
export type VideoAudio = { modo: AudioMode; instrucoes: string };
export const DEFAULT_VIDEO_AUDIO: VideoAudio = { modo: 'ambiente_trilha', instrucoes: '' };
export const MAX_AUDIO_INSTRUCTIONS = 500;
export const VIDEO_SECONDS = 8;
export const MAX_SHOTS = 3;
export const VIDEO_PROMPT_MIN_WORDS = 250;
export const VIDEO_PROMPT_MAX_WORDS = 450;
export const VIDEO_PROMPT_MAX_CHARS = 3000;

export type VideoShot = { inicio_s: number; fim_s: number; enquadramento: string; acao: string; movimento_camera: string; lente: string };
export type VideoDirection = {
  gancho_visual: string;
  sujeito: string;
  cenario: string;
  tomadas: VideoShot[];
  iluminacao: string;
  paleta_hex: string[];
  estilo: string;
  ritmo: string;
  cta_visual: string;
  audio: { modo: AudioMode; descricao: string; fala: string };
  evitar: string[];
};

export type VideoBrief = {
  workspaceId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  brand: any | null;
  context: PostCreativeContext | null;
  format: 'reel' | 'story_video';
  theme: string | null;
  hook: string | null;
  cta: string | null;
  /** Briefing visual do post (`creative_brief.prompt`). */
  userPrompt: string | null;
  audio: VideoAudio;
  /** Há foto de produto/marca como primeiro quadro? */
  hasFirstFrame: boolean;
  provider: string;
  /** Ajuste pedido pelo cliente no editor. */
  adjust?: string | null;
  /** Roteiro anterior (refação ou ajuste). */
  previousPrompt?: string | null;
  /** Motivo do crítico que reprovou o vídeo anterior. */
  criticNote?: string | null;
};

const str = { type: 'string' };
const num = { type: 'number' };
export const VIDEO_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['gancho_visual', 'sujeito', 'cenario', 'tomadas', 'iluminacao', 'paleta_hex', 'estilo', 'ritmo', 'cta_visual', 'audio', 'evitar'],
  properties: {
    gancho_visual: str,
    sujeito: str,
    cenario: str,
    tomadas: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['inicio_s', 'fim_s', 'enquadramento', 'acao', 'movimento_camera', 'lente'],
        properties: { inicio_s: num, fim_s: num, enquadramento: str, acao: str, movimento_camera: str, lente: str },
      },
    },
    iluminacao: str,
    paleta_hex: { type: 'array', items: str },
    estilo: str,
    ritmo: str,
    cta_visual: str,
    audio: {
      type: 'object',
      additionalProperties: false,
      required: ['modo', 'descricao', 'fala'],
      properties: { modo: { type: 'string', enum: [...AUDIO_MODES] }, descricao: str, fala: str },
    },
    evitar: { type: 'array', items: str },
  },
};

const HEX = /^#[0-9a-f]{6}$/i;

/** Texto livre (usuário ou IA) para dentro de um prompt: sem « » (o delimitador), sem quebras nem controle, com teto. */
export function cleanFree(v: unknown, max: number): string {
  return typeof v === 'string'
    ? v.replace(/[«»]/g, '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
    : '';
}

/** Áudio efetivo: camadas da mais geral para a mais específica (execução → post); camada inválida é ignorada. */
export function resolveAudio(...layers: unknown[]): VideoAudio {
  let out: VideoAudio = { ...DEFAULT_VIDEO_AUDIO };
  for (const layer of layers) {
    if (!layer || typeof layer !== 'object') continue;
    const o = layer as Record<string, unknown>;
    if (typeof o['modo'] !== 'string' || !(AUDIO_MODES as readonly string[]).includes(o['modo'])) continue;
    out = { modo: o['modo'] as AudioMode, instrucoes: cleanFree(o['instrucoes'], MAX_AUDIO_INSTRUCTIONS) };
  }
  return out;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const brandPalette = (brand: any): string[] => {
  const vs = (brand?.visual_style ?? {}) as VisualStyle;
  const list = listField(vs.paleta_hex).length ? listField(vs.paleta_hex) : [brand?.primary_color, brand?.secondary_color].filter(Boolean).map(String);
  return list.map((c) => c.trim()).filter((c) => HEX.test(c));
};

/** Regras de áudio por modo, para a IA. */
const AUDIO_GUIDE: Record<AudioMode, string> = {
  ambiente_trilha:
    'Som da própria cena (ambiente, objetos, pessoas sem diálogo) + trilha instrumental leve no tom da marca. SEM vozes, SEM fala, SEM canto, SEM locução. Preencha "fala" com "".',
  narracao:
    'Voz em português do Brasil, natural e próxima, sobre o som ambiente da cena. A voz diz NO MÁXIMO 2 frases curtas (gancho e chamada), escritas por você no campo "fala" (até 25 palavras no total, sem preço inventado, sem nome de concorrente). Nada de música alta por cima da voz.',
  sem_audio: 'Vídeo sem áudio: descreva só a imagem. Em "audio.descricao" escreva "sem áudio" e deixe "fala" vazia.',
};

/** Prompt (pt-BR) que pede o roteiro estruturado à IA. */
export function videoDirectorPrompt(b: VideoBrief): string {
  const vs = (b.brand?.visual_style ?? {}) as VisualStyle;
  const examples = listField(vs.exemplos_prompt).slice(-3);
  const palette = brandPalette(b.brand);
  const banned = [...listField(vs.elementos_proibidos), ...listField(b.brand?.banned_words), ...contextProhibitions(b.context)];
  const instr = cleanFree(b.audio.instrucoes, MAX_AUDIO_INSTRUCTIONS);
  return [
    'Você é diretor de cena sênior de uma agência de publicidade no Brasil e escreve roteiros de vídeos curtos para Instagram. Escreva TUDO em português do Brasil.',
    `Crie o roteiro de UM vídeo vertical 9:16 de ${VIDEO_SECONDS} segundos para ${b.format === 'reel' ? 'Reels' : 'story em vídeo'}, que será gerado por IA (${b.provider}).`,
    'REGRAS DO ROTEIRO (todas obrigatórias):',
    `- tomadas: de 1 a ${MAX_SHOTS}, em ordem, cobrindo de 0 a ${VIDEO_SECONDS} s SEM buracos nem sobreposição (a 1ª começa em 0, cada uma começa onde a anterior termina, a última termina em ${VIDEO_SECONDS}).`,
    '- Cada tomada tem UMA ação física clara e visível (ex.: "a mão desliza o copo até a frente", "o chope é servido até a borda"), com enquadramento, movimento de câmera e lente.',
    '- gancho_visual: o que prende o olhar nos 2 primeiros segundos (movimento, close, contraste) — é o que acontece na 1ª tomada.',
    '- cta_visual: o que se vê no último segundo para convidar à ação (sem texto na tela).',
    '- NADA de texto, letras, números, legendas, placas legíveis ou logotipos gerados na cena: título, preço, chamada e logo entram depois, na capa e nas legendas.',
    '- Pessoas (se houver) com anatomia natural: mãos com cinco dedos, rostos naturais, movimentos fisicamente plausíveis; nada de transformações estranhas.',
    b.hasFirstFrame
      ? '- O vídeo COMEÇA a partir da foto real enviada (primeiro quadro): mantenha o produto e o ambiente exatamente como na foto (forma, cor, rótulo, embalagem) e anime a partir dela.'
      : '- Não há foto de referência: descreva o produto e o ambiente de forma concreta e fiel à descrição da marca.',
    '- O produto real é o protagonista e precisa ficar reconhecível; comida e bebida em ângulo apetitoso (textura, vapor, gotas, frescor).',
    '- Coerência com a data e a estação informadas (luz, roupas, clima, decoração) e com o segmento da marca.',
    `- paleta_hex: 3 a 6 cores em #RRGGBB coerentes com a marca${palette.length ? ` (base: ${palette.join(', ')})` : ''}.`,
    '- ritmo: como a edição flui (ex.: "abre rápido, desacelera no produto, fecha firme").',
    '- evitar: 4 a 8 itens concretos do que NÃO pode aparecer.',
    banned.length ? `- PROIBIDO (marca e estratégia): ${banned.join('; ')}.` : '',
    `- ÁUDIO (modo "${b.audio.modo}"): ${AUDIO_GUIDE[b.audio.modo]}`,
    instr ? `- Instruções de áudio do cliente (siga se não violarem as regras acima): «${instr}»` : '',
    '',
    'GUIA VISUAL DA MARCA:',
    JSON.stringify({
      marca: b.brand?.name ?? null,
      segmento: b.brand?.segment ?? null,
      estilo_fotografico: vs.estilo_fotografico ?? null,
      iluminacao: vs.iluminacao ?? null,
      paleta_hex: palette,
      ambientes: vs.ambientes ?? [],
      elementos_obrigatorios: vs.elementos_obrigatorios ?? [],
      elementos_proibidos: vs.elementos_proibidos ?? [],
    }),
    examples.length ? `PROMPTS QUE FUNCIONARAM PARA ESTA MARCA (referência de estilo):\n- ${examples.join('\n- ')}` : '',
    '',
    'BRIEFING DO POST:',
    JSON.stringify({ tema: b.theme, gancho_da_legenda: b.hook, cta: b.cta, pedido_visual: b.userPrompt }),
    b.context ? `CONTEXTO (traduza em cena; nunca escreva estes textos no vídeo): ${JSON.stringify(contextForPrompt(b.context))}` : '',
    b.previousPrompt ? `ROTEIRO ANTERIOR (refaça melhorando): ${cleanFree(b.previousPrompt, VIDEO_PROMPT_MAX_CHARS)}` : '',
    b.criticNote ? `O CRÍTICO REPROVOU O VÍDEO ANTERIOR (corrija isto com prioridade): «${cleanFree(b.criticNote, 300)}»` : '',
    b.adjust ? `AJUSTE PEDIDO PELO CLIENTE (aplique com prioridade): «${cleanFree(b.adjust, 300)}»` : '',
    'Devolva SOMENTE o JSON do roteiro.',
  ]
    .filter(Boolean)
    .join('\n');
}

const shortSpeech = (t: string) => t.split(/(?<=[.!?])\s+/).filter(Boolean).slice(0, 2).join(' ').slice(0, 180).trim();

/** Normaliza o JSON da IA: 1–3 tomadas contíguas de 0 a 8 s (≥ 1 s cada), cores #RRGGBB, áudio no modo configurado, listas curtas. */
export function normalizeDirection(json: unknown, audio: VideoAudio, fallbackPalette: string[] = []): VideoDirection {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const j = (json && typeof json === 'object' ? json : {}) as any;
  const txt = (v: unknown, max = 400) => cleanFree(v, max);
  const toNum = (v: unknown) => (v === null || v === undefined || v === '' ? NaN : Number(v));
  const raw = Array.isArray(j.tomadas) ? (j.tomadas as unknown[]) : [];
  let shots: VideoShot[] = raw
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((t: any) => ({ inicio_s: toNum(t?.inicio_s), fim_s: toNum(t?.fim_s), enquadramento: txt(t?.enquadramento, 160), acao: txt(t?.acao), movimento_camera: txt(t?.movimento_camera, 160), lente: txt(t?.lente, 80) }))
    .filter((t) => t.acao)
    .sort((a, b) => (Number.isFinite(a.inicio_s) ? a.inicio_s : 99) - (Number.isFinite(b.inicio_s) ? b.inicio_s : 99))
    .slice(0, MAX_SHOTS);
  if (!shots.length) {
    shots = [{ inicio_s: 0, fim_s: VIDEO_SECONDS, enquadramento: 'plano médio', acao: txt(j.gancho_visual) || txt(j.sujeito) || 'o produto em destaque', movimento_camera: 'aproximação lenta', lente: '35 mm' }];
  }
  // Cobertura 0–8 s sem buracos: cada tomada começa onde a anterior termina; ≥ 1 s cada; a última termina em 8 s.
  const k = shots.length;
  let start = 0;
  shots = shots.map((t, i) => {
    const last = i === k - 1;
    const proposed = Number.isFinite(t.fim_s) ? t.fim_s : start + (VIDEO_SECONDS - start) / (k - i);
    const end = last ? VIDEO_SECONDS : Math.min(VIDEO_SECONDS - (k - 1 - i), Math.max(start + 1, Math.round(proposed * 2) / 2));
    const shot = { ...t, inicio_s: start, fim_s: end };
    start = end;
    return shot;
  });
  const palette = listField(j.paleta_hex).map((c) => c.trim()).filter((c) => HEX.test(c)).slice(0, 6);
  return {
    gancho_visual: txt(j.gancho_visual) || shots[0]!.acao,
    sujeito: txt(j.sujeito),
    cenario: txt(j.cenario),
    tomadas: shots,
    iluminacao: txt(j.iluminacao, 200),
    paleta_hex: palette.length ? palette : fallbackPalette.map((c) => c.trim()).filter((c) => HEX.test(c)).slice(0, 6),
    estilo: txt(j.estilo, 200),
    ritmo: txt(j.ritmo, 160),
    cta_visual: txt(j.cta_visual, 240),
    audio: {
      modo: audio.modo,
      descricao: audio.modo === 'sem_audio' ? 'sem áudio' : txt(j.audio?.descricao, 300),
      fala: audio.modo === 'narracao' ? shortSpeech(txt(j.audio?.fala, 400)) : '',
    },
    evitar: listField(j.evitar).map((x) => txt(x, 80)).filter(Boolean).slice(0, 8),
  };
}

type AssembleOpts = { audio: VideoAudio; hasFirstFrame: boolean; extraAvoid?: string[] };
const words = (t: string) => t.split(/\s+/).filter(Boolean).length;
const clip = (t: string, max: number) => (t.length <= max ? t : `${t.slice(0, max).replace(/\s+\S*$/, '')}…`);
const sec = (n: number) => `${String(Math.round(n * 10) / 10).replace('.', ',')}s`;
const BASE_VIDEO_AVOID = ['texto, letras ou números na cena', 'logotipos de terceiros', 'mãos ou dedos deformados', 'rostos distorcidos', 'objetos que mudam de forma', 'cortes bruscos', 'imagem tremida', "marca-d'água"];

/** Padrões de qualidade (fixos) que completam o roteiro curto até 250 palavras. */
const QUALITY_PAD = [
  'Qualidade de comercial de cinema: imagem nítida em alta resolução, foco preciso no assunto principal, cores fiéis e contraste natural, sem granulação exagerada.',
  'Movimentos de câmera suaves e estáveis, sem tremores nem saltos; cada tomada termina com o assunto bem enquadrado para o corte seguinte.',
  'Física realista: líquidos, vapor, fumaça, tecidos e cabelos se movem de forma natural, e os objetos mantêm forma, cor e tamanho do começo ao fim.',
  'A mesma luz, a mesma paleta e o mesmo ambiente em todas as tomadas, para que o vídeo pareça gravado de uma vez só.',
  'Terço superior e terço inferior do quadro vertical livres de elementos importantes: ali entram depois a interface do Instagram, o título e a chamada.',
  'Composição limpa, sem poluição visual: poucos objetos de apoio, fundo coerente com a marca e o produto sempre como protagonista da cena.',
  'Gestos e expressões naturais e espontâneos, como numa gravação real; ninguém encara a câmera sem motivo e não há movimentos robóticos.',
  'Ritmo pensado para quem rola o feed: algo interessante acontece já no primeiro segundo e o último quadro é claro, estável e convidativo.',
  'Profundidade de campo de lente real: assunto em foco, fundo levemente desfocado, sem aparência de colagem nem de imagem gerada por computador.',
  'Nada de transformações estranhas: o produto não muda de formato, de rótulo nem de cor durante o vídeo, e não surgem objetos do nada.',
];

function audioLine(d: VideoDirection, a: VideoAudio, cap: number): string {
  if (a.modo === 'sem_audio') return 'Áudio: nenhum (vídeo sem som).';
  const instr = a.instrucoes ? ` Orientação do cliente para o áudio: ${clip(a.instrucoes, Math.min(cap, MAX_AUDIO_INSTRUCTIONS))}.` : '';
  const desc = d.audio.descricao ? ` (${clip(d.audio.descricao, cap)})` : '';
  if (a.modo === 'narracao') {
    const fala = d.audio.fala ? `A voz diz: "${d.audio.fala}"` : 'A voz diz uma frase curta de convite.';
    return `Áudio: narração em português do Brasil, voz natural e próxima, sobre o som ambiente da cena${desc}. ${fala}${instr}`;
  }
  return `Áudio: som ambiente da cena e trilha instrumental leve no tom da marca${desc}; sem vozes, sem fala e sem canto.${instr}`;
}

function render(d: VideoDirection, o: AssembleOpts, cap: number): string {
  const c = (t: string) => clip(t, cap);
  const lines: string[] = [`Vídeo vertical 9:16 de ${VIDEO_SECONDS} segundos para Instagram, filmagem realista com aparência de comercial profissional.`];
  if (o.hasFirstFrame) lines.push('Comece exatamente a partir da imagem de referência enviada (primeiro quadro) e mantenha o produto idêntico a ela: mesma forma, cor, rótulo e embalagem.');
  lines.push(`Gancho (0–2s): ${c(d.gancho_visual)}.`);
  if (d.sujeito) lines.push(`Sujeito: ${c(d.sujeito)}.`);
  if (d.cenario) lines.push(`Cenário: ${c(d.cenario)}.`);
  lines.push('Roteiro por tomada:');
  for (const t of d.tomadas) {
    const parts = [t.enquadramento && `${c(t.enquadramento)};`, `${c(t.acao)};`, t.movimento_camera && `câmera: ${c(t.movimento_camera)};`, t.lente && `lente ${c(t.lente)}`].filter(Boolean).join(' ');
    lines.push(`[${sec(t.inicio_s)}–${sec(t.fim_s)}] ${parts.replace(/;$/, '')}.`);
  }
  const look = [d.iluminacao && `Luz: ${c(d.iluminacao)}.`, d.paleta_hex.length ? `Paleta: ${d.paleta_hex.join(', ')}.` : '', d.estilo && `Estilo: ${c(d.estilo)}.`, d.ritmo && `Ritmo: ${c(d.ritmo)}.`]
    .filter(Boolean)
    .join(' ');
  if (look) lines.push(look);
  if (d.cta_visual) lines.push(`Último segundo: ${c(d.cta_visual)}.`);
  lines.push(audioLine(d, o.audio, cap));
  lines.push('Sem texto, letras, números, legendas ou logotipos gerados na cena. Pessoas com anatomia natural e movimentos fisicamente plausíveis.');
  const avoid = [...new Set([...d.evitar, ...(o.extraAvoid ?? []), ...BASE_VIDEO_AVOID].map((x) => clip(String(x).trim(), Math.min(cap, 60))).filter(Boolean))].slice(0, 10);
  lines.push(`Evite: ${avoid.join('; ')}.`);
  return lines.join('\n');
}

function pad(text: string): string {
  let out = text;
  for (const p of QUALITY_PAD) {
    if (words(out) >= VIDEO_PROMPT_MIN_WORDS) break;
    const next = `${out}\n${p}`;
    if (words(next) > VIDEO_PROMPT_MAX_WORDS || next.length > VIDEO_PROMPT_MAX_CHARS) break;
    out = next;
  }
  return out;
}

function clipWords(t: string, max: number): string {
  let n = 0;
  let out = '';
  for (const tok of t.split(/(\s+)/)) {
    if (!tok) continue;
    if (/^\s+$/.test(tok)) {
      out += tok;
      continue;
    }
    if (++n > max) break;
    out += tok;
  }
  return out.trim();
}

/** Texto final para o modelo de vídeo: determinístico, 250–450 palavras, ≤ 3000 caracteres (corta descrições antes de cortar seções). */
export function assembleVideoPrompt(d: VideoDirection, o: AssembleOpts): string {
  for (const cap of [400, 260, 180, 120, 80]) {
    const text = render(d, o, cap);
    if (words(text) <= VIDEO_PROMPT_MAX_WORDS && text.length <= VIDEO_PROMPT_MAX_CHARS) return pad(text);
  }
  // Último recurso (campos absurdamente longos): corta por palavras e por caracteres.
  return clipWords(render(d, o, 60), VIDEO_PROMPT_MAX_WORDS).slice(0, VIDEO_PROMPT_MAX_CHARS);
}

/** Roteiro completo: IA (JSON estruturado) → normalização → texto final. */
export async function directVideo(ai: AiService, b: VideoBrief): Promise<{ direction: VideoDirection; prompt: string }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json = await ai.json<any>(b.workspaceId, { prompt: videoDirectorPrompt(b), schema: VIDEO_SCHEMA, name: 'video_direction' });
  const hasShots = Array.isArray(json?.tomadas) && json.tomadas.some((t: { acao?: unknown }) => cleanFree(t?.acao, 400));
  if (!cleanFree(json?.sujeito, 400) && !cleanFree(json?.gancho_visual, 400) && !hasShots) throw new UserError('O diretor de vídeo não devolveu o roteiro.');
  const direction = normalizeDirection(json, b.audio, brandPalette(b.brand));
  const vs = (b.brand?.visual_style ?? {}) as VisualStyle;
  const extraAvoid = [...listField(vs.elementos_proibidos), ...contextProhibitions(b.context)];
  return { direction, prompt: assembleVideoPrompt(direction, { audio: b.audio, hasFirstFrame: b.hasFirstFrame, extraAvoid }) };
}

/** Descrição parada (capa do vídeo): sujeito, cenário, luz, estilo e paleta — sem marcas de tempo. */
export function stillPrompt(d: VideoDirection): string {
  return [d.sujeito, d.cenario, d.iluminacao && `Luz: ${d.iluminacao}`, d.estilo && `Estilo: ${d.estilo}`, d.paleta_hex.length ? `Paleta: ${d.paleta_hex.join(', ')}` : '']
    .filter(Boolean)
    .join('. ');
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd api && ../scripts/run-capped.sh 1500 npm test -- src/modules/creative/__tests__/video-director.spec.ts`
Expected: PASS. Se o teste do "roteiro mínimo" ficar abaixo de 250 palavras, acrescente frases em `QUALITY_PAD` (nunca baixe o mínimo).

Run: `cd api && ../scripts/run-capped.sh 1500 npm run typecheck`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
git add api/src/modules/creative/video-director.ts api/src/modules/creative/__tests__/video-director.spec.ts
git commit -m "feat(criativos): diretor de vídeo com roteiro estruturado por tomada e montador determinístico em pt-BR

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: C5/C6 (peças) — `VideoQualityService` (crítico com 3 quadros) e `VideoConformService` (conversão + reingestão)

**Files:**
- Create: `api/src/modules/creative/video-quality.service.ts`
- Create: `api/src/modules/media/video-conform.service.ts`
- Modify: `api/src/modules/media/media.module.ts` (provider + export de `VideoConformService`)
- Modify: `api/src/modules/creative/creative.module.ts` (provider + export de `VideoQualityService`)
- Test: `api/src/modules/creative/__tests__/video-quality.spec.ts` (novo), `api/src/modules/media/__tests__/video-conform.spec.ts` (novo)

**Interfaces:**
- Consumes: `FfmpegService.extractFrames`, `FfmpegService.conformForInstagram` (Task 1); `ImageService.shrink(bytes, max)`; `AiService.vision(ws, { prompt, schema, name, images })`; `AssetsService.readBytes(asset)`, `AssetsService.ingest(input)`; `Env.MIN_VIDEO_SCORE`.
- Produces:
  - `video-quality.service.ts`: `type VideoScore = { roteiro: number; marca: number; tecnica: number; produto: number; scroll: number; total: number; motivo: string }`; `VIDEO_CRITIC_SCHEMA`; `VIDEO_FRAME_POINTS = [0.15, 0.5, 0.85]`; `videoCriticPrompt(o: { script: string; subject: string; palette: string[] }): string`; `VideoQualityService.minScore: number`; `VideoQualityService.score(workspaceId: string, video: Uint8Array, o: { durationSec: number; script: string; subject: string; palette: string[] }): Promise<VideoScore>`.
  - `video-conform.service.ts`: `VideoConformService.ensureIgReady(asset: MediaAsset, meta: { workspaceId: string; brandId: string | null; igPostId: string | null; title: string; provider: string }, opts: { silent: boolean }): Promise<MediaAsset>` (lança `UserError` se continuar fora do padrão).

- [ ] **Step 1: Escrever os testes que falham**

Crie `api/src/modules/creative/__tests__/video-quality.spec.ts`:

```ts
jest.setTimeout(60_000);

import { ImageService } from '../../media/image.service';
import { VIDEO_CRITIC_SCHEMA, videoCriticPrompt, VideoQualityService } from '../video-quality.service';

describe('VideoQualityService (crítico de vídeo, C5)', () => {
  const images = new ImageService();

  it('3 quadros (15/50/85 %) → 768 px → crítico com 5 critérios 0–10 (total 50), arredondados e limitados; MIN_VIDEO_SCORE do ambiente', async () => {
    const frame = new Uint8Array(await images.encode(images.blank(1080, 1920, 0x336699ff), false));
    const ffmpeg = { extractFrames: jest.fn(async () => [frame, frame, frame]) };
    const ai = { vision: jest.fn(async () => ({ roteiro: 8.4, marca: 11, tecnica: -2, produto: '7', scroll: 'x', motivo: 'm'.repeat(400) })) };
    const svc = new VideoQualityService(ai as any, images, ffmpeg as any, { MIN_VIDEO_SCORE: 30 } as any);
    const s = await svc.score('ws', new Uint8Array([1]), { durationSec: 8, script: 'Roteiro por tomada: …', subject: 'chope', palette: ['#c0392b'] });
    expect(s).toMatchObject({ roteiro: 8, marca: 10, tecnica: 0, produto: 7, scroll: 0, total: 25 });
    expect(s.motivo).toHaveLength(240);
    expect(ffmpeg.extractFrames).toHaveBeenCalledWith(expect.any(Uint8Array), 8, [0.15, 0.5, 0.85]);
    const req = (ai.vision.mock.calls[0] as any)[1];
    expect(req).toMatchObject({ name: 'video_score', schema: VIDEO_CRITIC_SCHEMA });
    expect(req.images).toHaveLength(3);
    const f0 = await images.read(req.images[0].bytes);
    expect(Math.max(f0.bitmap.width, f0.bitmap.height)).toBe(768);
    expect(svc.minScore).toBe(30);
  });

  it('o prompt avalia aderência ao roteiro/gancho, marca/paleta, defeitos técnicos (inclusive texto gerado), produto e apelo de scroll', () => {
    const p = videoCriticPrompt({ script: 'ROTEIRO', subject: 'chope', palette: ['#c0392b'] });
    for (const t of ['quadros do MESMO vídeo vertical, em ordem (15 %, 50 % e 85 % da duração)', 'Roteiro pedido: ROTEIRO', 'roteiro =', 'marca =', 'tecnica =', 'texto gerado ilegível', 'produto =', 'scroll =', 'motivo =']) {
      expect(p).toContain(t);
    }
  });
});
```

Crie `api/src/modules/media/__tests__/video-conform.spec.ts`:

```ts
import { mediaWorld, sampleMp4, WS_A } from './mem';
import { VideoConformService } from '../video-conform.service';

describe('VideoConformService (C6: conversão para o padrão do Instagram)', () => {
  const meta = { workspaceId: WS_A, brandId: null, igPostId: null, title: 'Reels', provider: 'gemini' };

  it('vídeo fora do padrão (640 px) é convertido, reingerido como filho do original e revalidado', async () => {
    const w = mediaWorld();
    try {
      const bad = await w.assets.ingest({ workspaceId: WS_A, kind: 'video', targetFormat: 'ig_reel', source: 'gemini', bytes: sampleMp4({ width: 640, height: 1136 }), title: 'Reels' });
      expect(bad.ig_ready).toBe(false);
      const ffmpeg = { conformForInstagram: jest.fn(async () => new Uint8Array(sampleMp4())) };
      const ok = await new VideoConformService(w.assets, ffmpeg as any).ensureIgReady(bad, meta, { silent: false });
      expect(ok).toMatchObject({ ig_ready: true, parent_id: bad.id, width: 1080, height: 1920, kind: 'video' });
      expect(ffmpeg.conformForInstagram).toHaveBeenCalledWith(expect.any(Uint8Array), { silent: false });
    } finally {
      w.cleanup();
    }
  });

  it('já no padrão: não converte; modo "sem áudio" com trilha de som: converte com silêncio', async () => {
    const w = mediaWorld();
    try {
      const good = await w.assets.ingest({ workspaceId: WS_A, kind: 'video', targetFormat: 'ig_reel', source: 'gemini', bytes: sampleMp4(), title: 'Reels' });
      const ffmpeg = { conformForInstagram: jest.fn(async () => new Uint8Array(sampleMp4({ audio: 'mp4a' }))) };
      const svc = new VideoConformService(w.assets, ffmpeg as any);
      expect(await svc.ensureIgReady(good, meta, { silent: false })).toBe(good);
      expect(ffmpeg.conformForInstagram).not.toHaveBeenCalled();
      const silent = await svc.ensureIgReady(good, meta, { silent: true });
      expect(ffmpeg.conformForInstagram).toHaveBeenCalledWith(expect.any(Uint8Array), { silent: true });
      expect(silent.parent_id).toBe(good.id);
    } finally {
      w.cleanup();
    }
  });

  it('continua fora do padrão depois da conversão: erro claro (o post vira failed com failure_kind "media")', async () => {
    const w = mediaWorld();
    try {
      const bad = await w.assets.ingest({ workspaceId: WS_A, kind: 'video', targetFormat: 'ig_reel', source: 'gemini', bytes: sampleMp4({ width: 640, height: 1136 }), title: 'Reels' });
      const ffmpeg = { conformForInstagram: jest.fn(async () => new Uint8Array(sampleMp4({ width: 640, height: 1136 }))) };
      await expect(new VideoConformService(w.assets, ffmpeg as any).ensureIgReady(bad, meta, { silent: false })).rejects.toThrow(/^Vídeo fora do padrão do Instagram mesmo depois da conversão: Largura de 640px; o mínimo é 720px\./);
    } finally {
      w.cleanup();
    }
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd api && ../scripts/run-capped.sh 1500 npm test -- src/modules/creative/__tests__/video-quality.spec.ts src/modules/media/__tests__/video-conform.spec.ts`
Expected: FAIL — módulos inexistentes.

- [ ] **Step 3: `VideoQualityService`**

Crie `api/src/modules/creative/video-quality.service.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { ENV } from '../../common/config/env.module';
import { Env } from '../../common/config/env.validation';
import { AiService } from '../ai/ai.service';
import { FfmpegService } from '../media/ffmpeg.service';
import { ImageService } from '../media/image.service';

export type VideoScore = { roteiro: number; marca: number; tecnica: number; produto: number; scroll: number; total: number; motivo: string };

const n = { type: 'number' };
export const VIDEO_CRITIC_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['roteiro', 'marca', 'tecnica', 'produto', 'scroll', 'motivo'],
  properties: { roteiro: n, marca: n, tecnica: n, produto: n, scroll: n, motivo: { type: 'string' } },
};
/** Quadros avaliados: 15 %, 50 % e 85 % da duração. */
export const VIDEO_FRAME_POINTS = [0.15, 0.5, 0.85];

const clamp = (v: unknown) => Math.max(0, Math.min(10, Math.round(Number(v) || 0)));
const clip = (t: string, max: number) => (t.length <= max ? t : `${t.slice(0, max)}…`);

export function videoCriticPrompt(o: { script: string; subject: string; palette: string[] }): string {
  return [
    'Você é um crítico de vídeos publicitários para Instagram. As 3 imagens são quadros do MESMO vídeo vertical, em ordem (15 %, 50 % e 85 % da duração).',
    `Roteiro pedido: ${clip(o.script, 1500)}`,
    `Assunto/produto esperado: ${o.subject}. Paleta da marca: ${o.palette.join(', ') || 'livre'}.`,
    'Dê notas de 0 a 10:',
    'roteiro = aderência ao roteiro e ao gancho (o que aparece bate com as tomadas pedidas);',
    'marca = fidelidade à marca e à paleta (cores, estilo, ambiente);',
    'tecnica = qualidade técnica (10 = sem defeitos; deformações, mãos ou rostos errados, artefatos, objetos derretendo e texto gerado ilegível reduzem muito);',
    'produto = clareza do produto (reconhecível, protagonista, apetitoso/atraente);',
    'scroll = apelo para parar o scroll no feed (o primeiro quadro prende o olhar?).',
    'motivo = 1 frase em português com o principal problema a corrigir (ou o ponto forte, se estiver ótimo).',
  ].join('\n');
}

/** Nota de qualidade do vídeo (0–50): 3 quadros pelo ffmpeg → JPEG 768 px → crítico de visão (via `AiService`). */
@Injectable()
export class VideoQualityService {
  readonly minScore: number;

  constructor(
    private readonly ai: AiService,
    private readonly images: ImageService,
    private readonly ffmpeg: FfmpegService,
    @Inject(ENV) env: Pick<Env, 'MIN_VIDEO_SCORE'>,
  ) {
    this.minScore = env.MIN_VIDEO_SCORE;
  }

  async score(workspaceId: string, video: Uint8Array, o: { durationSec: number; script: string; subject: string; palette: string[] }): Promise<VideoScore> {
    const raw = await this.ffmpeg.extractFrames(video, o.durationSec, VIDEO_FRAME_POINTS);
    const frames = await Promise.all(raw.map((f) => this.images.shrink(f, 768)));
    const r = await this.ai.vision<Record<string, unknown>>(workspaceId, { prompt: videoCriticPrompt(o), schema: VIDEO_CRITIC_SCHEMA, name: 'video_score', images: frames });
    const s = { roteiro: clamp(r.roteiro), marca: clamp(r.marca), tecnica: clamp(r.tecnica), produto: clamp(r.produto), scroll: clamp(r.scroll), motivo: String(r.motivo ?? '').slice(0, 240) };
    return { ...s, total: s.roteiro + s.marca + s.tecnica + s.produto + s.scroll };
  }
}
```

- [ ] **Step 4: `VideoConformService`**

Crie `api/src/modules/media/video-conform.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { AssetsService, MediaAsset } from './assets.service';
import { FfmpegService } from './ffmpeg.service';
import { TargetFormat } from './formats';
import { UserError } from './user-error';

/**
 * C6: vídeo fora do padrão do Instagram (ou com som quando o modo pede "sem áudio") é convertido pelo ffmpeg, reingerido na biblioteca
 * como filho do original e revalidado (`video-meta`). Se continuar fora do padrão, lança `UserError` com os problemas.
 */
@Injectable()
export class VideoConformService {
  constructor(
    private readonly assets: AssetsService,
    private readonly ffmpeg: FfmpegService,
  ) {}

  async ensureIgReady(
    asset: MediaAsset,
    meta: { workspaceId: string; brandId: string | null; igPostId: string | null; title: string; provider: string },
    opts: { silent: boolean },
  ): Promise<MediaAsset> {
    const checks = ((asset.quality_report as { checks?: { audioCodec?: string | null } } | null)?.checks ?? {}) as { audioCodec?: string | null };
    if (asset.ig_ready && !(opts.silent && checks.audioCodec)) return asset;
    const { bytes } = await this.assets.readBytes(asset);
    const converted = await this.ffmpeg.conformForInstagram(bytes, { silent: opts.silent });
    const next = await this.assets.ingest({
      workspaceId: meta.workspaceId, kind: 'video', targetFormat: asset.target_format as TargetFormat, source: asset.source, bytes: converted, mime: 'video/mp4',
      title: meta.title, prompt: asset.prompt, provider: meta.provider, cost: 0, brandId: meta.brandId, igPostId: meta.igPostId, parentId: asset.id,
    });
    if (!next.ig_ready) {
      const issues = ((next.quality_report as { issues?: string[] } | null)?.issues ?? []).join(' ');
      throw new UserError(`Vídeo fora do padrão do Instagram mesmo depois da conversão: ${issues || 'validação falhou.'}`);
    }
    return next;
  }
}
```

- [ ] **Step 5: Módulos**

Em `api/src/modules/media/media.module.ts`, acrescente `import { VideoConformService } from './video-conform.service';`, `VideoConformService,` em `providers` e em `exports`.

Em `api/src/modules/creative/creative.module.ts`, acrescente `import { VideoQualityService } from './video-quality.service';`, `VideoQualityService` em `providers` e em `exports`.

- [ ] **Step 6: Rodar e ver passar**

Run: `cd api && ../scripts/run-capped.sh 1500 npm test -- src/modules/creative/__tests__/video-quality.spec.ts src/modules/media/__tests__/video-conform.spec.ts`
Expected: PASS.

Run: `cd api && ../scripts/run-capped.sh 1500 npm run typecheck`
Expected: sem erros.

- [ ] **Step 7: Commit**

```bash
git add api/src/modules/creative/video-quality.service.ts api/src/modules/media/video-conform.service.ts api/src/modules/media/media.module.ts api/src/modules/creative/creative.module.ts api/src/modules/creative/__tests__/video-quality.spec.ts api/src/modules/media/__tests__/video-conform.spec.ts
git commit -m "feat(criativos): crítico de vídeo com 3 quadros e conversão para o padrão do Instagram pelo ffmpeg

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: C2–C6 na geração — caminho de vídeo (roteiro, primeiro quadro, áudio, nota + 1 refação, conversão, capa com duração real) e áudio da programação

**Files:**
- Modify: `api/src/modules/media/image.service.ts` (novo `dominantColor` + `ImageService.padToAspect`)
- Modify: `api/src/modules/instagram/media-generation.service.ts` — imports, constantes/tipos, construtor, `ingestAsset`/`mediaItem`/`libraryItem`, `videoCover`, novos `audioFor`/`startVideo`/`finishVideo`/`scoreVideo`/`completeVideo`, `generatePostAssets` (desvio do vídeo), `pollPendingMedia`, `uploadOwnMedia`
- Modify: `api/src/modules/instagram/instagram.dto.ts` (`VideoAudioDto`, `CreateAutoCalendarDto.videoAudio`)
- Modify: `api/src/modules/instagram/auto-calendar.service.ts:66-74` (`CreateAutoInput.videoAudio`) e `:149-166` (`createAutoRun`)
- Modify: `api/src/modules/instagram/instagram-actions.service.ts:155-158`
- Modify: `api/src/modules/instagram/__tests__/harness.ts` (`VIDEO_DIR`, `ai.json`, `assets.readBytes`, `images.padToAspect`, fakes de `quality`/`conform`)
- Modify: `docs/api-contract.md:446`, `:455`, `:456`
- Test: `api/src/modules/media/__tests__/pad-to-aspect.spec.ts` (novo); `api/src/modules/instagram/__tests__/media-generation.spec.ts` e `auto-calendar.spec.ts` (acrescentar)

**Interfaces:**
- Consumes: `directVideo`, `resolveAudio`, `stillPrompt`, `VIDEO_PROMPT_MAX_CHARS`, `VIDEO_SECONDS`, `VideoAudio`, `VideoDirection`, `AUDIO_MODES` (Task 9); `VideoQualityService.score/minScore`, `VideoScore` (Task 10); `VideoConformService.ensureIgReady` (Task 10); `firstFrameRef` (Task 6); `PostContextService.build` (Task 6); `GenerationRequest.audio` (Task 8); `VIDEO_WAIT_MS` (Task 5); `failure_kind` (Task 4).
- Produces:
  - `dominantColor(img: Img): [number, number, number]` e `ImageService.padToAspect(bytes: Uint8Array, width: number, height: number): Promise<{ bytes: Uint8Array; mime: string }>`.
  - `MediaGenerationService` com construtor `(store, ai, providers, refs, pipeline, extras, assets, content, publishing, images, postContext, quality: VideoQualityService, conform: VideoConformService)`.
  - `creative_brief.video_direction = { direction: VideoDirection | null; prompt: string; audio: VideoAudio; first_frame_ref: string | null; scores: { attempt, total, motivo, error? }[]; winner_attempt: number }`; `creative_brief.pending_job.video = { attempt: 1 | 2; best: { item, score, attempt, prompt, direction } | null; scores }`; `creative_brief.audio` (override do post) lido por `resolveAudio(run.video_audio, brief.audio)`.
  - Evento `video_regenerated` (`warn`): `"Vídeo refeito: nota N/50, abaixo de 28 (motivo)."`.
  - `POST /v1/instagram/create-auto-calendar` aceita `videoAudio?: { modo: 'ambiente_trilha'|'narracao'|'sem_audio'; instrucoes?(≤500) }` → `ig_auto_runs.video_audio`.
  - Harness: `export const VIDEO_DIR`; `igServices(w).quality`, `.conform`.

- [ ] **Step 1: Escrever os testes que falham**

Crie `api/src/modules/media/__tests__/pad-to-aspect.spec.ts`:

```ts
jest.setTimeout(60_000);

import { dominantColor, ImageService } from '../image.service';

describe('ImageService.padToAspect (primeiro quadro do vídeo em 9:16)', () => {
  const images = new ImageService();
  const rgb = (img: any, x: number, y: number) => {
    const c = img.getPixelColor(x, y) >>> 0;
    return [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255];
  };
  const near = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]!) < 40);

  it('encaixa a foto INTEIRA em 720×1280 sem distorcer; as sobras ficam na cor dominante', async () => {
    const img = images.blank(300, 100, 0x0000ffff); // azul (2/3)
    img.composite(images.blank(100, 100, 0xffffffff), 200, 0); // branco (1/3) à direita
    const out = await images.padToAspect(await images.encode(img, true), 720, 1280);
    expect(out.mime).toBe('image/jpeg');
    const r = await images.read(out.bytes);
    expect([r.bitmap.width, r.bitmap.height]).toEqual([720, 1280]);
    expect(near(rgb(r, 5, 5), [0, 0, 255])).toBe(true); // preenchimento = cor dominante (azul)
    expect(near(rgb(r, 5, 1275), [0, 0, 255])).toBe(true);
    // a foto escalada (720×240) fica centralizada na altura: faixa branca à direita, azul à esquerda
    expect(near(rgb(r, 700, 640), [255, 255, 255])).toBe(true);
    expect(near(rgb(r, 100, 640), [0, 0, 255])).toBe(true);
  });

  it('cor dominante é a mais frequente (não a média)', () => {
    const img = images.blank(100, 100, 0xff0000ff);
    img.composite(images.blank(40, 100, 0x00ff00ff), 60, 0);
    expect(dominantColor(img)).toEqual([255, 0, 0]);
  });
});
```

Acrescente ao fim de `api/src/modules/instagram/__tests__/media-generation.spec.ts` (e acrescente `import { UserError } from '../../media/user-error';` no topo):

```ts
describe('vídeo (Reels/Story): roteiro detalhado, primeiro quadro, áudio, nota de qualidade e conversão', () => {
  const reel = (w: IgWorld, over: Record<string, unknown> = {}) => idea(w, { format: 'reel', hook: 'Gancho', theme: 'Happy hour', cta: 'Reserve', creative_brief: { prompt: 'chope sendo servido' }, ...over });
  const words = (t: string) => t.split(/\s+/).filter(Boolean).length;
  const videoAssets = (w: IgWorld) => w.t['media_assets']!.rows.filter((x) => x.kind === 'video');
  const score = (total: number, motivo = 'm') => ({ roteiro: 0, marca: 0, tecnica: 0, produto: 0, scroll: 0, total, motivo });
  const dirPrompts = (s: any) => s.ai.json.mock.calls.filter((c: any) => c[1].name === 'video_direction').map((c: any) => c[1].prompt as string);

  it('roteiro estruturado → texto final pt-BR (250–450 palavras) enviado ao provedor; tomadas, áudio, nota e capa no post', async () => {
    const { w, s, gen } = setup();
    const post = reel(w);
    expect(await gen.generatePostAssets(WS_A, post.id)).toEqual({ ok: true, items: 1, provider: 'gemini' });
    expect(dirPrompts(s)[0]).toContain('cobrindo de 0 a 8 s SEM buracos');
    const req = s.provider.generateVideo.mock.calls[0][0];
    expect(req).toMatchObject({ aspectRatio: '9:16', kind: 'video', maxWaitMs: 25_000, audio: true });
    expect(req.referenceImages).toBeUndefined();
    expect(req.finalPrompt).toContain('Roteiro por tomada:');
    expect(words(req.finalPrompt)).toBeGreaterThanOrEqual(250);
    expect(words(req.finalPrompt)).toBeLessThanOrEqual(450);
    const vd = post.creative_brief.video_direction;
    expect(vd).toMatchObject({ prompt: req.finalPrompt, audio: { modo: 'ambiente_trilha', instrucoes: '' }, first_frame_ref: null, scores: [{ attempt: 1, total: 40, motivo: 'bom' }], winner_attempt: 1 });
    expect(vd.direction.tomadas[0].inicio_s).toBe(0);
    expect(vd.direction.tomadas.at(-1).fim_s).toBe(8);
    expect(post.creative_brief.visual_prompt).toBe(req.finalPrompt);
    expect(post.media[0]).toMatchObject({ type: 'video', duration: 8, ig_ready: true, cover_url: 'https://cdn.test/cover.jpg' });
    expect(post.ai_generation_log.at(-1)).toMatchObject({ step: 'media', items: 1, video_scores: [{ attempt: 1, total: 40 }], regenerated: false, winner_attempt: 1 });
    expect(s.extras.build.mock.calls[0][0]).toMatchObject({
      visualPrompt: 'copo de chope gelado com colarinho cremoso. balcão de madeira de um bar aconchegante. Luz: luz quente de fim de tarde. Estilo: comercial realista. Paleta: #c0392b, #f5deb3',
      durationSec: 8,
    });
    expect(s.conform.ensureIgReady.mock.calls[0][2]).toEqual({ silent: false });
  });

  it('primeiro quadro: a foto do produto do post, encaixada em 9:16, vai como referência; o roteiro sabe que começa da foto', async () => {
    const { w, s, gen } = setup();
    const brand = { id: uuid(), workspace_id: WS_A, name: 'Zé', visual_style: {} };
    w.t['brands']!.rows.push(brand);
    const p = plan(w, { brand_id: brand.id });
    const prod = { id: uuid(), workspace_id: WS_A, brand_id: brand.id, name: 'Chope Pilsen', description: null, price: null };
    w.t['products']!.rows.push(prod);
    const photo = new Uint8Array([9, 9]);
    s.refs.loadBrandRefs.mockResolvedValueOnce([
      { id: 'amb', tag: 'ambiente', name: 'bar.jpg', url: 'https://cdn.test/bar.jpg', bytes: new Uint8Array([1]), mime: 'image/jpeg' },
      { id: 'prod', tag: 'produto', name: 'chope-pilsen.png', url: 'https://cdn.test/chope.png', bytes: photo, mime: 'image/jpeg' },
    ]);
    const post = reel(w, { plan_id: p.id, product_id: prod.id });
    await gen.generatePostAssets(WS_A, post.id);
    expect(s.images.padToAspect).toHaveBeenCalledWith(photo, 720, 1280);
    const req = s.provider.generateVideo.mock.calls[0][0];
    expect(req.referenceImages).toEqual([{ bytes: photo, mime: 'image/jpeg' }]);
    expect(req.referenceUrls).toEqual(['https://cdn.test/chope.png']);
    expect(post.creative_brief.video_direction.first_frame_ref).toBe('prod');
    expect(dirPrompts(s)[0]).toContain('O vídeo COMEÇA a partir da foto real enviada');
    expect(req.finalPrompt).toContain('Comece exatamente a partir da imagem de referência enviada');
  });

  it('áudio: o do post sobrepõe o da execução; "sem áudio" desliga o áudio no provedor e pede conversão silenciosa; valor inválido no post cai no da execução', async () => {
    const { w, s, gen } = setup();
    const p = plan(w);
    const r = { id: uuid(), workspace_id: WS_A, plan_id: p.id, video_audio: { modo: 'narracao', instrucoes: 'voz calma' } };
    w.t['ig_auto_runs']!.rows.push(r);
    const mute = reel(w, { plan_id: p.id, run_id: r.id, creative_brief: { prompt: 'x', audio: { modo: 'sem_audio' } } });
    await gen.generatePostAssets(WS_A, mute.id);
    expect(s.provider.generateVideo.mock.calls[0][0].audio).toBe(false);
    expect(s.conform.ensureIgReady.mock.calls[0][2]).toEqual({ silent: true });
    expect(dirPrompts(s)[0]).toContain('ÁUDIO (modo "sem_audio")');
    const bogus = reel(w, { plan_id: p.id, run_id: r.id, creative_brief: { prompt: 'x', audio: { modo: 'karaoke', instrucoes: 'y'.repeat(5000) } } });
    await gen.generatePostAssets(WS_A, bogus.id);
    expect(s.provider.generateVideo.mock.calls[1][0].audio).toBe(true);
    expect(bogus.creative_brief.video_direction.audio).toEqual({ modo: 'narracao', instrucoes: 'voz calma' });
  });

  it('nota abaixo de 28: refaz 1 vez com o motivo do crítico no roteiro; fica o de maior nota; evento video_regenerated', async () => {
    const { w, s, gen } = setup();
    s.quality.score.mockResolvedValueOnce(score(20, 'O produto quase não aparece')).mockResolvedValueOnce(score(42, 'ótimo'));
    const post = reel(w);
    await gen.generatePostAssets(WS_A, post.id);
    expect(s.provider.generateVideo).toHaveBeenCalledTimes(2);
    const dirs = dirPrompts(s);
    expect(dirs).toHaveLength(2);
    expect(dirs[1]).toContain('O CRÍTICO REPROVOU O VÍDEO ANTERIOR (corrija isto com prioridade): «O produto quase não aparece»');
    expect(dirs[1]).toContain('ROTEIRO ANTERIOR (refaça melhorando):');
    const [, second] = videoAssets(w);
    expect(post.media[0].asset_id).toBe(second!.id);
    expect(post.creative_brief.video_direction).toMatchObject({ scores: [{ attempt: 1, total: 20 }, { attempt: 2, total: 42 }], winner_attempt: 2 });
    expect(w.t['ig_autopilot_events']!.rows.find((e) => e.kind === 'video_regenerated')).toMatchObject({ level: 'warn', message: 'Vídeo refeito: nota 20/50, abaixo de 28 (O produto quase não aparece).' });
    expect(post.ai_generation_log.at(-1)).toMatchObject({ regenerated: true, winner_attempt: 2 });
  });

  it('a refação saiu pior: fica o primeiro vídeo (e o roteiro dele)', async () => {
    const { w, s, gen } = setup();
    s.quality.score.mockResolvedValueOnce(score(25)).mockResolvedValueOnce(score(10));
    const post = reel(w);
    await gen.generatePostAssets(WS_A, post.id);
    const [first] = videoAssets(w);
    expect(post.media[0].asset_id).toBe(first!.id);
    expect(post.creative_brief.video_direction.winner_attempt).toBe(1);
    expect(post.creative_brief.video_direction.prompt).toBe(s.provider.generateVideo.mock.calls[0][0].finalPrompt);
  });

  it('Review Focus #4 — crítico fora do ar: segue com o vídeo e registra; refação que falha: fica o primeiro (nunca failed)', async () => {
    const { w, s, gen } = setup();
    s.quality.score.mockRejectedValueOnce(new Error('visão indisponível'));
    const a = reel(w);
    expect(await gen.generatePostAssets(WS_A, a.id)).toMatchObject({ ok: true, items: 1 });
    expect(a.status).toBe('pending_approval');
    expect(a.creative_brief.video_direction.scores).toEqual([{ attempt: 1, total: null, motivo: null, error: 'crítico indisponível: visão indisponível' }]);
    expect(s.provider.generateVideo).toHaveBeenCalledTimes(1);
    s.quality.score.mockResolvedValueOnce(score(12, 'deformado'));
    s.provider.generateVideo
      .mockResolvedValueOnce({ status: 'ready', assetUrl: 'https://provider.test/v.mp4', thumbnailUrl: null, externalJobId: null, cost: 6 })
      .mockRejectedValueOnce(new Error('Veo fora do ar'));
    const b = reel(w);
    expect(await gen.generatePostAssets(WS_A, b.id)).toMatchObject({ ok: true, items: 1 });
    expect(b.media).toHaveLength(1);
    expect(b.creative_brief.video_direction.scores).toEqual([{ attempt: 1, total: 12, motivo: 'deformado' }, { attempt: 2, total: null, motivo: null, error: 'Veo fora do ar' }]);
    expect(b.ai_generation_log.at(-1)).toMatchObject({ regen_error: 'Veo fora do ar', winner_attempt: 1 });
    expect(b.status).not.toBe('failed');
  });

  it('vídeo que continua fora do padrão depois da conversão: o post falha como mídia (failure_kind "media")', async () => {
    const { w, s, gen } = setup();
    s.conform.ensureIgReady.mockRejectedValueOnce(new UserError('Vídeo fora do padrão do Instagram mesmo depois da conversão: Largura de 640px; o mínimo é 720px.'));
    const post = reel(w);
    expect(await gen.generatePostAssets(WS_A, post.id)).toEqual({ ok: false, error: 'Vídeo fora do padrão do Instagram mesmo depois da conversão: Largura de 640px; o mínimo é 720px.' });
    expect(post).toMatchObject({ status: 'failed', failure_kind: 'media' });
  });

  it('assíncrono: pending_job guarda o estado do vídeo; o poller conclui com crítico, refação (também assíncrona) e capa', async () => {
    const { w, s, gen } = setup();
    const pend = (id: string) => ({ status: 'generating', assetUrl: null, thumbnailUrl: null, externalJobId: id, cost: 6 });
    const done = (id: string) => ({ status: 'ready', assetUrl: `https://provider.test/${id}.mp4`, thumbnailUrl: null, externalJobId: id, cost: 0 });
    s.provider.generateVideo.mockResolvedValueOnce(pend('veo:a1')).mockResolvedValueOnce(pend('veo:a2'));
    s.quality.score.mockResolvedValueOnce(score(15, 'gancho fraco')).mockResolvedValueOnce(score(38, 'bom'));
    const post = reel(w, { automation: 'publish' });
    expect(await gen.generatePostAssets(WS_A, post.id)).toEqual({ ok: true, items: 0, provider: 'gemini', pending: true });
    expect(post.creative_brief.pending_job).toMatchObject({ jobId: 'veo:a1', video: { attempt: 1, best: null, scores: [] } });
    s.provider.getGenerationStatus.mockResolvedValueOnce(done('veo:a1'));
    expect(await gen.pollPendingMedia()).toEqual([{ post: post.id, status: 'generating' }]); // 1º pronto, nota 15 → refação pendente
    expect(post.creative_brief.pending_job).toMatchObject({ jobId: 'veo:a2', video: { attempt: 2, best: { attempt: 1, score: 15 }, scores: [{ attempt: 1, total: 15 }] } });
    expect(post.status).toBe('generating');
    s.provider.getGenerationStatus.mockResolvedValueOnce(done('veo:a2'));
    expect(await gen.pollPendingMedia()).toEqual([{ post: post.id, status: 'ready' }]);
    expect(post.creative_brief.pending_job).toBeUndefined();
    expect(post.creative_brief.video_direction).toMatchObject({ winner_attempt: 2, scores: [{ attempt: 1, total: 15 }, { attempt: 2, total: 38 }] });
    expect(post.media[0]).toMatchObject({ type: 'video', cover_url: 'https://cdn.test/cover.jpg' });
    expect(post).toMatchObject({ status: 'ready', last_error: 'Conecte o Instagram para publicar.' });
  });

  it('Review Focus #4 — assíncrono: a refação falhou ou não terminou em 1 h — fica o primeiro vídeo', async () => {
    const { w, s, gen } = setup();
    const best = { item: { url: 'https://cdn.test/1.mp4', type: 'video', order: 0, asset_id: 'a1', duration: 8, ig_ready: true, issues: [] }, score: 20, attempt: 1, prompt: 'roteiro 1', direction: null };
    const mk = (age: number) =>
      idea(w, {
        format: 'reel', status: 'generating',
        creative_brief: {
          video_direction: { prompt: 'roteiro 2', direction: null, audio: { modo: 'ambiente_trilha', instrucoes: '' }, first_frame_ref: null },
          pending_job: { provider: 'gemini', jobId: `veo:r${age}`, index: 0, prompts: ['roteiro 2'], media: [], cost: 6, started_at: new Date(Date.now() - age).toISOString(), video: { attempt: 2, best, scores: [{ attempt: 1, total: 20, motivo: 'm' }] } },
        },
      });
    const failing = mk(1000);
    const stale = mk(61 * 60e3);
    s.provider.getGenerationStatus.mockImplementation(async (id: string) => ({ status: id === 'veo:r1000' ? 'failed' : 'generating', assetUrl: null, thumbnailUrl: null, externalJobId: id, cost: 0 }));
    expect(await gen.pollPendingMedia()).toEqual(expect.arrayContaining([{ post: failing.id, status: 'ready' }, { post: stale.id, status: 'ready' }]));
    for (const p of [failing, stale]) {
      expect(p.status).toBe('pending_approval');
      expect(p.media[0].asset_id).toBe('a1');
      expect(p.creative_brief.video_direction).toMatchObject({ winner_attempt: 1, prompt: 'roteiro 1' });
      expect(p.creative_brief.video_direction.scores[1]).toMatchObject({ attempt: 2, total: null });
      expect(p.creative_brief.pending_job).toBeUndefined();
    }
  });

  it('roteiro editado no editor (visual_prompt_override) vai direto ao provedor, sem o diretor; com ajuste, o diretor refaz com o pedido delimitado', async () => {
    const { w, s, gen } = setup();
    const post = reel(w, { creative_brief: { prompt: 'x', visual_prompt_override: 'MEU ROTEIRO: o chope é servido.' } });
    await gen.generatePostAssets(WS_A, post.id);
    expect(dirPrompts(s)).toHaveLength(0);
    expect(s.provider.generateVideo.mock.calls[0][0].finalPrompt).toBe('MEU ROTEIRO: o chope é servido.');
    await gen.generatePostAssets(WS_A, post.id, 'auto', 'mais close no copo');
    expect(dirPrompts(s)[0]).toContain('AJUSTE PEDIDO PELO CLIENTE (aplique com prioridade): «mais close no copo»');
  });

  it('capa e legendas usam a duração real do vídeo', async () => {
    const { w, s, gen } = setup();
    const base = s.assets.ingest.getMockImplementation()!;
    s.assets.ingest.mockImplementation(async (i: any) => ({ ...(await base(i)), ...(i.kind === 'video' ? { duration_seconds: 10 } : {}) }));
    const post = reel(w);
    await gen.generatePostAssets(WS_A, post.id);
    expect(s.extras.build.mock.calls[0][0].durationSec).toBe(10);
    expect(post.media[0].duration).toBe(10);
  });

  it('upload de vídeo fora do padrão é convertido; se a conversão falhar, fica o original com os avisos', async () => {
    const { w, s, a } = setup();
    const post = reel(w);
    const base = s.assets.ingest.getMockImplementation()!;
    s.assets.ingest.mockImplementationOnce(async (i: any) => ({ ...(await base(i)), ig_ready: false, quality_report: { issues: ['Largura de 640px; o mínimo é 720px.'] } }));
    s.conform.ensureIgReady.mockImplementationOnce(async (asset: any) => ({ ...asset, id: 'convertido', ig_ready: true, quality_report: { issues: [] } }));
    await a.uploadPostMedia(OWNER, WS_A, post.id, { filename: 'v.mp4', mimetype: 'video/mp4', bytes: Buffer.alloc(10, 1) });
    expect(post.media[0]).toMatchObject({ asset_id: 'convertido', ig_ready: true });
    expect(s.conform.ensureIgReady.mock.calls[0][2]).toEqual({ silent: false });
    s.assets.ingest.mockImplementationOnce(async (i: any) => ({ ...(await base(i)), ig_ready: false, quality_report: { issues: ['Codec mpeg4'] } }));
    s.conform.ensureIgReady.mockRejectedValueOnce(new Error('ffmpeg falhou (código 1)'));
    await a.uploadPostMedia(OWNER, WS_A, post.id, { filename: 'v2.mp4', mimetype: 'video/mp4', bytes: Buffer.alloc(10, 1) });
    expect(post.media[0]).toMatchObject({ ig_ready: false, issues: ['Codec mpeg4'] });
  });
});
```

No mesmo arquivo, no teste `'vídeo assíncrono: guarda pending_job (no post), mantém "generating"; o poller conclui'`, troque `expect(post.creative_brief.pending_job).toMatchObject({ provider: 'gemini', jobId: 'veo:abc', index: 0, cost: 0, media: [] });` por `expect(post.creative_brief.pending_job).toMatchObject({ provider: 'gemini', jobId: 'veo:abc', index: 0, cost: 0, media: [], video: { attempt: 1, best: null, scores: [] } });`.

Acrescente ao fim de `api/src/modules/instagram/__tests__/auto-calendar.spec.ts` (e acrescente `import { validate } from 'class-validator';`, `import { plainToInstance } from 'class-transformer';` e `import { CreateAutoCalendarDto } from '../instagram.dto';` no topo):

```ts
describe('C4 — áudio dos vídeos na programação', () => {
  it('createAutoCalendar grava video_audio (instruções limpas); sem o campo fica o padrão do banco', async () => {
    const { w, a } = setup();
    const p = plan(w);
    await a.createAutoCalendar(OWNER, input({ planId: p.id, mode: 'publish', videoAudio: { modo: 'narracao', instrucoes: '  voz\nfeminina calma  ' } }));
    expect(w.t['ig_auto_runs']!.rows[0].video_audio).toEqual({ modo: 'narracao', instrucoes: 'voz feminina calma' });
    await a.createAutoCalendar(OWNER, input({ planId: p.id }));
    expect(w.t['ig_auto_runs']!.rows[1].video_audio).toEqual({ modo: 'ambiente_trilha', instrucoes: '' });
  });

  it('Review Focus #5 — DTO: modo fora da lista, instruções > 500, campo extra ou valor que não é objeto → erro de validação', async () => {
    const base = { workspaceId: uuid(), startDate: '2099-01-01', endDate: '2099-01-02', weekdays: [1], times: ['09:00'], storyTimes: [], formats: ['reel'], focus: OBJECTIVE, mode: 'publish' };
    const errors = async (o: Record<string, unknown>) => (await validate(plainToInstance(CreateAutoCalendarDto, { ...base, ...o }), { whitelist: true, forbidNonWhitelisted: true })).length;
    expect(await errors({ videoAudio: { modo: 'narracao', instrucoes: 'voz calma' } })).toBe(0);
    expect(await errors({ videoAudio: { modo: 'sem_audio' } })).toBe(0);
    expect(await errors({})).toBe(0);
    expect(await errors({ videoAudio: { modo: 'karaoke' } })).toBeGreaterThan(0);
    expect(await errors({ videoAudio: { modo: 'narracao', instrucoes: 'x'.repeat(501) } })).toBeGreaterThan(0);
    expect(await errors({ videoAudio: { modo: 'narracao', volume: 10 } })).toBeGreaterThan(0);
    expect(await errors({ videoAudio: 'narracao' })).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd api && ../scripts/run-capped.sh 1500 npm test -- src/modules/media/__tests__/pad-to-aspect.spec.ts src/modules/instagram/__tests__/media-generation.spec.ts src/modules/instagram/__tests__/auto-calendar.spec.ts`
Expected: FAIL — `padToAspect`/`dominantColor` inexistentes, vídeo sem `video_direction`, `videoAudio` desconhecido.

- [ ] **Step 3: Primeiro quadro (ImageService)**

Em `api/src/modules/media/image.service.ts`, logo antes de `@Injectable()`:

```ts
/** Cor mais frequente da imagem (histograma com 16 níveis por canal, amostrado), na média dos pixels daquele balde. */
export function dominantColor(img: Img): [number, number, number] {
  const data = img.bitmap.data as Uint8Array;
  const step = Math.max(4, Math.floor(data.length / 4 / 50_000) * 4);
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i + 3 < data.length; i += step) {
    if (data[i + 3]! < 128) continue;
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const c = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    c.n++;
    c.r += r;
    c.g += g;
    c.b += b;
    buckets.set(key, c);
  }
  let best: { n: number; r: number; g: number; b: number } | null = null;
  for (const c of buckets.values()) if (!best || c.n > best.n) best = c;
  return best ? [Math.round(best.r / best.n), Math.round(best.g / best.n), Math.round(best.b / best.n)] : [0, 0, 0];
}
```

e dentro de `ImageService`, depois de `shrink`:

```ts
  /** Primeiro quadro do vídeo: encaixa a imagem INTEIRA em `width`×`height` (sem cortar nem distorcer); sobras na cor dominante. JPEG q90. */
  async padToAspect(bytes: Uint8Array, width: number, height: number): Promise<{ bytes: Uint8Array; mime: string }> {
    const img = await this.read(bytes);
    img.scaleToFit({ w: width, h: height });
    const [r, g, b] = dominantColor(img);
    const canvas = this.blank(width, height, ((r << 24) | (g << 16) | (b << 8) | 0xff) >>> 0);
    canvas.composite(img, Math.round((width - img.bitmap.width) / 2), Math.round((height - img.bitmap.height) / 2));
    return { bytes: new Uint8Array(await canvas.getBuffer('image/jpeg', { quality: 90 })), mime: 'image/jpeg' };
  }
```

- [ ] **Step 4: Caminho de vídeo na `MediaGenerationService`**

Em `api/src/modules/instagram/media-generation.service.ts`, troque os imports de `../creative/creative.types` e `../media/assets.service` e acrescente os novos:

```ts
import { firstFrameRef, orderRefsForProduct } from '../creative/creative-context';
import { choiceForProvider, GenerationRequest, GenerationResult, ProviderChoice, ServerCreativeProvider } from '../creative/creative.types';
import { directVideo, resolveAudio, stillPrompt, VIDEO_PROMPT_MAX_CHARS, VIDEO_SECONDS, VideoAudio, VideoDirection } from '../creative/video-director';
import { VideoQualityService, VideoScore } from '../creative/video-quality.service';
import { AssetsService, MediaAsset } from '../media/assets.service';
import { VideoConformService } from '../media/video-conform.service';
```

(o import de `orderRefsForProduct` da Task 6 passa a vir junto do `firstFrameRef`). Logo depois de `export const VIDEO_WAIT_MS = 25_000;`:

```ts
/** Primeiro quadro do vídeo (9:16): a foto do produto/marca encaixada sem distorcer, sobras na cor dominante. */
const FIRST_FRAME_W = 720;
const FIRST_FRAME_H = 1280;
/** Prompts antigos em inglês não devem continuar sendo enviados ao gerador. */
const legacyEnglish = (value: unknown) =>
  typeof value === 'string' && /\b(photorealistic|still frame|no text|use the product|commercial photograph|natural lighting|frozen layers)\b/i.test(value);

type VideoScoreEntry = { attempt: number; total: number | null; motivo: string | null; error?: string };
type VideoCandidate = { item: Record<string, any>; score: number | null; attempt: number; prompt: string; direction: VideoDirection | null };
/** Estado do vídeo entre a 1ª geração e a refação (vai no `pending_job` quando o provedor é assíncrono). */
type VideoState = { attempt: 1 | 2; best: VideoCandidate | null; scores: VideoScoreEntry[] };
type StoredVideoDirection = { direction: VideoDirection | null; prompt: string; audio: VideoAudio; first_frame_ref: string | null; scores?: VideoScoreEntry[]; winner_attempt?: number };
type VideoOutcome = { ok: true; items: number; provider: string; pending?: boolean };
```

No tipo `PendingJob`, acrescente `video?: VideoState;` depois de `started_at: string;`. No construtor, acrescente no FIM `private readonly quality: VideoQualityService,` e `private readonly conform: VideoConformService,`. Em `generatePostAssets`, apague a declaração local `const legacyEnglish = …` (agora é do módulo).

Troque o método `libraryItem` inteiro por:

```ts
  /** Salva a mídia na Biblioteca (padronizada no formato do post), sempre ligada à marca do plano. */
  private async ingestAsset(post: PostRow, src: Src, provider: string, prompt: string | null, cost = 0, title?: string): Promise<MediaAsset> {
    const video = src.mime ? src.mime.startsWith('video/') : isVideoFormat(post.format);
    return this.assets.ingest({
      brandId: await this.brandIdOfPost(post),
      workspaceId: post.workspace_id,
      kind: video ? 'video' : 'image',
      targetFormat: targetForIgFormat(post.format),
      source: provider,
      ...(src.bytes ? { bytes: src.bytes } : { sourceUrl: src.sourceUrl! }),
      mime: src.mime ?? null,
      title: title ?? post.theme ?? 'Post do Instagram',
      prompt,
      provider,
      cost,
      igPostId: post.id,
    });
  }

  /** Item de mídia do post com largura/altura/duração reais. */
  private mediaItem(a: MediaAsset, order: number) {
    return {
      url: a.url,
      type: a.kind,
      order,
      width: a.width,
      height: a.height,
      duration: a.duration_seconds == null ? null : Number(a.duration_seconds),
      asset_id: a.id,
      ig_ready: a.ig_ready,
      issues: ((a.quality_report as { issues?: string[] } | null)?.issues ?? []) as string[],
    };
  }

  private async libraryItem(post: PostRow, src: Src, order: number, provider: string, prompt: string | null, cost = 0, title?: string) {
    return this.mediaItem(await this.ingestAsset(post, src, provider, prompt, cost, title), order);
  }
```

Troque a assinatura do `videoCover` por `private async videoCover(post: PostRow, provider: ServerCreativeProvider, prompt: string, assetId: string | null, durationSec: number) {` e, dentro dele, `durationSec: 8,` por `durationSec,`. No `continueAssets`, troque `if (isVideoFormat(format)) Object.assign(item, await this.videoCover(post, provider, req.finalPrompt, item['asset_id']));` por `if (isVideoFormat(format)) Object.assign(item, await this.videoCover(post, provider, req.finalPrompt, item['asset_id'], Number(item['duration']) || VIDEO_SECONDS));`.

Logo depois do `criticSlide` (Task 7), acrescente:

```ts
  /** Áudio do vídeo: o do post (`creative_brief.audio`) sobrepõe o da programação (`ig_auto_runs.video_audio`). */
  private async audioFor(post: PostRow): Promise<VideoAudio> {
    const run = post.run_id ? await this.prisma.ig_auto_runs.findFirst({ where: { id: post.run_id, workspace_id: post.workspace_id }, select: { video_audio: true } }) : null;
    return resolveAudio(run?.video_audio, post.creative_brief?.audio);
  }

  /**
   * Reels/Story em vídeo: diretor de vídeo (roteiro por tomada) → primeiro quadro (foto do produto/marca em 9:16) → vídeo com o áudio
   * configurado (espera curta; o poller conclui) → `finishVideo`. `criticNote` = refação pedida pelo crítico (2ª tentativa).
   */
  private async startVideo(post: PostRow, provider: ChainedProvider, instructions: string | null, lease: PostLease, state: VideoState, criticNote: string | null = null, cost = 0): Promise<VideoOutcome> {
    const ws: string = post.workspace_id;
    const brand = await this.content.brandFor(ws, await this.brandIdOfPost(post));
    const vs = (brand?.visual_style ?? {}) as VisualStyle;
    const ctx = await this.postContext.build(post, brand?.id ?? null);
    const audio = await this.audioFor(post);
    const refs = await this.refs.loadBrandRefs(ws, brand?.id, { max: 4, ids: vs.referencias?.length ? vs.referencias : undefined });
    const ref = firstFrameRef(refs, ctx.product?.name ?? null);
    const frame = ref
      ? await this.images.padToAspect(ref.bytes, FIRST_FRAME_W, FIRST_FRAME_H).catch((e) => {
          this.logger.warn(`[instagram] primeiro quadro falhou (segue só com o texto): ${errText(e)}`);
          return null;
        })
      : null;
    const brief = post.creative_brief ?? {};
    const prev = brief.video_direction as StoredVideoDirection | undefined;
    const override =
      !instructions && !criticNote && typeof brief.visual_prompt_override === 'string' && brief.visual_prompt_override.trim() && !legacyEnglish(brief.visual_prompt_override)
        ? String(brief.visual_prompt_override).trim().slice(0, VIDEO_PROMPT_MAX_CHARS)
        : null;
    await lease.renew();
    let direction: VideoDirection | null = prev?.direction ?? null;
    let prompt: string;
    if (override) prompt = override;
    else {
      const r = await directVideo(this.ai, {
        workspaceId: ws, brand, context: ctx, format: post.format === 'story_video' ? 'story_video' : 'reel',
        theme: post.theme ?? null, hook: post.hook ?? null, cta: post.cta ?? null, userPrompt: (brief.prompt as string | undefined) ?? null,
        audio, hasFirstFrame: !!frame, provider: provider.id, adjust: instructions, previousPrompt: instructions || criticNote ? (prev?.prompt ?? null) : null, criticNote,
      });
      direction = r.direction;
      prompt = r.prompt;
    }
    const stored: StoredVideoDirection = { direction, prompt, audio, first_frame_ref: frame && ref ? ref.id : null, scores: state.scores };
    post.creative_brief = { ...brief, video_direction: stored, visual_prompt: prompt };
    await this.store.patchPost(post.id, { creative_brief: post.creative_brief });
    await lease.renew();
    const req: GenerationRequest = {
      finalPrompt: prompt, aspectRatio: '9:16', kind: 'video', maxWaitMs: VIDEO_WAIT_MS, audio: audio.modo !== 'sem_audio',
      ...(frame ? { referenceImages: [frame] } : {}),
      ...(frame && ref && /^https:\/\//i.test(ref.url) ? { referenceUrls: [ref.url] } : {}),
    };
    const r = await provider.generateVideo(req);
    if (r.status === 'generating' && r.externalJobId) {
      const { pending_job: _old, ...rest } = post.creative_brief;
      const pending: PendingJob = { provider: provider.id, jobId: r.externalJobId, index: 0, prompts: [prompt], media: [], cost, instructions, started_at: new Date().toISOString(), video: state };
      post.creative_brief = { ...rest, pending_job: pending };
      await this.store.patchPost(post.id, { status: 'generating', ai_provider: provider.id, creative_brief: post.creative_brief });
      return { ok: true, items: 0, provider: provider.id, pending: true };
    }
    if (r.status !== 'ready' || (!r.assetUrl && !r.bytes)) throw new UserError('O provedor não devolveu a mídia pronta.');
    return this.finishVideo(post, provider, r, state, cost + r.cost, instructions, lease);
  }

  /** Vídeo pronto (síncrono ou pelo poller): biblioteca → padrão do Instagram (ffmpeg) → nota do crítico → no máximo 1 refação. */
  private async finishVideo(post: PostRow, provider: ChainedProvider, r: GenerationResult, state: VideoState, cost: number, instructions: string | null, lease: PostLease): Promise<VideoOutcome> {
    const stored = (post.creative_brief?.video_direction ?? {}) as StoredVideoDirection;
    const audio = resolveAudio(stored.audio);
    await lease.renew();
    const raw = await this.ingestAsset(post, this.srcOf(r), provider.id, stored.prompt ?? null, r.cost);
    await lease.renew();
    const asset = await this.conform.ensureIgReady(
      raw,
      { workspaceId: post.workspace_id, brandId: await this.brandIdOfPost(post), igPostId: post.id, title: post.theme ?? 'Reels', provider: provider.id },
      { silent: audio.modo === 'sem_audio' },
    );
    const { score, error } = await this.scoreVideo(post, asset, stored, lease);
    const scores: VideoScoreEntry[] = [...state.scores, { attempt: state.attempt, total: score?.total ?? null, motivo: score?.motivo ?? null, ...(error ? { error } : {}) }];
    const candidate: VideoCandidate = { item: this.mediaItem(asset, 0), score: score?.total ?? null, attempt: state.attempt, prompt: stored.prompt ?? '', direction: stored.direction ?? null };
    const best = !state.best || (candidate.score ?? -1) > (state.best.score ?? -1) ? candidate : state.best;
    if (score && score.total < this.quality.minScore && state.attempt === 1) {
      await this.store.logEvent({
        workspace_id: post.workspace_id, plan_id: post.plan_id, post_id: post.id, kind: 'video_regenerated', level: 'warn',
        message: `Vídeo refeito: nota ${score.total}/50, abaixo de ${this.quality.minScore} (${score.motivo || 'sem motivo'}).`,
      });
      try {
        return await this.startVideo(post, provider, instructions, lease, { attempt: 2, best, scores }, score.motivo || 'nota baixa do crítico', cost);
      } catch (e) {
        if (e instanceof PublishClaimLost) throw e;
        this.logger.warn(`[instagram] refação do vídeo falhou; fica o primeiro: ${errText(e)}`);
        return this.completeVideo(post, provider, best, [...scores, { attempt: 2, total: null, motivo: null, error: errText(e) }], cost, instructions, lease);
      }
    }
    return this.completeVideo(post, provider, best, scores, cost, instructions, lease);
  }

  /** Nota do crítico de vídeo; fora do ar não bloqueia (segue com o vídeo e registra). */
  private async scoreVideo(post: PostRow, asset: MediaAsset, stored: StoredVideoDirection, lease: PostLease): Promise<{ score: VideoScore | null; error: string | null }> {
    try {
      const { bytes } = await this.assets.readBytes(asset);
      await lease.renew();
      const brand = await this.content.brandFor(post.workspace_id, await this.brandIdOfPost(post));
      const vs = (brand?.visual_style ?? {}) as VisualStyle;
      const palette = listField(vs.paleta_hex).length ? listField(vs.paleta_hex) : ([brand?.primary_color, brand?.secondary_color].filter(Boolean) as string[]);
      const score = await this.quality.score(post.workspace_id, bytes, {
        durationSec: Number(asset.duration_seconds) || VIDEO_SECONDS, script: stored.prompt ?? '', subject: stored.direction?.sujeito || post.theme || 'o produto da marca', palette,
      });
      return { score, error: null };
    } catch (e) {
      if (e instanceof PublishClaimLost) throw e;
      this.logger.warn(`[instagram] crítico do vídeo indisponível (segue com o vídeo): ${errText(e)}`);
      return { score: null, error: `crítico indisponível: ${errText(e)}` };
    }
  }

  /** Fecha o vídeo com o de maior nota: capa (duração real), roteiro do vencedor, notas no log; status como o resto da geração. */
  private async completeVideo(post: PostRow, provider: ChainedProvider, best: VideoCandidate, scores: VideoScoreEntry[], cost: number, instructions: string | null, lease: PostLease): Promise<VideoOutcome> {
    const stored = (post.creative_brief?.video_direction ?? {}) as StoredVideoDirection;
    await lease.renew();
    const still = best.direction ? stillPrompt(best.direction) : best.prompt || post.theme || 'Reels';
    const cover = await this.videoCover(post, provider, still, best.item['asset_id'] ?? null, Number(best.item['duration']) || VIDEO_SECONDS);
    const media = [{ ...best.item, ...cover }];
    const requires = await this.store.approvalRequired(post);
    const { pending_job: _drop, ...brief } = post.creative_brief ?? {};
    const regenError = scores.find((x) => x.attempt === 2 && x.error)?.error ?? null;
    await this.store.patchPost(post.id, {
      media,
      creative_brief: { ...brief, visual_prompt: best.prompt, video_direction: { ...stored, direction: best.direction, prompt: best.prompt, scores, winner_attempt: best.attempt } },
      // Post reprovado pelo validador (needs_review) NUNCA vai direto para "ready" (ver `wasFlagged`).
      status: requires === false && !wasFlagged(post) ? 'ready' : 'pending_approval',
      last_error: null,
      failure_kind: null,
      ai_provider: provider.id,
      ai_generation_log: this.store.appendLog(post, {
        step: 'media', provider: provider.id, provider_log: providerLog(provider), items: 1, cost, instructions,
        video_scores: scores, regenerated: scores.length > 1, winner_attempt: best.attempt, ...(regenError ? { regen_error: regenError } : {}),
      }),
    });
    return { ok: true, items: 1, provider: provider.id };
  }
```

Em `generatePostAssets`, logo depois de `used = provider;`, acrescente:

```ts
      // Reels/Story em vídeo: caminho próprio (roteiro detalhado, primeiro quadro, áudio, nota de qualidade, conversão).
      if (isVideoFormat(format)) return await this.startVideo(post, provider, instructions ?? null, lease, { attempt: 1, best: null, scores: [] });
```

Em `pollPendingMedia`, troque o trecho de `const provider = await this.providers.resolve(post.workspace_id, choiceForProvider(pj.provider));` até `if (r.status !== 'ready' || (!assetUrl && !r.bytes)) throw new UserError('O provedor informou falha na geração da mídia.');` por:

```ts
        const provider = await this.providers.resolve(post.workspace_id, choiceForProvider(pj.provider));
        // Refação do vídeo que não deu certo (falhou ou passou de 1 h): fica o primeiro vídeo — o post nunca prende nem falha por isso.
        const keepBest = async (error: string) => {
          const v = pj.video!;
          await this.completeVideo(post, provider, v.best!, [...v.scores, { attempt: v.attempt, total: null, motivo: null, error }], pj.cost, pj.instructions ?? null, lease);
          await this.afterMediaReady(post);
          out.push({ post: post.id, status: 'ready' });
        };
        const r = await provider.getGenerationStatus(pj.jobId);
        if (r.status === 'generating') {
          if (Date.now() - new Date(pj.started_at).getTime() > PENDING_TIMEOUT_MS) {
            if (pj.video?.best) {
              await keepBest('O provedor não concluiu a refação em 1 hora.');
              continue;
            }
            throw new UserError('O provedor não concluiu a mídia em 1 hora.');
          }
          out.push({ post: post.id, status: 'generating' });
          continue;
        }
        const assetUrl = r.assetUrl ?? (r.status === 'ready' && !r.bytes ? await provider.getAsset(pj.jobId) : null);
        if (r.status !== 'ready' || (!assetUrl && !r.bytes)) {
          if (pj.video?.best) {
            await keepBest('O provedor informou falha na refação do vídeo.');
            continue;
          }
          throw new UserError('O provedor informou falha na geração da mídia.');
        }
        // Vídeo do caminho novo (roteiro + crítico): conversão, nota e, se preciso, a refação (que pode ficar pendente de novo).
        if (pj.video && isVideoFormat(post.format)) {
          const res = await this.finishVideo(post, provider, { ...r, assetUrl }, pj.video, pj.cost + (r.cost ?? 0), pj.instructions ?? null, lease);
          if (res.pending) {
            out.push({ post: post.id, status: 'generating' });
            continue;
          }
          await this.afterMediaReady(post);
          out.push({ post: post.id, status: 'ready' });
          continue;
        }
```

Em `uploadOwnMedia`, troque as linhas de `const item = await this.libraryItem(...)` e `const media = [...current, item];` por:

```ts
    let asset = await this.ingestAsset(post, { bytes: new Uint8Array(file.bytes), mime: file.mimetype }, 'upload', null, 0, file.filename.replace(/\.[^.]+$/, ''));
    if (video && !asset.ig_ready) {
      // Vídeo do usuário fora do padrão do Instagram: converte (ffmpeg); se não der, fica o original com os avisos (como antes).
      const original = asset;
      asset = await this.conform
        .ensureIgReady(original, { workspaceId, brandId: await this.brandIdOfPost(post), igPostId: post.id, title: original.title ?? 'Vídeo', provider: 'upload' }, { silent: false })
        .catch((e) => {
          this.logger.warn(`[instagram] conversão do vídeo enviado falhou: ${errText(e)}`);
          return original;
        });
    }
    const media = [...current, this.mediaItem(asset, current.length)];
```

- [ ] **Step 5: Áudio na programação (DTO, serviço, ações)**

Em `api/src/modules/instagram/instagram.dto.ts`, troque `import { Transform } from 'class-transformer';` por `import { Transform, Type } from 'class-transformer';`, acrescente `ValidateNested` ao import de `class-validator` e `import { AUDIO_MODES } from '../creative/video-director';`. Logo antes de `export class CreateAutoCalendarDto`:

```ts
/** Áudio dos vídeos da programação (Reels e stories em vídeo). */
export class VideoAudioDto {
  @IsIn([...AUDIO_MODES]) modo!: (typeof AUDIO_MODES)[number];
  @IsOptional() @IsString() @MaxLength(500) instrucoes?: string;
}
```

e dentro de `CreateAutoCalendarDto`, depois de `recurring?: boolean;`:

```ts
  /** Áudio dos vídeos (sem o campo: padrão do banco — ambiente + trilha, sem instruções). */
  @IsOptional() @IsObject() @ValidateNested() @Type(() => VideoAudioDto) videoAudio?: VideoAudioDto;
```

Em `api/src/modules/instagram/auto-calendar.service.ts`, acrescente `import { resolveAudio } from '../creative/video-director';`, o campo `videoAudio?: { modo: string; instrucoes?: string } | null;` no tipo `CreateAutoInput`, e no `data` do `ig_auto_runs.create` de `createAutoRun`, depois de `recurring: !!input.recurring,`:

```ts
        ...(input.videoAudio ? { video_audio: resolveAudio(input.videoAudio) as unknown as Prisma.InputJsonObject } : {}),
```

Em `api/src/modules/instagram/instagram-actions.service.ts`, no `createAutoCalendar`, troque `planId: d.planId, brandId: d.brandId, campaignId: d.campaignId, focus: d.focus, mode: d.mode, recurring: d.recurring,` por `planId: d.planId, brandId: d.brandId, campaignId: d.campaignId, focus: d.focus, mode: d.mode, recurring: d.recurring, videoAudio: d.videoAudio,`.

- [ ] **Step 6: Harness**

Em `api/src/modules/instagram/__tests__/harness.ts`, logo depois da constante `ART`:

```ts
/** Roteiro de vídeo que a IA falsa devolve (`video_direction`). */
export const VIDEO_DIR = {
  gancho_visual: 'o chope é servido até a borda em câmera lenta',
  sujeito: 'copo de chope gelado com colarinho cremoso',
  cenario: 'balcão de madeira de um bar aconchegante',
  tomadas: [
    { inicio_s: 0, fim_s: 2.5, enquadramento: 'close', acao: 'o chope é servido até a borda', movimento_camera: 'travelling lento para a frente', lente: '85 mm' },
    { inicio_s: 2.5, fim_s: 5.5, enquadramento: 'plano médio', acao: 'a mão desliza o copo até a frente', movimento_camera: 'câmera parada', lente: '50 mm' },
    { inicio_s: 5.5, fim_s: 8, enquadramento: 'plano aberto', acao: 'amigos brindam ao fundo', movimento_camera: 'leve recuo', lente: '35 mm' },
  ],
  iluminacao: 'luz quente de fim de tarde',
  paleta_hex: ['#c0392b', '#f5deb3'],
  estilo: 'comercial realista',
  ritmo: 'abre rápido e fecha firme',
  cta_visual: 'o copo em primeiro plano com o bar desfocado ao fundo',
  audio: { modo: 'ambiente_trilha', descricao: 'som do bar e trilha leve', fala: '' },
  evitar: ['copos de outras marcas'],
};
```

No objeto `ai`, troque `json: jest.fn(async () => ({ ...ART })),` por `json: jest.fn(async (_ws: string, req: any) => (req?.name === 'video_direction' ? structuredClone(VIDEO_DIR) : { ...ART })),`. No objeto `assets`, acrescente `readBytes: jest.fn(async () => ({ bytes: new Uint8Array(PNG), mime: null })),`. Troque `const images = …` por:

```ts
  const images = {
    shrink: jest.fn(async (b: Uint8Array) => ({ bytes: new Uint8Array(b), mime: 'image/jpeg' })),
    padToAspect: jest.fn(async (b: Uint8Array) => ({ bytes: new Uint8Array(b), mime: 'image/jpeg' })),
  } as any;
  // Crítico de vídeo (40/50 por padrão) e conversão (devolve o próprio asset) falsos: nenhum ffmpeg nos testes do Instagram.
  const quality = { minScore: 28, score: jest.fn(async () => ({ roteiro: 8, marca: 8, tecnica: 8, produto: 8, scroll: 8, total: 40, motivo: 'bom' })) } as any;
  const conform = { ensureIgReady: jest.fn(async (a: any) => a) } as any;
```

troque a criação do `mediaGen` por `const mediaGen = new MediaGenerationService(w.store, ai, providers, refs, pipeline, extras, assets, content, publishing, images, postContext, quality, conform);` e devolva `images`, `quality` e `conform` no objeto de `igServices` (o `images` hoje não é devolvido: acrescente).

- [ ] **Step 7: Contrato**

Em `docs/api-contract.md`:
- `generate-post-assets`: troque `Reels/Story vídeo = vídeo + capa + legendas.` por `Reels/Story vídeo = **roteiro detalhado** (IA devolve JSON por tomada — gancho 0–2 s, até 3 tomadas cobrindo 0–8 s, câmera/lente/luz/paleta/estilo, áudio, "evitar" — e um montador em código gera o texto final pt-BR de 250–450 palavras, ≤ 3000 caracteres), **primeiro quadro** = foto do produto do post (ou a 1ª referência da marca) em 9:16 com preenchimento na cor dominante, **áudio** do post (\`creative_brief.audio\`) ou da programação (\`video_audio\`), espera de ~25 s (o resto pelo poller), **conversão** com ffmpeg quando não está \`ig_ready\` (H.264 High/yuv420p/30 fps/1080×1920/AAC 48 kHz/+faststart/≤ 60 s; ainda inválido → \`failed\` + \`failure_kind 'media'\`), **nota do crítico** (3 quadros, 0–50; abaixo de \`MIN_VIDEO_SCORE\` refaz 1× com o motivo, fica o de maior nota, evento \`video_regenerated\`; crítico fora do ar não bloqueia) e capa + legendas com a duração real. Tudo fica em \`creative_brief.video_direction { direction, prompt, audio, first_frame_ref, scores[], winner_attempt }\`; \`visual_prompt_override\` (roteiro editado no editor) vai direto ao provedor.`
- `upload-post-media`: depois de `entra na biblioteca;` acrescente `vídeo fora do padrão do Instagram é convertido pelo ffmpeg (se a conversão falhar, fica o original com os avisos);`.
- `create-auto-calendar`: no corpo, depois de `recurring?,` acrescente `videoAudio?: { modo: ambiente_trilha\|narracao\|sem_audio, instrucoes?(≤500) },` e depois de `A programação nasce com \`strategy_status 'pending'\`` acrescente `e \`video_audio\` (padrão \`{ modo: 'ambiente_trilha', instrucoes: '' }\`)`.

- [ ] **Step 8: Rodar e ver passar**

Run: `cd api && ../scripts/run-capped.sh 1500 npm test -- src/modules/media/__tests__/ src/modules/creative/__tests__/ src/modules/instagram/__tests__/`
Expected: PASS.

Run: `cd api && ../scripts/run-capped.sh 1500 npm run typecheck`
Expected: sem erros.

- [ ] **Step 9: Commit**

```bash
git add api/src/modules/media/image.service.ts api/src/modules/instagram/media-generation.service.ts api/src/modules/instagram/instagram.dto.ts api/src/modules/instagram/auto-calendar.service.ts api/src/modules/instagram/instagram-actions.service.ts api/src/modules/instagram/__tests__/harness.ts api/src/modules/media/__tests__/pad-to-aspect.spec.ts api/src/modules/instagram/__tests__/media-generation.spec.ts api/src/modules/instagram/__tests__/auto-calendar.spec.ts docs/api-contract.md
git commit -m "feat(instagram): vídeo com roteiro por tomada, primeiro quadro da marca, áudio configurável, nota com 1 refação e conversão

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Web — diálogo com áudio e explicação da produção, cartão do período com pulados, eventos no painel, aprovações e painel de vídeo do editor

**Files:**
- Create: `web/src/lib/instagram/production.ts`, `web/src/lib/instagram/production.test.ts`
- Create: `web/src/components/creative/video-direction-panel.tsx`
- Modify: `web/src/lib/instagram/auto-calendar.functions.ts:6-9` (`videoAudio` no corpo)
- Modify: `web/src/modules/instagram/infrastructure/instagram.api.ts:24-56` (post) e `:98-118` (run)
- Modify: `web/src/components/instagram/shared.tsx:9-33` (`IgPost.automation`, `run_id`)
- Modify: `web/src/components/instagram/auto-calendar.tsx` — imports (`:1-32`), contagens do cartão (`:169-174`), estado/envio do diálogo (`:278-318`), seção de áudio (depois de "Horários dos stories", `:432-439`), explicação no "Modo" (`:459-478`)
- Modify: `web/src/components/instagram/autopilot-panel.tsx:5-29,57-60`
- Modify: `web/src/components/instagram/approvals.tsx:12,31`
- Modify: `web/src/components/instagram/post-editor.tsx:32-36,237-260`
- Test: `web/src/lib/instagram/production.test.ts` (vitest)

**Interfaces:**
- Consumes (API): `GET /v1/workspaces/:ws/ig-auto-runs` → `counts { …, produced, producing, queued, rewriting, skipped }`, `skipped_posts[]`, `video_audio`; `POST /v1/instagram/create-auto-calendar` com `videoAudio`; `ig_posts.creative_brief.video_direction { direction.tomadas, prompt, scores, winner_attempt }`, `creative_brief.audio`; `PATCH /ig-posts/:id { creative_brief }`; eventos `strategy_auto_approved`, `post_rewritten`, `post_skipped`, `video_regenerated`.
- Produces (`web/src/lib/instagram/production.ts`): `type AudioMode`; `AUDIO_MODES: Record<AudioMode, { label: string; hint: string }>`; `AUDIO_INSTRUCTIONS_MAX = 500`; `VIDEO_SCRIPT_MAX = 3000`; `type RunCounts`; `periodCounts(c: RunCounts): string`; `awaitsHuman(p: { status: string; automation?: string | null }): boolean`; `effectiveLayout(brief): TextLayout`; `videoBriefPatch(brief, prompt: string, audio: { modo: AudioMode; instrucoes: string } | null): Record<string, unknown>`. Componente `VideoDirectionPanel({ brief, busy, onSave(prompt, audio | null), onRegenerate })`.

- [ ] **Step 1: Escrever o teste que falha**

Crie `web/src/lib/instagram/production.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { awaitsHuman, effectiveLayout, periodCounts, videoBriefPatch } from "./production";

describe("produção automática — regras da tela", () => {
  it("cartão do período: produzidos / produzindo / na fila / agendados / publicados / pulados", () => {
    expect(periodCounts({ total: 7, produced: 2, producing: 1, queued: 1, scheduled: 1, published: 1, skipped: 1, waiting: 0, failed: 0, review: 0, rewriting: 0 })).toBe(
      "7 conteúdos · 2 produzidos · 1 produzindo · 1 na fila · 1 agendados · 1 publicados · 1 pulados",
    );
  });

  it("aprovações: o post em revisão do modo totalmente automático não espera ninguém (a IA reescreve)", () => {
    expect(awaitsHuman({ status: "pending_approval" })).toBe(true);
    expect(awaitsHuman({ status: "needs_review", automation: "approval" })).toBe(true);
    expect(awaitsHuman({ status: "needs_review", automation: null })).toBe(true);
    expect(awaitsHuman({ status: "needs_review", automation: "publish" })).toBe(false);
    expect(awaitsHuman({ status: "ready" })).toBe(false);
  });

  it("layout padrão da arte igual ao da API: com headline, título no topo; sem, limpo; o escolhido vale", () => {
    expect(effectiveLayout({ headline: "Chope em dobro" })).toBe("titulo_topo");
    expect(effectiveLayout({})).toBe("limpo");
    expect(effectiveLayout({ headline: "x", layout: "cta_rodape" })).toBe("cta_rodape");
    expect(effectiveLayout(null)).toBe("limpo");
  });

  it("painel de vídeo: o roteiro só vira override se mudou; áudio do post (ou volta ao padrão); limites de tamanho", () => {
    const brief = { prompt: "x", audio: { modo: "narracao", instrucoes: "a" }, video_direction: { prompt: "ROTEIRO GERADO" } };
    expect(videoBriefPatch(brief, "ROTEIRO GERADO", null)).toEqual({ prompt: "x", video_direction: { prompt: "ROTEIRO GERADO" }, visual_prompt_override: null });
    const edited = videoBriefPatch(brief, "  MEU ROTEIRO  ", { modo: "sem_audio", instrucoes: ` ${"y".repeat(600)} ` });
    expect(edited.visual_prompt_override).toBe("MEU ROTEIRO");
    expect(edited.audio).toEqual({ modo: "sem_audio", instrucoes: "y".repeat(500) });
    expect((videoBriefPatch({}, "z".repeat(4000), null).visual_prompt_override as string).length).toBe(3000);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd web && ../scripts/run-capped.sh 1500 yarn test`
Expected: FAIL — `Cannot find module './production'`.

- [ ] **Step 3: Regras puras da tela**

Crie `web/src/lib/instagram/production.ts`:

```ts
import type { TextLayout } from "@/lib/creative/visual-style";

/** Modos de áudio dos vídeos (Reels e stories em vídeo) — os mesmos da API (`AUDIO_MODES`). */
export type AudioMode = "ambiente_trilha" | "narracao" | "sem_audio";
export const AUDIO_MODES: Record<AudioMode, { label: string; hint: string }> = {
  ambiente_trilha: { label: "Ambiente + trilha", hint: "Som da cena e trilha instrumental leve, sem vozes." },
  narracao: { label: "Narração curta", hint: "Voz em português dizendo até 2 frases curtas (gancho e chamada)." },
  sem_audio: { label: "Sem áudio", hint: "Vídeo sem som." },
};
export const AUDIO_INSTRUCTIONS_MAX = 500;
export const VIDEO_SCRIPT_MAX = 3000;

export type RunCounts = {
  total: number;
  produced: number;
  producing: number;
  queued: number;
  scheduled: number;
  published: number;
  skipped: number;
  waiting: number;
  failed: number;
  review: number;
  rewriting: number;
};

/** Linha do cartão do período (produção automática). */
export function periodCounts(c: RunCounts): string {
  return `${c.total} conteúdos · ${c.produced} produzidos · ${c.producing} produzindo · ${c.queued} na fila · ${c.scheduled} agendados · ${c.published} publicados · ${c.skipped} pulados`;
}

/** Post que espera uma PESSOA (fila de Aprovações): aguardando aprovação, ou em revisão fora do modo totalmente automático. */
export const awaitsHuman = (p: { status: string; automation?: string | null }) =>
  p.status === "pending_approval" || (p.status === "needs_review" && p.automation !== "publish");

/** Layout efetivo da arte (o mesmo padrão da API): com headline, título no topo; sem headline, limpo. */
export const effectiveLayout = (brief: { layout?: string | null; headline?: string | null } | null | undefined): TextLayout =>
  ((brief?.layout as TextLayout | null | undefined) ?? (brief?.headline ? "titulo_topo" : "limpo")) as TextLayout;

/**
 * `creative_brief` salvo pelo painel de vídeo: o roteiro só vira `visual_prompt_override` se for diferente do gerado; o áudio do post
 * sobrepõe o da programação (`null` = volta ao padrão da programação).
 */
export function videoBriefPatch(
  brief: Record<string, unknown> | null | undefined,
  prompt: string,
  audio: { modo: AudioMode; instrucoes: string } | null,
): Record<string, unknown> {
  const rest: Record<string, unknown> = { ...(brief ?? {}) };
  delete rest.audio;
  const generated = String((brief?.video_direction as { prompt?: string } | undefined)?.prompt ?? "").trim();
  const text = prompt.trim().slice(0, VIDEO_SCRIPT_MAX);
  return {
    ...rest,
    visual_prompt_override: text && text !== generated ? text : null,
    ...(audio ? { audio: { modo: audio.modo, instrucoes: audio.instrucoes.trim().slice(0, AUDIO_INSTRUCTIONS_MAX) } } : {}),
  };
}
```

- [ ] **Step 4: Painel de vídeo do editor**

Crie `web/src/components/creative/video-direction-panel.tsx`:

```tsx
"use client";
/* eslint-disable @typescript-eslint/no-explicit-any -- jsonb solto de ig_posts.creative_brief (como no resto do Instagram) */

import { useState } from "react";
import { Clapperboard, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AUDIO_INSTRUCTIONS_MAX, AUDIO_MODES, VIDEO_SCRIPT_MAX, type AudioMode } from "@/lib/instagram/production";

type Shot = { inicio_s: number; fim_s: number; enquadramento: string; acao: string; movimento_camera: string; lente: string };
type Score = { attempt: number; total: number | null; motivo: string | null; error?: string };
const sec = (n: number) => `${String(n).replace(".", ",")}s`;

/** Editor do post em vídeo (Reels/Story): roteiro final editável, tomadas, áudio, nota do crítico e "Regenerar vídeo". */
export function VideoDirectionPanel({
  brief,
  busy,
  onSave,
  onRegenerate,
}: {
  brief: any;
  busy?: boolean;
  onSave: (prompt: string, audio: { modo: AudioMode; instrucoes: string } | null) => void;
  onRegenerate: () => void;
}) {
  const vd = brief?.video_direction ?? {};
  const shots: Shot[] = Array.isArray(vd.direction?.tomadas) ? vd.direction.tomadas : [];
  const scores: Score[] = Array.isArray(vd.scores) ? vd.scores : [];
  const own = brief?.audio && typeof brief.audio === "object" ? (brief.audio as { modo?: string; instrucoes?: string }) : null;
  const ownMode = own?.modo && own.modo in AUDIO_MODES ? (own.modo as AudioMode) : null;
  const [prompt, setPrompt] = useState<string>(brief?.visual_prompt_override ?? vd.prompt ?? "");
  const [mode, setMode] = useState<AudioMode | "padrao">(ownMode ?? "padrao");
  const [text, setText] = useState<string>(own?.instrucoes ?? "");
  const winner = scores.find((s) => s.attempt === vd.winner_attempt) ?? scores[scores.length - 1];
  return (
    <div className="space-y-3 rounded-lg border border-border/70 p-3">
      <p className="flex items-center gap-2 text-sm font-semibold">
        <Clapperboard className="size-4 text-primary" /> Roteiro do vídeo
      </p>
      <div className="space-y-1.5">
        <Label className="text-xs">Roteiro final enviado ao gerador de vídeo (editável)</Label>
        <Textarea rows={8} maxLength={VIDEO_SCRIPT_MAX} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Gerado na próxima criação do vídeo." />
        <p className="text-right text-[11px] text-muted-foreground">{prompt.length}/3.000</p>
      </div>
      {shots.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium">Tomadas</p>
          <ol className="space-y-1 text-xs text-muted-foreground">
            {shots.map((t, i) => (
              <li key={i}>
                <b className="text-foreground">
                  {sec(t.inicio_s)}–{sec(t.fim_s)}
                </b>{" "}
                · {t.enquadramento} · {t.acao}
                {t.movimento_camera ? ` · câmera: ${t.movimento_camera}` : ""}
                {t.lente ? ` · ${t.lente}` : ""}
              </li>
            ))}
          </ol>
        </div>
      )}
      <div className="space-y-1.5">
        <Label className="text-xs" htmlFor="video-audio-mode">
          Áudio deste vídeo
        </Label>
        <select
          id="video-audio-mode"
          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          value={mode}
          onChange={(e) => setMode(e.target.value as AudioMode | "padrao")}
        >
          <option value="padrao">Padrão da programação</option>
          {(Object.keys(AUDIO_MODES) as AudioMode[]).map((k) => (
            <option key={k} value={k}>
              {AUDIO_MODES[k].label}
            </option>
          ))}
        </select>
        {mode !== "padrao" && mode !== "sem_audio" && (
          <Textarea
            rows={2}
            maxLength={AUDIO_INSTRUCTIONS_MAX}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder='Ex.: "trilha animada", "voz feminina calma", "sem música"'
          />
        )}
      </div>
      {winner && (
        <p className="text-xs">
          <b>Nota do crítico:</b> {winner.total ?? "—"}/50
          {winner.motivo ? ` — ${winner.motivo}` : winner.error ? ` — ${winner.error}` : ""}
          {scores.length > 1 ? ` (refeito ${scores.length - 1}× · ficou o de maior nota)` : ""}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => onSave(prompt, mode === "padrao" ? null : { modo: mode, instrucoes: mode === "sem_audio" ? "" : text })}>
          Salvar roteiro e áudio
        </Button>
        <Button size="sm" disabled={busy} onClick={onRegenerate}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Regenerar vídeo
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Shims e tipos**

Em `web/src/lib/instagram/auto-calendar.functions.ts`, troque o tipo do corpo de `createAutoCalendar` por:

```ts
export const createAutoCalendar = serverFnPost<
  Schedule & {
    workspaceId: string;
    planId?: string | null;
    brandId?: string | null;
    campaignId?: string | null;
    focus: string;
    mode: "publish" | "approval";
    recurring?: boolean;
    /** Áudio dos vídeos (Reels e stories em vídeo); sem ele, o padrão do banco. */
    videoAudio?: { modo: "ambiente_trilha" | "narracao" | "sem_audio"; instrucoes?: string };
  },
  { runId: string; planId: string; total: number; skipped: number }
>("/v1/instagram/create-auto-calendar");
```

Em `web/src/modules/instagram/infrastructure/instagram.api.ts`:
- no schema `post`, depois de `review_score: nullNum,` acrescente `review_attempts: nullNum,` e `failure_kind: str,`;
- no schema `run`, troque a linha `counts: z.object({ … })` por:

```ts
    counts: z.object({
      total: z.number(), media: z.number(), waiting: z.number(), scheduled: z.number(), published: z.number(), failed: z.number(), review: z.number().default(0),
      // Painel do período (produção automática).
      produced: z.number().default(0), producing: z.number().default(0), queued: z.number().default(0), rewriting: z.number().default(0), skipped: z.number().default(0),
    }),
    skipped_posts: z.array(z.object({ id: z.string(), theme: str, scheduled_at: str, reason: z.string() })).default([]),
    video_audio: z.any().nullish().transform((v) => v ?? null),
```

Em `web/src/components/instagram/shared.tsx`, no tipo `IgPost`, depois de `review_score?: number | null;`:

```ts
  /** Programação com IA: modo ("publish" | "approval") e a execução de origem. */
  automation?: string | null;
  run_id?: string | null;
```

- [ ] **Step 6: Diálogo e cartão do "Programar com IA"**

Em `web/src/components/instagram/auto-calendar.tsx`, acrescente o import `import { AUDIO_INSTRUCTIONS_MAX, AUDIO_MODES, periodCounts, type AudioMode } from "@/lib/instagram/production";`.

Troque o parágrafo das contagens do cartão (de `<p className="text-xs">` com `{r.counts.total} conteúdos · {r.counts.media} criativos · …` até o `</p>` correspondente) por:

```tsx
                <p className="text-xs">
                  {periodCounts(r.counts)}
                  {r.counts.waiting > 0 && ` · ${r.counts.waiting} aguardando aprovação`}
                  {r.counts.failed > 0 && <span className="text-destructive"> · {r.counts.failed} com falha</span>}
                  {r.counts.rewriting > 0 && <span className="text-warning"> · {r.counts.rewriting} sendo reescritos pela IA</span>}
                  {r.counts.review > 0 && <span className="text-destructive"> · {r.counts.review} precisam de revisão (veja Aprovações)</span>}
                </p>
                {r.skipped_posts?.length > 0 && (
                  <details className="text-xs">
                    <summary className="cursor-pointer font-medium text-warning">Pulados ({r.skipped_posts.length})</summary>
                    <ul className="mt-1 space-y-0.5 text-muted-foreground">
                      {r.skipped_posts.map((p: any) => (
                        <li key={p.id}>
                          {p.theme ?? "Post"}
                          {p.scheduled_at ? ` · ${dayLabel(p.scheduled_at)}` : ""} — {p.reason}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
```

No `AutoCalendarDialog`, depois de `const [recurring, setRecurring] = useState(false);`:

```tsx
  const [audioMode, setAudioMode] = useState<AudioMode>("ambiente_trilha");
  const [audioText, setAudioText] = useState("");
```

No `create({ data: { … } })` do `submit`, depois de `recurring,` acrescente `videoAudio: { modo: audioMode, instrucoes: audioText.trim() },`.

Logo depois do `</Field>` de "Horários dos stories (opcional)", acrescente:

```tsx
          {allFormats.some((f) => f === "reel" || f === "story_video") && (
            <Field label="Áudio dos vídeos (Reels e stories em vídeo)">
              <div className="grid gap-2 sm:grid-cols-3">
                {(Object.keys(AUDIO_MODES) as AudioMode[]).map((k) => (
                  <ModeCard key={k} active={audioMode === k} title={AUDIO_MODES[k].label} text={AUDIO_MODES[k].hint} onClick={() => setAudioMode(k)} />
                ))}
              </div>
              {audioMode !== "sem_audio" && (
                <Textarea
                  className="mt-2"
                  rows={2}
                  maxLength={AUDIO_INSTRUCTIONS_MAX}
                  value={audioText}
                  onChange={(e) => setAudioText(e.target.value)}
                  placeholder='Instruções (opcional): "trilha animada", "sem música", "voz feminina calma"…'
                />
              )}
            </Field>
          )}
```

No `Field label="Modo"`, logo depois do `<label>` de "Repetir toda semana com estas configurações", acrescente:

```tsx
            {mode === "publish" && (
              <p className="mt-3 rounded-md border border-primary/30 bg-primary/5 p-2 text-xs text-muted-foreground">
                Sem cliques depois de criar: a estratégia é aprovada sozinha, cada criativo é produzido a partir de 48 h antes do horário (meta: pronto 24 h antes) e
                publicado na hora marcada. Post reprovado na revisão é refeito pela IA até 2 vezes; se ainda não passar, o horário é pulado e o aviso aparece no painel.
              </p>
            )}
```

- [ ] **Step 7: Painel de eventos, aprovações e editor**

Em `web/src/components/instagram/autopilot-panel.tsx`, acrescente `Clapperboard` ao import de `lucide-react` e, no fim do objeto `KIND`:

```ts
  // Produção automática (programações com IA).
  strategy_auto_approved: { label: "Estratégia aprovada", icon: CheckCircle2 },
  post_rewritten: { label: "Reescrito pela IA", icon: RefreshCw },
  post_skipped: { label: "Pulado", icon: AlertTriangle },
  video_regenerated: { label: "Vídeo refeito", icon: Clapperboard },
```

e troque a `description` da `Section` por `"Gera, agenda e publica sozinho conforme o plano de conteúdo e as programações com IA."`.

Em `web/src/components/instagram/approvals.tsx`, acrescente `import { awaitsHuman } from "@/lib/instagram/production";` e troque `const pending = posts.filter((p) => p.status === "pending_approval" || p.status === "needs_review");` por `const pending = posts.filter(awaitsHuman);`.

Em `web/src/components/instagram/post-editor.tsx`, acrescente `import { VideoDirectionPanel } from "@/components/creative/video-direction-panel";` e `import { effectiveLayout, videoBriefPatch } from "@/lib/instagram/production";`, remova `import type { TextLayout } from "@/lib/creative/visual-style";` (fica sem uso) e troque o bloco `{post.format !== "reel" && post.format !== "story_video" && ( <ArtDirectionPanel … /> )}` inteiro por:

```tsx
          {post.format === "reel" || post.format === "story_video" ? (
            <VideoDirectionPanel
              key={post.id}
              brief={post.creative_brief}
              busy={busy === "gen"}
              onSave={(prompt, audio) =>
                run(
                  "save",
                  async () => {
                    await patchIgPost(workspaceId, post.id, { creative_brief: videoBriefPatch(post.creative_brief, prompt, audio) });
                  },
                  "Roteiro e áudio salvos. Clique em Regenerar vídeo para usar.",
                )
              }
              onRegenerate={() =>
                run("gen", () => fns.gen({ data: { workspaceId, postId: post.id, provider: "auto" } }), "Vídeo enviado para geração: ele aparece aqui quando ficar pronto.")
              }
            />
          ) : (
            <ArtDirectionPanel
              key={post.id}
              prompt={post.creative_brief?.visual_prompt_override ?? post.creative_brief?.visual_prompt ?? ""}
              layout={effectiveLayout(post.creative_brief)}
              variations={post.creative_brief?.variations ?? []}
              busy={busy === "gen"}
              showLayout={post.format !== "feed_carousel"}
              onSave={(prompt, layout) =>
                run(
                  "save",
                  async () => {
                    await patchIgPost(workspaceId, post.id, {
                      creative_brief: { ...(post.creative_brief ?? {}), visual_prompt_override: prompt || null, layout },
                    });
                  },
                  "Direção de arte salva. Clique em Regenerar mídia para usar.",
                )
              }
              onAdjust={(adjust) =>
                run("gen", () => fns.gen({ data: { workspaceId, postId: post.id, provider: "auto", adjust } }), "Mídia regenerada com o ajuste.")
              }
            />
          )}
```

- [ ] **Step 8: Rodar e ver passar**

Run: `cd web && ../scripts/run-capped.sh 1500 yarn test`
Expected: PASS (inclui `app-routes.test.ts`).

Run: `cd web && ../scripts/run-capped.sh 1500 yarn typecheck`
Expected: sem erros.

Run: `cd web && ../scripts/run-capped.sh 1500 yarn lint`
Expected: sem erros novos.

- [ ] **Step 9: Commit**

```bash
git add web/src/lib/instagram/production.ts web/src/lib/instagram/production.test.ts web/src/components/creative/video-direction-panel.tsx web/src/lib/instagram/auto-calendar.functions.ts web/src/modules/instagram/infrastructure/instagram.api.ts web/src/components/instagram/shared.tsx web/src/components/instagram/auto-calendar.tsx web/src/components/instagram/autopilot-panel.tsx web/src/components/instagram/approvals.tsx web/src/components/instagram/post-editor.tsx
git commit -m "feat(web): áudio dos vídeos e produção automática no Programar com IA, pulados no cartão, eventos novos e painel de vídeo no editor

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Smoke e browser-check da produção sem cliques, documentação e verificação final

**Files:**
- Modify: `api/scripts/smoke.sh` — depois da linha `check "ig: enviar imagem → ok, …"` (`:539`) e no `rm -f` seguinte (`:540`); linha `check "cron media (calendário automático + piloto) sem erro" …` (`:624`); bloco novo depois de `check "cron account / optimize devolvem lista" …` (`:626`)
- Modify: `web/scripts/browser-check.mjs` — imports (`:21-27`), `fakeAi` (`:74`), fixtures depois de `let notaN = 0;` (`:99`), gateway (`:100-186`), seção `instagram` (`:1219-1286`)
- Modify: `docs/api-contract.md:427` (`GET /ig-autopilot-events`)
- Modify: `README.md:55-56` (variáveis), `CLAUDE.md` (bullet **Instagram**)
- Test: o próprio smoke (`scripts/run-capped.sh 1300 bash api/scripts/smoke-capped.sh`) e o browser-check dos grupos 3 (estudio) e 4 (instagram)

**Interfaces:**
- Consumes: tudo das Tasks 1–12 — cron `media` → `{ autoCalendar, production: { skipped, started, ready, pending, failed }, autopilot }`; `create-auto-calendar` com `videoAudio`; `GET /ig-auto-runs` (`counts.produced|producing|queued|rewriting|skipped`, `skipped_posts`, `video_audio`); `creative_brief.video_direction`; `upload-post-media` com conversão; textos da tela da Task 12.
- Produces: nada novo (só verificação e documentação).

- [ ] **Step 1: Smoke — upload de vídeo real convertido pelo ffmpeg**

Em `api/scripts/smoke.sh`, logo depois da linha que começa com `check "ig: enviar imagem → ok, entra na biblioteca e no post (aguardando aprovação)"`, acrescente:

```bash
# Vídeo de verdade (480×854, fora do padrão do Instagram) feito pelo ffmpeg das dependências: o upload converte para 1080×1920 com o ffmpeg real.
FFBIN=$(cd "$(dirname "$0")/.." && node -e "process.stdout.write(process.env.FFMPEG_PATH || require('ffmpeg-static') || '')")
"$FFBIN" -v error -y -f lavfi -i testsrc=size=480x854:rate=30:duration=2 -f lavfi -i sine=frequency=440:duration=2 -shortest -c:v libx264 -pix_fmt yuv420p -c:a aac /tmp/mf-smoke-ig.mp4
P5=$(PSQL "INSERT INTO ig_posts(workspace_id,format,status,theme) VALUES ('$WID','reel','idea','Reel smoke') RETURNING id" | head -1)
check "ig: enviar vídeo fora do padrão → convertido pelo ffmpeg (1080×1920, ig_ready); o original fica na biblioteca" "true,true,1,1080,1920,2" "$(curl -s -X POST $IGA/upload-post-media -H "$H" -F "workspaceId=$WID" -F "postId=$P5" -F "file=@/tmp/mf-smoke-ig.mp4;type=video/mp4" | jq -r .ok | tr '\n' ','; PSQL "SELECT (media->0->>'ig_ready')||','||jsonb_array_length(media) FROM ig_posts WHERE id='$P5'" | tr '\n' ','; PSQL "SELECT width||','||height FROM media_assets WHERE id=(SELECT (media->0->>'asset_id')::uuid FROM ig_posts WHERE id='$P5')" | tr '\n' ','; PSQL "SELECT count(*) FROM media_assets WHERE ig_post_id='$P5'")"
check "ig: …o diretório temporário do ffmpeg ficou vazio" "0" "$(ls -A "$(dirname "$0")/../uploads/.ffmpeg-tmp" 2>/dev/null | wc -l)"
```

e troque a linha seguinte `rm -f /tmp/mf-smoke-ig.txt /tmp/mf-smoke-ig.png` por `rm -f /tmp/mf-smoke-ig.txt /tmp/mf-smoke-ig.png /tmp/mf-smoke-ig.mp4`.

- [ ] **Step 2: Smoke — chaves do cron `media` e bloco da produção automática**

Troque a linha

```bash
check "cron media (calendário automático + piloto) sem erro" "autoCalendar,autopilot,false" "$(curl -s -X POST $CRON -H "x-cron-secret: $CTOK" -H "$J" -d '{"task":"media"}' | jq -r '[(keys|join(",")), ([.. | objects | select(has("error"))] | length > 0)] | join(",")')"
```

por

```bash
check "cron media (calendário automático + produção antecipada + piloto) sem erro" "autoCalendar,autopilot,production,false" "$(curl -s -X POST $CRON -H "x-cron-secret: $CTOK" -H "$J" -d '{"task":"media"}' | jq -r '[(keys|join(",")), ([.. | objects | select(has("error"))] | length > 0)] | join(",")')"
```

e, logo depois da linha `check "cron account / optimize devolvem lista" …`, acrescente:

```bash
echo "── Produção automática: áudio da programação, revisão da IA, produção antecipada (rodízio) e pulados ──"
check "prod: programação nasce com o áudio padrão (ambiente + trilha, sem instruções)" "ambiente_trilha," "$(PSQL "SELECT (video_audio->>'modo')||','||(video_audio->>'instrucoes') FROM ig_auto_runs WHERE id='$RUN'")"
AUTOP=$(echo "$AUTO" | jq -c '.mode="publish" | .startDate="2099-02-01" | .endDate="2099-02-01" | .times=["10:00"] | .formats=["reel"]')
check "prod: áudio com modo inválido → 400" "VALIDATION_ERROR" "$(curl -s -X POST $IGA/create-auto-calendar -H "$H" -H "$J" -d "$(echo "$AUTOP" | jq -c '.videoAudio={"modo":"musica"}')" | jq -r .error.code)"
check "prod: instruções de áudio acima de 500 caracteres → 400" "VALIDATION_ERROR" "$(curl -s -X POST $IGA/create-auto-calendar -H "$H" -H "$J" -d "$(echo "$AUTOP" | jq -c --arg t "$(printf 'x%.0s' $(seq 1 501))" '.videoAudio={"modo":"narracao","instrucoes":$t}')" | jq -r .error.code)"
RUNA=$(curl -s -X POST $IGA/create-auto-calendar -H "$H" -H "$J" -d "$(echo "$AUTOP" | jq -c '.videoAudio={"modo":"narracao","instrucoes":" voz «calma» "}')" | jq -r .runId)
check "prod: áudio da programação gravado (sem « » e sem espaços nas pontas)" "narracao,voz calma" "$(PSQL "SELECT (video_audio->>'modo')||','||(video_audio->>'instrucoes') FROM ig_auto_runs WHERE id='$RUNA'")"
# Sem IA no smoke: estratégia e preenchimento vêm do banco; o que interessa aqui é a produção.
PSQL "UPDATE ig_auto_runs SET status='active', strategy_status='approved', strategy='{\"ctas\":[\"Reserve pelo WhatsApp\"]}', filled=1 WHERE id='$RUNA'" >/dev/null
PC1=$(curl -s $IGW/ig-posts/pending-count -H "$HV" | jq .count)
NRP=$(PSQL "INSERT INTO ig_posts(workspace_id,plan_id,run_id,automation,format,status,scheduled_at,review_reason) VALUES ('$WID','$PLID','$RUNA','publish','feed_image','needs_review', now() + interval '5 days','Checagem final: faltam ligação com o objetivo, pilar ou persona.') RETURNING id" | head -1)
check "prod: em revisão no modo automático (a IA reescreve) não entra no selo nem na revisão humana" "$PC1,1,0" "$(curl -s $IGW/ig-posts/pending-count -H "$HV" | jq .count),$(curl -s $IGW/ig-auto-runs -H "$HV" | jq -r --arg id "$RUNA" '.[] | select(.id==$id) | [.counts.rewriting,.counts.review]|join(",")')"
PSQL "UPDATE ig_posts SET status='cancelled' WHERE id='$NRP'" >/dev/null
check "prod: failure_kind fora do CHECK é recusado (ig_posts_failure_kind_check)" "1" "$(PSQL "INSERT INTO ig_posts(workspace_id,format,status,failure_kind) VALUES ('$WID','feed_image','idea','bogus')" 2>&1 | grep -c 'ig_posts_failure_kind_check')"
# Rodízio: na empresa WID, A1 (+2 h) e A2 (+3 h); na empresa NID, B1 (+20 h). A2 é mais cedo que B1, mas só 1 post por empresa por rodada.
NPL=$(PSQL "INSERT INTO ig_content_plans(workspace_id,name) VALUES ('$NID','Plano produção smoke') RETURNING id" | head -1)
NRUN=$(PSQL "INSERT INTO ig_auto_runs(workspace_id,plan_id,start_date,end_date,mode,status,strategy_status) VALUES ('$NID','$NPL','2099-02-01','2099-02-01','publish','active','approved') RETURNING id" | head -1)
A1=$(PSQL "INSERT INTO ig_posts(workspace_id,plan_id,run_id,automation,format,status,theme,scheduled_at) VALUES ('$WID','$PLID','$RUNA','publish','feed_image','idea','Prod A1', now() + interval '2 hours') RETURNING id" | head -1)
A2=$(PSQL "INSERT INTO ig_posts(workspace_id,plan_id,run_id,automation,format,status,theme,scheduled_at) VALUES ('$WID','$PLID','$RUNA','publish','feed_image','idea','Prod A2', now() + interval '3 hours') RETURNING id" | head -1)
AF=$(PSQL "INSERT INTO ig_posts(workspace_id,plan_id,run_id,automation,format,status,theme,scheduled_at) VALUES ('$WID','$PLID','$RUNA','publish','feed_image','idea','Prod fora da janela', now() + interval '60 hours') RETURNING id" | head -1)
AO=$(PSQL "INSERT INTO ig_posts(workspace_id,plan_id,run_id,automation,format,status,theme,scheduled_at) VALUES ('$WID','$PLID','$RUNA','publish','feed_image','idea','Prod vencido', now() - interval '13 hours') RETURNING id" | head -1)
B1=$(PSQL "INSERT INTO ig_posts(workspace_id,plan_id,run_id,automation,format,status,theme,scheduled_at) VALUES ('$NID','$NPL','$NRUN','publish','feed_image','idea','Prod B1', now() + interval '20 hours') RETURNING id" | head -1)
check "prod: review_attempts nasce 0 e failure_kind nulo" "0," "$(PSQL "SELECT review_attempts||','||coalesce(failure_kind,'') FROM ig_posts WHERE id='$A1'")"
PR=$(curl -s -X POST $CRON -H "x-cron-secret: $CTOK" -H "$J" -d '{"task":"media"}')
check "prod: cron media pulou o vencido e começou a produção de 2 empresas" "true,true" "$(echo "$PR" | jq -r '[(.production.skipped >= 1), (.production.started >= 2)] | join(",")')"
check "prod: rodízio — o mais próximo de cada empresa (A1 e B1; A2 espera), fora da janela de 48 h fica (sem IA: falha de mídia)" "failed:media,idea,idea,failed:media" "$(for p in $A1 $A2 $AF $B1; do PSQL "SELECT status||coalesce(':'||failure_kind,'') FROM ig_posts WHERE id='$p'"; done | paste -sd,)"
check "prod: atrasado > 12 h sem criativo → pulado com aviso + evento post_skipped" "cancelled,Pulado automaticamente: o horário passou há mais de 12 h sem o criativo pronto.,post_skipped" "$(PSQL "SELECT status||','||last_error FROM ig_posts WHERE id='$AO'"),$(PSQL "SELECT kind FROM ig_autopilot_events WHERE post_id='$AO'")"
check "prod: resumo do período (pulados, na fila, falhas, motivo e áudio)" "1,2,1,o horário passou há mais de 12 h sem o criativo pronto.,narracao" "$(curl -s $IGW/ig-auto-runs -H "$HV" | jq -r --arg id "$RUNA" '.[] | select(.id==$id) | [.counts.skipped,.counts.queued,.counts.failed,.skipped_posts[0].reason,.video_audio.modo]|join(",")')"
# Falha de PUBLICAÇÃO não refaz a mídia; falha de MÍDIA ganha 1 nova tentativa (que, sem IA, falha de novo).
PSQL "UPDATE ig_posts SET failure_kind='publish' WHERE id='$B1'" >/dev/null
curl -s -X POST $CRON -H "x-cron-secret: $CTOK" -H "$J" -d '{"task":"media"}' >/dev/null
check "prod: 2ª rodada — só a falha de mídia ganha nova tentativa (auto_retried); a de publicação fica" "true,failed:media,,failed:publish" "$(PSQL "SELECT coalesce(creative_brief->>'auto_retried','')||','||status||coalesce(':'||failure_kind,'') FROM ig_posts WHERE id='$A1'"),$(PSQL "SELECT coalesce(creative_brief->>'auto_retried','')||','||status||coalesce(':'||failure_kind,'') FROM ig_posts WHERE id='$B1'")"
check "prod: o pulado não gera evento de novo" "1" "$(PSQL "SELECT count(*) FROM ig_autopilot_events WHERE post_id='$AO' AND kind='post_skipped'")"
PSQL "UPDATE ig_posts SET status='cancelled' WHERE run_id IN ('$RUNA','$NRUN') AND status <> 'cancelled'" >/dev/null
```

(Os workspaces `WID`/`NID` — com plano, programações e posts — já são apagados pela limpeza do fim do smoke.)

- [ ] **Step 3: Rodar o smoke**

Run: `cd /home/doutor/coding/freela/meu-funil && docker compose up -d postgres && scripts/run-capped.sh 1300 bash api/scripts/smoke-capped.sh`
Expected: todos os checks `✓` (inclusive os novos `ig: enviar vídeo…`, `cron media (… produção antecipada …)` e `prod: …`). Um `✗` aponta a tarefa dona: upload → Task 11; `prod: áudio…` → Task 11; `prod: em revisão…` → Task 3; `prod: rodízio`/`pulado`/`resumo` → Task 5; `2ª rodada` → Task 4.

- [ ] **Step 4: Browser-check — gateway falso com Veo, roteiro e crítico de vídeo**

Em `web/scripts/browser-check.mjs`:

Troque `import { execSync, spawn } from 'node:child_process';` por `import { execFileSync, execSync, spawn } from 'node:child_process';`, troque `import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';` por `import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';`, acrescente `import { createRequire } from 'node:module';` depois do import de `node:http` e `import { fileURLToPath } from 'node:url';` depois de `import path from 'node:path';`.

Troque `const fakeAi = { strategy: 0, copy: 0, prompts: [], sdr: null };` por:

```js
const fakeAi = { strategy: 0, copy: 0, prompts: [], sdr: null, videos: [], videoScores: 0 };
```

Logo depois de `let notaN = 0;`, acrescente:

```js
// Produção automática: roteiro de vídeo da IA (narração) e um MP4 de verdade (480×854, 4 s, com som) feito pelo ffmpeg-static da API —
// o Veo falso devolve este arquivo e a API o converte para 1080×1920 com o ffmpeg real. Gerado uma vez, sob demanda.
const roteiroFake = {
  gancho_visual: 'o chope é servido até a borda em câmera lenta',
  sujeito: 'copo de chope gelado com colarinho cremoso',
  cenario: 'balcão de madeira de um bar aconchegante',
  tomadas: [
    { inicio_s: 0, fim_s: 2.5, enquadramento: 'close', acao: 'o chope é servido até a borda', movimento_camera: 'travelling lento para a frente', lente: '85 mm' },
    { inicio_s: 2.5, fim_s: 5.5, enquadramento: 'plano médio', acao: 'a mão desliza o copo até a frente', movimento_camera: 'câmera parada', lente: '50 mm' },
    { inicio_s: 5.5, fim_s: 8, enquadramento: 'plano aberto', acao: 'amigos brindam ao fundo', movimento_camera: 'leve recuo', lente: '35 mm' },
  ],
  iluminacao: 'luz quente de fim de tarde',
  paleta_hex: ['#c0392b', '#f5deb3'],
  estilo: 'comercial realista',
  ritmo: 'abre rápido e fecha firme',
  cta_visual: 'o copo em primeiro plano com o bar desfocado ao fundo',
  audio: { modo: 'narracao', descricao: 'bar ao fundo', fala: 'Hoje tem chope gelado! Reserve sua mesa pelo WhatsApp.' },
  evitar: ['copos de outras marcas'],
};
const requireApi = createRequire(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../api/package.json'));
let videoFalso = null;
const fakeVideo = () => {
  if (videoFalso) return videoFalso;
  const bin = process.env.FFMPEG_PATH || requireApi('ffmpeg-static');
  const dir = mkdtempSync(path.join(tmpdir(), 'mf-bc-video-'));
  const out = path.join(dir, 'veo.mp4');
  execFileSync(bin, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=480x854:rate=30:duration=4', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', out]);
  videoFalso = readFileSync(out);
  rmSync(dir, { recursive: true, force: true });
  return videoFalso;
};
```

No gateway, logo antes de `if (req.url?.endsWith('/images/generations') || req.url?.endsWith('/images/edits')) {`, acrescente:

```js
    // Produção automática (C1): Veo do gateway — POST /v1/videos (registra o corpo), GET /v1/videos/:id (pronto na hora), GET …/content (MP4 real).
    if (req.method === 'POST' && req.url === '/v1/videos') {
      fakeAi.videos.push(body);
      res.end(JSON.stringify({ id: `vid${fakeAi.videos.length}`, status: 'queued' }));
      return;
    }
    const vid = /^\/v1\/videos\/(vid\d+)(\/content)?$/.exec(req.url ?? '');
    if (req.method === 'GET' && vid) {
      if (vid[2]) {
        res.setHeader('Content-Type', 'video/mp4');
        res.end(fakeVideo());
      } else res.end(JSON.stringify({ id: vid[1], status: 'completed' }));
      return;
    }
```

e, logo depois de `else if (name === 'art_direction') out = direcaoDeArte;`, acrescente:

```js
    // Produção automática (C2/C5): roteiro por tomada e crítico de vídeo (1ª nota 20/50 → refação; depois 45/50).
    else if (name === 'video_direction') out = roteiroFake;
    else if (name === 'video_score') {
      const t = fakeAi.videoScores++ === 0 ? 4 : 9;
      out = { roteiro: t, marca: t, tecnica: t, produto: t, scroll: t, motivo: t < 9 ? 'O produto quase não aparece no gancho' : 'Produto claro e gancho forte' };
    }
```

- [ ] **Step 5: Browser-check — o passeio da estratégia vira "Com minha aprovação"**

No "Totalmente automático" a estratégia agora é aprovada sozinha (Task 2); o passeio existente (revisar, refazer, editar e aprovar a estratégia) passa a usar o modo com aprovação. Na seção `instagram`, troque

```js
  if (igAi) {
    await dlg.getByRole('button', { name: /Criar e publicar automaticamente/ }).click();
```

por

```js
  if (igAi) {
    check('programação: no "Totalmente automático" o diálogo explica a produção sem cliques', tem(await dlg.innerText(), 'Sem cliques depois de criar: a estratégia é aprovada sozinha') && tem(await dlg.innerText(), 'refeito pela IA até 2 vezes'));
    // A revisão humana da estratégia (refazer/editar/aprovar) é do modo "Com minha aprovação"; o "Totalmente automático" vem no bloco seguinte.
    await dlg.getByRole('button', { name: /Com minha aprovação/ }).click();
    await dlg.getByRole('button', { name: /Criar e gerar para aprovação/ }).click();
```

Troque a linha `check('API: post automático "publish" com mídia e agendado na fila (sandbox: sem conta)', …);` inteira por:

```js
    check('API: post automático "approval" com mídia, aguardando aprovação', autoPost.automation === 'approval' && autoPost.status === 'pending_approval' && autoPost.media.length === 1 && autoPost.theme === 'Auto 0', JSON.stringify([autoPost.automation, autoPost.status]));
```

e a linha `check('programação: cartão da execução (Em andamento, contagem, "publica sozinho", estratégia aprovada)', …);` inteira por:

```js
    check('programação: cartão da execução (Em andamento, contagem do período, "com aprovação", estratégia aprovada)', tem(await corpo(), 'Em andamento') && tem(await corpo(), '1 conteúdos · 1 produzidos') && tem(await corpo(), 'com aprovação') && tem(await corpo(), 'Estratégia · aprovada') && tem(await corpo(), 'Seus ajustes: foque no prato executivo; nada de promoção'));
```

- [ ] **Step 6: Browser-check — bloco "zero cliques" (Reels amanhã às 12:00, produzido pelo cron)**

Logo depois do bloco

```js
  } else {
    await dlg.getByRole('button', { name: 'Fechar' }).click();
  }
```

(antes de `// ── Resultados: insights da conta + ranking dos publicados ──`), acrescente:

```js
  // ── Produção automática (zero cliques): "Totalmente automático" com 1 Reels amanhã às 12:00 e "Narração curta"; o cron `media` (o mesmo
  //    job do agendador) produz o vídeo sem ninguém clicar — roteiro por tomada, foto do produto como 1º quadro, nota do crítico com 1 refação
  //    e conversão pelo ffmpeg real; sem conta conectada o post fica pronto com o aviso. Depois, o painel de vídeo do editor.
  let fotoProduto = null;
  if (igAi) {
    // foto do produto da marca (referência com a etiqueta "produto"): vira o primeiro quadro do vídeo
    fotoProduto = await page.evaluate(
      async ([base, ws, b64]) => {
        const t = JSON.parse(window.localStorage.getItem('authUser')).access_token;
        const fd = new FormData();
        fd.append('file', new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: 'image/png' }), 'chope-produto.png');
        const r = await fetch(`${base}/v1/workspaces/${ws}/files?kind=brands`, { method: 'POST', headers: { Authorization: `Bearer ${t}` }, body: fd });
        return r.json();
      },
      [API, wsId, PNG_1X1],
    );
    const refProduto = (await apiCall('POST', `/v1/workspaces/${wsId}/brands/${marcaIg.id}/assets`, { kind: 'reference', name: 'chope-produto.png', storage_path: fotoProduto.storage_path, tag: 'produto' })).body;
    check('marca: foto do produto registrada como referência "produto"', refProduto?.tag === 'produto', JSON.stringify(refProduto));

    const amanha = igPsql(`SELECT to_char((now() AT TIME ZONE 'America/Sao_Paulo')::date + 1, 'YYYY-MM-DD')`);
    await page.goto(`${BASE}/instagram?tab=calendar`);
    await page.getByText('Programar com IA').first().waitFor({ timeout: 30000 });
    await page.getByRole('button', { name: 'Nova programação' }).click();
    const dlg2 = page.getByRole('dialog');
    await dlg2.getByText('Nova programação com IA').waitFor({ timeout: 15000 });
    await dlg2.locator('select').first().selectOption({ label: `Plano: ${igSobras.plano}` });
    await dlg2.locator('input[type="date"]').nth(0).fill(amanha);
    await dlg2.locator('input[type="date"]').nth(1).fill(amanha);
    for (const h of ['09:00', '19:00']) await dlg2.getByLabel(`Remover ${h}`).click();
    for (const f of ['Feed', 'Carrossel']) await dlg2.locator('label').filter({ hasText: new RegExp(`^${f}$`) }).locator('button[role="checkbox"]').click();
    await dlg2.getByText(/^1 post\(s\)/).waitFor({ timeout: 20000 });
    const txtDlg2 = await dlg2.innerText();
    for (const t of ['Áudio dos vídeos (Reels e stories em vídeo)', 'Ambiente + trilha', 'Narração curta', 'Sem áudio']) check(`programação: diálogo mostra "${t}"`, tem(txtDlg2, t));
    await dlg2.getByRole('button', { name: /Narração curta/ }).click();
    await dlg2.getByPlaceholder(/Instruções \(opcional\)/).fill('voz feminina calma');
    await dlg2.getByPlaceholder(/Ex\.: Levar público de Valinhos/).fill(OBJETIVO);
    fakeAi.videos.length = 0;
    fakeAi.videoScores = 0;
    await dlg2.getByRole('button', { name: /Criar e publicar automaticamente/ }).click();
    await page.getByText(/Programação criada: 1 posts\./).waitFor({ timeout: 30000 });
    await page.getByText('Programação pronta. Os demais criativos são gerados sozinhos antes de cada horário.').waitFor({ timeout: 180000 });
    ok('programação "Totalmente automático": sem nenhum clique de aprovação até "Programação pronta"');
    const zr = (await apiCall('GET', `/v1/workspaces/${wsId}/ig-auto-runs`)).body[0];
    check('API: "Totalmente automático" aprova a estratégia sozinho e guarda o áudio dos vídeos', zr.mode === 'publish' && zr.strategy_status === 'approved' && zr.video_audio?.modo === 'narracao' && zr.video_audio?.instrucoes === 'voz feminina calma' && zr.counts.total === 1 && zr.counts.queued === 1, JSON.stringify([zr.strategy_status, zr.video_audio, zr.counts]));
    const zp = (await apiCall('GET', `/v1/workspaces/${wsId}/ig-posts`)).body.find((x) => x.run_id === zr.id);
    check('API: o Reels de amanhã nasce como ideia, sem mídia (a produção antecipada é do agendador)', zp?.format === 'reel' && zp.status === 'idea' && zp.media.length === 0, JSON.stringify([zp?.format, zp?.status]));
    check('API: evento "strategy_auto_approved" no piloto', (await apiCall('GET', `/v1/workspaces/${wsId}/ig-autopilot-events?limit=20`)).body.some((e) => e.kind === 'strategy_auto_approved'));

    // post vencido (> 12 h sem criativo) na mesma programação: a produção pula com aviso
    igPsql(`INSERT INTO ig_posts(workspace_id,plan_id,run_id,automation,format,status,theme,scheduled_at) VALUES ('${wsId}','${planoIg.id}','${zr.id}','publish','feed_image','idea','Vencido check', now() - interval '13 hours')`);
    // o cron `media` (o mesmo do agendador), pela rota HTTP com um token próprio
    const tokAntigo = igPsql(`SELECT token FROM cron_tokens WHERE name='instagram'`);
    const tokBc = `bc-cron-${Date.now()}`;
    igPsql(`INSERT INTO cron_tokens(name,token) VALUES ('instagram','${tokBc}') ON CONFLICT (name) DO UPDATE SET token=EXCLUDED.token`);
    limpezas.push(() => igPsql(tokAntigo ? `UPDATE cron_tokens SET token='${tokAntigo}' WHERE name='instagram'` : `DELETE FROM cron_tokens WHERE name='instagram' AND token='${tokBc}'`));
    limpezas.push(() => igPsql(`DELETE FROM cron_heartbeats WHERE name LIKE 'instagram-%' AND last_run_at >= '${igT0}'`));
    const tick = await fetch(`${API}/api/public/cron/instagram`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-cron-secret': tokBc },
      body: JSON.stringify({ task: 'media' }),
      signal: AbortSignal.timeout(300000),
    }).then((r) => r.json());
    check('cron media: a produção antecipada pulou o vencido e produziu o Reels (sem clique)', tick.production?.skipped >= 1 && tick.production?.ready >= 1, JSON.stringify(tick.production));

    const zv = (await apiCall('GET', `/v1/workspaces/${wsId}/ig-posts`)).body.find((x) => x.id === zp.id);
    const vd = zv.creative_brief?.video_direction ?? {};
    const tomadas = vd.direction?.tomadas ?? [];
    check('API: roteiro por tomada (0 a 8 s) com o áudio da programação', tomadas.length === 3 && tomadas[0].inicio_s === 0 && tomadas.at(-1).fim_s === 8 && vd.audio?.modo === 'narracao' && vd.audio?.instrucoes === 'voz feminina calma', JSON.stringify([tomadas.length, vd.audio]));
    check('API: a foto do produto da marca virou o primeiro quadro', vd.first_frame_ref === refProduto.id, JSON.stringify(vd.first_frame_ref));
    check('API: nota do crítico 20/50 → refeito 1×; ficou o de maior nota (45/50)', vd.scores?.length === 2 && vd.scores[0].total === 20 && vd.scores[1].total === 45 && vd.winner_attempt === 2, JSON.stringify(vd.scores));
    check('API: vídeo convertido pelo ffmpeg para o padrão do Instagram (1080×1920, ig_ready)', zv.media?.length === 1 && zv.media[0].type === 'video' && zv.media[0].ig_ready === true && igPsql(`SELECT width||'x'||height FROM media_assets WHERE id='${zv.media[0].asset_id}'`) === '1080x1920', JSON.stringify(zv.media?.[0]));
    check('API: sem conta conectada o post fica pronto com o aviso e sem job simulado', zv.status === 'ready' && zv.last_error === 'Conecte o Instagram para publicar.' && igPsql(`SELECT count(*) FROM publishing_jobs WHERE ig_post_id='${zv.id}'`) === '0', JSON.stringify([zv.status, zv.last_error]));
    check('Veo: 2 pedidos de 8 s, com áudio e o 1º quadro', fakeAi.videos.length === 2 && fakeAi.videos.every((v) => v.parameters?.durationSeconds === 8 && v.parameters?.generateAudio === true && !!v.instances?.[0]?.image?.bytesBase64Encoded), JSON.stringify(fakeAi.videos.map((v) => v.parameters)));
    check('Veo: prompt pt-BR com o roteiro por tomada, a fala e a orientação do cliente', fakeAi.videos.every((v) => {
      const p = v.instances?.[0]?.prompt ?? '';
      return p.includes('Roteiro por tomada:') && p.includes('A voz diz: "Hoje tem chope gelado! Reserve sua mesa pelo WhatsApp."') && p.includes('Orientação do cliente para o áudio: voz feminina calma');
    }));
    check('diretor de vídeo: a refação levou o motivo do crítico', !!fakeAi.prompts.filter((x) => x.name === 'video_direction').at(-1)?.prompt.includes('O CRÍTICO REPROVOU O VÍDEO ANTERIOR (corrija isto com prioridade): «O produto quase não aparece no gancho»'));

    // cartão do período e "Pulados"
    await page.goto(`${BASE}/instagram?tab=calendar`);
    await page.getByText('Programar com IA').first().waitFor({ timeout: 30000 });
    await page.getByText('2 conteúdos · 1 produzidos · 0 produzindo · 0 na fila · 0 agendados · 0 publicados · 1 pulados').waitFor({ timeout: 30000 });
    ok('programação: cartão do período (produzidos / produzindo / na fila / agendados / publicados / pulados)');
    await page.getByText('Pulados (1)').click();
    await page.getByText(/Vencido check · .+ — o horário passou há mais de 12 h sem o criativo pronto\./).waitFor({ timeout: 10000 });
    ok('programação: "Pulados (1)" lista o post pulado com o motivo');

    // Visão geral: eventos novos no piloto e o editor do Reels (painel de vídeo)
    await page.goto(`${BASE}/instagram`);
    await page.getByText('Fila dos próximos 7 dias').waitFor({ timeout: 30000 });
    await page.getByText('Vídeo refeito ·').first().waitFor({ timeout: 30000 });
    const txtOv = await corpo();
    for (const t of ['Estratégia aprovada ·', 'Pulado ·', 'Vídeo refeito ·']) check(`piloto automático: evento "${t.replace(' ·', '')}" no painel`, tem(txtOv, t));
    await page.locator('button', { hasText: 'Auto 0' }).first().click();
    await page.getByRole('heading', { name: /^Reels/ }).waitFor({ timeout: 15000 });
    await page.getByText('Roteiro do vídeo').waitFor({ timeout: 15000 });
    const txtVid = await corpo();
    for (const t of ['Roteiro final enviado ao gerador de vídeo (editável)', 'Tomadas', '0s–2,5s', 'Áudio deste vídeo', 'Nota do crítico: 45/50', 'refeito 1× · ficou o de maior nota', 'Salvar roteiro e áudio', 'Regenerar vídeo']) {
      check(`editor do Reels mostra "${t}"`, tem(txtVid, t));
    }
    await page.locator('#video-audio-mode').selectOption('sem_audio');
    await page.getByRole('button', { name: 'Salvar roteiro e áudio' }).click();
    await page.getByText('Roteiro e áudio salvos. Clique em Regenerar vídeo para usar.').waitFor({ timeout: 15000 });
    const salvo = (await apiCall('GET', `/v1/workspaces/${wsId}/ig-posts`)).body.find((x) => x.id === zp.id);
    check('API: o editor salvou o áudio do post (Sem áudio) e o roteiro igual ao gerado não vira override', salvo.creative_brief.audio?.modo === 'sem_audio' && salvo.creative_brief.visual_prompt_override === null, JSON.stringify([salvo.creative_brief.audio, salvo.creative_brief.visual_prompt_override]));
    const antesVideos = fakeAi.videos.length;
    await page.getByRole('button', { name: 'Regenerar vídeo' }).click();
    await page.getByText('Vídeo enviado para geração: ele aparece aqui quando ficar pronto.').waitFor({ timeout: 180000 });
    const ultimo = fakeAi.videos.at(-1);
    check('Regenerar vídeo: novo pedido ao Veo sem áudio e com "Áudio: nenhum (vídeo sem som)." no roteiro', fakeAi.videos.length === antesVideos + 1 && ultimo?.parameters?.generateAudio === false && (ultimo?.instances?.[0]?.prompt ?? '').includes('Áudio: nenhum (vídeo sem som).'), JSON.stringify(ultimo?.parameters));
    await page.keyboard.press('Escape');
  }
```

Na limpeza do fim da seção, troque

```js
  const idsMidia = igPsql(`SELECT string_agg(id::text, ',') FROM media_assets WHERE workspace_id='${wsId}' AND ig_post_id IS NOT NULL AND created_at >= '${igT0}'`);
```

por

```js
  // toda mídia criada pela seção (vídeos originais, convertidos e capas incluídos)
  const idsMidia = igPsql(`SELECT string_agg(id::text, ',') FROM media_assets WHERE workspace_id='${wsId}' AND created_at >= '${igT0}'`);
```

e, logo antes de `await apiCall('DELETE', \`/v1/workspaces/${wsId}/brands/${marcaIg.id}\`);`, acrescente:

```js
  if (fotoProduto?.key) await apiCall('DELETE', `/v1/workspaces/${wsId}/files?key=${encodeURIComponent(fotoProduto.key)}`);
```

- [ ] **Step 7: Rodar o browser-check (grupos 3 e 4)**

Run: `cd /home/doutor/coding/freela/meu-funil && bash web/scripts/browser-check-sections.sh 3 4`
Expected: os dois grupos terminam sem `FALHA` (o grupo 3 confere que o Estúdio segue igual com as referências por `/images/edits` da Task 7; o grupo 4 roda o passeio do Instagram com o bloco "zero cliques"). Se um grupo morrer com 137, reparta o grupo — não suba o teto.

- [ ] **Step 8: Contrato, README e CLAUDE.md**

Em `docs/api-contract.md`, na linha `` | `GET /ig-autopilot-events[?limit=20]` | eventos `created_at` desc (máx. 100) | ``, troque `eventos \`created_at\` desc (máx. 100)` por `eventos \`created_at\` desc (máx. 100). \`kind\` ganha, com a produção automática: \`strategy_auto_approved\`, \`post_rewritten\`, \`post_skipped\` e \`video_regenerated\``.

Confira que as tarefas anteriores deixaram o contrato completo — cada comando abaixo precisa imprimir um número ≥ 1 (se algum der 0, aplique agora o passo "Contrato" da tarefa indicada):

```bash
cd /home/doutor/coding/freela/meu-funil
for s in review_attempts:4 failure_kind:4 strategy_auto_approved:2 'reescreve sozinha:3' 'produção antecipada:5' skipped_posts:5 'Gateway sem suporte a referência:7' 'veo-3.1-fast-generate-preview:8' video_direction:11 videoAudio:11 'convertido pelo ffmpeg:11'; do printf '%s (Task %s): ' "${s%:*}" "${s##*:}"; grep -c -- "${s%:*}" docs/api-contract.md; done
```

Em `README.md`, logo depois do bullet que começa com `` - `SCHEDULER_ENABLED` ``, acrescente:

```markdown
- Produção automática do Instagram (programações "Totalmente automático"): `IG_PRODUCTION_PER_TICK` (4 posts por rodada do job `instagram-media-5min`, no máximo 1 por empresa), `IG_PRODUCTION_WINDOW_HOURS` (48: começa a produzir 48 h antes do horário), `IG_PRODUCTION_TARGET_HOURS` (24: quem já está a menos de 24 h do horário vai primeiro) e `MIN_VIDEO_SCORE` (28 de 50: abaixo disso o vídeo é refeito 1 vez e fica o de maior nota).
- `FFMPEG_PATH` — ffmpeg da conversão de vídeos para o padrão do Instagram e dos quadros do crítico de vídeo. Vazio = binário do pacote `ffmpeg-static` (vem no `npm install`); a imagem Docker instala o ffmpeg do Alpine e usa `/usr/bin/ffmpeg`. Cada chamada tem tempo-limite de 120 s e usa um diretório temporário próprio em `UPLOADS_DIR/.ffmpeg-tmp/` (apagado no fim).
```

Em `CLAUDE.md`, no bullet **Instagram**, troque `O \`pollPendingCreatives\` NÃO roda no cron do Instagram (já é o job \`creative-poll-5min\`).` por:

```markdown
O `pollPendingCreatives` NÃO roda no cron do Instagram (já é o job `creative-poll-5min`). Produção automática (05/10/2026): o job `instagram-media-5min` roda `autoCalendarTick` (estratégia automática, reescrita dos reprovados do modo `publish`, agendar prontos) → `ProductionService.productionTick` (criativos das programações entre 48 h e 24 h antes, 1 post por empresa por rodada, pulados > 12 h) → `autopilotTick` (só posts de plano, `automation = null`). ffmpeg só pela porta `FFMPEG_RUNNER`/`FfmpegService` (temporários em `UPLOADS_DIR/.ffmpeg-tmp`; runner falso no jest, binário real só no smoke/browser-check).
```

- [ ] **Step 9: Verificação final (uma coisa pesada por vez)**

Run: `cd api && ../scripts/run-capped.sh 1500 npm test`
Expected: PASS (suíte inteira).

Run: `cd api && ../scripts/run-capped.sh 1500 npm run typecheck`
Expected: sem erros.

Run: `cd api && ../scripts/run-capped.sh 1500 npm run lint`
Expected: sem erros.

Run: `cd web && ../scripts/run-capped.sh 1500 yarn test`
Expected: PASS.

Run: `cd web && ../scripts/run-capped.sh 1500 yarn typecheck`
Expected: sem erros.

Run: `cd web && ../scripts/run-capped.sh 1500 yarn lint`
Expected: sem erros.

Run: `cd /home/doutor/coding/freela/meu-funil && scripts/run-capped.sh 1300 bash api/scripts/smoke-capped.sh`
Expected: todos `✓`.

Run: `cd /home/doutor/coding/freela/meu-funil && bash web/scripts/browser-check-sections.sh 3 4`
Expected: sem `FALHA`.

Run: `cd /home/doutor/coding/freela/meu-funil && docker compose stop postgres`
Expected: contêiner `meu-funil-postgres` parado.

- [ ] **Step 10: Commit**

```bash
git add api/scripts/smoke.sh web/scripts/browser-check.mjs docs/api-contract.md README.md CLAUDE.md
git commit -m "test: smoke e browser-check da produção automática sem cliques (vídeo real pelo ffmpeg) e documentação

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
