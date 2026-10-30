# Estrategista conduz — entrega da noite de 29→30/10/2026

Branch local `feat/estrategista-conduz` (sobre `master` `5494fff`). **Nada foi pushado nem subido.** As migrações novas foram aplicadas só no banco LOCAL.
Spec: `docs/superpowers/specs/2026-10-29-estrategista-conduz-design.md` (§0.8 = respostas do dono) e `…-ui.md`. Planos: `docs/superpowers/plans/2026-10-29-estrategista-{f0-seguranca-meta,f1-intake,f2-regiao,f5f6-estilo}.md`.

## O que ficou pronto

- **F0 (todas as empresas):** conjunto da Meta com `end_time` = último dia 23:59 (Brasília); sem verba → `BUDGET_MISSING` (antes R$ 20 calado; vale para Google/TikTok); cidade resolvida antes de criar qualquer coisa, UF/estado escolhem a cidade certa, cidade não achada → `GEO_UNRESOLVED` (nunca "Brasil inteiro" por engano); período vencido → `PERIOD_ENDED`, termina hoje → `PERIOD_TOO_SHORT`; `PATCH …/budget` e `…/location`; avisos na tela; SQL só de leitura `api/scripts/ops/campanhas-meta-sem-fim.sql`.
- **F1 (empresas em `CAMPAIGN_INTAKE_WORKSPACE_IDS`):** "Conte o que você quer" → "Entendi" com até 3 perguntas (verba → destino → condições da oferta) e região; `POST …/campaigns/intake` (datas, verba e link decididos no servidor); `GET /v1/workspaces/:ws/features`; `intake_text` e `offer_terms` viram restrição nos prompts do estrategista e da copy.
- **F2 (todas):** região como dado (`geo_targets`: cidade da Meta + raio 17–80 km ou só a cidade), busca `GET …/geo/search`, `PATCH …/geo-targets`, seletor na conversa e no detalhe.
- **F5/F6:** "Estilo das artes" na aba Briefing: enviar imagem (JPG/PNG); com `STYLE_REFS_PINTEREST_ENABLED=true`, colar Pin, pasta ou perfil público do Pinterest (pasta vira fonte renovada todo dia pelo RSS, até 8 Pins novos por vez). A IA de visão escreve as notas de estilo; **só o texto** chega ao diretor de arte e ao de vídeo — o pixel de terceiro nunca vai ao gerador, à Biblioteca, à Meta ou ao Instagram (bucket `style-refs` é só de tela). Job `style-refs-15min`.
- **Não construído:** F3/F4 (o piloto que conduz sozinho até o anúncio pausado + conferência "Ligar"). Ficam para a próxima sessão, depois de uma campanha real passar pela F1.

Cada fatia: TDD por arquivo, revisão do `software-architect` (opus) e uma rodada de correção; revisão de telas do `ux-designer` com uma rodada de correção. Verificação: jest por arquivo, vitest por arquivo, eslint dos arquivos tocados, `tsc` da API e do web (0 erros), subida local da API (rotas mapeadas). **A suíte inteira não foi rodada** (trava a máquina) — fica com o CI.

## Como subir (Denner, pela ordem)

1. Push do branch (via `!`, como sempre): `git push origin feat/estrategista-conduz` — e, depois de conferir, levar para `stack-freela`.
2. EC2 (`/opt/meu-funil`): backup `pg_dump -Fc` + tag da imagem `meufunil-api:pre-2026-10-30`.
3. tar/scp/build/up da API como no `docs/deploy.md`. Quatro migrações novas sobem no boot: `20261029120000_campaign_intake`, `20261029130000_campaign_geo_targets`, `20261029140000_style_references`, `20261029150000_style_ref_sources_seen` (todas aditivas).
4. No `/opt/meu-funil/.env` (a produção usa `env_file`; o compose não é atualizado): `CAMPAIGN_INTAKE_WORKSPACE_IDS=7309ae62-15c2-48d3-8990-4dbe75a29c4e` e, **só depois do teste do item 6**, `STYLE_REFS_PINTEREST_ENABLED=true` → `up -d --force-recreate api`.
5. Web: cópia sem git → Vercel prod (como no `docs/deploy.md`).
6. Antes de ligar o Pinterest, de dentro do EC2: `curl -sS https://www.pinterest.com/pinterest/feed.rss | head -c 300` — se não vier `<?xml … <rss`, o Pinterest barra o IP da nuvem; aí fica só o envio de imagem.
7. Depois de subir: a lista só de leitura das campanhas ligadas antes da data de fim (`docs/deploy.md` §4b).

## Para o Diego (operação)

- A "1ª contratação grátis" é o **cupom de 100% de uso único** do freela-admin (`/cupons`), criado **à mão** por contratante depois que a empresa se cadastra (o admin mostra a origem "Campanha/UTM"). O anúncio nunca promete desconto automático no pagamento — as condições escritas no "Entendi" viram regra do estrategista e da copy.
- Destino para colar no "Entendi": `https://www.freelaservicos.com.br/cadastro?perfil=empresa` (o sistema acrescenta `utm_source=meta&utm_medium=paid&utm_campaign=<nome>`).
- Pinterest: colar o link de uma pasta pública com o estilo desejado; ela é relida todo dia.
- A Meta da empresa Freela App no Meu Funil **não foi conferida** (a leitura da produção foi barrada e o Claude in Chrome não estava ligado). Conferir em Integrações antes de publicar.

## Commits

```
3704214 fix(telas): correções da revisão do designer
9ca46fe fix(style-refs): correções da revisão das Fatias 5/6
3e4e26d feat(web): estilo das artes (envio e Pinterest)
173d4aa fix(região): correções da revisão da Fatia 2
5bdaf3f feat(style-refs): rotas, renovação automática e notas no diretor de arte
bb548b4 feat(style-refs): referências de estilo (envio, Pin e pasta do Pinterest)
5606080 fix(intake): correções da revisão da Fatia 1
a3cf63f feat(style-refs): regras do Pinterest (Pin, pasta e perfil por RSS)
acd00c6 docs(plano): Fatias 5 e 6 do estrategista (estilo das artes e Pinterest automático)
41921ee feat(web): região com cidade da Meta e raio
22808a3 feat(ads): busca de cidade da Meta para a região
ab59bcc feat(campaigns): região estruturada (cidade + raio) usada no publicar
de87c1b docs(plano): Fatia 2 do estrategista (região com raio)
c0177cb feat(web): nova campanha por conversa (Conte o que você quer)
7c96227 fix(ads): link do Google/TikTok mantém o tipo dentro da chamada (tsc)
8e68d74 fix(ads,campaigns): correções da revisão da Fatia 0
372a2e3 feat(campaigns): estrategista entende o pedido em texto (intake)
1195cc6 feat(campaigns): pedido original e condições da oferta como regra dos prompts
a94537c feat(features): liberação por empresa e GET /features
d4fa61d docs(plano): Fatia 1 do estrategista (Conte o que você quer)
c74c6aa docs(ops): lista das campanhas da Meta ligadas antes da data de fim
b166f3c feat(web): avisos de verba e cidade antes de publicar na Meta
d7f128b feat(campaigns): ajustar verba e cidade antes de publicar
edfbbb3 fix(ads): anúncio da Meta com data de fim, verba obrigatória e cidade de verdade
30ebbd0 docs(plano): Fatia 0 do estrategista (data de fim, verba e cidade na Meta)
```

## Decisões que tomei (Ruling) — o custo se estiver errado está em cada linha

### Fatia 0 — data de fim, verba e cidade na Meta

- Task 1: Ruling: suíte inteira não roda nesta máquina (trava; regra do CLAUDE.md) — rodei os 3 arquivos tocados (meta-ads 31/31, channels 16/16, campaign-end 11/11) — custo: regressão em outro módulo só aparece no CI/smoke
- Task 1: Ruling: smoke.sh e browser-check criam a campanha com audience.localizacao 'Valinhos, SP' — sem cidade a publicação agora é recusada — custo: nenhum
- Task 1: Ruling: UTM mantém utm_medium=paid (não paid_social da §0.8) — já é o que está no ar e o admin do Freela lê qualquer valor — custo: só nome
- Task 3: Ruling: web sem teste de componente (o projeto testa a tela no browser-check, pesado demais para rodar à noite) — verificado com eslint + tsc do web (0 erros) — custo: comportamento visual só conferido no browser-check/uso
- Final: Ruling: parseReais "1.500" → 1,5 (Minor do revisor) re-graduado para Important — é dinheiro digitado na tela — entra na rodada de correção
- Final: Ruling: Google/TikTok sem data de fim — §0.3 só cobre a Meta — custo: anúncio desses canais roda até pausar (como antes)
- Final: Ruling: start_time não vem do start_date — a Meta começa ao ligar, e ligar é manual — custo: campanha ligada antes do início começa antes
- Final: Ruling: apply-recommendation activate_ad/increase_budget depois do período — fora do escopo da §0.7 #3 — custo: otimizador pode religar anúncio depois do fim (campanhas novas param pelo end_time)
- Final: Ruling: withUtm checa só utm_source — link com só utm_campaign ganha duplicata — custo: UTM repetida em link raro

### Fatia 1 — "Conte o que você quer"

- Ruling: intake sem previous_draft/answers (a tela aplica as respostas localmente e reenviar refaz do texto) — YAGNI — custo: refinamento por conversa fica para depois
- Ruling: botão Falar (Web Speech) fica de fora na F1 — o microfone do teclado já funciona em qualquer caixa — custo: um toque a mais no Android
- Task 2: Ruling: migração escrita à mão, sem rodar migrate (banco local parado à noite; aditiva e simples) — custo: erro de SQL só aparece na subida (o smoke aplica as migrações)
- Task 2: Ruling (atualizada): migração aplicada no banco LOCAL com prisma migrate deploy → colunas intake_text/offer_terms criadas
- Task 3: Ruling: verba aceita só com R$/reais escrito (não qualquer número) — '30 dias' não pode virar R$ 30/dia — custo: 'verba de 30 por dia' sem R$ vira pergunta
- Task 4: Ruling: destino na conversa = só link de página; objetivo leads vira traffic com a frase em "Considerei que" — o caso do Freela é a página de cadastro e o formulário da Meta pede link de privacidade — custo: quem quer formulário vai em Ver/ajustar
- Task 4: Ruling: rótulos das condições genéricos ("A taxa do serviço", "A diária do profissional", "As duas", "Escrever") em vez de "do Freela" — o Meu Funil serve outras empresas — custo: nenhum

### Fatia 2 — região com raio (+ revisão do designer)

- Task 1: Ruling: setLocation (texto livre) zera geo_targets — senão haveria duas verdades e o publicar ignoraria o texto novo — custo: quem usa o texto perde o raio escolhido
- Task 3: Ruling: seletor com UMA cidade na v1 (a API aceita até 10) — o pedido do Diego é uma cidade e "+ Adicionar outra cidade" aumenta a tela — custo: duas cidades só pelo texto ("Jundiaí e Campinas") no formulário
- Task 3: Ruling: testes das funções puras do seletor escritos depois do componente — custo: nenhum vermelho visto nesses 2 testes
- Final: Ruling: formato {key, radius, distance_unit} e faixa 17–80 km confiados na doc de Basic Targeting citada pelo designer (o revisor não leu a página oficial) — custo: se a Meta mudar a faixa, o 400 vem da Meta no publicar
- Final: fixed I2 raio inválido vai adiante (validação/400) — sem teste de componente ( Ruling: UI; verificado por lint/tsc)
- Final: fixed I3 detalhe sem laço — sem teste de componente ( Ruling: UI; verificado por lint/tsc)
- Final: Ruling (Depois): raio escolhido não aparece no Briefing; StatCards acima dos avisos no celular; [Mudar] no "Considerei que"; Falar; várias cidades no seletor

### Fatias 5 e 6 — estilo das artes e Pinterest

- Ruling: só imagem na v1 (vídeo enviado depois; Pin de vídeo = capa) — FfmpegService não tem probe de duração e o teste de vídeo local é pesado — custo: movimento de vídeo não vira referência ainda
- Ruling: além do Pin, pasta/perfil do Pinterest por RSS com renovação a cada 24 h — é o "puxar automático" pedido pelo dono (§0.8 #5) — custo: depende do RSS público do Pinterest (não documentado)
- Task 1: Ruling: decodificação/redução pelo ImageService do projeto (guarda de imagem-bomba e jest) em vez de Jimp direto — custo: nenhum
- Task 1: Ruling: "Parar" uma pasta apaga as referências que vieram dela — senão ocupariam o teto de 30 sem renovar — custo: quem quer manter precisa reenviar
- Task 1: Ruling: teste de features.style_refs_pinterest escrito junto com a implementação (sem vermelho visto)
- Task 2: Ruling: no Instagram, a campanha das notas vem do creative_brief.campaign_id (posts de programação usam só as referências da marca) — custo: referência específica de campanha não orienta post de programação automática
- Final: fixed I7 log em vez de engolir + aviso na subida — sem teste ( Ruling: log)
- Final: Ruling: % quebrado no link (Minor do revisor) re-graduado e corrigido — é entrada do usuário e dava 500 — '% quebrado no caminho' RED→GREEN

## Pendências menores (deferidas)

### Fatia 0 — data de fim, verba e cidade na Meta

- setStatus do Google/TikTok não recusa PERIOD_ENDED (create recusa)
- cidades achadas em parte somem sem aviso (unresolved[] não implementado)
- com cidade preenchida, o aviso da cidade só aparece depois de um publicar que falhou (geoProblem some ao recarregar)
- status active sem metaId esconde os avisos mas mostra "Publicar na Meta"
- GEO_UNRESOLVED grava publishing_jobs failed; BUDGET_MISSING/PERIOD_ENDED não
- a SQL lista só meta_delivery_status ACTIVE; pausadas antigas com fim futuro podem ser religadas sem data de fim
- piso de R$ 1 por conjunto aumenta verba pequena sem aviso (já existia)

### Fatia 1 — "Conte o que você quer"

- formulário pisca antes do painel enquanto features/marcas carregam
- trocar a marca ou o texto depois do Entendi mantém o rascunho antigo
- inicio_data inválido vira hoje sem suposição; "30 dias" pode virar 30 leads
- sugestão "Usar o último" é da empresa, não da marca (agência)
- teste de "marca de outra empresa" cai no 403 do acesso, não prova o 404 da marca
- guia novo aparece também para empresas fora da lista
- foco do erro em "Outro"/"Escrever" cai no 1º botão; controles ativos enquanto cria
- create não confere total ≥ dia nem valid_until ≥ hoje
- offerConstraint não escapa aspas/quebras (texto da própria empresa)
- docs/deploy/.env.prod.example sem CAMPAIGN_INTAKE_WORKSPACE_IDS (vai no recado do deploy)

### Fatia 2 — região com raio (+ revisão do designer)

- resposta antiga da busca pode sobrescrever a lista (sem sequência/abort); lista reaparece depois de escolher
- resultados e "Não achamos" sem role=status; chips com aria-pressed (igual aos que já existem)
- ?q=a&q=b vira array → 500 na busca
- chaves repetidas em geo_targets não são removidas no publicar
- atividade geo_updated sem from
- readGeoTargets cala linha inválida (publica pelo texto sem aviso)
- RegionPicker descarta a mensagem da API no erro; setCampaignLocation ficou sem uso no web
- "Mandar de novo" zera as respostas; botão fixo sem safe-area; carregamento sem role=status; chips sem aria-invalid; "Outro" sem label visível
- sem botão "Abrir integrações" quando a IA não está configurada
- pergunta da oferta repete o "Vale até" (trocar por "O que exatamente é grátis ou oferecido?")
- "Criando a campanha…" sem aviso de que leva até 1 minuto; "Copy gerada com {engine}"
- "Só a cidade" → "Só {cidade}"; "Outra distância" vazia vira raio 0 e a frase diz "Só Jundiaí."; sem "Use um número de 17 a 80."
- quem só edita, depois da aprovação, recebe "Ajustar" que não leva a lugar nenhum
- nomes desiguais ("teto do mês" × "verba total"; "cidade" × "região")
- erro do link do Pinterest só em toast; "Parar" deveria dizer que tira os Pins
- guides.ts campaign/campaignNew com textos a ajustar (passo 5 do guia da campanha errado)

### Fatias 5 e 6 — estilo das artes e Pinterest

- pasta fora do padrão de nome vira o perfil inteiro; url_shortener fora de RESERVED; maiúsculas diferentes criam 2ª fonte
- fonte gravada mesmo quando a 1ª leitura falha (ocupa 1 das 5)
- take: 200 global na renovação (muitas fontes ficam sem renovar)
- makeRoom do envio despeja antes de o store dar certo
- falha passageira da IA vira failed para sempre (sem nova tentativa)
- CASCADE de marca/campanha/fonte deixa JPEGs órfãos no bucket

