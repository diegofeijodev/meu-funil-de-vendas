# Referências do Pinterest automáticas — desenho

Data: 16/11/2026 · Ramo: `feat/pinterest-automatico` (sobre `d9fb28b`, em produção desde 16/11 18h58) · Estado: **APROVADO pelo Denner em 16/11 ("eu aprovo o desenho ai do pinterest automatico, faça")**; Fatia 4 refeita em 17/11 (v4, respostas do Denner na §5.1); teste da Fatia 0 feito em 16/11 (mudou de forma visível, ver o roteiro) · Telas e textos: `2026-11-16-pinterest-automatico-ui.md`

## 1. Pedido e porquê

Pedido do Diego, repassado pelo Denner em 16/11: "Colocar no Meu Funil imagens do pinterest". Esclarecido pelo Denner no mesmo dia: ao pedir
uma imagem ou postagem, o sistema deve **chamar sozinho** bases do Pinterest e usá-las de base para vídeos, postagens etc., **para a arte sair
com mais qualidade**. É o mesmo pedido do áudio de 29/10 (`2026-10-29-estrategista-conduz-design.md`, F5/F6).

Por que o que existe não atendeu (conferido em 16/11):

- Produção tem **0 referências e 0 pastas** em todas as empresas, com `STYLE_REFS_PINTEREST_ENABLED` ligada desde 30/10
  (`~/meufunil-deploy/ver-referencias-pinterest.sh`, só leitura). Ninguém usou.
- A única porta de entrada é a seção "Estilo das artes" **dentro de uma campanha** (`web/.../campaigns/[id]/CampaignDetail.tsx`).
- `loadStyleNotes` usa as 8 notas mais novas, sem olhar o assunto do pedido; cada nota tem até 260 letras (`style-notes.ts`).
- Os stories das vagas não recebem nota nenhuma (`vacancy-prompts.ts` → `photoPrompt(funcao)`).

O que já funciona e fica: Pin avulso vale só para a campanha; **pasta ou perfil público vale para a marca inteira** (o `sync` grava com
`campaign_id = null`) e é relida a cada 24 h pelo RSS; Estúdio, posts do Instagram e vídeo já pedem as notas (`RefsService.loadStyleNotes`).

## 2. Objetivos, não-objetivos, anti-objetivos

**Objetivos**

1. Toda arte, post, vídeo e story de vaga recebe referência de estilo **sem ninguém configurar nada** na hora do pedido.
2. A referência usada combina com o **assunto** do que foi pedido.
3. A leitura da referência carrega o suficiente para mudar a arte (assunto + receita de cena), não só cores e clima.
4. A empresa enxerga e troca as referências na tela da Marca.

**Não-objetivos (agora)**

- Busca por palavra no Pinterest (caminho B, §4): depende de o Pinterest aprovar o acesso.
- Publicar no Pinterest; galeria para escolher Pin como imagem do post.

**Anti-objetivos**

1. A imagem do Pinterest ir como pixel para o gerador ou ser publicada. Continua valendo o anti-objetivo 5 de 29/10. Só muda com "sim"
   explícito do dono, em pedido separado.
2. Consultar o Pinterest por caminhos que os termos proíbem (consulta interna de busca, raspagem da página de busca).
3. Texto, marca, logotipo ou pessoa da referência aparecerem na arte.
4. Repetir 29/10: construir, ligar e ninguém usar.

## 3. Restrições

- Fonte permitida hoje: oEmbed do Pin e RSS de pasta/perfil público (25 Pins mais novos, imagem `i.pinimg.com/736x`). Responde do EC2 (testado 30/10).
- Busca oficial: `GET /v5/search/partner/pins` devolve os 10 primeiros Pins de um termo, mas está em beta e "not available to all apps";
  `GET /v5/search/pins` busca só os Pins da própria conta (especificação oficial `pinterest/api-description`, lida em 16/11).
- Produção não tem IA do app (`AI_GATEWAY_URL` vazio de propósito): toda leitura de referência gasta a chave de alguma empresa.
- Máquina do dono: regras de baixo consumo do `CLAUDE.md` (um comando pesado por vez, `scripts/run-capped.sh`).
- A API roda em uma instância; job novo entra no agendador único.

## 4. Caminhos considerados

| | Caminho | Prós | Contras |
|---|---|---|---|
| A | Pastas da marca, usadas em tudo e escolhidas pelo assunto | Usa o que já funciona; não depende do Pinterest | Alguém precisa colar as pastas |
| B | Busca por palavra na hora do pedido | É o "sozinho" ao pé da letra | Só com aprovação do Pinterest (beta fechado), sem prazo |
| C | Biblioteca pronta por segmento | Zero configuração para a empresa | Alguém cura as pastas; marcas do mesmo segmento recebem o mesmo estilo |

**Escolha do Denner (16/11): A + C.** A sozinho repetiria o zero uso; C sozinho não deixa a empresa pôr o próprio gosto. B fica como fonte
extra por cima do A se o Diego pedir o acesso e o Pinterest aprovar.

## 5. Desenho (v2, depois da revisão do arquiteto)

Ordem das fatias: cada uma entrega sozinha e a seguinte só começa com a anterior verificada.

### Fatia 0 — antes e depois + falha que não queima

- Teste sem código: roteiro em `docs/superpowers/plans/2026-11-16-pinterest-teste-antes-depois.md` (2 pedidos, sem e com 5 referências
  enviadas numa campanha de teste da Freela App; as referências saem no fim, então não ficam notas antigas em produção).
- Além do olho, comparar a **nota do crítico** de cada arte. O diretor de arte condensa tudo em 60 a 120 palavras
  (`art-director.ts:106`): mais texto na nota não garante efeito, por isso o teste vem antes.
- Código (pequeno, independe do resultado): hoje qualquer erro na leitura vira `failed` definitivo e o Pin nunca volta
  (`style-refs.service.ts:258-260`, `:440-447`, `:466`). Falha transitória (sem crédito, 429, 5xx, tempo esgotado) volta para a fila com
  limite de 3 tentativas; só erro definitivo (imagem inválida, recusa de conteúdo) marca `failed`.

### Fatia 1 — leitura mais rica, com orçamento por nota

- `StyleNotes` ganha `categorias` (lista fechada, ver Fatia 3), `assunto` (até 6 palavras livres, sem marca nem nome) e `acabamento`
  (até 300 letras: superfície, tipo de fundo, profundidade de campo, textura). **Não** descreve a disposição dos elementos nem as pessoas:
  continua valendo "não copie composição" de 29/10. **(decisão minha: troquei a "receita da cena" do rascunho por "acabamento" para não
  reabrir a decisão de direitos; se o dono quiser a composição descrita, é pedido à parte.)**
- Os campos novos entram no **texto** do `STYLE_NOTES_PROMPT`, não só no schema (visão com chave própria não recebe o schema,
  `ai.service.ts:257-272`), e em `normalizeStyleNotes` (hoje descarta chave desconhecida, `style-notes.ts:38-49`).
- Orçamento: cada nota até 600 letras (hoje 260, `style-notes.ts:69`), bloco até 2500, corte sempre na fronteira de uma nota; entram até
  4 notas. As notas passam por `cleanFree` e « » como os outros textos livres (`video-director.ts:99-103`).
- `style_notes.v = 2`. Nota sem `v` continua válida. Script de operação para reler notas antigas (produção hoje tem zero).
- O cabeçalho do bloco é contrato (`docs/api-contract.md:942-949`, `style-refs.service.spec.ts:95`): atualizar o contrato **antes** do código.
- Cada arte, post e vídeo guarda quais referências seguiu (ids e quantidade), junto da direção de arte. Serve para a tela dizer "Estilo:
  seguiu N referências suas" (Fatia 2) e para medir o efeito; hoje não há registro do que cada peça usou.

### Fatia 2 — porta de entrada: na Marca e onde a arte é vista

O designer mostrou que pôr o painel só na Marca repetiria o zero uso: hoje ele fica no Briefing, última de 5 abas da campanha
(`CampaignDetail.tsx:790`, `:1094`), com "(opcional)" no título, e a Marca é ainda menos visitada. Então:

- **Convite onde a arte é vista** (Estúdio, Aprovações e Pacote do piloto): cada arte mostra "Estilo: sem referências." com o botão
  "Mostrar o estilo que eu quero", ou "Estilo: seguiu N referências suas." (usa o registro da Fatia 1).
- **Painel "Estilo das artes" na Marca**, na aba Guia visual, acima do guia (sem criar 7ª aba: a faixa de abas não quebra linha no
  celular). Na campanha o painel continua, sem o "(opcional)", e avisa na hora que pasta colada ali vale para a marca inteira.
- **Separar das fotos da marca.** A Marca já chama de "referência" as fotos próprias, que vão como **pixel** ao gerador
  (`BrandDetail.tsx:291-292`, `refs.service.ts:84-105`). "Referência" passa a valer só para estilo; o bloco das fotos vira "Logo e fotos da
  sua marca", com aviso fixo junto do envio. Mudar esse rótulo sai do 1:1 com o protótipo (`CLAUDE.md`): decisão 4 do dono.
- **A lista para de afirmar coisa falsa.** `list` sem campanha traz as referências de todas as campanhas (`style-refs.service.ts:127`) e o
  painel escreve "· desta campanha". Contrato primeiro: a API devolve `campaign_name`, `source_title`, a tentativa em curso e quantas
  referências cada pasta tem.
- Estados que faltam: vazio, erro de carga e confirmação antes de "Parar" (hoje apaga a pasta e todas as referências sem perguntar,
  `style-refs-panel.tsx:155`).
- Celular: "Remover" embaixo do texto, lista mostra 4 e "Ver todas (n)", campo do link com 44 px, uma única região `aria-live` no painel.
- Só divulgar a função para as empresas junto com a Fatia 4: a seleção pronta é o que tira o "preciso configurar".
- Fora desta versão: vídeo como referência (o RSS do Pinterest só traz imagem; o painel aceita JPG e PNG). **(decisão minha)**

### Fatia 3 — escolha pela categoria

Sobreposição de palavras soltas é frágil em português ("burger" × "hambúrguer", "chopp" × "chope"). Em vez disso:

- Lista fechada de categorias em `style-refs/categories.ts` (comida por tipo, bebida/bar, ambiente, pessoas trabalhando, equipe/vagas,
  produto em destaque…). Na **leitura** (chamada que já é paga) a IA marca as categorias da imagem.
- No **pedido**, função pura `subjectCategories(texto)`: dicionário de sinônimos, sem acento, palavra inteira ("bar" não casa com
  "barbearia"). A mesma função dá o segmento da marca (Fatia 4).
- `loadStyleNotes(ws, brandId, campaignId, subject?)` ordena: campanha (no máximo 2 das 4 vagas) → marca com categoria em comum → `assunto`
  livre como desempate → mais novas. **Sem nenhuma categoria em comum, a nota entra só com paleta e luz, sem `acabamento`.**
- Onde há diretor (arte e vídeo), cada nota vai rotulada com as categorias e o diretor recebe "use só as que combinam com o briefing".
- `subject` por chamador: post e vídeo = tema + gancho + pedido + produto; Estúdio = título + pedido + `offer_product` (não os 3 produtos
  sem ordem de `creative.service.ts:118-120`); piloto = passa por `directArt`, nome da campanha + ângulo; vagas = função.

### Fatia 4 — Seleção do Meu Funil automática, em cada empresa (v4, 17/11)

Reescrita depois das respostas do Denner em 17/11 (§5.1): **não existe mais empresa central**. A versão de 16/11 (empresa "Biblioteca" em
`STYLE_LIBRARY_WORKSPACE_ID`, lida por todas as empresas) foi construída no ramo e sai inteira nesta versão. Agora:

- **Catálogo de pastas por ramo no código** (`api/src/modules/style-refs/selection-catalog.ts`): ramo (id de `categories.ts`) → 2 ou 3 pastas
  públicas do Pinterest, montado uma vez em 17/11 por busca na web (domínio pinterest.com) e conferido pelo RSS oficial de cada pasta
  (200, ≥ 16 Pins com imagem) e por uma folha de miniaturas (foto de verdade do ramo, sem infográfico nem ilustração). Nenhuma busca nem
  raspagem do Pinterest no produto. Ramos: `equipe_vagas`, `acai_sorvete`, `comida_hamburguer`, `comida_churrasco`, `bebida_bar` e
  `ambiente` (restaurante/gastronomia). Tabela das pastas no plano (Task 16).
- **Cada marca tem as próprias pastas da Seleção.** Com `STYLE_LIBRARY_ENABLED=true` (e `STYLE_REFS_PINTEREST_ENABLED=true`, de que a
  Seleção depende), `brands.style_library_enabled` ligado, ramo resolvido e a empresa com chave de IA (OpenAI ou Gemini, própria ou herdada
  da agência, pelo `AiKeysService`), o sistema cria em `style_ref_sources` **da própria marca** as pastas do ramo, com `origin = 'selection'`.
  O RSS e a leitura de hoje fazem o resto, com a chave da empresa. Sem chave: não cria nada e o painel diz que a Seleção precisa de uma
  chave de IA em Integrações.
- **Reconciliação única por marca** (`reconcileSelection`): calcula as pastas que a marca deveria ter e acerta o banco (cria as que faltam,
  tira as que sobram com as referências delas). Roda no `PATCH` da marca quando muda `segment`, `style_library_enabled` ou
  `style_library_segment` (só grava linhas; o RSS e o download vão para segundo plano) e no job `style-refs-15min`, poucas marcas por
  rodada (é o que pega a chave cadastrada depois em Integrações e a marca nova).
- **Desligar, "Nenhum desses" ou trocar de ramo** tira as pastas da Seleção e as referências delas; na troca, entram as do ramo novo. O ramo
  reconhecido **pode ser trocado na tela** (fecha o ponto que ficou aberto em 16/11). Chave do servidor desligada = **inerte**: nada é
  criado, renovado, lido nem usado, e nada é apagado (religar retoma).
- **Própria sempre antes.** Na escolha das notas a Seleção só completa as vagas que as próprias não ocuparam (como em 16/11). As pastas da
  Seleção não contam no limite de 5 pastas próprias; a Seleção tem teto próprio e nunca tira referência própria do teto de 30 da marca
  (a própria tira a da Seleção primeiro). A Seleção só busca Pins novos enquanto é útil (a marca tem menos de 4 próprias prontas).
- **Isolamento:** toda consulta leva `workspace_id` da própria empresa; duas empresas do mesmo ramo têm cópias separadas das mesmas pastas
  públicas. Teste "empresa A não lê notas de B" continua.
- **Miniaturas:** agora são cópias da própria empresa, então o painel mostra as pastas e as referências da Seleção como qualquer pasta, com
  o rótulo do ui.md §3. O bloco "Ver as descrições" sai.
- **Convite "Estilo: …"** nas artes só aparece com a Seleção ligada para a empresa (`features.style_library`), para não divulgar antes.
  **(decisão do Denner via coordenador, reversível)**
- `STYLE_LIBRARY_ENABLED` continua existindo e nasce `false`. Saem `STYLE_LIBRARY_WORKSPACE_ID`, o bloqueio de exclusão da Biblioteca e a
  leitura de outra empresa.

### Fatia 5 — stories das vagas (por último)

Nas vagas não existe diretor: o texto iria **cru** ao gerador de imagem (`vacancy-generator.service.ts:330`), e a conferência reprova
qualquer bloco de 3+ letras na foto (`:64-70`); depois de 2 tentativas o story sai sem foto. Negações e objetos com escrita (cardápio,
letreiro, garrafa) aumentam esse risco. Por isso:

- Montador próprio para a foto: só paleta, luz e clima, em frases afirmativas, com "Sem nenhum texto…" por último. Nada de `acabamento`
  nem de "evitar".
- A 2ª tentativa vai **sem** notas.
- Interruptor por empresa nos Ajustes da aba Vagas, **desligado por padrão**; vale também para a prévia (`vacancy-preview.service.ts:134`).
- Medir `used_fallback` (story sem foto) antes e depois numa semana; se piorar, desliga.
- A marca das vagas hoje é invisível: o sistema pega sozinho a mais antiga (`vacancy-settings.service.ts:364-372`) e o web não mostra. A
  API dos ajustes passa a devolver o nome da marca e quantas referências ela tem em uso; a tela mostra "Seguir as referências da marca
  {nome}" e avisa quando a marca não tem referência ou quando ainda não há marca. Trocar a marca das vagas fica fora desta versão.
  **(decisão minha)**

### 5.1 Decisões do dono

**Respostas do Denner em 17/11 (mudam a Fatia 4):**
- Decisão 1 (guardar imagem de terceiro): "Pode".
- Decisão 2 (quem paga a leitura): "Deixa cada conta ter sua própria pasta/biblioteca e aí usa as chaves cadastradas dela pra fazer isso."
  → **sai a empresa central "Biblioteca"**: cada empresa tem as próprias pastas da Seleção e a leitura usa a chave de IA dela.
- Decisão 3 (quem monta as pastas): "A seleção não pode ser automática não?" → a Seleção é automática: o sistema põe sozinho, em cada
  marca, as pastas públicas do Pinterest do ramo dela, tiradas de um catálogo de pastas por ramo que vive no código (montado uma vez,
  sem busca nem raspagem no Pinterest); depois o RSS atualiza sozinho como qualquer pasta.

Decisões originais (para histórico):

1. **Guardar imagem de terceiro numa biblioteca do Meu Funil** (as empresas veriam só texto, mas o sistema guarda a miniatura para a
   curadoria): o OK jurídico de 29/10 cobria a referência colada por cada empresa. Precisa de um "sim" para a biblioteca.
2. **Quem paga a leitura da biblioteca:** empresa interna "Biblioteca" com chave própria (recomendado) ou a Freela App.
3. **Quem monta as pastas e para quais segmentos** (sugestão: vagas/gastronomia, açaí, bar/chope, espetinho).
4. **Renomear na Marca** o bloco "referências" das fotos próprias para "Logo e fotos da sua marca" (sai do texto 1:1 do protótipo).
   Recomendado: sem isso a foto do Pinterest enviada no lugar errado vira imagem na arte. **Tratado como aprovado junto com o desenho
   (16/11) — leitura minha: o desenho já trazia a recomendação.**
5. Pedir ao Pinterest o acesso à busca (caminho B), se quiser.
6. Imagem do Pinterest como base visual do gerador: fora deste desenho; precisa de "sim" explícito.

## 6. Verificação

- jest focado, sem rede (`AI_FETCH` falso, RSS por fixture): `style-refs` (campos novos, orçamento por nota, categorias, ordem, falha
  transitória, "A não lê B"), `creative`, `vacancy-stories` (montador da foto, 2ª tentativa sem notas, interruptor).
- Contrato atualizado antes do código de cada fatia. `tsc` da API e do web uma vez no fim; smoke; browser-check dos grupos de marcas,
  campanhas e vagas. Tudo por `scripts/run-capped.sh`.
- Em produção, a cada fatia: refazer o antes e depois com a nota do crítico; na Fatia 5, a taxa de story sem foto.

## 7. Fica para quem constrói

Nomes finais de colunas, texto exato dos prompts, a lista de categorias e o dicionário de sinônimos, textos de tela (ux-designer),
migrações aditivas e roteiro de subida no padrão de `~/meufunil-deploy/`.

## 8. Revisões

- 16/11 software-architect: 3 críticos (vagas com texto cru; tetos que apagavam o campo novo; falha de leitura definitiva) e 7
  importantes, todos incorporados nesta v2. Correções de fato: são cerca de 5 notas (não 8) que cabem hoje em 1500 letras; o piloto não é
  chamador à parte (passa por `directArt`).
- 16/11 ux-designer: 4 bloqueantes (foto do Pinterest na área errada vira pixel; porta só na Marca repete o zero uso; lista na Marca
  dizia "desta campanha" para tudo; marca das vagas invisível) e 8 importantes, incorporados nesta v3. Textos prontos em
  `2026-11-16-pinterest-automatico-ui.md`. Larguras citadas são conta pelas classes, não medição em navegador.
