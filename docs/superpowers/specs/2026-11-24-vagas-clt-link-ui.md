# Vagas no Instagram: publicação parada, QR da vaga e vagas fixas (CLT) — telas, arte e textos

Complemento de `2026-11-24-vagas-clt-link-design.md` (o "desenho técnico"). Feito pelo ux-designer em 24/11/2026.
Regras de negócio são as do desenho técnico; onde a tela precisa de algo que ele não dá, está em **§8 Pontos para o arquiteto**.
Base visual: `2026-10-28-vagas-instagram-ui.md`, `2026-11-16-pinterest-automatico-ui.md`, a arte desenhada pelo sistema
(`api/src/modules/vacancy-stories/vacancy-base-art.ts`) e as telas atuais (`web/src/components/health-alerts-banner.tsx`,
`web/src/components/instagram/vacancies/*`).

**Quem usa as telas do Meu Funil:** o Diego (dono, não técnico, muito pelo celular) e a equipe de marketing do Freela (computador e celular).
**Quem vê a arte e a página pública:** quem procura trabalho em bar e restaurante, no celular (muitas vezes Android simples), olhando cada
story por 1 a 2 segundos. No Brasil, quase todo mundo já lê QR code por causa do Pix.

**Convenções deste documento**
- Horário sempre no formato do resto da aba Vagas: "8h30", "20/11 às 8h30", "hoje às 9h30", "amanhã às 8h". A faixa da IA usa hoje
  "21:00" (`dayTimeSp`); os textos novos usam "8h30" e a faixa da IA pode migrar depois (cosmético, severidade 1).
- `{x}` = variável. Toda variável com número tem singular, plural e zero escritos.
- Wireframes em 360 px de largura (celular), que é o pior caso. No computador, o mesmo conteúdo em até 2 colunas onde indicado.
- Cores da arte medidas pelas RGB de `vacancy-base-art.ts` (fórmula de contraste da WCAG). Cores do site e do Meu Funil (tokens
  `destructive`, `warning`, `success`) marcadas como **conferir**: não medi.

---

## 0. Resumo

| Entrega | Para quem | Ação principal | Toques / tempo |
|---|---|---|---|
| Faixa vermelha "O Instagram parou de aceitar as publicações" | Diego e equipe | "Já corrigi — testar agora" | 1 toque, resposta em até ~5 s |
| QR da vaga no rodapé da arte | quem vê o story em print ou outra tela | ler o QR | 0 toques no Meu Funil; ligar: Instagram → Vagas → Ajustes → Gerar prévia com QR → Pôr o QR → confirmar = 6 toques, uma vez |
| Arte "Vaga fixa CLT" | quem procura emprego fixo | entender "fixa, salário por mês" em 1 s | — |
| Ajustes CLT e lista com duas fontes | Diego e equipe | ligar as vagas fixas | Instagram → Vagas → interruptor → "Ligar vagas fixas" = 4 toques |
| Página pública `/vagas-fixas/[id]` | quem leu o QR ou recebeu o link | "Entrar para se candidatar" | 1 toque até o cadastro |

**Decisões principais deste documento**
1. A faixa vermelha fica **curta em todas as telas** (título, 2 frases, 2 botões). Os 5 passos do conserto ficam atrás de "Como resolver
   (5 passos)", que abre no lugar, sem janela por cima.
2. Enquanto a publicação está parada, a faixa amarela de "posts que falharam" some (é o mesmo fato) e a faixa da IA **não pode** dizer
   "o que já estava pronto continua sendo publicado".
3. QR: quadrado branco de **180 × 180 px** em (64, 1508), dentro do rodapé preto, com **zona clara de 4 módulos** (pedido ao arquiteto:
   URL de até 84 caracteres, ver §8 P3). Texto ao lado em 3 linhas: "Candidate-se pelo app" / "Procure Freela Serviços na loja" /
   "ou leia o QR para ver a vaga". Nada de "Toque e segure": no Instagram, segurar só pausa o story.
4. O interruptor do QR só destrava depois de uma **prévia com QR** que o próprio sistema conseguiu ler. Ligar o QR só depois de testar
   num celular 16:9 com a barra de resposta à mostra (§2.6).
5. Arte CLT: o título passa a ser **"VAGA FIXA" em azul-carteira** (#1E3A8A) e a pílula **"CARTEIRA ASSINADA"** em azul; o salário diz
   **"Salário por mês"**. A diária continua preta e amarela. Cor nunca sozinha: o texto também muda.
6. Arte CLT sem o cartão "Cargo" (o cargo já está no título, em letra grande): sobra espaço para Benefícios sem encolher a pilha.
7. Vagas fixas ganham **cartão de situação próprio** (interruptor, hoje, última consulta) e um grupo "Só vagas fixas (CLT)" nos Ajustes.
   Antes de ligar, a tela diz quantas vagas vão entrar de verdade (hoje, 1 das 52 abertas cai nos últimos 14 dias).
8. Página pública: botão principal "Entrar para se candidatar" (fixo no pé da tela no celular); o app aparece como segunda opção, com os
   selos oficiais. Vaga fechada, vencida ou inexistente mostra uma página só: "Esta vaga não está mais disponível".

---

## 1. Faixa vermelha: "O Instagram parou de aceitar as publicações"

### 1.1 Trabalho do usuário

- **Job:** quando o Instagram para de publicar, quero saber na hora, entender o que fazer e confirmar que voltou, para não perder vagas
  nem posts.
- **Contexto:** o Diego abre o Meu Funil pelo celular, em qualquer tela. O conserto é feito no computador, no Meta Business (vários passos
  em outro site). Quem só tem papel de leitura vê o aviso, mas não testa.
- **Critério de sucesso:** em qualquer tela, em menos de 5 s de leitura, a pessoa sabe (1) que nada está indo ao ar, (2) desde quando,
  (3) o que está esperando e (4) qual é o próximo passo. Depois de corrigir: 1 toque para testar.

### 1.2 Onde aparece e ordem das faixas

A faixa vive em `HealthAlertsBanner` (topo de todas as telas logadas da empresa). Ordem, de cima para baixo:

1. **Publicação parada** (vermelha), quando `publishing` existe.
2. **IA** (vermelha ou amarela), como hoje, com a frase trocada da §1.6.
3. **Posts que falharam** (amarela), como hoje. **Não aparece** quando `publishing` existe **e** `instagram.permission` é verdadeiro
   (R10: é o mesmo fato). Com `publishing` e falhas de outro motivo, as duas aparecem.

Com 2 ou mais faixas no celular, cada uma mostra só título, corpo e botões; detalhes ficam fechados. A faixa nunca tem "X" para fechar:
ela some sozinha quando a API para de devolvê-la (padrão atual, sem estado no navegador).

### 1.3 Wireframes (360 px)

**A. Permissão (`reason = 'permission'`), fechada** — o estado normal em todas as telas.

```text
┌──────────────────────────────────┐
│ ⛔ O Instagram parou de aceitar   │
│    as publicações                │
│                                  │
│ Desde 20/11 às 8h30, a Meta      │
│ recusa tudo o que o Meu Funil    │
│ tenta publicar no @freelaapp,    │
│ por falta de permissão.          │
│ 3 posts e 7 vagas esperam aqui;  │
│ o que perder o prazo é cancelado │
│ com o motivo. Nenhuma arte nova  │
│ de vaga é criada até voltar.     │
│                                  │
│ [ Como resolver (5 passos)    ▾ ]│  h 44, contorno
│ [ Já corrigi — testar agora     ]│  h 44, vermelho cheio
│                                  │
│ Também conferimos sozinhos.      │
│ Próxima conferência: hoje às     │
│ 9h30.                            │
└──────────────────────────────────┘
```

No computador (≥ 640 px): os dois botões lado a lado, "Já corrigi — testar agora" à esquerda (ação principal primeiro na leitura).

**B. Permissão, aberta ("Como resolver")** — abre no lugar (`aria-expanded`), sem diálogo.

```text
│ [ Esconder os passos          ▴ ]│
│                                  │
│ Faça no computador, com a conta  │
│ que administra o Meta Business   │
│ do Freela:                       │
│                                  │
│ 1  Abra Usuários do sistema no   │
│    Gerenciador de Negócios da    │
│    Meta.                         │
│    [ Abrir Usuários do sistema ↗]│
│                                  │
│ 2  Escolha o usuário do sistema  │
│    do Meu Funil → Atribuir ativos│
│    → Contas do Instagram →       │
│    @freelaapp. Ligue Controle    │
│    total e salve.                │
│                                  │
│ 3  No mesmo usuário, toque em    │
│    Gerar token. Escolha o app do │
│    Meu Funil, validade Nunca, e  │
│    marque instagram_content_     │
│    publish junto com as que já   │
│    estavam marcadas. Copie o     │
│    token.                        │
│                                  │
│ 4  No Meu Funil, abra Integrações│
│    → Meta Ads (API oficial),     │
│    cole em "Token do usuário do  │
│    sistema" e toque em Salvar    │
│    credenciais.                  │
│    [ Abrir Integrações ]         │
│                                  │
│ 5  Volte aqui e toque em Já      │
│    corrigi — testar agora.       │
│                                  │
│ instagram_content_publish não    │
│ aparece na lista do passo 3?     │
│ O app da Meta ainda não tem essa │
│ permissão. Fale com quem criou o │
│ app (Painel de apps → Permissões)│
└──────────────────────────────────┘
```

- Os nomes de menu da Meta mudam com frequência: **conferir** "Gerenciador de Negócios", "Usuários do sistema", "Atribuir ativos",
  "Contas do Instagram", "Controle total" e "Gerar token" no Meta Business em pt-BR antes de subir. O link do passo 1 é o que o Meu Funil já
  usa (`https://business.facebook.com/settings/system-users`, em `meta-ads-card.tsx`).
- O nome da permissão (`instagram_content_publish`) aparece como está, porque é o texto que a pessoa vai procurar na lista da Meta. É a
  única palavra técnica da faixa, e só dentro dos passos. Em fonte monoespaçada, com quebra permitida (`break-all`) para não estourar 360 px.
- Os passos cobrem os dois consertos possíveis (ativo não atribuído e token sem a permissão) numa linha só, sem "se isso, faça aquilo".
  Gerar um token novo não faz mal quando o problema era só o ativo.

**C. Estados do botão "Já corrigi — testar agora"** (região `aria-live="polite"` logo abaixo dos botões)

```text
Testando                         Voltou (a faixa vira verde)
┌────────────────────────────┐   ┌──────────────────────────────────┐
│ [ ◌ Testando com a Meta… ] │   │ ✓ A permissão de publicar voltou │
│   (desabilitado)           │   │ Os posts que esperavam começam a │
└────────────────────────────┘   │ sair nos próximos minutos, cada  │
                                 │ um no seu horário. Quando o 1º   │
Ainda bloqueado                  │ for ao ar, está confirmado. Se a │
┌────────────────────────────┐   │ Meta recusar de novo, o aviso    │
│ [ Já corrigi — testar ... ]│   │ vermelho volta.                  │
│   (desabilitado até 9h13)  │   │ [ Fechar ]                       │
│ ⚠ Testado às 9h12: a Meta  │   └──────────────────────────────────┘
│ ainda não deu a permissão  │
│ de publicar. Confira os    │
│ passos 2 e 3 e teste de    │
│ novo a partir das 9h13.    │
└────────────────────────────┘
```

- "Voltou": a faixa troca de vermelho para verde **no próprio lugar** (estado local do componente) e fica até a pessoa tocar em "Fechar"
  ou mudar de tela. Motivo: sem isso, a faixa sumiria no próximo ciclo e a pessoa não saberia se deu certo. Sem toast duplicado.
- O teste **lê** a permissão (`/me/permissions`); ele não publica. Por isso o verde diz "a permissão voltou", não "está publicando", e
  avisa que a confirmação vem com o 1º post no ar (texto na §1.4). Se a Meta recusar de novo depois do teste, a faixa vermelha volta com a
  frase "reabriu" da §1.4 (depende de um campo, §8 P23).
- "Ainda bloqueado": o botão fica desabilitado por 60 s (é o limite da API, 409). O texto diz a hora em que pode testar de novo; sem
  contagem regressiva que muda a cada segundo (o leitor de tela repetiria).

**D. Token vencido (`reason = 'token'`)**

```text
┌──────────────────────────────────┐
│ ⛔ O Instagram parou de aceitar   │
│    as publicações                │
│ Desde 20/11 às 8h30, o acesso do │
│ Meu Funil ao @freelaapp venceu   │
│ ou foi trocado. Reconecte o      │
│ Instagram para voltar a publicar.│
│ 3 posts e 7 vagas esperam aqui;  │
│ o que perder o prazo é cancelado │
│ com o motivo.                    │
│ [ Reconectar o Instagram        ]│ → Instagram → Visão geral
│ Isso não volta sozinho: só a     │
│ reconexão resolve.               │
└──────────────────────────────────┘
```

**E. Sonda em "modo só registro" (F0-5 b, enquanto o fechamento pela sonda não estiver ligado)**

Nesse modo, a conferência e o botão **não fecham** o bloqueio, e a fila adiada não tenta publicar (R4). A única saída é a reconexão.
A faixa não pode prometer "conferimos sozinhos" nem dizer "a Meta ainda não deu a permissão" (seria falso). Então:

- O botão principal vira **"Já corrigi — reconectar o Instagram"** (leva a Instagram → Visão geral).
- O passo 5 vira: "Volte aqui e toque em Já corrigi — reconectar o Instagram."
- A linha da conferência automática não aparece.
- Depende de um campo na resposta da API (§8 P5).

### 1.4 Textos exatos

| Elemento | Texto |
|---|---|
| Título (todos os motivos) | **O Instagram parou de aceitar as publicações** |
| Corpo, permissão | "{Desde 20/11 às 8h30}, a Meta recusa tudo o que o Meu Funil tenta publicar no {@freelaapp}, por falta de permissão. {Espera} Nenhuma arte nova de vaga é criada até voltar." |
| Corpo, token | "{Desde 20/11 às 8h30}, o acesso do Meu Funil ao {@freelaapp} venceu ou foi trocado. Reconecte o Instagram para voltar a publicar. {Espera}" |
| {Desde…} | hoje: "Desde as 8h30" · outro dia: "Desde 20/11 às 8h30" (`since` de `publishing`) |
| {@freelaapp} | "@{username}"; sem username: "Instagram desta empresa" (§8 P6) |
| {Espera} | 0 e 0: "Nada está esperando agora." · só posts: "{1 post espera / 3 posts esperam} aqui; o que perder o prazo é cancelado com o motivo." · só vagas: "{1 vaga espera / 7 vagas esperam} aqui; o que perder o prazo é cancelado com o motivo." · os dois: "{1 post / 3 posts} e {1 vaga / 7 vagas} esperam aqui; o que perder o prazo é cancelado com o motivo." (`waiting` de `publishing`) |
| Botão abrir passos | "Como resolver (5 passos)" · aberto: "Esconder os passos" |
| Introdução dos passos | "Faça no computador, com a conta que administra o Meta Business do Freela:" |
| Passo 1 | "Abra Usuários do sistema no Gerenciador de Negócios da Meta." · botão "Abrir Usuários do sistema" (abre em outra aba, ícone ↗, `aria-label` "Abrir Usuários do sistema no Meta Business, em outra aba") |
| Passo 2 | "Escolha o usuário do sistema do Meu Funil → Atribuir ativos → Contas do Instagram → {@freelaapp}. Ligue Controle total e salve." |
| Passo 3 | "No mesmo usuário, toque em Gerar token. Escolha o app do Meu Funil, validade Nunca, e marque instagram_content_publish junto com as que já estavam marcadas. Copie o token." |
| Passo 4 | "No Meu Funil, abra Integrações → Meta Ads (API oficial), cole em “Token do usuário do sistema” e toque em Salvar credenciais." · botão "Abrir Integrações" (mesma aba) |
| Passo 5 | "Volte aqui e toque em Já corrigi — testar agora." (modo só registro: "…toque em Já corrigi — reconectar o Instagram.") |
| Nota final | "instagram_content_publish não aparece na lista do passo 3? O app da Meta ainda não tem essa permissão. Fale com quem criou o app (Painel de apps → Permissões)." |
| Botão testar | "Já corrigi — testar agora" |
| Testando | botão "Testando com a Meta…" · região viva: "Testando com a Meta…" |
| Voltou | título "A permissão de publicar voltou" · corpo "Os posts que esperavam começam a sair nos próximos minutos, cada um no seu horário, e as vagas voltam a ganhar arte em até 10 minutos. Quando o 1º for ao ar, está confirmado. Se a Meta recusar de novo, o aviso vermelho volta." · botão "Fechar" |
| Reabriu depois de um teste ou conferência (frase a mais no início do corpo vermelho) | "A conferência das {9h12} indicou que a permissão tinha voltado, mas a Meta recusou de novo às {9h27}. O conserto ainda não está completo: refaça os passos 2 e 3." (só quando o bloqueio anterior foi fechado pela conferência ou pelo botão, não por uma publicação; §8 P23) |
| Ainda bloqueado | "Testado às {9h12}: a Meta ainda não deu a permissão de publicar. Confira os passos 2 e 3 e teste de novo a partir das {9h13}." |
| 409 (`PUBLISH_CHECK_TOO_SOON`) | a mensagem da API: "Espere um minuto para testar de novo." |
| 422 (`PUBLISH_NEEDS_RECONNECT`) | a mensagem da API + a faixa passa ao estado D no próximo ciclo |
| Sem conexão / erro | "Não conseguimos testar agora. Verifique a conexão e toque em Já corrigi — testar agora de novo." |
| Conferência automática | "Também conferimos sozinhos. Próxima conferência: {hoje às 9h30 / amanhã às 8h30 / 26/11 às 8h30}." · já passou do horário: "Também conferimos sozinhos. Próxima conferência: nos próximos minutos." · `next_check_at` nulo: linha não aparece |
| Botão token | "Reconectar o Instagram" |
| Linha do token | "Isso não volta sozinho: só a reconexão resolve." |
| Papel só leitura (sem botão) | "Só quem pode editar nesta empresa testa a correção. Mostre estes passos a quem administra o Meta Business do Freela." |

### 1.5 Estados

| Estado | O que aparece |
|---|---|
| Carregando a consulta da faixa | nada (padrão atual: a faixa é auxiliar) |
| Erro na consulta da faixa | nada; tenta de novo no ciclo de 5 min (padrão atual) |
| Sem bloqueio | nada |
| Bloqueado por permissão | A (fechada) ou B (aberta) |
| Testando | C, "Testando" |
| Voltou | C, faixa verde até "Fechar" |
| Ainda bloqueado | C, aviso abaixo do botão, botão desabilitado 60 s |
| Token vencido | D |
| Sonda só registra | E |

### 1.6 Faixa da IA enquanto a publicação está parada

A faixa vermelha da IA termina hoje com "O que já estava pronto e agendado continua sendo publicado." Com `publishing` aberto isso é
**falso**. Quando as duas existem, a última frase da faixa da IA vira:

> "A publicação também está parada: veja o aviso acima."

Só o texto muda (`aiAlertText` ganha a opção `publishingBlocked`); a API já devolve os dois campos.

### 1.7 Aba Vagas enquanto a publicação está parada

**Cartão de situação** (`status-card.tsx`), aviso vermelho dentro do cartão, acima dos outros avisos:

```text
┌──────────────────────────────────┐
│ (●) Postar as diárias do Freela  │
│     nos stories                  │
│ Ligado · você aprova cada story  │
│ ...                              │
│ ┌──────────────────────────────┐ │
│ │ ⏸ Pausado: o Instagram não   │ │
│ │ está aceitando publicações   │ │
│ │ desde 20/11 às 8h30. As vagas│ │
│ │ esperam aqui e ganham arte   │ │
│ │ quando ele voltar.           │ │
│ │ [ Ver como resolver ]        │ │ → rola até a faixa do topo,
│ └──────────────────────────────┘ │   abre os passos e põe o foco
└──────────────────────────────────┘   no título dela
```

Com o bloqueio, os avisos de "Instagram desconectado" e de IA do cartão continuam aparecendo se forem verdade; o de "desconectado" já cobre
o motivo token, então no motivo token o aviso "Pausado" não aparece (não repetir).

**Linhas da lista** — situações novas (vêm da API, como as outras: `display`, `label`, `support`, `can`; §8 P7):

| Situação | Ícone | Texto | Apoio | Ações |
|---|---|---|---|---|
| Vaga esperando para criar a arte (`PUBLISH_BLOCKED_WAIT`) | ⏸ `PauseCircle`, cor de atenção | **Esperando o Instagram voltar** | "A arte é criada quando a Meta voltar a aceitar publicações. Se a vaga começar antes, ela fica de fora." | Não postar |
| Story pronto ou agendado parado pelo bloqueio (`PUBLISH_BLOCKED_MSG`) | ⏸ `PauseCircle` | **Pronto, esperando o Instagram voltar** | "Vai ao ar quando a Meta voltar a aceitar publicações, se ainda der tempo: até {16h}." | Não postar |
| Para aprovar, com bloqueio | 👍 (como hoje) | Esperando sua aprovação | "Pode aprovar: ele espera o Instagram voltar para ir ao ar." | Aprovar · Não postar |
| Perdeu o prazo durante o bloqueio | 🚫 (como "Não foi ao ar") | Não foi ao ar | motivo do desenho técnico (R5): "Não foi ao ar: o Instagram recusava as publicações desta empresa desde {20/11 às 8h30}, e a vaga começa {21/11 às 18h}." · CLT: "Não foi ao ar: o Instagram recusava as publicações desta empresa desde {20/11 às 8h30}, e o prazo para divulgar esta vaga fixa terminou em {24/12}." | — |

- **"Postar agora" some** enquanto houver bloqueio: ele chamaria a Meta, falharia e reabriria o bloqueio (R3). Melhor não oferecer o que
  não funciona (heurística 5, prevenção de erros).
- O ícone de pausa é diferente do relógio de "Esperando o horário" para não confundir "vai sair às 14h" com "não sai até alguém
  consertar".

### 1.8 Limite da Meta na tela (P1)

O texto de ajuda do "Máximo de stories" e o aviso `capWarning` têm hoje "25" e "15" fixos. Com o limite lido da Meta (hoje 50), os dois
ficam errados. Textos com variável:

| Elemento | Texto |
|---|---|
| Ajuda do máximo | "O Instagram aceita até {50} publicações por dia nesta conta, somando posts normais e stories. As vagas que passarem do máximo ficam para o dia seguinte, se ainda não tiverem começado." |
| Aviso acima do limiar | "Acima de {15} por dia, somando diárias e vagas fixas, os posts normais da empresa podem ficar sem espaço." Aparece quando (máximo das diárias + máximo das fixas) > limite da Meta − 10. Com 25, é o "acima de 15" de hoje. Com 50, o limiar é 40 e o aviso **não aparece** com os máximos atuais (20 + 10 = 30): é o certo, porque sobra espaço. Uma porcentagem (60% de 50 = 30) também nunca apareceria, já que o contador das diárias para em 20 |
| Ajuda opcional com dado (se a API mandar) | "Nos últimos 21 dias chegaram, em média, {11} vagas por dia que podiam virar story (até {21} em 9 de cada 10 dias)." |

Depende de `publish_quota` na resposta dos Ajustes (§8 P9).

---

## 2. QR code da vaga no rodapé da arte

### 2.1 Para quem o QR serve (e para quem não serve)

| Situação | O QR ajuda? |
|---|---|
| Story visto no próprio celular | **Não** direto: não dá para apontar a câmera para a própria tela. Só por print (Fotos do iPhone ou Google Lens) |
| Print repassado no WhatsApp e aberto em outro celular | Sim, apontando a câmera do segundo celular para a tela, ou pelo Lens |
| Story visto no computador (instagram.com) ou numa TV | **Sim**, é o melhor caso (QR grande na tela) |
| De um celular para a tela de outro celular | Às vezes: o QR fica com ~1 cm na tela; só de perto |

Por isso o caminho principal do rodapé continua sendo **a loja** ("Candidate-se pelo app / Procure Freela Serviços na loja"); o QR é a
terceira linha, a alternativa.

### 2.2 Tamanho, módulos e zona clara

A arte é **1080 × 1920** (9:16; não há versão 4:5 no código).

- **Módulo:** 4 px na arte, nunca menos (V5). Depois da redução do Instagram para 720 px de largura, fica com ~2,7 px, que é o teste do
  desenho técnico com `jsqr`.
- **Zona clara:** o rodapé em volta é **preto**. Leitor de QR acha o código pelos 3 quadrados dos cantos, e fundo escuro grudado neles é o
  pior caso. A norma pede 4 módulos de margem clara; o desenho técnico usa 2. Recomendo **4**.
- **Conta que cabe** (lado do quadrado = (módulos + 2 × zona) × 4 px, e o rodapé tem 196 px de altura):

| Versão do QR | Módulos | Zona clara | Lado | Cabe? |
|---|---|---|---|---|
| 5 | 37 | 4 | (37 + 8) × 4 = **180 px** | sim, com 8 px de folga em cima e embaixo |
| 6 | 41 | 2 | (41 + 4) × 4 = 180 px | sim (é o do desenho técnico) |
| 6 | 41 | 4 | (41 + 8) × 4 = 196 px | não (encosta nas bordas arredondadas) |

A versão 5 com correção M aceita até 84 caracteres. Hoje a URL da diária tem 86 e a da CLT 92 (por causa do `?utm_source=ig`, 14
caracteres). **Conferir com a biblioteca** qual versão sai em cada caso (`getModuleCount()`); a escolha entre tirar o UTM, encurtá-lo ou
aceitar 2 módulos de zona clara é do arquiteto (§8 P3). Minha preferência: zona clara de 4 módulos.

- **Posição:** quadrado branco de **180 × 180** em **x 64, y 1508** (termina em x 244, y 1688). Confere com o canto arredondado do rodapé
  (raio 40, centro do canto em (80, 1540)): o canto do quadrado fica a 35,8 px do centro, dentro do arredondado. O quadrado de 184 em
  (56, 1506) do desenho técnico fica a 41,6 px, ou seja, ~2 px para fora do preto, e o branco vaza sobre o amarelo.
- **Contraste:** módulos INK (17, 17, 17) sobre branco (255, 255, 255) = **18,9 : 1**. Nunca QR claro sobre fundo escuro (vários leitores
  Android não leem QR invertido).
- **Sem logo no meio do QR**, sem cantos arredondados nos módulos e sem cor: cada truque desses gasta a correção de erro que a
  recompressão do Instagram já consome.

### 2.3 Rodapé com QR (coordenadas na arte 1080 × 1920)

```text
x: 40                                                        1040
y 1500 ┌───────────────────────────────────────────────────────┐ rodapé preto
       │ ┌────────┐                                ┌─────────┐ │ (raio 40)
       │ │▛▀▜ ▖▗▀▜│  Candidate-se pelo app         │ Google  │ │ L1 amarela
       │ │▌█▐ ▚▞▄▐│                                │  Play   │ │
       │ │▙▄▟ ▗▘▙▟│  Procure Freela Serviços       ├─────────┤ │ L2 branca
       │ │▖▞▄▘▛▖ ▌│  na loja                       │App Store│ │
       │ │▙▄▟ ▘▚▗▟│  ou leia o QR para ver a vaga  │         │ │ L3 branca
       │ └────────┘                                └─────────┘ │ (suave)
y 1696 └───────────────────────────────────────────────────────┘
        x 64–244     x 268 → até 24 px antes dos selos    selos iguais aos
        y 1508–1688                                        de hoje (h 64)
```

- **Texto** começa em x 268 (24 px depois do quadrado) e vai até 24 px antes da borda esquerda dos selos (`bx − 24`; com os selos de
  hoje, ~490 px de largura útil). Cada linha com `fitWrapped` em 1 linha:
  - L1 amarela (255, 198, 26), Inter ExtraBold, começa em 44 px, piso 36 px. Contraste sobre INK: **12,0 : 1**.
  - L2 branca, Inter Bold, começa em 30 px, piso 26 px. Contraste: **18,9 : 1**.
  - L3 branca, Inter Bold, começa em 30 px, piso 26 px.
  - Linhas de base aproximadas: L1 em y 1566, L2 em y 1616, L3 em y 1660 (ajustar no código para o bloco ficar centrado no rodapé).
- **Selos:** os mesmos arquivos, o mesmo tamanho (altura 64) e a mesma posição de hoje. **Nunca redesenhar.**
- **Sem QR** (`qr_enabled` desligado, ou QR que não coube): o rodapé de hoje, idêntico, byte a byte (teste do desenho técnico).
- **Área segura:** a nota de 28/10 diz "nada importante abaixo de y 1600" e o QR vai até y 1688. Isso não impede o desenho, mas **impede
  ligar o QR** até passar no teste da §2.6 (QR inteiro visível e lido num celular 16:9 com a barra "Enviar mensagem" à mostra).

### 2.4 Textos do rodapé

| Linha | Sem QR (hoje) | Com QR (proposta) |
|---|---|---|
| L1 | Candidate-se pelo app | Candidate-se pelo app |
| L2 | Procure Freela Serviços na loja | Procure Freela Serviços na loja |
| L3 | — | ou leia o QR para ver a vaga |

**Por que esta ordem e estas palavras**
- Quem vê o story no próprio celular (a maioria) precisa da loja; por isso a loja vem antes do QR. O QR é "ou".
- "leia o QR" é como se fala do Pix ("ler o QR code"); "para ver a vaga" diz o que acontece. "Aponte a câmera" sozinho não diz para
  quê, e no próprio celular não há o que apontar.
- **Não usar "Toque e segure"**: no Instagram, tocar e segurar só pausa o story; não abre o QR. Seria prometer algo que não acontece.
- **Endereço escrito na arte: não recomendo.** Ninguém digita um link com 36 caracteres de código em 2 s, e o domínio sozinho leva à home,
  que já é o link da bio. O endereço que o QR abre aparece **na tela do Meu Funil** (prévia e detalhe), para quem quiser conferir.
- **Se o Diego quiser o endereço na arte (D6 = sim):** a L3 vira **"Vagas em freelaservicos.com.br"** (30 caracteres; branca, Inter Bold,
  começa em 28 px, piso 26 px; cabe nos ~490 px). Ela **tira** o "ou leia o QR para ver a vaga": o QR ao lado do endereço já se explica
  (todo mundo lê QR do Pix), e uma 4ª linha cairia abaixo de 26 px (≈ 8 dp no celular). Só o domínio, nunca o link com o código da vaga
  (que leva à home, seção de vagas). Sem QR, a L3 é a mesma frase. Não há espaço embaixo do QR: o quadrado vai até y 1688 e o rodapé
  acaba em 1696.
- Alternativa, se o Diego preferir a ordem do desenho técnico: L2 "Aponte a câmera para ver a vaga", L3 "ou procure Freela Serviços na
  loja". Funciona, mas põe em segundo lugar o caminho de quem está no celular.

### 2.5 Ajustes: "Link da vaga na arte (QR code)"

Fica no grupo "Para diárias e vagas fixas" dos Ajustes (§4.3). Vale na hora, com diálogo (como "Postar sozinho"); não entra no
"Salvar ajustes".

```text
┌──────────────────────────────────┐
│ Link da vaga na arte (QR code)   │ legend
│ Desligado. As artes saem sem QR, │
│ como hoje.                       │
│                                  │
│ Para ligar:                      │
│ ○ 1 Gere uma prévia com o QR     │
│ ○ 2 Leia o QR da prévia com o seu│
│     celular                      │
│                                  │
│ [ 👁 Gerar prévia com QR        ]│ h 44
│ Não posta nada. Usa a vaga mais  │
│ recente do Freela.               │
│                                  │
│ ┌──────────┐ PRÉVIA · não foi    │
│ │ (story   │ postada             │
│ │  9:16,   │                     │
│ │  280 px) │                     │
│ └──────────┘                     │
│ Rodapé em tamanho maior:         │
│ ┌──────────────────────────────┐ │ recorte do rodapé,
│ │ ▓QR▓  Candidate-se pelo app  │ │ largura toda
│ └──────────────────────────────┘ │
│ [ Ver a arte em tamanho real ↗ ] │
│                                  │
│ ✓ O sistema leu o QR. Ele abre:  │
│   freelaservicos.com.br/vagas/   │
│   3f2a…  (vaga Garçom)           │
│                                  │
│ Agora aponte a câmera do seu     │
│ celular para o QR acima. Tem de  │
│ abrir a vaga Garçom no site do   │
│ Freela.                          │
│                                  │
│ (○──) Pôr o QR nas próximas artes│ interruptor, alvo 44 px
│ Quem tira print do story ou vê em│
│ outra tela abre a vaga no site.  │
│ No próprio celular, só pelo      │
│ print.                           │
└──────────────────────────────────┘
```

- **Trava:** o interruptor fica desabilitado até existir uma prévia **com QR** que o sistema leu (`jsqr`). Desabilitado, a ajuda diz
  "Gere uma prévia com o QR para poder ligar." Depende de a prévia aceitar QR com o interruptor desligado (§8 P2).
- **Passo 2** não é conferido pelo sistema (não há como). Ele fica escrito no diálogo de ligar, para quem pulou.
- Sem crédito de IA, a prévia sai sem foto. Serve do mesmo jeito para testar o QR, e a tela diz isso (texto abaixo).
- Quem pode mexer: recomendo o mesmo papel de "Postar sozinho" (dono ou administrador), porque muda o que vai a público (§8 P4).

| Elemento | Texto |
|---|---|
| Título | Link da vaga na arte (QR code) |
| Desligado | "Desligado. As artes saem sem QR, como hoje." |
| Ligado | "Ligado desde {25/11 às 10h}. Toda arte nova de vaga sai com o QR no rodapé." |
| Lista "Para ligar" | "1 Gere uma prévia com o QR" · "2 Leia o QR da prévia com o seu celular" (o 1 ganha ✓ quando há prévia com QR lida) |
| Botão | "Gerar prévia com QR" · rodando: "Criando a prévia…" |
| Ajuda do botão | "Não posta nada. Usa a vaga mais recente do Freela." |
| Andamento | "Criando a prévia… costuma levar de 1 a 3 minutos. Pode sair desta tela, ela fica salva aqui." (igual à prévia de hoje) |
| Sem IA | "A IA está sem créditos, então a prévia sai sem foto. Para testar o QR, serve do mesmo jeito." |
| Recorte | "Rodapé em tamanho maior:" · botão "Ver a arte em tamanho real" (abre a imagem em outra aba) |
| Sistema leu | "✓ O sistema leu o QR. Ele abre: {freelaservicos.com.br/vagas/3f2a…} (vaga {Garçom})." |
| Sistema não leu | "✗ O sistema não conseguiu ler o QR desta prévia. O QR fica desligado. Tente gerar de novo; se repetir, avise o suporte." |
| QR não coube | "Esta vaga tem um link longo demais para o QR. A arte saiu sem ele. Gere outra prévia." |
| Pedido ao humano | "Agora aponte a câmera do seu celular para o QR acima. Tem de abrir a vaga {Garçom} no site do Freela." |
| Ajuda do interruptor | "Quem tira print do story ou vê em outra tela abre a vaga no site. No próprio celular, só pelo print." |
| Desabilitado | "Gere uma prévia com o QR para poder ligar." |
| Papel sem permissão | "Só o dono ou um administrador liga o QR." |
| Diálogo ligar — título | "Pôr o QR code nas artes das vagas?" |
| Diálogo ligar — texto | "Daqui para frente, toda arte nova de vaga sai com o QR no rodapé, à esquerda dos selos. As artes que já estão prontas continuam sem QR. Antes, aponte a câmera do seu celular para o QR da prévia e confira se abre a vaga." |
| Diálogo ligar — botões | "Pôr o QR" / "Agora não" |
| Toast ligado | "QR ligado. Quando o 1º story com QR for ao ar, tire um print e leia o QR para conferir." |
| Desligar | sem diálogo (baixo risco); toast "QR desligado. As próximas artes saem sem QR." com "Desfazer" por 6 s |
| Erro ao mudar | "Não conseguimos mudar isso agora. Tente de novo." (padrão atual) |
| Vagas fixas sem página no site | "Nas vagas fixas, o QR entra quando a página da vaga fixa estiver no site do Freela." (só com a CLT ligada e a página ainda fora, §8 P22) |

**Na lista e no detalhe:** story com QR ganha o selo "Com QR" (texto, não só ícone); o detalhe mostra "O QR abre: {endereço}" e o link
"Abrir no site ↗".

### 2.6 Critério para ligar na Freela App (portão)

Antes de ligar o QR em produção, alguém da equipe confere, e anota o resultado na revisão da tarefa M9:

1. Prévia com QR lida pelo sistema (✓ na tela).
2. Câmera do iPhone e Google Lens no Android leem o QR **da tela do computador** (prévia em tamanho real).
3. Um story real de teste, visto num celular **16:9** (tela mais "baixa", onde a barra "Enviar mensagem" cobre a parte de baixo do
   story): o QR aparece **inteiro**, e o **print** desse celular é lido pelo Lens e pelo Fotos do iPhone.
4. Print de um celular Android simples (720 px de largura) também lido.

Se o item 3 falhar (barra cobrindo o QR), o QR **não liga**, e a posição volta para o arquiteto (subir o rodapé mexe na pilha de cartões).

---

## 3. Arte "Vaga fixa CLT"

### 3.1 Trabalho de quem vê

- **Job:** quando passa um story de vaga, quero saber em 1 segundo se é diária ou emprego fixo, quanto paga **por mês** e onde, para
  decidir se paro e me candidato.
- **Risco principal:** confundir as duas. "R$ 1.874" lido como pagamento de um dia, ou alguém que só quer diária se candidatando a CLT.
- **Critério:** num celular de 360 dp, sem ler os cartões, só pelo título, dá para dizer "é vaga fixa".

### 3.2 O que muda em relação à diária

| Elemento | Diária (hoje) | Vaga fixa CLT |
|---|---|---|
| Faixa 1 do título | "VAGA", pincelada **preta**, texto branco, 104 px | "**VAGA FIXA**", pincelada **azul-carteira** (30, 58, 138 = #1E3A8A), texto branco, 88 px |
| Faixa 2 | função, pincelada amarela | cargo, pincelada amarela (igual) |
| Pílula | "FREELANCER", preta, ícone de pessoa | "**CARTEIRA ASSINADA**", azul-carteira, ícone de carteira de trabalho |
| Cartão de dinheiro | "Valor para o freela:" | "**Salário por mês:**" |
| Quando | "Data:" e "Horário:" | "Escala:" |
| Função/cargo em cartão | sim ("Função:") | **não**: o cargo já está no título, em letra grande |
| Último cartão | "Descrição:" | "Benefícios:" |
| Rodapé | preto com selos | igual (com ou sem QR, §2.3) |

- **Por que azul-carteira:** é a cor da Carteira de Trabalho, que todo mundo reconhece, e fica claramente diferente do preto mesmo de
  relance. O amarelo da marca continua dominando (cargo, cartões, base).
- **Cor não é o único sinal:** "VAGA FIXA", "CARTEIRA ASSINADA" e "Salário por mês" mudam junto. Quem não distingue cores lê a diferença.
- **Contraste medido** (WCAG): branco sobre azul-carteira **10,4 : 1**; amarelo da marca sobre azul-carteira **6,6 : 1**; azul-carteira
  sobre o fundo claro (250, 250, 250) **9,9 : 1**. Nunca texto branco sobre amarelo (1,6 : 1).
- **Decisão do Diego** (vai na prévia, §9 D4): azul-carteira (recomendado) ou tudo em preto e amarelo, mudando só os textos.

### 3.3 Composição (1080 × 1920)

```text
y    0 ┌─────────────────────────────────────────────┐
       │◜ curvas amarelas (iguais)          ╭──────╮ │
  140  │ ┌─LOGO─┐                         ╱  FOTO   ╲│ círculo r 470,
       │ └──────┘                        │  da IA    ││ centro (860, 430)
  392  │ ▛▀▀▀▀▀▀▀▀▀▀▀▀▀▀▜                │  (cargo)  ││ (igual à diária)
       │ ▌  VAGA FIXA    ▐ azul, 88 px    ╲         ╱ │
  516  │ ▛▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▜              ╰──────╯   │
       │ ▌  ATENDENTE         ▐ amarelo, texto preto   │
 ~656  │ (▣ CARTEIRA ASSINADA) pílula azul, ≤ 46 px    │
  742  │ (🏬)┃Empresa:                               ┃ │
       │     ┃SPOLETO SHOPPING ANÁLIA FRANCO         ┃ │
       │ (🕘)┃Escala:                                ┃ │
       │     ┃6x1, 10h às 18h20                      ┃ │
       │ (📍)┃Cidade:                                ┃ │
       │     ┃São Paulo – SP                         ┃ │
       │ (●$)┃Salário por mês:                       ┃ │ amarelo cheio
       │     ┃R$ 1.874,32                            ┃ │ valor 64 px
       │ (●✓)┃Benefícios:                            ┃ │
       │     ┃Vale-transporte · Refeição no local ·  ┃ │
       │     ┃Plano de saúde                         ┃ │
 1478  │                                              │
 1500  │ ████ rodapé preto, igual ao da diária ██████ │
 1696  │                                              │
 1920  └──────────────────────────────────────────────┘ base amarela
```

- **"VAGA FIXA" em 88 px** (não 104): com 9 letras, a pincelada vai até ~x 750 e deixa a foto aparecer. `fitWrapped` em 1 linha, largura
  máxima 700 px.
- **Pílula "CARTEIRA ASSINADA":** `fitWrapped` em 1 linha, começa em 58 px, piso 40 px, texto até 600 px, para a pílula terminar antes de
  x 780. Mesma inclinação de −4° da diária.
- **Cargo:** mesma regra da função (1 linha de 92 a 64 px; senão 2 linhas de 76 a 46 px). Sem "CLT", "(CLT)" e "- CLT" no fim: a pílula
  já diz (§8 P13).
- **Ícones novos** no mesmo estilo de `icon()`: carteira de trabalho (retângulo com uma faixa em cima) na pílula e um "✓" para Benefícios.
  Escala usa o relógio que já existe. Se não der tempo, Benefícios pode usar a prancheta de hoje.
- **Ordem dos cartões** segue a da diária: quem já viu as diárias acha o dinheiro no mesmo lugar (penúltimo, amarelo cheio).
- **Foto e logo:** iguais à diária (foto da IA para o cargo; sem foto, círculo amarelo claro).

### 3.4 Cartões e formatos

| Ordem | Cartão | Rótulo | Valor | Linhas | Some quando |
|---|---|---|---|---|---|
| 1 | Empresa | "Empresa:" | em MAIÚSCULAS, depois de `cleanEstablishment` | até 2 | empresa nula ou limpa (com dígitos, sufixo, contato) |
| 2 | Escala | "Escala:" | "6x1, 10h às 18h20" · dos horários: "Seg a Sex, 8h às 17h" · horários diferentes por dia: "6 dias por semana" | 1 | sem escala escrita e sem horários válidos |
| 3 | Cidade | "Cidade:" | "São Paulo – SP" | até 2 | nunca (sem cidade, não vira story) |
| 4 | Salário | "Salário por mês:" | "R$ 2.550" · "R$ 1.874,32" · "R$ 2.000 a R$ 2.500" | 1, 64 px | nunca (sem salário, não vira story) |
| 5 | Benefícios | "Benefícios:" | até 4 itens unidos por " · ", até 80 caracteres | até 2, Inter Bold | sem benefícios |

- **Dinheiro:** centavos só quando não são zero ("R$ 2.550", mas "R$ 1.874,32"), ponto no milhar, como na diária.
- **Tamanho na tela:** a arte de 1080 vira ~360 dp no celular (÷ 3). Valor 42 px ≈ 14 dp; salário 64 px ≈ 21 dp; rótulo 25 px ≈ 8 dp
  (secundário, igual à diária). Com 5 cartões, a conta dá ~684 px para 736 px livres (111 + 111 + 111 + 136 + 159 + 4 × 14), então a
  pilha fica perto do tamanho cheio (k ≈ 1). **Conferir no código** com a prévia.

### 3.5 Quando falta um campo

| Falta | Na arte | No Meu Funil |
|---|---|---|
| Empresa | o cartão sai; os outros crescem (até 1,3×) | a linha mostra só o cargo |
| Escala | o cartão sai | no detalhe: "Escala: não informada" |
| Benefícios | o cartão sai | — |
| Salário | não vira story | "Não virou story" · "A vaga fixa não tem salário informado." · sem "Criar story mesmo assim" (a criação forçada também exige salário) |
| Cidade | não vira story | "Não virou story" · "A vaga fixa não tem cidade que dê para mostrar." |
| Foto (IA sem crédito ou erro) | círculo amarelo claro | selo "Sem foto" |
| Logo | sem logo | — |
| **Mínimo que sempre existe** | título (VAGA FIXA + cargo + pílula) + Cidade + Salário | — |

### 3.6 Exemplos com dados reais (24/11)

| Vaga no Freela | Título | Cartões |
|---|---|---|
| Spoleto Shopping Anália Franco — Atendente — R$ 1.874,32 | VAGA FIXA / ATENDENTE / CARTEIRA ASSINADA | Empresa "SPOLETO SHOPPING ANÁLIA FRANCO" · Escala (se houver) · Cidade (se a regra achar; senão a vaga é pulada) · Salário por mês "R$ 1.874,32" · Benefícios (se houver) |
| COCO BAMBU CAMPINAS SHOPPING — Cumim — R$ 2.550,00 | VAGA FIXA / CUMIM / CARTEIRA ASSINADA | Empresa "COCO BAMBU CAMPINAS SHOPPING" · Cidade "Campinas – SP" · Salário por mês "R$ 2.550" |

- **Endereço nunca aparece:** o campo de local do Freela traz rua e número; a arte só recebe a cidade já conferida pela API (V6).
- **Texto alternativo da prévia** no Meu Funil: "Story de vaga fixa: Atendente, R$ 1.874,32 por mês, São Paulo – SP, Spoleto Shopping
  Anália Franco."
- **"Por mês"** é uma suposição: o formulário do Freela pede "Proposta salarial" sem dizer a unidade. Os valores reais (R$ 1.874,32 e
  R$ 2.550) são mensais. Ver §8 P14.

---

## 4. Vagas fixas nos Ajustes e na lista

### 4.1 Ordem na aba Vagas (celular)

1. "Para aprovar" (só quando há story esperando; diárias e fixas juntas).
2. Cartão das **diárias** (o de hoje). Com a CLT disponível, o título vira **"Postar as diárias do Freela nos stories"** (hoje "as vagas
   do Freela", que passaria a ser ambíguo).
3. Cartão das **vagas fixas (CLT)** (novo, §4.2).
4. "Vagas que chegaram", com filtro de tipo (§4.4).
5. "Ajustes", agrupados (§4.3).

Sem arte modelo: aparece a "Primeira vez" das diárias **e** o cartão das vagas fixas, porque a CLT não usa arte modelo.
Tudo o que é CLT só aparece quando a API devolve o bloco `clt` (depois da migração 3).

### 4.2 Cartão "Vagas fixas (CLT)"

**Desligado (antes de ligar)** — a tela mostra o que vai acontecer de verdade, porque o comum, com os dados de hoje, é entrar quase nada.

```text
┌──────────────────────────────────┐
│ (○──) Postar as vagas fixas (CLT)│ interruptor, alvo 44 px
│       nos stories                │
│ Desligado. Nenhuma vaga fixa vira│
│ story agora.                     │
│ ┌ ℹ O que vai entrar ──────────┐ │
│ │ Hoje há 52 vagas fixas       │ │
│ │ abertas no Freela. Com os    │ │
│ │ Ajustes de agora (as novas e │ │
│ │ as dos últimos 14 dias),     │ │
│ │ entra 1 já. As outras entram │ │
│ │ quando forem publicadas.     │ │
│ │ Vaga fixa publicada há mais  │ │
│ │ de 30 dias não vira story.   │ │
│ │ Sem salário ou sem cidade    │ │
│ │ também não.                  │ │
│ └──────────────────────────────┘ │
└──────────────────────────────────┘
```

**Ligado**

```text
┌──────────────────────────────────┐
│ (●──) Postar as vagas fixas (CLT)│
│       nos stories                │
│ Ligado · você aprova cada story  │
│ antes                            │
│ Hoje: 1 postado de 2 (o máximo   │
│ por dia das vagas fixas)         │
│ Última consulta: 14h40 (a cada   │
│ 10 minutos)                      │
│ Ligado desde 25/11 às 10h. Entram│
│ as vagas fixas publicadas desde  │
│ 11/11.                           │
└──────────────────────────────────┘
```

**Sem marca cadastrada:** interruptor desabilitado + "Para ligar, cadastre uma marca: a logo da arte vem dela." + botão "Abrir Marcas".

**Consulta das vagas fixas fora** (mais de 30 min, `clt_last_poll_error`): aviso amarelo dentro do cartão.

| Elemento | Texto |
|---|---|
| Interruptor | **Postar as vagas fixas (CLT) nos stories** |
| Desligado | "Desligado. Nenhuma vaga fixa vira story agora." |
| Bloco "O que vai entrar", com números | "Hoje há {52} vagas fixas abertas no Freela. Com os Ajustes de agora ({as novas / as novas e as dos últimos 14 dias}), {entra 1 já / entram 3 já / não entra nenhuma agora}. As outras entram quando forem publicadas. Vaga fixa publicada há mais de {30} dias não vira story. Sem salário ou sem cidade também não." |
| Bloco "O que vai entrar", sem números (a API não manda) | "Entram as vagas fixas novas{ e as dos últimos 14 dias}, até {2} por dia. Vaga fixa publicada há mais de {30} dias não vira story. Sem salário ou sem cidade também não." |
| {30} | o prazo para divulgar do desenho técnico (`publishedAt + 30 dias`), que a F0-6 pode mudar: vem da API (§8 P11), nunca fixo no texto |
| Ligado | "Ligado · você aprova cada story antes" / "Ligado · posta sozinho depois da conferência" (o modo é o mesmo das diárias) |
| Hoje | "Hoje: {0 postados / 1 postado / 2 postados} de {2} (o máximo por dia das vagas fixas)" |
| Consulta | "Última consulta: {14h40} (a cada 10 minutos)" · antes da 1ª: "Primeira consulta ao Freela em até 10 minutos." |
| Desde | "Ligado desde {25/11 às 10h}. Entram as vagas fixas publicadas desde {11/11}." (sem retroativo: "…Vagas fixas publicadas antes disso não entram.") |
| Consulta fora | "Não conseguimos consultar as vagas fixas do Freela {desde as 14h10}. Tentamos de novo sozinhos a cada 10 minutos. As diárias seguem normais." |
| Sem marca | "Para ligar, cadastre uma marca: a logo da arte vem dela." · botão "Abrir Marcas" |
| Sem permissão | "Só o dono ou um administrador pode ligar ou desligar." |
| Diálogo ligar — título | "Ligar os stories das vagas fixas?" |
| Diálogo ligar — texto | "A partir de agora, cada vaga fixa (CLT) nova do Freela vira um story no {@freelaapp}, até {2} por dia.{ Também entram, aos poucos, as abertas publicadas nos últimos 14 dias.} Vagas sem salário ou sem cidade não entram. {Cada story espera sua aprovação antes de ir ao ar. / Os stories vão ao ar sozinhos, depois que o sistema confere cargo, salário e cidade.} As diárias não mudam." |
| Diálogo ligar — botões | "Ligar vagas fixas" / "Agora não" |
| Toast ligado | "Stories das vagas fixas ligados." |
| Diálogo desligar — título | "Desligar os stories das vagas fixas?" |
| Diálogo desligar — texto | "{1 story pronto / 2 stories prontos}{ e }{1 esperando aprovação / 3 esperando aprovação} de vagas fixas não {vai / vão} ao ar. Os que já foram postados continuam no Instagram até sumirem sozinhos (24 h). As diárias continuam como estão." (sem nada pendente: só as duas últimas frases) |
| Diálogo desligar — botões | "Desligar vagas fixas" / "Manter ligado" |
| Toast desligado | "Stories das vagas fixas desligados." |
| Erro ao ligar ou desligar | a mensagem da API; sem mensagem: "Não conseguimos ligar agora. Tente de novo." / "Não conseguimos desligar agora. Tente de novo." |

### 4.3 Ajustes agrupados

Um formulário só, um "Salvar ajustes" só (como hoje). Três grupos com título, para cada pessoa saber a que tipo de vaga o ajuste vale.

```text
┌ Ajustes ────────────────────── ▾ ┐
│ Todas as cidades · 8h às 21h ·   │ resumo de 1 linha
│ diárias até 15/dia · fixas até   │ (quebra em 2 no celular)
│ 2/dia · OpenAI                   │
├──────────────────────────────────┤
│ PARA DIÁRIAS E VAGAS FIXAS       │ h3
│  Cidades                         │
│  Horário para postar             │
│  Quem faz a foto                 │
│  Estilo                          │
│  Antes de ir ao ar               │
│  Link da vaga na arte (QR code)  │ §2.5
├──────────────────────────────────┤
│ SÓ DIÁRIAS                       │ h3
│  Arte modelo · Prévia            │
│  Máximo de stories de diárias por│
│  dia   [−]  15  [+]              │
│  Só postar vagas que começam     │
│  daqui a pelo menos ( )1h (•)2h  │
├──────────────────────────────────┤
│ SÓ VAGAS FIXAS (CLT)             │ h3 (só com o bloco clt)
│  Máximo de stories de vagas fixas│
│  por dia   [−]  2  [+]           │ 1 a 10
│  Vagas fixas já abertas quando   │
│  você ligar                      │
│  ( ) Só as novas                 │
│  ( ) Também as dos últimos 7 dias│
│      (nenhuma agora)             │
│  (•) Também as dos últimos 14    │
│      dias (1 vaga)               │
│  ( ) Também as dos últimos 30    │
│      dias (3 vagas)              │
├──────────────────────────────────┤
│               [ Salvar ajustes ] │ fixo no pé
└──────────────────────────────────┘
```

| Elemento | Texto |
|---|---|
| Resumo | "{Todas as cidades} · {8h às 21h} · diárias até {15}/dia{ · fixas até {2}/dia} · {OpenAI}" (a parte das fixas só com elas ligadas) |
| Grupos | "Para diárias e vagas fixas" · "Só diárias" · "Só vagas fixas (CLT)" |
| Cidades (ajuda) | "Só vagas dessas cidades viram story, diárias e fixas." (a lista "Cidades das vagas recentes" precisa incluir as cidades das vagas fixas, §8 P12) |
| Máximo das diárias (título) | "Máximo de stories de diárias por dia" (ajuda com variável, §1.8) |
| Máximo das fixas (título) | "Máximo de stories de vagas fixas por dia" |
| Máximo das fixas (ajuda) | "Vagas fixas ficam abertas por semanas, então 2 por dia costuma bastar. Elas dividem com as diárias o limite de {50} publicações do Instagram e o horário para postar; quando as duas disputam o mesmo horário, a diária vai antes, porque o prazo dela é mais curto." |
| Contador | botões com `aria-label` "Diminuir" / "Aumentar"; limites 1 e 10 |
| Retroativo (título) | "Vagas fixas já abertas quando você ligar" |
| Opções | "Só as novas" · "Também as dos últimos 7 dias" · "Também as dos últimos 14 dias" · "Também as dos últimos 30 dias" |
| Contagem ao lado (se a API mandar) | "(nenhuma agora)" · "(1 vaga)" · "({3} vagas)" |
| Retroativo (ajuda) | "Entram aos poucos, das mais novas para as mais velhas, dentro do máximo por dia. Vaga fixa publicada há mais de {30} dias não vira story." (a opção "30 dias" do retroativo é um valor do CHECK, não o prazo; se o prazo mudar para menos de 30, a opção "Também as dos últimos 30 dias" some) |
| Salvar | como hoje: "Salvar ajustes" · "Ajustes salvos." · erro "Não conseguimos salvar. Seus ajustes continuam aqui. Toque em Tentar de novo." |

### 4.4 Lista "Vagas que chegaram" com as duas fontes

```text
┌──────────────────────────────────┐
│ Vagas que chegaram               │
│ Tipo                             │ rótulo visível
│ [Todas] [Diárias] [Fixas (CLT)]  │ h 44, aria-pressed
│ Situação                         │
│ [Todas] [No ar] [Não postadas]   │
│ ┌──────────────────────────────┐ │
│ │▕▔▔▏ Atendente · Spoleto       │ │
│ │▕  ▏ Shopping Anália Franco    │ │
│ │▕  ▏ [Fixa · CLT]              │ │ selo com texto
│ │▕▁▁▏ R$ 1.874,32/mês · São     │ │
│ │     Paulo – SP · divulgar até │ │
│ │     24/12                     │ │
│ │     🕘 Esperando o horário    │ │
│ │     Vai ao ar às 8h           │ │
│ │ [Postar agora] [Não postar]   │ │
│ └──────────────────────────────┘ │
│ ┌──────────────────────────────┐ │
│ │▕▔▔▏ Garçom · Coco Bambu       │ │
│ │▕  ▏ [Diária]                  │ │
│ │▕▁▁▏ R$ 150 · Sáb 29/11 · 18h  │ │
│ │     às 23h · Campinas         │ │
│ │     📻 No ar até amanhã 14h50 │ │
│ └──────────────────────────────┘ │
└──────────────────────────────────┘
```

- O filtro "Tipo" e os selos "Diária" / "Fixa · CLT" só aparecem depois que a CLT foi ligada alguma vez (`clt.enabled_at`); antes disso, a
  lista fica igual à de hoje. Os selos aparecem em "Tipo: Todas"; com um tipo escolhido, o filtro já diz.
- Linha CLT: "{Cargo} · {Empresa}" · "{R$ 1.874,32}/mês · {Cidade – UF} · divulgar até {24/12}" no lugar de data e hora.
- No celular, os dois grupos de filtros ficam em duas linhas, cada um com o seu rótulo ("Tipo", "Situação"), para não virar uma fileira de
  6 botões sem sentido.

**Apoio e motivos das linhas CLT** (os da diária ficam como estão; textos do desenho técnico, §2.4.3):

| Situação | Texto de apoio ou motivo |
|---|---|
| Esperando a vez | "Hoje já foram {2} vagas fixas (o máximo por dia). Vai ao ar amanhã às {8h}, se o prazo para divulgar ainda não tiver terminado." |
| Para aprovar | "Aprove até {24/12}. Depois disso o prazo para divulgar termina." |
| Prazo passou | "O prazo para divulgar esta vaga fixa terminou em {24/12}." |
| Não coube | "Não coube no máximo de {2} stories de vagas fixas por dia até {24/12}." |
| Fechou | "A vaga fixa foi fechada ou venceu no Freela." |
| Ninguém aprovou | "Ninguém aprovou a tempo. O prazo era {24/12}." |
| Desligado | "Os stories das vagas fixas foram desligados." |
| Sem salário / sem cidade | §3.5 |

**Vazios**

| Filtro | Texto |
|---|---|
| Fixas, ligado, nenhuma | "Nenhuma vaga fixa nova desde que você ligou ({25/11 às 10h}). Consultamos o Freela a cada 10 minutos; a última foi às {14h40}. Vagas fixas são poucas: conte em dias, não em horas." |
| Fixas, desligado | "Ligue as vagas fixas no cartão acima para elas aparecerem aqui." |
| Diárias / Todas | os textos de hoje (`arrivedEmptyText`) |

Carregando e erro: os de hoje (3 esqueletos; "Não conseguimos carregar as vagas. Verifique a conexão e toque em Tentar de novo.").

**Detalhe (painel de baixo para cima) de uma vaga fixa**
- Cabeçalho: "{Atendente} · {Spoleto Shopping Anália Franco}", selo "Fixa · CLT", "Divulgar até {24/12}".
- Tabela "Confira com a vaga": Cargo · Salário por mês · Escala · Cidade · Empresa · Benefícios ("✓ confere" / "✗ diferente: a arte diz …").
- Com QR: "O QR abre: {freelaservicos.com.br/vagas-fixas/…}".
- Link "Abrir a vaga fixa no site ↗" (só quando a página do site existir).
- Ações iguais às da diária.

**Aba Aprovações:** tema "Vaga fixa · {Atendente} · {Spoleto Shopping Anália Franco}" (desenho técnico) e "✓ Conferido: cargo, salário,
cidade".

---

## 5. Página pública `/vagas-fixas/[id]` (site do Freela)

### 5.1 Trabalho de quem chega

- **Quem:** quem procura emprego fixo em bar e restaurante. Chega pelo QR, por print repassado, por link no WhatsApp ou pelo Google.
  Quase sempre no celular; muitas vezes sem conta no Freela.
- **Job:** quando vejo uma vaga fixa, quero ver o salário, onde é e a escala, e me candidatar sem complicação, para conseguir um emprego
  de carteira assinada.
- **Critério:** em 360 × 640, salário, cidade e escala aparecem **sem rolar**; o botão de candidatura está sempre visível; 1 toque até o
  cadastro.

### 5.2 Wireframe (celular)

```text
┌──────────────────────────────────┐
│ [Freela Serviços]        [Entrar]│ cabeçalho do site (igual)
├──────────────────────────────────┤
│ ┌───────────────────────────────┐│
│ │💼 Vaga fixa · Carteira        ││ selo: ícone + texto
│ │   assinada (CLT)              ││
│ └───────────────────────────────┘│
│ Atendente                        │ h1, 24 px
│ Spoleto Shopping Anália Franco   │ 16 px
│                                  │
│ Salário    R$ 1.874,32 por mês   │ dl; valor 20 px, negrito
│ Cidade     São Paulo – SP        │
│ Escala     6x1, 10h às 18h20     │
│ ─────────────────────────────────│
│ Benefícios                       │ h2
│ ✓ Vale-transporte                │ ul
│ ✓ Refeição no local              │
│ ✓ Plano de saúde                 │
├ ─ ─ ─ ─ ─ ─ ─ dobra (640 px) ─ ─ ┤
│ Sobre a vaga                     │ h2
│ Atendimento no salão e caixa…    │
│                                  │
│ Publicada em 20/11/2026.         │
│ O endereço e o contato são       │
│ informados ao candidato pela     │
│ plataforma.                      │
│                                  │
│ Prefere o app?                   │ h2
│ Baixe o Freela Serviços e procure│
│ esta vaga em Vagas fixas.        │
│ [ Google Play ] [ App Store ]    │ selos oficiais
│                                  │
│ (rodapé do site)                 │
├──────────────────────────────────┤
│ [  Entrar para se candidatar   ] │ fixo no pé, h 48,
└──────────────────────────────────┘ respeita a safe-area
```

- **Computador:** uma coluna de até 672 px (como `/vagas/[id]`). O botão sai do pé fixo e fica logo abaixo dos benefícios; os selos ficam
  ao lado de "Prefere o app?".
- **Escala com horários por dia:** dias seguidos com o mesmo horário viram uma linha ("Seg a Sex · 8h às 17h", "Sáb · 8h às 12h"), até 7
  linhas.
- **Campos que faltam:** sem salário, a linha mostra "A combinar" (a página pode ser aberta pelo Google mesmo sem story); sem cidade,
  sem escala, sem empresa, sem benefícios ou sem descrição, a linha ou a seção some. O título continua.
- Selo "Vaga fixa · Carteira assinada (CLT)" no alto: o mesmo azul-carteira da arte, se o Diego aprovar (§3.2); senão a cor primária do
  site. Contraste do selo **conferir** com os tokens do site.

### 5.3 Botão de candidatura

Segue o molde de `/vagas/[id]` (`PublicVacancyCta`): o primeiro desenho é o do visitante anônimo (igual ao do servidor); depois que a
sessão carrega, o botão muda.

| Quem | Botão principal | Apoio |
|---|---|---|
| Visitante sem login | **Entrar para se candidatar** → cadastro com volta para a vaga | — |
| Profissional logado, ainda não se candidatou | **Candidatar-se** → tela de candidatura desta vaga | — |
| Profissional que já se candidatou (se a API disser) | **Ver minha candidatura** | "Você já se candidatou a esta vaga." |
| Contratante dono da vaga | **Abrir no meu painel** | "Esta vaga é sua." |
| Outro contratante | botão secundário **Ir para o meu painel** | "Você está conectado como contratante. Esta vaga foi publicada por outra empresa." |

- **App como segunda opção**, não como botão principal: o app só abre pelo esquema `freelamobile://` (não há link universal no `app.json`),
  e, sem o app instalado, um botão "Abrir no app" não faria nada. Além disso, no app a lista de vagas fixas filtra por distância (30 km),
  então "procure esta vaga" pode falhar para quem mora longe. Por isso o texto é "Prefere o app?", com os selos oficiais (§8 P17, §9 D5).
- O destino de "Candidatar-se" e da volta do cadastro **não pode** ser a tela de acompanhamento de candidatura (§8 P1).

### 5.4 Vaga que não está mais disponível

A API responde 404 igual para vaga fechada, vencida, de empresa inativa ou que não existe. O texto vale para todos os casos:

```text
┌──────────────────────────────────┐
│ [Freela Serviços]        [Entrar]│
├──────────────────────────────────┤
│ Esta vaga não está mais          │ h1
│ disponível                       │
│ Ela pode ter sido preenchida ou  │
│ encerrada pela empresa, ou o link│
│ está incompleto.                 │
│                                  │
│ [      Ver vagas abertas       ] │ → /#vagas
│                                  │
│ Novas vagas fixas aparecem       │
│ primeiro no app:                 │
│ [ Google Play ] [ App Store ]    │
└──────────────────────────────────┘
```

- HTTP 404 e `noindex`. Sem marcação `JobPosting`.
- Quem chega por QR de um print antigo cai aqui, não numa página de erro genérica.

### 5.5 Carregando e erro

- **Carregando** (`loading.tsx`): esqueleto no formato do cartão (selo, título, 3 linhas de dados, botão). Nada de spinner de tela inteira.
- **Erro da API** (fora do ar, tempo esgotado): **nunca** mostrar "não está mais disponível", que seria mentira. Página de erro:
  "Não conseguimos carregar esta vaga agora. Tente de novo em alguns minutos." + botão "Tentar de novo". Sem `JobPosting` (§8 P15).

### 5.6 Busca do Google e compartilhamento, sem dados sensíveis

| Item | Conteúdo |
|---|---|
| `<title>` | "Vaga fixa de {Atendente} em {São Paulo} – {SP}" (sem cidade: "Vaga fixa de {Atendente}"); o sufixo do site vem do layout (**conferir**) |
| `description` | "{Atendente} com carteira assinada em {São Paulo}: salário de {R$ 1.874,32} por mês{, escala 6x1}. Candidate-se pelo Freela Serviços." (sem salário: tira a parte do salário) |
| `canonical` | `/vagas-fixas/{id}`, **sem** o `?utm_source` do QR |
| Cartão do WhatsApp (Open Graph) | título igual ao `<title>`; descrição "{R$ 1.874,32} por mês · {6x1} · {Spoleto Shopping Anália Franco}" |
| `JobPosting` (só com a vaga aberta) | `title`, `description` (a descrição pública ou a frase acima), `datePosted`, `validThrough`, `employmentType: FULL_TIME`, `hiringOrganization.name` (só com empresa, §8 P16), `jobLocation` só com cidade, UF e país BR, `baseSalary` em BRL com `unitText: MONTH` (só com salário) |
| Nunca na página nem no HTML | rua, número, bairro, o texto cru do local, telefone, e-mail, link de contato, coordenadas, instruções de candidatura, id do dono |

- O texto de rodapé "O endereço e o contato são informados ao candidato pela plataforma." (do desenho técnico) explica a ausência sem
  parecer que falta algo.
- Teste do site (W2): o HTML da página não contém nenhum dos canários do teste da API (telefone, e-mail, "Rua das Flores", "@perfil").

---

## 6. Acessibilidade (WCAG 2.2 AA como piso)

WCAG = diretrizes de acessibilidade para conteúdo web. ✓ = este desenho cobre; ✗ = depende de algo fora dele (com o ponto indicado).

**Faixa vermelha (Meu Funil)**
- ✓ Ícone + título + texto; nunca só a cor vermelha (1.4.1).
- ✓ "Como resolver" é um `<button>` com `aria-expanded` e `aria-controls`; os passos são `<ol>`.
- ✓ Resultado do teste numa região `aria-live="polite"` fora do botão; o botão em "Testando" fica `disabled` com o texto trocado.
- ✓ Links externos com "↗" visível e `aria-label` que diz "em outra aba".
- ✓ "Ver como resolver" (aba Vagas) leva o foco ao título da faixa (`tabIndex=-1`) e abre os passos.
- ✓ Sem contagem regressiva que muda a cada segundo (o horário fixo "a partir das 9h13" basta).
- ✗ Hoje a faixa vermelha usa `role="alert"`, que o leitor de tela anuncia de novo a cada troca de tela. Sugestão: `role="region"` com
  `aria-labelledby` no título e `aria-live` só nos resultados. Cosmético para quem vê; incômodo para quem usa leitor de tela (severidade 2).
- ✗ Contraste dos tokens `destructive`, `warning` e `success` sobre os fundos `/10`: **conferir** com a ferramenta de contraste antes de
  subir (não medido aqui).

**Ajustes e lista (Meu Funil)**
- ✓ Interruptores com rótulo visível e alvo de 44 × 44 px em volta (padrão do `status-card.tsx`).
- ✓ Filtros "Tipo" e "Situação" em `role="group"` com `aria-label`, botões com `aria-pressed`, altura 44 px, 8 px entre eles.
- ✓ Selos "Diária", "Fixa · CLT", "Com QR", "Sem foto" sempre em texto.
- ✓ Grupos dos Ajustes com `<h3>`; opções do retroativo em `<fieldset>` + `<legend>`; contador com `aria-label` "Diminuir" / "Aumentar" e
  `<output aria-live="polite">`.
- ✓ Prévia com texto alternativo completo (§3.6); o recorte ampliado do rodapé é decorativo (`alt=""`), porque o texto "O QR abre: …" já
  diz o que importa.
- ✓ Diálogos Radix (foco preso, Esc fecha), sem diálogo dentro de diálogo; botões com o verbo da ação ("Pôr o QR", "Ligar vagas fixas",
  "Desligar vagas fixas"), nunca "Sim/Não".
- ✓ Ícone de pausa com `motion-reduce` (sem animação); spinner de "Testando" para com `prefers-reduced-motion`.

**Arte**
- ✓ Contrastes medidos: preto sobre branco 18,9 : 1; amarelo sobre preto 12,0 : 1; branco sobre azul-carteira 10,4 : 1; amarelo sobre
  azul-carteira 6,6 : 1; azul-carteira sobre o fundo claro 9,9 : 1. Nenhum texto branco sobre amarelo.
- ✓ Diária × fixa diferentes por texto, não só por cor.
- ✗ Story publicado pela API não leva texto alternativo; só a prévia no Meu Funil tem.

**Página pública (site do Freela)**
- ✓ `<h1>` com o cargo; dados em `<dl>`; benefícios em `<ul>`; ícones decorativos com `aria-hidden`.
- ✓ Botão fixo no pé não cobre conteúdo: a página ganha espaço embaixo do tamanho do botão; respeita `env(safe-area-inset-bottom)`.
- ✓ Botão com 48 px de altura e texto de 16 px; texto do corpo nunca menor que 14 px.
- ✓ Selos das lojas com `alt` "Disponível no Google Play" e "Baixar na App Store" (texto oficial).
- ✓ Zoom de 200% sem rolagem para os lados (uma coluna).
- ✗ Teste com leitor de tela (TalkBack) no fluxo "QR → página → Entrar para se candidatar": fazer na W2.

---

## 7. Problemas encontrados no desenho técnico e nas telas atuais

Escala de severidade de Nielsen: 0 não é problema · 1 cosmético · 2 menor · 3 maior · 4 catastrófico (impede a tarefa).

| Sev. | Onde | Problema | Heurística | Correção |
|---|---|---|---|---|
| 4 | Desenho técnico §2.4.2, CTA da página | O botão leva o profissional logado a `/freelancer/vagas-fixas/<id>`, que na cópia local do site é o **acompanhamento** de uma candidatura (`/fixed-jobs/me/applications/:id`): quem ainda não se candidatou vê "Candidatura não encontrada" | 5 prevenção de erros | Destino de candidatura por id da vaga (§8 P1) |
| 3 | Desenho técnico M9 | A prévia só leva o QR quando `qr_enabled` já está ligado: não há como ver o QR antes de ligar | 5, 3 controle | Prévia com QR independente do interruptor (§8 P2) |
| 3 | Desenho técnico §2.3 | QR de 184 px com 2 módulos de zona clara sobre fundo preto, encostando no canto arredondado e indo até y 1690 (área coberta pela barra de resposta em telas 16:9) | 5 | 180 px em (64, 1508), 4 módulos de zona clara, portão da §2.6 (§8 P3) |
| 3 | Desenho técnico F0-5 b + R4 | Com a sonda "só registra", o botão não fecha o bloqueio, a fila adiada não tenta publicar, e o texto "a Meta ainda não deu a permissão" fica falso. Só a reconexão tira dali | 1 visibilidade, 9 recuperação | Estado E da faixa e campo na API (§8 P5) |
| 3 | Desenho técnico §2.4.3 + dados de 24/11 | Só 1 das 52 vagas fixas abertas cai nos últimos 14 dias, e vaga com mais de 30 dias nunca entra. O Diego pode esperar 52 stories e ver 1 | 1, 2 mundo real | Bloco "O que vai entrar" antes de ligar; contagens na API (§8 P11); decisão D3 |
| 3 | Arte CLT do desenho técnico | Salário sem "por mês": "R$ 1.874" ao lado das diárias de "R$ 150" pode ser lido como pagamento por dia | 2 | "Salário por mês:" na arte, "por mês" na página |
| 3 | Página pública | 404 e erro da API podiam cair na mesma página; com a API fora, a pessoa leria "vaga indisponível" | 9 | §5.5 e §8 P15 |
| 2 | `health-alerts.ts` (faixa da IA) | "O que já estava pronto e agendado continua sendo publicado" fica falso com a publicação parada | 1 | §1.6 |
| 2 | `settings-panel.tsx`, `capWarning` | "25 publicações" e "acima de 15" fixos; com o limite lido da Meta (50) ficam errados | 2 | §1.8 e §8 P9 |
| 2 | Desenho técnico P2 × dados de 24/11 | p90 de 21 vagas por dia e máximo de 26 passam do teto de 20 do CHECK; 67 de 248 (27%) eram gêmeas, acima do gatilho de 15% da P5 | 7 eficiência | §8 P10 |
| 2 | Lista durante o bloqueio | "Postar agora" falharia e reabriria o bloqueio; linhas paradas apareceriam como "Na fila" ou "Esperando o horário" | 1, 5 | Situações novas e `can.post_now` falso (§8 P7) |
| 2 | Página pública, caminho do app | Sem link universal; no app, a lista de vagas fixas filtra por 30 km | 3 | App como segunda opção (§5.3, §8 P17) |
| 2 | Desenho técnico §6, rodapé com QR em 3 linhas | 3 linhas com `fitWrapped` até a borda dos selos caem para ~25 px (≈ 8 dp no celular) | 8 minimalismo | Ordem e tamanhos da §2.3/§2.4 (piso 26 px) |
| 2 | Status card de hoje | Título "Postar as vagas do Freela nos stories" fica ambíguo com as vagas fixas | 4 consistência | "Postar as diárias do Freela nos stories" (§4.1) |
| 1 | Arte CLT do desenho técnico | Cartão "Cargo" repete o título e encolhe a pilha de 6 cartões | 8 | Sem o cartão (§3.2) |
| 1 | Arte CLT | Título "ATENDENTE CLT" + pílula "CARTEIRA ASSINADA" repetem | 8 | Tirar "CLT" do cargo na arte (§8 P13) |
| 1 | Faixas | Formatos de hora diferentes: "21:00" na faixa da IA, "21h" na aba Vagas | 4 | Textos novos em "8h30"; migrar a faixa da IA depois |

---

## 8. Pontos para o arquiteto

Cada ponto tem a minha preferência; a decisão é do `software-architect` (e do Diego quando for produto).

- **P1. Destino da candidatura no site (bloqueia W2).** Na cópia local do `freela-web-v2` (ramo `design/revisao-web-menos-scroll`, não o
  `origin/main`; não consegui ler o `origin/main` daqui), `/freelancer/vagas-fixas/[id]` chama `/fixed-jobs/me/applications/:id`, ou seja,
  é o acompanhamento de uma candidatura, e a candidatura acontece na lista `/freelancer/vagas-fixas` (expande "Detalhes"). O `withReturnUrl`
  citado no desenho técnico também não existe nessa cópia. **Conferir no `origin/main`.** Preferência: uma rota de candidatura por id da
  vaga (por exemplo, `/freelancer/vagas-fixas?vaga=<id>` abrindo os detalhes e o "Candidatar-se" mesmo fora dos 30 km), e, se a pessoa já
  se candidatou, "Ver minha candidatura" (precisa de um campo na resposta autenticada).
- **P2. Prévia com QR com o interruptor desligado.** `POST …/vacancy-stories/preview` aceitar `{ qr: true }` e a resposta trazer
  `preview.qr: { url, read_ok } | null` (`read_ok` = o `jsqr` leu a URL na arte final). O interruptor destrava com `preview.qr.read_ok`.
- **P3. Tamanho, versão e URL do QR.** Preferência: quadrado de 180 px em (64, 1508) com **zona clara de 4 módulos** e módulo de 4 px, o
  que exige versão 5 (37 módulos) e, com correção M, URL de até 84 caracteres. Hoje: diária 86, CLT 92. Opções, em ordem de preferência:
  (a) parâmetro curto que o site traduz para a origem (`?o=ig`: diária 77, CLT 83); (b) sem UTM (72 e 78); (c) UTM com correção L
  (versão 5); (d) o desenho técnico como está (versão 6, zona clara de 2). Decidir pelo teste com `jsqr` em 720 px **e** pelo portão da
  §2.6 com celulares reais. Conferir no 1º uso com `getModuleCount()`.
- **P4. Quem liga o QR.** Preferência: `manage` (dono ou administrador), como "Postar sozinho", porque muda o que vai a público. Se ficar
  `write`, a tela só troca o texto "Só o dono ou um administrador liga o QR.".
- **P5. Modo da sonda na resposta.** `publishing.probe: 'active' | 'log_only'`. Em `log_only` a faixa troca o botão para "Já corrigi —
  reconectar o Instagram" e esconde "conferimos sozinhos". Avaliar também: no `log_only`, liberar **um** job adiado por conferência, para
  uma publicação que dê certo fechar o bloqueio (hoje, só a reconexão fecha).
- **P6. Conta na faixa.** `publishing.username` (ou ler de onde a tela de Instagram já lê) para o texto dizer "no @freelaapp".
- **P7. Linhas paradas pelo bloqueio vêm da API.** Dois `display` novos: `paused` (linha com `PUBLISH_BLOCKED_WAIT`) e `paused_ready` (post
  `ready`/`scheduled`/`approved` com `PUBLISH_BLOCKED_MSG`), com `label` e `support` da §1.7, e `can.post_now = false` enquanto houver
  bloqueio. O `SITUATION` do web ganha os dois com o ícone `PauseCircle`.
- **P8. Faixa da IA.** Só web: `aiAlertText(…, { publishingBlocked })` (§1.6). Sem mudança na API.
- **P9. Limite da Meta na resposta dos Ajustes.** `publish_quota` (o `publish_quota_total ?? 25` da P1 técnica) no `GET …/settings`, para a
  ajuda e o limiar do aviso (60% do limite).
- **P10. Teto do máximo por dia.** Com p90 = 21 e máximo = 26, o teto de 20 do CHECK não cobre 9 de cada 10 dias. Com 27% de gêmeas, a P5
  (pular gêmeas) passa do gatilho de 15% do próprio desenho técnico. Preferência: trazer a P5 para este lote; com as gêmeas fora, o p90
  deve cair para perto de 15. Senão, subir o CHECK e o contador da tela para 25.
- **P11. Contagens da CLT antes de ligar.** No bloco `clt`: `open_total` (abertas no Freela), `promo_days` (o prazo para divulgar, hoje 30)
  e `backlog_counts: { "0": n, "7": n, "14": n, "30": n }` (quantas entrariam agora em cada opção, já tirando as sem salário, sem cidade e
  fora do prazo). Sem isso, a tela usa o texto sem números (§4.2). Ver também a decisão D3.
- **P12. Cidades das vagas fixas** no `recent_cities` dos Ajustes, para a lista de cidades não esconder uma vaga fixa de uma cidade que só
  tem vaga fixa.
- **P13. `cltFields`.** (a) Tirar "CLT", "(CLT)", "- CLT" do fim do cargo mostrado na arte e na lista. (b) Escala dos horários: mesmo
  horário em todos os dias → "Seg a Sex, 8h às 17h"; horários diferentes → "{6} dias por semana". (c) `publicSalary` com só o mínimo vira
  valor único e perde o "a partir de" que o painel do contratante mostra; se importar, devolver também o tipo (`exact` | `range` | `from` |
  `upto`).
- **P14. Unidade do salário.** O formulário do Freela pede "Proposta salarial" (placeholder "Ex.: 3200") sem dizer a unidade. A arte e a
  página dizem "por mês", com base nos valores reais. Preferência: o rótulo do formulário vira "Salário por mês" (mudança no
  `freela-web-v2` e no app do contratante).
- **P15. Leitura da vaga fixa no site.** `getPublicFixedJob` distingue 404 (`notFound()`, página da §5.4) de qualquer outra falha (lança
  erro, página da §5.5). Nunca transformar falha da API em "não está mais disponível".
- **P16. `JobPosting` sem empresa.** O Google exige `hiringOrganization`. Preferência: sem empresa pública, não gerar a marcação (a página
  continua).
- **P17. App.** O `app.json` só tem o esquema `freelamobile` (sem link universal, sem `intentFilters`). Fora deste lote: links universais
  (iOS `associatedDomains`, Android `intentFilters` com `autoVerify`) para `/vagas-fixas/<id>` abrir direto a tela `(app)/vagas-fixas/[id]`,
  que já tem "Candidatar-se". Até lá, o app é a segunda opção na página.
- **P18. Salvar só o token em Integrações.** Conferir se "Salvar credenciais" (`meta-ads-card.tsx`) aceita trocar só o "Token do usuário
  do sistema" sem pedir os outros campos de novo. O passo 4 da faixa depende disso.
- **P19. Motivo de expiração CLT durante o bloqueio.** `blockedExpireReason` ganha a versão CLT da §1.7 ("…e o prazo para divulgar esta
  vaga fixa terminou em {24/12}.").
- **P20. Números da F0-1.** O pedido fala em 38 stories que falharam e 5 cancelados (43); o desenho técnico fala em 40 recusas. Conferir
  na F0-1 antes de usar um dos números em texto para o Diego.
- **P21. Artes já prontas ao ligar o QR.** O diálogo diz que as prontas continuam sem QR. Confirmar que nada é refeito sozinho ao ligar.
- **P22. QR das vagas fixas sem a página do site.** Uma configuração que diga se `/vagas-fixas/<id>` já está no ar, para a tela mostrar o
  aviso da §2.5 e a arte CLT sair sem QR até lá.
- **P23. "Voltou" só lido, não publicado.** O teste e a conferência leem `/me/permissions`; não provam que publicar funciona (é o falso
  "liberado" da tabela de riscos). Para a faixa dizer a verdade: (a) `publishing.reopened_after: { closed_at, how: 'probe' | 'button' } | null`
  quando o bloqueio reabre depois de um fechamento sem publicação, para a frase "A conferência das 9h12 indicou…, mas a Meta recusou de novo
  às 9h27" (§1.4); (b) opcional, `last_publish_ok_at` nos Ajustes, para o cartão da aba Vagas dizer "Confirmado: o 1º post depois do
  conserto foi ao ar às {9h31}." Se a F0-5 levar à opção D (3 estados), o estado "testando" do sistema usa o texto verde da §1.4 até a 1ª
  publicação dar certo.

---

## 9. Decisões para o Diego

| # | Pergunta | Recomendação |
|---|---|---|
| D1 | QR na arte (muda a decisão de 28/10)? | Sim, como opção desligada, ligada só depois da prévia e do teste num celular real (§2.6) |
| D2 | Ordem do rodapé com QR | "Candidate-se pelo app / Procure Freela Serviços na loja / ou leia o QR para ver a vaga" (loja antes do QR) |
| D3 | Vagas fixas: hoje só 1 das 52 abertas entra com 14 dias de retroativo, e vaga com mais de 30 dias nunca entra. Quer uma opção "todas as abertas, 2 por dia"? | Decidir com a F0-6 na mão. Se a maioria das 52 tiver mais de 30 dias e continuar aberta, é provável que muitas estejam esquecidas: melhor não divulgar vaga que talvez não exista mais |
| D4 | Vaga fixa em azul-carteira (título e pílula) ou tudo preto e amarelo? | Azul-carteira: diferencia de relance e lembra a Carteira de Trabalho |
| D5 | Candidatura pela página: site primeiro ou app primeiro? | Site primeiro ("Entrar para se candidatar"), app como segunda opção, até existir link que abre o app direto |
| D6 | Endereço do site escrito na arte? | Não: ninguém digita em 2 s; o link da bio cobre. Se sim, a variante está na §2.4 ("Vagas em freelaservicos.com.br" no lugar da L3) |
| D7 | Página da vaga fixa sem salário | "A combinar" na página (o story continua pulando a vaga sem salário) |
| D8 | Cartão "Cargo" na arte CLT (o pedido lista Empresa, Cargo, Salário, Escala, Cidade e Benefícios) | Tirar: o cargo já está no título em letra grande. Com ele, são 6 cartões e a pilha encolhe para ~0,8 (≈ 912 px para 736 livres): valores de ~34 px (≈ 11 dp no celular) e salário de ~51 px. Se o Diego quiser igual à diária, ele volta como 2º cartão ("Cargo:"), e a prévia mostra o tamanho real |
