# Stories automáticos das vagas do Freela — design

**Data:** 28/10/2026 · **Projeto:** `meu-funil` (API NestJS em `api/`, web Next.js em `web/`)
**Pedido (Denner, repassando o Diego):** "Disparo de vagas automático no instagram seguindo template pronto." Sobre o template:
"Acho que é mandar algum template pronto e a ia já seguir ou deixar salvo." Formato: "Um story por vaga." Exemplo enviado: uma arte
2:3 (1024×1536) feita por IA de imagem — logo do Freela, faixa "VAGA / AUXILIAR DE LIMPEZA / FREELANCER", foto de uma pessoa fazendo a
função no estabelecimento, cartões (Estabelecimento, Função, Data + Horário, Região, Endereço, Valor para o freela, Descrição, Ver vaga +
link), rodapé preto com logo e selos Google Play / App Store. O dono confirmou que a arte saiu de uma IA de imagem ("Isso") e aprovou o
resumo do fluxo ("Tá legal assim, pode seguir").

## 1. Intenção

Cada vaga nova publicada no Freela vira, sozinha, um story no Instagram do Freela, com a cara do modelo que o dono enviou. Ninguém
precisa montar arte. O objetivo é que mais freelancers vejam a vaga e se candidatem ou baixem o app.

**Sucesso:** toda vaga nova elegível aparece em story no mesmo dia, com função, data, horário, cidade e valor **certos**, no estilo do
modelo, sem ninguém abrir o Canva.

## 2. Objetivos, não objetivos e anti-objetivos

**Objetivos**
- Detectar vagas novas do Freela sozinho e gerar 1 story por vaga.
- Salvar o modelo de arte enviado pelo dono e usá-lo como referência visual em toda geração.
- Conferir o texto da arte gerada contra os dados da vaga antes de postar.
- Tudo configurável por empresa (ligar/desligar, cidades, janela de horário, limite por dia, IA, aprovar antes ou postar sozinho).

**Não objetivos (fica para depois)**
- Endereço, bairro/região e descrição da vaga na arte (ver §9).
- Modelos de arte para as campanhas normais, Pinterest e imagens no briefing (pedidos separados do mesmo lote).
- Post no feed, carrossel ou reels de vagas. Só story.
- Apagar o story quando a vaga for preenchida (a API do Instagram não apaga story; ele some em 24 h).
- Link tocável no story (a API de publicação do Instagram não aceita figurinha de link).
- Receber as vagas por webhook do Freela (por enquanto o Meu Funil consulta a vitrine).

**Anti-objetivos (seria fracasso mesmo funcionando)**
- Story com valor, data ou horário errado no Instagram público do Freela.
- Expor dado pessoal: nome de pessoa física com CPF, telefone, e-mail, endereço.
- Postar vaga de teste, vaga velha ou vaga que já começou.
- Encher o Instagram de stories a ponto de estourar o limite de publicações do dia e travar os posts normais da empresa.
- Logo duplicada (o modelo já traz a logo; ver §6.4).

## 3. Restrições

- **Fonte de dados = vitrine pública do Freela, sem autenticação:**
  `GET https://api.freelaservicosapp.com.br/v1/bars-restaurants/public/vacancies/recent?limit=24[&city=]` (padrão 8, teto 24) e
  `GET .../public/vacancies/:id`. Campos: `id, title, serviceType, city, date, startTime, endTime, amountInCents (valor do freelancer),
  contractorName, publishedAt, isUpcoming, payoutTiming?`. Vagas só para VIP não aparecem na vitrine. **Não há endereço, bairro nem
  descrição.** A lista mistura vagas novas com antigas (em 28/10 vieram vagas de junho entre as 24).
- Amostra real de 28/10 (24 vagas da vitrine): 10 publicadas em 27/10 (lote do Coco Bambu); nomes como
  `"GENILSON FERREIRA DA SILVA 26385530850"` (pessoa física com CPF), `"Enzo teste fernandes ltda"` (teste), `null`, razões sociais em
  maiúsculas (`"KNK ALIMENTACAO LTDA"`).
- **Limite do Instagram:** `publishing.service.ts` barra em 25 publicações por 24 h por conta (`DAILY_LIMIT`), contando TODOS os posts da
  empresa. Ao bater o limite (`RateLimited`) a fila já remarca o job para 1 h depois sem gastar tentativa.
- **IA:** só via `AiService`. `image()` já aceita `referenceImages` (OpenAI `/images/edits`, Gemini `inlineData`); `json()` já aceita
  `images` (visão). Na OpenAI, `9:16` sai em 1024×1536 (2:3); só o Gemini gera 9:16 de verdade. Em produção a empresa Freela App usa
  chaves próprias OpenAI e Gemini (o gateway do app fica vazio de propósito).
- **Story:** `IgFormat = 'story_image'`, publicado com `media_type: STORIES` + `image_url`. Sem legenda.
- Story tem 1080×1920; a interface do Instagram cobre ~250 px em cima e embaixo.
- Regras do repositório (`CLAUDE.md`): contrato da API em `docs/api-contract.md` primeiro; erros `{ error: { code, message } }`; toda rota
  de workspace com `WorkspaceAccessService`; arquivos só via `FilesService`; nenhum teste faz rede (fakes na porta `AI_FETCH` e numa porta
  nova para a vitrine); flag nova em `env.validation.ts` + `.env.example` + `docker-compose.yml`; uma instância com `SCHEDULER_ENABLED`.
- Máquina do dono: comandos pesados só por `scripts/run-capped.sh`.

## 4. Decisões do dono

| Tema | Decisão |
|---|---|
| Formato | Um story por vaga. |
| Modelo | O dono envia uma arte pronta; ela fica salva; a IA segue o estilo dela em toda vaga. |
| Como a arte é feita | IA de imagem gera a arte inteira (foto + textos), como no exemplo. |
| Conferência | O sistema lê o texto da arte gerada; se valor ou data saírem errados, refaz até 2 vezes; se continuar errado, usa uma versão em que o próprio sistema escreve os textos por cima de uma foto. |
| Detecção | Automática (palpite apresentado e aceito: olhar a vitrine periodicamente). |
| Configuração | Configurável (pedido recorrente do dono: "deixa tudo configurável"). |

## 5. Fluxo

1. **Consulta** (job novo no agendador, a cada 10 min): busca `recent?limit=24` (uma vez sem cidade; se a empresa filtrou cidades, uma
   chamada por cidade). Só considera vagas com `publishedAt` posterior ao momento em que a função foi ligada (**sem retroativo**) e
   `isUpcoming = true`.
2. **Triagem** (cada vaga vira uma linha em `vacancy_stories`, única por empresa + id da vaga): descarta com motivo gravado
   - nome do contratante com "teste"/"test" (sem diferenciar maiúsculas/acentos);
   - cidade fora do filtro da empresa;
   - vaga que começa em menos de N horas (padrão 2 h, configurável);
   - acima do limite diário de stories de vagas (fica `waiting` para o dia seguinte se ainda não tiver começado; ver §6.6).
3. **Limpeza dos dados:** remove sequências de 11 a 14 dígitos do nome (CPF/CNPJ), corta espaços duplos; nome vazio ou `null` → o cartão
   do estabelecimento sai da arte. Nome em MAIÚSCULAS vira "Título" com exceções (LTDA, ME, EIRELI e afins somem do fim). Datas e horas
   em `America/Sao_Paulo`: a data exibida é a de `startTime` convertida (ex.: `startTime 2026-10-29T14:30Z` → "29/10/2026", "11:30");
   `endTime` idem ("às 21:00"). Valor: `amountInCents 15000` → "R$ 150,00".
4. **Geração** (fora da janela de horário espera; ver §6.6): `AiService.image` com `referenceImages = [modelo]`, prompt com os campos
   limpos, instrução de seguir o layout do modelo e omitir cartões sem dado. Proporção: ver §6.3.
5. **Conferência:** `AiService.json` com a imagem gerada extrai `{funcao, estabelecimento, data, inicio, fim, valor}`; compara campo a
   campo normalizado (sem acento, minúsculas, só dígitos para valor/data/hora). Valor, data, início e fim: igualdade exata. Função e
   estabelecimento: igualdade depois de normalizar. Falhou → gera de novo (até 2 refações, com o campo errado citado no prompt).
   Esgotou → **versão de reserva**: a IA gera só uma foto sem texto (pessoa fazendo a função) e o sistema desenha os cartões por cima
   com `composeCreative` nas cores do modelo. Cada tentativa vai para `ig_posts.ai_generation_log`.
6. **Post:** cria `ig_posts` (`format 'story_image'`, `source 'vacancy'`, sem legenda) com a mídia pronta. Se a empresa escolheu
   "aprovar antes", o post vai para a aba Aprovações do Instagram (fluxo de aprovação de post que já existe); senão vai direto para a fila
   `publishing_jobs`.
7. **Antes de publicar:** consulta `GET /public/vacancies/:id`; se a vaga sumiu da vitrine, não está mais `isUpcoming` ou já começou, o
   post é cancelado com o motivo ("A vaga não está mais aberta."). Post pendente de aprovação cuja vaga já começou também é cancelado.

## 6. Decisões de construção (minhas, para o dono conferir)

### 6.1 Onde mora
Módulo novo `api/src/modules/vacancy-stories/` (serviço de consulta + triagem, serviço de geração, controller de configuração). A
leitura da vitrine fica atrás de uma porta injetável (`FREELA_VACANCIES_FETCH`) para os testes não fazerem rede. URL base em env
`FREELA_PUBLIC_API_URL` (padrão a de produção).

### 6.2 Quem pode usar
A tela e o job só valem para empresas listadas em `VACANCY_STORIES_WORKSPACE_IDS` (env, lista de ids, padrão vazio). Motivo: o Meu Funil
atende outras empresas e a vitrine é do Freela; só a empresa "Freela App" deve ver isso. Dentro dela, a função começa **desligada**.

### 6.3 Proporção do story
IA padrão = **OpenAI** (`gpt-image-1`, melhor texto em imagem). Ela devolve 1024×1536 (2:3, a mesma proporção do modelo). O sistema
encaixa a arte em 1080×1920 com faixas em cima e embaixo na cor de fundo dominante do modelo — as faixas caem justo onde a interface
do Instagram cobre o story. Gemini fica como opção na configuração (gera 9:16 direto). Isso sustenta o "a IA ajusta para o tamanho de
story" dito ao dono.

### 6.4 Logo
O modelo já tem a logo do Freela. O story de vaga **não** recebe a logo automática no canto (a regra nova de 27/10 que põe a logo no
canto inferior direito) — `posicao_logo` forçada para `none` neste fluxo, inclusive na versão de reserva (ela desenha a logo da marca no
lugar certo do layout, uma vez só).

### 6.5 Foto da cena
O prompt pede uma pessoa fazendo a função num ambiente de bar/restaurante **sem nome nem logo de outra empresa no cenário**. No exemplo
do dono a IA desenhou a fachada da Frutá; repetir isso com outras marcas (Coco Bambu, Spoleto) arrisca logo desenhada errada e uso de
marca alheia. O nome do estabelecimento aparece só no cartão de texto.

### 6.6 Volume e horário
- Janela de postagem padrão 08:00–21:00 (Brasília); vaga publicada de madrugada espera a janela.
- Limite padrão de **10 stories de vagas por dia** por empresa (o limite do Instagram é 25 por 24 h somando tudo da empresa).
- Passou do limite: as excedentes ficam `waiting` e entram no dia seguinte por ordem de início mais próximo, se ainda forem elegíveis
  (não começaram e respeitam a antecedência mínima). Se o Instagram recusar por limite, a fila já remarca para 1 h depois.
- Ordem dentro do dia: início mais próximo primeiro.

### 6.7 Aprovar antes ou postar sozinho
A configuração tem a opção. **Padrão ao ligar: "Aprovar antes de postar"**, para os primeiros stories passarem pelo olho do Denner/Diego;
virar para "Postar sozinho" é um clique. O pedido original é "automático" — o padrão é só para a estreia.

### 6.8 Dados guardados
- `vacancy_story_settings` (1 por empresa): `enabled`, `enabled_at` (marca d'água do "sem retroativo"), `template_asset_id`,
  `cities text[]` (vazio = todas), `daily_cap` (10), `window_start`/`window_end` ("08:00"/"21:00"), `min_lead_minutes` (120),
  `vendor` ('openai'|'gemini'), `auto_publish` (false).
- `vacancy_stories`: `workspace_id`, `source` ('freela'), `external_id` (id da vaga), **único** (`workspace_id, source, external_id`),
  `status` (`new`|`skipped`|`waiting`|`generating`|`ready`|`posted`|`cancelled`|`failed`), `skip_reason`, `snapshot jsonb` (os campos
  da vitrine no momento da triagem), `ig_post_id` (FK `ig_posts`, SET NULL), `attempts`, `used_fallback`, `created_at`, `updated_at`.
- Modelo de arte: `brand_assets` com `kind 'vacancy_template'` (PNG/JPG/WEBP, mesmas regras de upload da logo), na marca da empresa.

### 6.9 Custo
Cada story custa de 1 a 3 imagens da IA (mais uma foto sem texto se cair na reserva) e de 1 a 3 leituras de imagem, cobradas na chave da
própria empresa. A tela mostra, por story, quantas tentativas foram usadas e se caiu na reserva. (Preço por imagem: conferir na página de
preços do fornecedor antes de prometer número ao dono.)

## 7. Tela (a desenhar com o ux-designer)

Lugar provável: Instagram → aba nova "Vagas" (só para as empresas da lista). Precisa ter:
- Ligar/desligar, com o que acontece ao ligar ("A partir de agora, cada vaga nova do Freela vira um story.").
- Envio/troca do modelo com prévia; sem modelo não dá para ligar.
- Configurações do §6.8 com textos do dia a dia.
- "Gerar prévia" com uma vaga real, sem postar (para o dono ver se a IA segue o modelo).
- Lista das vagas detectadas com status, motivo de quando foi pulada, miniatura do story, tentativas usadas, e ações "Postar agora" /
  "Não postar".
- **Em aberto para o designer:** o que pôr no lugar do link da vaga, já que no story ele não é tocável e um endereço com UUID é
  ilegível (o exemplo ainda tem "//" no meio). Candidatos: só o domínio + selos das lojas; um QR code da vaga; "Procure Freela Serviços
  na loja de apps".

## 8. O que fica com quem constrói

Nome do módulo e dos arquivos, formato exato do prompt, normalização da comparação, como reaproveitar o fluxo de aprovação de posts,
detalhe da versão de reserva (dentro do estilo do modelo), textos finais da tela (com o designer), testes (fakes da vitrine e da IA; um
teste de fuso com `startTime` perto da meia-noite UTC).

## 9. Depois (depende de outra decisão)

Endereço, bairro e descrição na arte exigem mudar a API do Freela (`api-freela`, outro repositório, sobe para produção no push da main,
só com o dono) **e** decidir se o endereço completo da empresa pode ficar público no Instagram — a vitrine o esconde de propósito.
