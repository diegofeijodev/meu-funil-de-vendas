# Stories automáticos das vagas — tela e textos

Complemento de `2026-10-28-vagas-instagram-design.md`. Feito pelo ux-designer em 28/10/2026 a partir do design. Quem usa a tela: Denner
(operação) e Diego (dono, não técnico, muito pelo celular). Quem vê o story: freelancers de bares e restaurantes, no celular, por 1–2 s.
Meta: aprovar um story em 3 toques (Instagram → Vagas → Aprovar).

## 1. A arte do story (1080×1920)

Área livre: nada importante fora de y 250–1600 (o Instagram cobre o topo com nome/foto do perfil e a base com a barra "Enviar mensagem";
o próprio `compose.ts` usa 14% em cima e 20% embaixo). Testar num celular real com a barra de resposta aberta.

Campos, em ordem de destaque (até ~20 palavras no total):

| Ordem | Campo | Formato | Tamanho mínimo |
|---|---|---|---|
| 1 | Função (com "VAGA FREELA" pequeno em cima) | `GARÇOM`, caixa alta, até 2 linhas | 110 px |
| 1 | Valor ("Valor para o freela") | `R$ 150`; com centavos `R$ 152,50` | 130 px (o maior número) |
| 2 | Quando | `Sáb, 29/10 · 18h às 23h`; `Qua, 29/10 · 11h30 às 21h` | 60 px |
| 3 | Onde | pino + `Campinas` (como vem da vitrine) | 60 px |
| 4 | Estabelecimento (quando permitido, ver design §5.3) | `Coco Bambu` | 48 px |
| — | Rodapé desenhado pelo sistema | ver abaixo | 56 px / 44 px |

- Data: dia da semana + data, **sem ano**, **nunca "hoje"/"amanhã"** (o story fica 24 h no ar).
- Texto de corpo ≥ 48 px, sempre sobre cartão de fundo sólido.
- **Rodapé (sistema, não IA):** linha 1 **Candidate-se pelo app**; linha 2 **Procure Freela Serviços na loja**; selos oficiais
  "DISPONÍVEL NO Google Play" e "Baixar na App Store" (arquivos oficiais, nunca redesenhados). Sem link, sem QR (o freelancer vê o story no
  mesmo celular que teria de escanear), sem domínio (ninguém digita em 2 s; `/vagas` sem id nem existe no web do Freela). *Pendente: OK do
  dono — ver design §10.* Falta testar se a busca "Freela Serviços" mostra o app em 1º na Play Store (na App Store o nome confere).
- Fora da arte, como complemento: o link da bio do @ do Freela apontando para a loja.

## 2. Onde fica

Aba nova **"Vagas"** no Instagram (`?tab=vagas`), em 2º lugar, depois de "Visão geral", com contador quando há story para aprovar:
"Vagas (2)". Só existe para as empresas da lista; para as outras `?tab=vagas` cai em "Visão geral". Com 6 abas o `TabsList` quebra em 2
linhas em 360 px (aceitável). O selo do menu (`lib/ig-pending.ts`) já conta esses stories; nesta empresa ele abre `?tab=vagas`.

Ordem na tela (celular): 1) cartão de situação com o interruptor; 2) "Para aprovar"; 3) "Vagas que chegaram"; 4) "Ajustes" (fechado, com
resumo de 1 linha: "Todas as cidades · 8h às 21h · até 10/dia · OpenAI").

### Primeira vez (sem modelo)
Título "Vagas do Freela nos stories" · "Cada vaga nova do Freela vira um story no estilo da sua arte modelo." · passos "1 Envie a arte
modelo · 2 Veja uma prévia · 3 Ligue" · botão **Enviar arte modelo** · "PNG, JPG ou WEBP, em pé." · interruptor desativado com "Envie a
arte modelo para poder ligar."

### Dia a dia (ligado)
- Situação: "Ligado · você aprova cada story antes" / "Ligado · posta sozinho depois da conferência" · "Hoje: 4 postados de 10 (o máximo
  por dia que você definiu)" · "Última consulta: 14h40 (a cada 10 minutos)" · "Ligado desde 28/10 às 14h30. Vagas publicadas antes disso
  não entram."
- Cartão "Para aprovar": miniatura 9:16, "Garçom · Coco Bambu", "R$ 150", "Sáb 29/10 · 18h às 23h", "Campinas", "✓ Conferido: função,
  valor, data, horário, cidade", "! Aprove até 16h", botões **Não postar** / **Aprovar** (`h-11` no celular, 8 px entre eles).
- "Vagas que chegaram" com filtros (Todas · No ar · Não postadas).

### Detalhe (painel de baixo para cima)
Prévia 9:16 (280 px de largura) com opção "Mostrar o que o Instagram cobre" · tabela "Confira com a vaga" (Função/Valor/Data/Horário/
Cidade com "✓ confere" ou "✗ diferente: a arte diz 28/10") · "Feita pela IA na 2ª tentativa (a 1ª errou o horário)" · "Abrir a vaga no
Freela ↗" · **Não postar** / **Aprovar** · "Refazer a arte" (pelo fluxo da vaga, nunca o "Regenerar mídia" genérico).

### Ajustes
Arte modelo (miniatura · "Trocar arte modelo" · "Gerar prévia com uma vaga real") · Cidades (lista das cidades das vagas recentes, com
contagem; nunca texto livre) · "Horário para postar: Das [08:00] às [21:00]" (`type="time"`) · "Máximo de stories de vagas por dia" (−/+,
1 a 20, padrão 10) · "Só postar vagas que começam daqui a pelo menos" (1 h · 2 h · 4 h · 6 h) · "Quem desenha a arte" (OpenAI recomendado
/ Gemini) · "Antes de ir ao ar" (Eu aprovo cada story — recomendado nas primeiras semanas / Postar sozinho) · **Salvar ajustes** fixo
embaixo, ativo só quando algo mudou. Ligar/desligar e "Postar sozinho" valem na hora, com diálogo.

## 3. Textos

| Elemento | Texto |
|---|---|
| Interruptor | **Postar as vagas do Freela nos stories** |
| Desligado | "Desligado. Nenhuma vaga vira story agora." |
| Diálogo ligar | "Ligar os stories das vagas?" · "A partir de agora, cada vaga nova do Freela vira um story no Instagram @{conta}. Vagas publicadas antes de agora não entram. Cada story espera sua aprovação antes de ir ao ar." (modo sozinho: "Os stories vão ao ar sozinhos, depois que o sistema confere função, valor, data, horário e cidade.") · "Ligar" / "Agora não" |
| Diálogo desligar | "Desligar os stories das vagas?" · "{n} stories prontos e {m} esperando aprovação não vão ao ar. Os que já foram postados continuam no Instagram até sumirem sozinhos (24 h). Vagas publicadas enquanto estiver desligado não entram depois, mesmo se você ligar de novo." · "Desligar" / "Manter ligado" |
| Arte modelo | "Arte modelo" · "A IA segue o estilo desta arte em todo story: cores, letras e posição dos cartões. Os textos são trocados pelos da vaga." · "Enviar arte modelo" / "Trocar arte modelo" · salva: "Arte modelo salva. Gere uma prévia para ver como fica com uma vaga de verdade." · tipo errado: "Esse arquivo não serve. Envie uma imagem PNG, JPG ou WEBP." · grande: "A imagem tem {x} MB e o máximo é {y} MB. Envie uma menor." · deitada (aviso): "Essa arte está deitada. Story é em pé: envie uma arte em pé para não sobrar faixa grande em cima e embaixo." |
| Prévia | "Gerar prévia com uma vaga real" · "Não posta nada. Usa a vaga mais recente do Freela. Gasta de 1 a 3 imagens da chave da empresa." · carregando: "Criando a prévia… costuma levar de 1 a 3 minutos. Pode sair desta tela, ela fica salva aqui." (passos "Criando a arte (tentativa 1 de 3)" → "Conferindo os textos") · selo "PRÉVIA · não foi postada" · sem vaga: "Não há vaga aberta no Freela agora. Usamos uma vaga de exemplo: Garçom, R$ 150, Sáb 29/10, 18h às 23h, Campinas." |
| Cidades | "Só vagas dessas cidades viram story." · padrão "Todas as cidades" · "Cidades das vagas recentes" |
| Horário | "Vaga que chegar fora desse horário espera e vai ao ar às {08:00}." · erro "O início precisa ser antes do fim." |
| Limite | "O Instagram aceita até 25 publicações por dia na conta, somando os posts normais. As vagas que passarem do máximo ficam para o dia seguinte, se ainda não tiverem começado." · acima de 15: "Acima de 15, os posts normais da empresa podem ficar sem espaço no dia." |
| Antecedência | "Vaga em cima da hora não dá tempo de alguém ver o story e se candidatar." · modo aprovar: "Conte também o tempo que você leva para aprovar." |
| IA | "OpenAI (recomendado): erra menos letras e números" · "Gemini: já sai no tamanho exato do story" · "Usa a chave da empresa em Integrações. Cada story gasta de 1 a 3 imagens; se cair na reserva, mais 1." |
| Diálogo "Postar sozinho" | "Postar sem sua aprovação?" · "Os próximos stories vão ao ar sem passar por você. O sistema continua conferindo função, valor, data, horário e cidade; se a IA errar 3 vezes, usa a versão de reserva, com os textos escritos pelo sistema. Nos últimos {n} stories: {a} saíram certos de primeira, {b} foram refeitos, {c} foram para a reserva e você não postou {d}." · "Postar sozinho" / "Continuar aprovando" |
| Salvar | "Salvar ajustes" · "Ajustes salvos." · erro "Não conseguimos salvar. Seus ajustes continuam aqui. Toque em Tentar de novo." |

**Vazios:** modelo salvo e sem prévia: "Arte modelo salva. Gere uma prévia antes de ligar, para ver se a IA segue o seu modelo." · ligado
sem vagas: "Nenhuma vaga nova desde que você ligou (28/10 às 14h30). Consultamos o Freela a cada 10 minutos; a última foi às 14h40." ·
"Para aprovar" vazio: "Nenhum story esperando você agora."

**Erros:** tela: "Não conseguimos carregar as vagas. Verifique a conexão e toque em Tentar de novo." · vitrine fora há > 30 min (amarelo):
"Não conseguimos consultar as vagas do Freela desde as 14h10. Tentamos de novo sozinhos a cada 10 minutos. Quando voltar, as vagas novas
entram normalmente." · Instagram desconectado (vermelho): "O Instagram está desconectado. Os stories ficam prontos aqui, mas só vão ao ar
depois que você reconectar." [Reconectar Instagram] · IA (vermelho): "A OpenAI recusou a chave da empresa (sem crédito). Nenhum story novo
está sendo criado desde as 14h20." [Abrir Integrações] · limite (amarelo): "A conta chegou a 25 publicações nas últimas 24 h, somando
posts normais e stories. Os próximos stories saem a partir das 15h30."

**Carregando:** esqueleto do cartão de situação + 3 cartões com miniatura 9:16; nada de spinner de tela inteira.

## 4. Situações da lista

| Situação | Texto | Apoio | Ações |
|---|---|---|---|
| na fila | Na fila para criar a arte | — | Não postar |
| gerando | Criando a arte | "Tentativa 2 de 3" | — |
| esperando horário | Esperando o horário | "Vai ao ar às 8h" | Postar agora · Não postar |
| esperando limite | Esperando a vez | "Hoje já foram 10 (o máximo por dia). Vai ao ar amanhã às 8h, se a vaga ainda não tiver começado." | Postar agora · Não postar |
| para aprovar | Esperando sua aprovação | "Aprove até 16h. Depois disso não dá tempo de divulgar." | **Aprovar** · Não postar |
| pronto (sozinho) | Pronto, vai ao ar às 14h50 | — | Não postar |
| no ar | No ar até amanhã às 14h50 → depois "Ficou 24 h no ar" | — | Ver no Instagram (só nas 24 h) |
| pulada | Não virou story | motivo | Criar story mesmo assim (vaga aberta e não começou) |
| cancelada | Não foi ao ar | motivo | conforme o motivo |
| falhou | Não conseguimos criar o story | motivo | Tentar de novo |

Selos extras: "Versão de reserva", "Refeita 1 vez".

Motivos: teste — "Parece vaga de teste: o nome da empresa tem “teste”." · cidade — "Cidade fora da sua lista: Jundiaí." · em cima da
hora — "Começa às 15h, em menos de 2 h. Não dá tempo de divulgar." · limite vencido — "Ficou esperando a vez (máximo de 10 por dia) e a
vaga começou antes." · fechou — "A vaga não está mais aberta no Freela (preenchida ou cancelada)." · mudou — "A vaga mudou no Freela
(valor ou horário). Vamos criar o story de novo." · começou — "A vaga começou antes de ir ao ar." · ninguém aprovou — "Ninguém aprovou a
tempo: a vaga começou às 18h." · você — "Você escolheu não postar." · desligado — "Os stories das vagas foram desligados." · sem valor —
"A vaga não tem valor informado." · IA — "A IA não conseguiu criar a arte: a chave da OpenAI está sem crédito." (sempre o motivo em
português) · Instagram — "O Instagram recusou a publicação: {motivo}."

Ações:
- **Aprovar** tem o mesmo nome aqui e na aba Aprovações. **Postar agora** é outra coisa: fura horário ou limite, só em "esperando".
- **Não postar:** sem diálogo; toast "O story da vaga Garçom não vai ao ar. [Desfazer]" por 6 s, depois chips opcionais "Texto errado ·
  Foto estranha · Não quero divulgar esta vaga". Volta pelo "Criar story mesmo assim" enquanto a vaga estiver aberta.
- **Postar agora fora do horário:** "Postar agora, fora do horário?" · "São 22h10, fora do horário que você definiu (8h às 21h). O story
  vai ao ar em até 5 minutos e conta no máximo de hoje." · "Postar agora" / "Esperar as 8h".
- **Postar agora acima do limite:** "Hoje já foram 10 stories de vagas (o seu máximo). Este vai ser o 11º e conta no limite de 25 do
  Instagram." · "Postar agora" / "Deixar para amanhã".
- **Criar story numa vaga de teste:** "Essa vaga parece de teste ({nome}). Criar o story mesmo assim?" · "Criar story" / "Cancelar".
- **Reserva no detalhe:** "Versão de reserva: a IA errou o valor nas 3 tentativas, então o sistema escreveu os textos por cima de uma
  foto. Os textos estão certos; o visual é mais simples." · "Aprovar" · "Tentar de novo com a IA" · "Ver as 3 tentativas" (com o campo
  errado marcado).
- **Aviso semanal** (≥ 30% na reserva): "Nos últimos 7 dias, 5 de 12 stories foram para a reserva. Uma arte modelo com menos texto
  costuma ajudar a IA."

## 5. Outras telas tocadas

- **Aba Aprovações (`approvals.tsx`):** story de vaga mostra o `theme` ("Vaga · Garçom · Coco Bambu · Sáb 29/10"), a linha "✓ Conferido:
  …" e abre o detalhe da vaga; "Rejeitar" vira "Não postar" sem motivo obrigatório (hoje é `window.prompt` obrigatório).
- **Editor de post (`post-editor.tsx`):** para `source = 'vacancy'` esconder "Regenerar mídia", "Ajustar", legenda e hashtags; "Refazer
  a arte" usa o fluxo da vaga. "Enviar minha própria" pode ficar, com o aviso "A sua arte não passa pela conferência."
- **Calendário:** ~300 stories de vaga por mês — filtro por origem (designer decide o padrão).

## 6. Acessibilidade (WCAG 2.2 AA)

Alvos de toque ≥ 44 px · situação sempre com ícone + texto · interruptor com rótulo visível · prévia com `alt` ("Story: Garçom, R$ 150,
Sáb 29/10, 18h às 23h, Campinas") · `aria-live="polite"` em "Criando a arte…", toasts e avisos · horários `type="time"` · contador com
`aria-label` "Diminuir"/"Aumentar" · diálogos Radix (foco preso, Esc fecha), nada de diálogo dentro de diálogo · progresso respeita
`prefers-reduced-motion`.
