# Fatias 5 e 6 — Estilo das artes: referências por envio e Pinterest automático — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A empresa mostra o estilo que quer (imagem enviada, link de um Pin, ou uma pasta/perfil do Pinterest que o sistema acompanha sozinho); a IA de visão descreve o estilo em texto e esse texto orienta o diretor de arte e o de vídeo — o pixel de terceiro nunca vai ao gerador nem é publicado.

**Architecture:** Módulo novo `api/src/modules/style-refs` com duas tabelas: `style_references` (cada referência: origem, imagem ≤ 1024 px guardada só para mostrar na tela, notas de estilo) e `style_ref_sources` (pastas/perfis do Pinterest acompanhados por RSS). Um job (`style-refs-15min`) lê as referências pendentes e renova as fontes a cada 24 h. `RefsService.loadStyleNotes` entrega o texto ao `ArtBrief`/`VideoBrief`.

**Tech Stack:** NestJS + Prisma (jest com `EXTERNAL_FETCH` e IA falsos), Jimp (redução), Next.js.

**Spec:** `docs/superpowers/specs/2026-10-29-estrategista-conduz-design.md` §2.3, §0.2 anti-objetivo 5, §0.8 #5 (RSS testado em 29/10); tela `…-ui.md` §E.

## Global Constraints

- Pixel de terceiro nunca entra em `referenceImages`, primeiro quadro de vídeo, crítico, Biblioteca, Meta ou Instagram: só o texto das notas vai ao gerador, delimitado por "INSPIRAÇÃO DE ESTILO (não copie composição, pessoas, marcas nem textos)".
- Pinterest só com `STYLE_REFS_PINTEREST_ENABLED=true` (fora: rotas do Pinterest 404 e `features.style_refs_pinterest = false`). Envio de imagem vale para todas as empresas.
- Download só de `i.pinimg.com` (e do próprio `*.pinterest.com` para RSS/oEmbed/HTML), https, `image/(jpeg|png|webp)`, ≤ 15 MB, redirecionamento seguido à mão com a allowlist checada a cada salto, via `EXTERNAL_FETCH` (guarda de SSRF).
- RSS: pasta `https://<x>.pinterest.com/<user>/<pasta>/` → `<…>/<pasta>.rss`; perfil `https://<x>.pinterest.com/<user>/` → `<…>/<user>/feed.rss`; imagem do item = `i.pinimg.com/236x/…` trocado por `736x`.
- Tetos: 30 referências por marca (as mais antigas vindas de RSS saem primeiro; enviadas e Pins colados não saem sozinhos), 8 por campanha no texto do gerador, 5 fontes por marca, 8 Pins novos por fonte a cada renovação.
- Imagem guardada reduzida a ≤ 1024 px (JPEG), em `FilesService` bucket `style-refs`.
- Só imagem na v1 (vídeo enviado fica para depois; Pin de vídeo = a capa).
- Testes: um arquivo por comando via `scripts/run-capped.sh`.

## Review Focus

1. Link de Pin pelo `pin.it` que redireciona para fora do Pinterest → recusado ("Esse link não é de um Pin…").
2. A mesma pasta colada duas vezes → a mesma fonte (sem duplicar), e Pins repetidos entre renovações não duplicam (`pin_id` único por marca).
3. Pinterest fora do ar / RSS vazio → a fonte mostra o erro e as referências antigas continuam valendo.
4. IA de visão falha numa referência → só ela fica `failed` com a frase; as outras seguem.
5. Criativo gerado com referências prontas → o prompt do diretor de arte tem as notas e nenhum byte da referência vai como imagem.

---

### Task 1: Tabelas, regras puras do Pinterest e o serviço (envio, Pin, pasta)

**Files:**
- Create: `api/prisma/migrations/20261029140000_style_references/migration.sql`; Modify: `api/prisma/schema.prisma`
- Create: `api/src/modules/style-refs/pinterest.ts` (puro), `style-refs.service.ts`, `style-notes.ts` (schema da visão + texto), `style-refs.module.ts`
- Modify: `api/src/common/config/env.validation.ts` (`STYLE_REFS_PINTEREST_ENABLED`), `api/.env.example`, `docker-compose.yml`, `api/src/modules/workspaces/features.service.ts`, `api/src/app.module.ts`
- Test: `api/src/modules/style-refs/__tests__/pinterest.spec.ts`, `api/src/modules/style-refs/__tests__/style-refs.service.spec.ts`

**Interfaces:**
- Produces (puro): `parsePinterestLink(raw: string): { kind: 'pin'; pinId: string; url: string } | { kind: 'shortlink'; url: string } | { kind: 'board' | 'profile'; url: string; rssUrl: string } | null`; `parseRss(xml: string): { pinId: string; link: string; imageUrl: string; title: string }[]` (imagem em 736x); `pinImageFromOembed(json): string | null`; `ogImage(html): string | null`.
- Produces (serviço): `StyleRefsService.list(userId, ws, brandId, campaignId?)` → `{ refs: StyleRefView[]; sources: SourceView[]; limits }`; `upload(userId, ws, brandId, file, campaignId?)`; `addPinterest(userId, ws, brandId, url, campaignId?)` (Pin → 1 referência; pasta/perfil → fonte + até 8 referências); `remove(userId, ws, brandId, id)`; `removeSource(...)`; `processPending(limit)`; `refreshDueSources(limit)`; `loadStyleNotes(ws, brandId, campaignId): Promise<string | null>`.
- `StyleRefView = { id, source: 'upload'|'pinterest', source_url, title, status: 'processing'|'ready'|'failed', summary: string | null, error: string | null, image_url (assinada), campaign_id, created_at }`.
- Notas (schema estrito da visão): `{ paleta: string[]; composicao: string; luz: string; enquadramento: string; clima: string; evitar: string[] }`; `summary` = "cores …, luz …, …" em pt-BR.
- [ ] Testes puros: Pin `br.pinterest.com/pin/123/` → `www.pinterest.com/pin/123/`; `pin.it/abc` → shortlink; pasta → rss `…/pasta.rss`; perfil → `…/feed.rss`; link de outro site → null; RSS de exemplo (2 itens) → `pinId` do link e imagem em 736x; oEmbed e `og:image`.
- [ ] Testes do serviço (Prisma em memória, fetch e IA falsos): envio grava `processing`, `processPending` chama a visão com a imagem e grava as notas (`ready`); falha da visão → `failed` "Não conseguimos ler o estilo desta referência. Remova e tente outra."; Pin colado duas vezes → "Esse Pin já está nas referências."; `pin.it` que redireciona para fora → recusa; pasta → fonte + 8 referências; a mesma pasta de novo → mesma fonte; Pinterest desligado → 404; teto de 30 apaga a referência de RSS mais antiga; `loadStyleNotes` monta o texto com até 8 e `null` sem nenhuma pronta.
- [ ] Ver falhar → implementar → ver passar → commit `feat(style-refs): referências de estilo (envio, Pin e pasta do Pinterest)`

### Task 2: Rotas, job e o texto no diretor de arte e no de vídeo

**Files:**
- Create: `api/src/modules/style-refs/style-refs.controller.ts`, `style-refs-cron.service.ts`
- Modify: `api/src/modules/scheduler/job-schedules.ts` (`style-refs-15min`, `*/15 * * * *`), `api/src/modules/creative/art-director.ts` (`ArtBrief.styleNotes`), `video-director.ts` (`VideoBrief.styleNotes`), `creative.service.ts`, `api/src/modules/instagram/media-generation.service.ts`, `docs/api-contract.md` (§ nova "Estilo das artes")
- Test: `api/src/modules/creative/__tests__/` (spec do art-director que já existir) + `style-refs.service.spec.ts`

**Interfaces:**
- Rotas (WorkspaceAccessGuard; GET read, resto write): `GET /v1/workspaces/:ws/brands/:brandId/style-refs?campaign_id=`, `POST …/style-refs/upload` (multipart `file`, campo `campaign_id`), `POST …/style-refs/pinterest {url, campaign_id?}`, `DELETE …/style-refs/:id`, `DELETE …/style-refs/sources/:sourceId`.
- [ ] Testes: `buildVisualPrompt` com `styleNotes` põe a linha "INSPIRAÇÃO DE ESTILO (não copie composição, pessoas, marcas nem textos): …" e sem notas não põe; `videoDirectorPrompt` idem; o job processa pendentes e renova fontes com mais de 24 h.
- [ ] Ver falhar → implementar → ver passar → commit `feat(style-refs): rotas, renovação automática e notas no diretor de arte`

### Task 3: Web — "Estilo das artes"

**Files:**
- Create: `web/src/modules/style-refs/infrastructure/style-refs.api.ts`, `web/src/components/style-refs-panel.tsx`
- Modify: `web/src/app/(app)/campaigns/[id]/CampaignDetail.tsx` (aba Briefing)

- [ ] Painel com o texto da ux §E; "Enviar imagem"; com `style_refs_pinterest`: campo "Link do Pinterest (Pin, pasta ou perfil)" + [Usar] e a lista "Pastas acompanhadas" (título, "atualizada em DD/MM", erro, [Parar]); cada referência com miniatura, "O que eu peguei: …", estado ("Lendo o estilo…" com `role=status`), [Remover] com o toast "Referência removida."; contador "N de 8 referências nesta campanha"; mensagens de erro da ux §E.
- [ ] eslint + `yarn typecheck` → commit `feat(web): estilo das artes (envio e Pinterest)`
