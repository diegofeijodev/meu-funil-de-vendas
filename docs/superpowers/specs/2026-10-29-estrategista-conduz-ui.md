# Meu Funil — UX do "Estrategista que conduz" (29/10/2026)

Companheiro de `2026-10-29-estrategista-conduz-design.md` (decisões consolidadas e pedidos ao arquiteto resolvidos lá, §0.4).
Escrito pelo agente ux-designer em 29/10/2026 sobre o `master` `5494fff`, só leitura.


## Resumo

- **Para quem:** Diego, dono da Freela, sem equipe de marketing, no celular, fala por áudio.
- **O que muda:** `/campaigns/new` passa a abrir em "Conte o que você quer" (o formulário de 5 passos continua como "Preencher formulário"
  e como "Ver/ajustar detalhes", fechado e já preenchido). No detalhe da campanha entra um painel **Estrategista** no topo, que passa por 3 estados:
  **Pacote** (aprovar uma vez) → **Andamento** (linha do tempo + "Precisa de você") → **Pronto para ligar** (conferência antes de gastar).
- **Meta em toques:** do "Nova campanha" ao "Aprovar e começar" são **7 toques + 1 texto**, em até **5 min** (1 min falando, 30 s respondendo,
  até 1 min para montar o plano e 2 min conferindo). No dia seguinte, ligar o anúncio leva **2 toques** ("Conferir e ligar" → "Ligar anúncio").
  Hoje o caminho manual tem 5 telas de formulário (até 20 campos) e mais 7 passos do guia.
  O trabalho tem várias etapas por natureza, então o critério não é "≤ 3 toques no total". O critério é: **1 toque por decisão que gasta** e
  **nenhuma etapa exige entender o modelo de dados**.
- **Correção ao briefing:** "Jundiaí e até **15 km**" não existe na Meta. O raio em volta de cidade vai de **17 a 80 km** (doc de targeting da Meta).
  As opções ficam: só a cidade · +20 · +40 · +80 km · outra distância (17–80).

## Job e contexto

"Quando eu quero divulgar o Freela numa cidade e não tenho ninguém de marketing, quero contar em poucas frases o que quero (de preferência
falando), para receber tudo pronto (posts, vídeo e o anúncio montado) e só conferir e ligar."

| Campo | Diego (hipóteses marcadas com H) |
|---|---|
| Dispositivo | celular (H: Android com Chrome; não sabemos o modelo); às vezes desktop |
| Ambiente | entre uma tarefa e outra, pouco tempo, manda áudio no WhatsApp; volta no dia seguinte para ver |
| Vocabulário dele | "estratégia", "criativo", "vídeo", "stories", "reels", "tráfego pago", "foco", "persona", "região", "prazo" |
| Papel | owner, então aprova e liga. Rebeca (comercial) pode ter `write` (H): começa e pede aprovação |
| Tarefa crítica | não gastar dinheiro errado (região, verba, oferta que o Freela não cumpre) |

## Fluxo

```
Nova campanha ─► Conte o que você quer ─► [Mandar] ─► "Entendi…" + até 3 perguntas + região ─► [Criar e montar o plano]
   (1)               (texto/ditado)          (2)         (3)(4)(5) chips · raio já vem marcado (0)        (6)
        │
        └─ "Preencher formulário" (caminho antigo, intacto)

Detalhe da campanha ─► Montando o plano (≤ 1 min) ─► PACOTE ─► [Aprovar e começar] (7) ─► ANDAMENTO (polling)
                                                           │                                │
                                                           └─ Ajustar (drawer por bloco)     ├─ Precisa de você → botão da ação → segue
                                                                                             └─ PRONTO PARA LIGAR ─► [Conferir e ligar] (8)
                                                                                                  ─► Conferência ─► [Ligar anúncio: R$ 30 por dia] (9)
```
Desvios: pedido sem verba/destino/condição da oferta (vira pergunta) · cidade não achada · sem Meta (o anúncio espera, o resto anda) ·
sem Instagram (posts ficam prontos esperando) · teto de créditos · nenhuma arte passou · recusado em Approvals · falha da IA · aba fechada (o servidor segue).

---

## Telas

Convenções: 360 px, 1 coluna, `[ Botão ]` = botão (h-11 = 44 px), `( chip )` = chip de escolha única (ToggleGroup, ≥ 44 px de altura),
`═══` = CTA fixo embaixo (`sticky bottom-0`, mesmo padrão do `settings-panel.tsx`, com `padding-bottom: env(safe-area-inset-bottom)`).
Ícones de estado: ✓ pronto · ◐ fazendo · ! precisa de você · ✕ falhou · ○ na fila · – pulado. **Sempre com texto ao lado.**

### A. `/campaigns/new` — Conte o que você quer

**A1. Padrão (vazio)**
```
┌──────────────────────────────────┐
│ ←  Nova campanha                 │
├──────────────────────────────────┤
│ Marca: Freela          [Trocar]  │  ← só se houver > 1 marca
│                                  │
│ Conte o que você quer            │  ← <label for>
│ O que quer, para quem, onde, por │  ← aria-describedby
│ quanto tempo e a oferta.         │
│ ┌──────────────────────────────┐ │
│ │Quero uma campanha para       │ │  ← placeholder = frase do Diego
│ │cadastros de bares e          │ │
│ │restaurantes de Jundiaí por   │ │
│ │30 dias oferecendo a primeira │ │
│ │contratação gratuita.         │ │
│ │                              │ │  ← 6 linhas, cresce até 12
│ └──────────────────────────────┘ │
│ [ Falar ]  Prefere áudio? Toque  │  ← "Falar" só se o navegador suporta
│ no microfone do teclado ou cole  │
│ a transcrição de um áudio do     │
│ WhatsApp.                        │
│                                  │
│ Prefere ir campo a campo?        │
│ Preencher formulário ›           │
│ ▸ Como funciona (HowTo fechado)  │
╞══════════════════════════════════╡
│ [  Mandar para o estrategista  ] │
└──────────────────────────────────┘
```

| Estado | O que muda |
|---|---|
| Falando (`Falar` ativo) | o botão vira `[ Parar ]` (`aria-pressed=true`), a linha "Ouvindo… fale à vontade" fica num `role=status` e o texto entra na caixa ao vivo |
| Microfone negado | "O navegador não deixou usar o microfone. Libere nas configurações ou use o microfone do teclado." (o texto já digitado fica) |
| Vazio e toca em Mandar | erro no campo: "Conte em uma ou duas frases o que você quer." O foco vai para a caixa |
| > 3.500 letras | contador "3.612 de 4.000 letras"; acima de 4.000: "Ficou longo demais (4.212 de 4.000 letras). Corte um pouco." |
| Carregando | CTA "Lendo o seu pedido…" (desabilitado, sem toque duplo); um skeleton no formato do cartão "Entendi" aparece embaixo da caixa |
| Erro da IA | faixa abaixo da caixa: "Não conseguimos ler o pedido agora. Seu texto continua aqui." `[ Tentar de novo ]` · "Preencher formulário ›". Sem chave/créditos: "A IA desta empresa não está configurada." `[ Abrir integrações ]` |
| Fora da lista do piloto | a tela abre direto no formulário de hoje (a entrada conversacional some e não aparece erro) |

**Áudio, resposta direta:** na v1 vale **colar a transcrição** do WhatsApp (no app: segurar o áudio → Transcrever, quando o celular oferecer) e também
o **microfone do teclado**, que funciona em qualquer caixa de texto, sem código e no iPhone e no Android. O botão "Falar" (Web Speech API) entra como extra,
**só quando o navegador tem suporte** (Chrome Android/desktop). No iPhone ele fica escondido, não aparece desabilitado. Nada de prometer upload de áudio na v1.

**A2. "Entendi" + o que falta** (a mesma tela, abaixo da caixa; o foco vai para o título "Entendi")
```
├──────────────────────────────────┤
│ Entendi                          │  ← h2, tabIndex=-1 (recebe foco)
│ Uma campanha para trazer         │
│ cadastros de bares e restaurantes│
│ de Jundiaí, de 29/10 a 27/11     │  ← data absoluta (servidor)
│ (30 dias), oferecendo a primeira │
│ contratação grátis.              │
│                                  │
│ Considerei que                   │
│ • Para quem: donos e gerentes de │
│   bares e restaurantes  [Mudar]  │
│ • Começa hoje, 29/10    [Mudar]  │
│                                  │
│ Faltam 3 respostas               │
│ 1. Quanto gastar por dia no      │  ← fieldset + legend
│    anúncio?                      │
│ (R$ 20) (R$ 30) (R$ 50) (Outro)  │  ← nenhum chip vem marcado
│ R$ 30 por dia × 30 dias =        │  ← aparece ao escolher
│ até cerca de R$ 900 no período   │
│                                  │
│ 2. Para onde vai quem se         │
│    interessar?                   │
│ ( Formulário no Instagram e      │
│   Facebook: a pessoa deixa nome  │
│   e WhatsApp sem sair do app e   │
│   cai no seu CRM )               │
│ ( Página de cadastro: cole o     │
│   link )                         │
│ [ https://           ]           │  ← só na opção escolhida
│                                  │
│ 3. O que é grátis na primeira    │
│    contratação?                  │
│ (A taxa do Freela) (A diária do  │
│  freelancer) (As duas) (Escrever)│
│ Vale até  [ 27/11/2026 ]         │
│ Só para empresa nova? (Sim)(Não) │
│                                  │
│ Região                           │
│ Jundiaí – SP          [Trocar]   │
│ (Só Jundiaí) (+20 km) (+40 km)   │  ← +20 vem marcado (= hoje)
│ (+80 km) (Outra distância)       │
│ Jundiaí e cidades em volta, até  │
│ 20 km do centro.                 │
│ + Adicionar outra cidade         │
│                                  │
│ ▸ Ver/ajustar todos os detalhes  │  ← formulário atual, fechado e preenchido
╞══════════════════════════════════╡
│ [  Criar e montar o plano      ] │
└──────────────────────────────────┘
```
- Até **3 perguntas**, nesta ordem: verba → destino → condições da oferta. A região é sempre mostrada porque decide quem vê o anúncio. O resto vai para "Considerei que" com `[Mudar]`.
- **Verba nunca vem marcada** (regra 4 da arquitetura). O raio vem marcado porque não muda quanto se gasta e repete o comportamento de hoje (20 km).
- "Ver/ajustar todos os detalhes" abre as 5 seções do formulário atual como sanfona, cada uma com o resumo de 1 linha. Os campos Ticket médio, Margem e CAC
  ficam em "Metas (opcional)", fechado.
- Se Diego responde escrevendo na caixa de cima de novo, `Mandar` refaz o "Entendi" com `previous_draft` + `answers`.

| Estado | O que muda |
|---|---|
| Faltou responder e toca em Criar | o CTA não fica desabilitado sem motivo: o foco vai para a 1ª pergunta sem resposta, com o erro "Escolha quanto gastar por dia." |
| Cidade não achada | "Não achamos "Jundiai" nas cidades da Meta. Você quis dizer:" `( Jundiaí – SP )` `( Outra cidade )` |
| Sem Meta conectada | o campo vira texto livre: "Escreva cidade e estado, como no endereço. Vamos conferir na Meta quando ela estiver conectada." |
| Outra distância | drawer com stepper − 25 km + (de 1 em 1, de 17 a 80) e a frase "A Meta aceita de 17 a 80 km em volta de uma cidade." |
| Nunca | cair em "Brasil inteiro". Se a cidade não for resolvida, o anúncio **não é montado** (ver o bloqueio GEO_UNRESOLVED) |
| Criando | CTA "Criando a campanha…"; ao terminar, vai para o detalhe já em "Montando o plano" |

### B. Detalhe da campanha — painel Estrategista, estado **Pacote**

Ordem da página com piloto: cabeçalho compacto (nome + selo) → **painel Estrategista** → "Detalhes" (as abas de hoje) → números (StatCards)
**só quando a campanha já estiver na Meta**. "Encerrar campanha" vai para o menu `⋯` do cabeçalho, longe do CTA.

**B0. Montando o plano** (estratégia gerada pelo caminho atual, até 1 min)
```
│ O plano do estrategista          │
│ Montando o plano. Leva até 1     │  ← role=status
│ minuto. Fique nesta tela.        │
│ ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒ (skeleton)       │
```
Erro: "Não conseguimos montar o plano agora. Seu pedido está salvo nesta campanha." `[ Tentar de novo ]`.
(A frase "Fique nesta tela" só pode virar "Pode fechar" se o servidor guardar que a geração está em andamento. Ver o pedido ao arquiteto 3.)

**B1. Pacote pronto para aprovar**
```
┌──────────────────────────────────┐
│ ←  Cadastros Jundiaí · 1ª grátis │
│    ○ Rascunho               ⋯    │
├──────────────────────────────────┤
│ O plano do estrategista          │
│ Confira e aprove uma vez só.     │
│                                  │
│ A ideia                          │
│ "Seu primeiro freela sem taxa."  │
│ Falar com quem fica sem garçom   │
│ no fim de semana.                │
│ 3 jeitos de falar: Falta de      │
│ gente · Rapidez · Sem custo      │
│ Ver o plano completo ›           │  ← aba Estratégia
│ ──────────────────────────────── │
│ No Instagram (sem custo de Meta) │
│ 3 stories, 2 reels e 1 post por  │
│ semana · seg, qua e sex · 11h e  │
│ 18h · de 29/10 a 27/11.          │
│ Você aprova cada post antes.     │
│                       [Ajustar]  │
│ ──────────────────────────────── │
│ Anúncio pago na Meta             │
│ 6 artes + 1 vídeo vertical.      │
│ Fica montado e DESLIGADO: não    │
│ gasta nada até você ligar.       │
│ Para quem  Donos e gerentes de   │
│            bares e restaurantes  │
│ Onde       Jundiaí – SP e até    │
│            20 km em volta        │
│ Quando     29/10 a 27/11 (30 d)  │
│ Quanto     R$ 30/dia × 30 dias = │
│            até cerca de R$ 900,  │
│            cobrados pela Meta    │
│ Quem clicar  Formulário → CRM    │
│                       [Ajustar]  │
│ ──────────────────────────────── │
│ Custo de criação no Meu Funil    │  ← bloco separado: créditos ≠ R$
│ Até 48 créditos   Ver a conta ▾  │
│ ──────────────────────────────── │
│ Estilo das artes (opcional)      │  ← tela E
│ [ Enviar imagem ou vídeo ]       │
│ ──────────────────────────────── │
│ ! Antes de começar               │  ← só se houver aviso
│ A Meta não está conectada. Dá    │
│ para começar: textos, artes e    │
│ Instagram andam; o anúncio espera│
│ você conectar.                   │
│ [ Conectar a Meta ]              │
╞══════════════════════════════════╡
│ [     Aprovar e começar        ] │
│ Nada é gasto na Meta até você    │
│ ligar o anúncio.                 │
└──────────────────────────────────┘
```

**"Ver a conta" dos créditos** (aberto; números do exemplo padrão da arquitetura; a conta real vem do `pilot/estimate`)
```
│ Artes:   3 jeitos × 2 artes × 3  │
│          versões × 1,5 = 27      │
│ Refações: até 6 × 1,5    =  9    │
│ Vídeo:   1 × 2 tentativas × 6=12 │
│ Teto desta campanha      = 48    │
│ De onde vem: tabela de custo do  │
│ Meu Funil (imagem 1,5 · vídeo 6).│
│ Textos, plano e leitura das      │
│ referências não gastam créditos. │
│ Posts do Instagram: estimativa   │
│ separada, fora deste teto:       │
│ 4 semanas × (3 × 1,5 + 2 × 6 +   │
│ 1 × 1,5) = 72 créditos.          │  ← fórmula ilustrativa, a do servidor manda
│ Com chave de IA própria, quem    │
│ cobra é a OpenAI/Google na sua   │
│ conta, não o Meu Funil.          │
```

**Ajustar** abre um `Drawer` (folha de baixo) por bloco, com CTA "Salvar". Ao salvar, o pacote é recalculado ("Recalculando…" no bloco de custo).
- Instagram: dias (chips seg–dom), horários (chips + "Outro"), quantos por semana de cada formato (stepper), e o modo:
  `( Eu aprovo cada post antes, recomendado na 1ª campanha )` `( Posta sozinho depois da revisão automática )`.
- Anúncio: verba por dia, destino, região, "jeitos de falar" (1–5), artes por jeito (1–3), vídeos (0–2),
  `( Eu escolho as artes antes de montar na Meta )` `( O estrategista escolhe as que passarem na revisão )` (G2 × G1), e o teto de créditos (stepper).
- Não abre drawer dentro de drawer. "Outra distância" do raio, aqui, é um campo dentro do próprio drawer.

| Estado / papel | O que muda |
|---|---|
| owner/admin | CTA **"Aprovar e começar"** (1 toque, `approve_now`) |
| marketing (`write`) | CTA **"Começar e pedir aprovação do anúncio"**, com a linha "Textos, artes e Instagram começam agora. O anúncio espera o dono ou um admin aprovar em Approvals." |
| viewer | sem CTA; a linha "Só quem edita a campanha pode começar." |
| Falta algo que trava (`can_approve=false`) | CTA "Falta 1 coisa para começar": o toque leva o foco ao bloco com o campo dentro (ex.: "Falta dizer quanto gastar por dia") |
| Já tem um piloto ativo (409) | "O estrategista já está trabalhando nesta campanha." `[ Ver andamento ]` |
| Enviando | CTA "Começando…"; depois o foco vai para o título "Andamento" |

### C. Painel Estrategista — **Andamento**

**C1. Com algo precisando dele** (é o que o Diego vê ao voltar no dia seguinte)
```
┌──────────────────────────────────┐
│ ←  Cadastros Jundiaí · 1ª grátis │
│    ! Precisa de você        ⋯    │
├──────────────────────────────────┤
│ Precisa de você (1)              │  ← região aria-live=polite
│ ┌──────────────────────────────┐ │
│ │ ! Conecte a Meta para montar │ │
│ │ o anúncio. Textos, artes e   │ │
│ │ Instagram continuam.         │ │
│ │ Conferimos de novo sozinhos  │ │
│ │ a cada 30 minutos.           │ │
│ │ [ Conectar a Meta ]          │ │
│ │ Já conectei: conferir agora  │ │
│ └──────────────────────────────┘ │
│                                  │
│ Andamento     atualizado às 9h12 │  ← h2 (recebe foco após aprovar)
│ ✓ Plano aprovado · 28/10, 18h40  │
│ ✓ Textos do anúncio · prontos    │
│   Ver textos ›                   │
│ ✓ Instagram programado           │
│   12 posts até 27/11. 2 esperam  │
│   sua aprovação. Ver posts ›     │
│ ✓ Artes e vídeo · 7 de 7 prontas │
│   [▢][▢][▢][▢][▢][▢][▶]          │
│ ! Anúncio na Meta · esperando    │
│   você (conectar a Meta)         │
│ ○ Pronto para ligar              │
│                                  │
│ Créditos: 39 de até 48 usados    │
│ (soma do custo das 7 artes e do  │
│ vídeo já feitos)                 │
│                                  │
│ Parar o estrategista             │  ← link discreto, no fim
╞══════════════════════════════════╡
│ [      Conectar a Meta         ] │  ← CTA = ação do 1º bloqueio
└──────────────────────────────────┘
```

**C2. Trabalhando** (sem bloqueio): não há "Precisa de você" nem CTA fixo. A linha das artes mostra:
`◐ Artes e vídeo · 4 de 7 prontas` + "Fazemos uma peça a cada 5 minutos: as 7 levam uns 35 minutos, mais alguns para o vídeo. Pode fechar a tela."
(a conta vem do job de 5 min com 1 peça por rodada, como a arquitetura define).

**C3. Concluído** → vira o estado D (Pronto para ligar). **C4. Falhou**: o selo "✕ Parou com erro" e o bloco "Precisa de você" com a falha e `[ Tentar de novo ]`.
**C5. Parado** (cancelado ou campanha encerrada): "Estrategista parado em 30/10. O que ficou pronto continua na campanha."

Estados de cada etapa (`steps.*.status`) → texto:

| Status | Ícone + texto | Observação |
|---|---|---|
| pending | ○ Na fila | |
| running | ◐ Fazendo agora | sem animação com `prefers-reduced-motion` |
| waiting | ◐ Gerando o vídeo, leva alguns minutos | etapa assíncrona |
| done | ✓ Pronto / Prontas | com a contagem e o link para a aba |
| skipped | – Pulado: {motivo} | ex.: "Já enviado à mão", "Recusado em Approvals" |
| blocked | ! Esperando você | o motivo aparece em "Precisa de você" |
| failed | ✕ Não deu certo | o motivo e "Tentar de novo" ficam no bloco |

Bloqueios (código → frase → o que fazer → botão). **Nem todo bloqueio tem "Continuar"**:

| Código | Frase (o que aconteceu + o que fazer) | Botão |
|---|---|---|
| `META_NOT_CONNECTED` | "Conecte a Meta para montar o anúncio. Textos, artes e Instagram continuam. Conferimos de novo sozinhos a cada 30 minutos." | `[ Conectar a Meta ]` + link "Já conectei: conferir agora" |
| `WAITING_APPROVAL` (owner/admin) | "O anúncio está esperando a sua aprovação." | `[ Abrir aprovação ]` (sem Continuar) |
| `WAITING_APPROVAL` (write) | "O anúncio está esperando o dono ou um admin aprovar. Avise quem aprova." | nenhum |
| `LANDING_MISSING` | "Falta dizer para onde vai quem clicar no anúncio." + campo de URL | `[ Salvar e continuar ]` |
| `BUDGET_MISSING` | "Falta dizer quanto gastar por dia no anúncio." + chips | `[ Salvar e continuar ]` |
| `GEO_UNRESOLVED` | "Não achamos "{cidade}" nas cidades da Meta, então o anúncio não foi montado. Nunca anunciamos para o Brasil inteiro por engano." + busca | `[ Usar esta cidade ]` |
| `COST_CAP` | "Chegamos ao teto de 48 créditos com 5 de 7 artes prontas." | `[ Aumentar o teto para 60 ]` · `[ Seguir com as 5 artes ]` |
| `NO_CREATIVE_PASSED` | "Nenhuma arte passou na revisão automática (nota mínima 28 de 50)." | `[ Fazer mais uma rodada (até 9 créditos) ]` · "Ver as artes e escolher à mão ›" |
| `WAITING_CREATIVE_REVIEW` (G2) | "As artes estão prontas. Escolha quais vão para o anúncio." (tom de ação, não de erro) | `[ Escolher artes ]` |
| `NO_IG_PLAN` | "O plano veio sem os temas do Instagram, então os posts não foram programados. O anúncio segue normal." | `[ Refazer a parte do Instagram ]` |
| `AI_NOT_CONFIGURED` / sem créditos | "A IA desta empresa não está configurada (ou está sem créditos), então as artes pararam." | `[ Abrir integrações ]` + "Já resolvi: continuar" |
| `failed` (depois de 3 tentativas) | "Não conseguimos {fazer as artes} depois de 3 tentativas ({motivo curto}). Nada do que ficou pronto se perdeu." | `[ Tentar de novo ]` |
| Sem Instagram conectado | etapa ✓ com aviso: "Posts prontos, esperando você conectar o Instagram para sair." | `[ Conectar Instagram ]` (não bloqueia) |

**"Parar o estrategista"** (AlertDialog, risco médio):
"Parar o estrategista? O que já ficou pronto continua na campanha. O anúncio, se já estiver montado, continua desligado."
☐ "Cancelar também os 12 posts programados do Instagram" · `[ Parar o estrategista ]` · `[ Continuar trabalhando ]`.

**Lista de campanhas:** em cada cartão, uma linha do estrategista (ícone + texto): "◐ Fazendo artes (4 de 7)" · "! Precisa de você: conectar a Meta" ·
"✓ Pronto para ligar". Assim o Diego vê de manhã, sem abrir campanha por campanha, o que precisa dele (pedido ao arquiteto 2).

### D. **Pronto para ligar** — conferência antes do "Ativar na Meta"

No painel: "✓ Tudo pronto. O anúncio está montado na Meta e desligado." + CTA fixo **"Conferir e ligar o anúncio"**, que abre a tela de conferência
(página cheia no celular, `Dialog` no desktop). O botão "Ativar na Meta" de hoje, no cabeçalho, passa a abrir esta mesma tela.
```
┌──────────────────────────────────┐
│ ←  Conferir antes de ligar       │
├──────────────────────────────────┤
│ O anúncio está montado e         │
│ desligado. Confira o que vai     │
│ rodar.                           │
│                                  │
│ Quanto                           │
│ R$ 30 por dia                    │  ← 24 px
│ 29/10 a 27/11 (30 dias)          │
│ R$ 30 × 30 dias = cerca de       │
│ R$ 900 no período                │
│                                  │
│ Onde                             │
│ Jundiaí – SP e até 20 km em volta│
│ No Instagram e no Facebook       │
│                                  │
│ Para quem                        │
│ Donos e gerentes de bares e      │
│ restaurantes, 25 a 55 anos       │
│                                  │
│ Quem clicar vai para             │
│ Formulário no Instagram/Facebook;│
│ o contato cai no seu CRM.        │
│                                  │
│ O que o anúncio promete          │
│ "Primeira contratação grátis:    │
│ sem a taxa do Freela, para       │
│ empresa nova, até 27/11."        │
│ ☐ Confirmo que o Freela cumpre   │  ← só se a oferta tiver promessa
│   essa oferta.                   │
│                                  │
│ Artes (6) e vídeo (1)            │
│ [▢][▢][▢][▢][▢][▶]               │  ← tocar amplia
│                                  │
│ Bom saber                        │
│ A Meta cobra na forma de         │
│ pagamento da conta de anúncios.  │
│ Num dia ela pode gastar até 75%  │
│ a mais (até R$ 52,50), mas numa  │
│ semana não passa de 7 × R$ 30 =  │
│ R$ 210. Não dá para garantir     │
│ quantos cadastros vão chegar.    │
│ Você pode pausar quando quiser.  │
╞══════════════════════════════════╡
│ [ Ligar anúncio: R$ 30 por dia ] │
│          Agora não               │
└──────────────────────────────────┘
```
- **"até 27/11" só pode ser escrito se o conjunto de anúncios for criado na Meta com data de fim.** Se não for, a linha precisa dizer
  "Roda até você pausar ou encerrar". Isso é severidade 4 até confirmar (pedido ao arquiteto 1).
- Fonte do "75% / 7×": regra de orçamento diário da Meta ("na semana não gastamos mais que 7 vezes o orçamento diário").
- Papel sem `manage`: no lugar do CTA, "Só o dono ou um admin liga o anúncio. Avise quem aprova."
- Ligando: "Ligando na Meta…". Sucesso (toast + o selo vira "● No ar"): "Anúncio ligado. A Meta pode levar algumas horas para começar a mostrar.
  Os resultados aparecem aqui a cada 3 horas." Erro: "A Meta não aceitou ligar o anúncio: {motivo}. Nada foi gasto." `[ Tentar de novo ]`.
- A conferência substitui o "Tem certeza?" porque é ela mesma a confirmação de alto risco, com o valor no verbo do botão.

### E. Estilo das artes (referências)

Fica no Pacote (B1) e também na aba Briefing (com a campanha já andando: "Vale para as artes que ainda vão ser feitas.").
```
│ Estilo das artes (opcional)      │
│ Mostre fotos ou vídeos com o     │
│ clima que você quer. O           │
│ estrategista descreve o estilo em│
│ palavras e cria artes novas: não │
│ copia a imagem, as pessoas, as   │
│ marcas nem os textos, e a        │
│ referência nunca é publicada.    │
│                                  │
│ Link do Pinterest                │  ← só com STYLE_REFS_PINTEREST_ENABLED
│ [ https://pin.it/…      ] [Usar] │
│ [ Enviar imagem ou vídeo ]       │
│                                  │
│ ┌────┐ Lendo o estilo…           │  ← processing (role=status)
│ │    │                 [Remover] │
│ └────┘                           │
│ ┌────┐ Pinterest                 │  ← ready
│ │img │ O que eu peguei: cores    │
│ └────┘ quentes, luz de fim de    │
│        tarde, comida bem de      │
│        perto.          [Remover] │
│ 2 de 8 referências               │
```

| Estado | Texto |
|---|---|
| Pinterest desligado (flag off, padrão) | sem campo de link; a dica fica "Achou no Pinterest? Salve a imagem no celular e envie aqui." |
| Link que não é Pin | "Esse link não é de um Pin. No Pinterest, toque em Compartilhar → Copiar link (começa com pin.it ou pinterest.com/pin)." |
| Pin não carregou | "Não conseguimos pegar a imagem desse Pin. Salve a imagem no celular e envie aqui." `[ Enviar imagem ]` |
| Pin de vídeo | "Desse Pin de vídeo só deu para pegar a capa. Para usar o movimento, envie o arquivo do vídeo." |
| Mesmo Pin de novo | "Esse Pin já está nas referências." |
| Arquivo grande | "O vídeo passa de 50 MB. Envie um trecho mais curto." / "A imagem passa de 15 MB." |
| Limite | "Chegou a 8 referências nesta campanha. Remova uma para pôr outra." (marca: 30) |
| Leitura falhou | "Não conseguimos ler o estilo desta referência. Remova e tente outra." |
| Remover | remove na hora, com o toast "Referência removida." (não precisa confirmar: é baixo risco e dá para adicionar de novo) |

---

## Textos do guia (`lib/guides.ts`)

Proposta: uma chave nova **`campaignPilot`** (mostrada no detalhe quando há piloto e no `/new`), e a `campaign` vira o guia manual. O passo 5
de hoje está **errado**: diz que a campanha "é publicada pausada" ao aprovar, mas publicar é um botão separado.

```ts
campaignPilot: {
  title: "Como o estrategista monta a campanha",
  steps: [
    "Em Nova campanha, conte o que você quer: o quê, para quem, onde, por quanto tempo e a oferta. Pode usar o microfone do teclado ou colar a transcrição de um áudio do WhatsApp.",
    "Responda só o que o estrategista perguntar (quanto gastar por dia, para onde vai quem se interessar, as condições da oferta), confira a região e toque em Criar e montar o plano.",
    "Confira o plano: o que sai no Instagram, como fica o anúncio e quanto custa, com a conta. Toque em Aprovar e começar.",
    "O estrategista escreve os textos, programa o Instagram, cria as artes e o vídeo e monta o anúncio na Meta desligado. Se precisar de você, aparece em Precisa de você com o botão para resolver.",
    "Quando aparecer Pronto para ligar, confira verba, região, público, oferta e artes e toque em Ligar anúncio. O estrategista nunca liga o anúncio sozinho.",
    "Os resultados chegam a cada 3 horas e a IA sugere ajustes em AI Insights.",
  ],
},
campaign: {
  title: "Fazer à mão, aba por aba",
  steps: [
    "Estratégia: gere com IA, revise e toque em Aprovar estratégia.",
    "Copies: gere variações; elas seguem a ideia principal e os jeitos de falar aprovados.",
    "Criativos: no Creative Studio escolha a campanha e o jeito de falar; aprove os melhores (só os aprovados vão para a Meta).",
    "Anúncios e regras: escolha a estrutura, o botão do anúncio, onde aparece, os públicos e as regras automáticas.",
    "Toque em Solicitar aprovação; o dono ou um admin aprova em Approvals. Depois toque em Publicar na Meta: o anúncio é montado desligado.",
    "Toque em Ativar na Meta, confira e ligue. Os resultados chegam a cada 3 horas.",
    "Opcional: com Google Ads ou TikTok Ads conectados, crie a mesma campanha desligada nesses canais em Anúncios e regras.",
  ],
  references: [{ label: "Central de ajuda da Meta para anunciantes", url: "https://www.facebook.com/business/help" }],
},
campaignNew: {
  title: "Como criar uma campanha",
  steps: [
    "Conte o que você quer em poucas frases. O estrategista entende e pergunta só o que faltar.",
    "Prefere ir campo a campo? Toque em Preencher formulário: marca, nome, objetivo, oferta, público, verba e formatos.",
    "Nos dois jeitos, você confere tudo antes de qualquer coisa ir para o Instagram ou para a Meta.",
  ],
},
```
(O `Record<…>` do tipo `GUIDES` ganha `"campaignPilot"`. Os rótulos "Approvals" e "AI Insights" seguem o menu de hoje: ver o problema 1.)

## Microcopy (elemento → texto)

| Elemento | Texto |
|---|---|
| Título `/new` | Nova campanha |
| Label da caixa | Conte o que você quer |
| Ajuda da caixa | O que quer, para quem, onde, por quanto tempo e a oferta. |
| Placeholder | Quero uma campanha para cadastros de bares e restaurantes de Jundiaí por 30 dias oferecendo a primeira contratação gratuita. |
| Dica de áudio | Prefere áudio? Toque no microfone do teclado ou cole a transcrição de um áudio do WhatsApp. |
| Botão falar / parar | Falar / Parar · status "Ouvindo… fale à vontade" |
| CTA intake | Mandar para o estrategista · carregando "Lendo o seu pedido…" |
| Atalho manual | Preencher formulário |
| Resumo | Entendi · Considerei que · Faltam {n} respostas |
| Pergunta verba | Quanto gastar por dia no anúncio? · conta "R$ {d} por dia × {n} dias = até cerca de R$ {t} no período" |
| Pergunta destino | Para onde vai quem se interessar? · "Formulário no Instagram e Facebook: a pessoa deixa nome e WhatsApp sem sair do app e cai no seu CRM" · "Página de cadastro: cole o link" |
| Link de privacidade (se for formulário) | A Meta pede o link da política de privacidade da empresa. Ex.: https://seusite.com.br/privacidade |
| Pergunta oferta | O que é grátis na primeira contratação? · Vale até · Só para empresa nova? |
| Região | Região · Só {cidade} · +20 km · +40 km · +80 km · Outra distância · "{cidade} e cidades em volta, até {r} km do centro." · "A Meta aceita de 17 a 80 km em volta de uma cidade." |
| CTA criar | Criar e montar o plano · "Criando a campanha…" |
| Painel | O plano do estrategista · Confira e aprove uma vez só. |
| Blocos | A ideia · No Instagram (sem custo de Meta) · Anúncio pago na Meta · Custo de criação no Meu Funil · Estilo das artes (opcional) · Antes de começar |
| Garantia | Fica montado e DESLIGADO: não gasta nada até você ligar. |
| CTA pacote | Aprovar e começar · (write) Começar e pedir aprovação do anúncio · "Nada é gasto na Meta até você ligar o anúncio." |
| Andamento | Andamento · atualizado às {hh}h{mm} · Precisa de você ({n}) |
| Etapas | Plano aprovado · Textos do anúncio · Instagram programado · Artes e vídeo · Anúncio na Meta · Pronto para ligar |
| Selo da campanha | Rascunho · Fazendo · Precisa de você · Pronto para ligar · No ar · Parou com erro · Estrategista parado |
| Créditos | Créditos: {u} de até {t} usados (soma do custo das artes e vídeos já feitos) |
| Pronto | Tudo pronto. O anúncio está montado na Meta e desligado. · CTA "Conferir e ligar o anúncio" |
| Conferência | Conferir antes de ligar · Quanto · Onde · Para quem · Quem clicar vai para · O que o anúncio promete · Artes e vídeo · Bom saber |
| CTA ligar | Ligar anúncio: R$ {d} por dia · Agora não |
| Sem Meta | Conecte a Meta para montar o anúncio. Textos, artes e Instagram continuam. |
| Sem Instagram | Posts prontos, esperando você conectar o Instagram para sair. |
| Teto | Chegamos ao teto de {t} créditos com {k} de {m} artes prontas. |
| Erro genérico de rede | Não conseguimos salvar. Verifique a conexão e toque em Tentar de novo. Seus dados continuam aqui. |
| Termos com explicação (se aparecerem) | "custo por interessado (CPL)" · "pessoas parecidas com seus clientes (lookalike)" · "público" em vez de "persona/ICP" |

Vocabulário usado no painel (proposta para o projeto): copy → **textos do anúncio** · criativo → **arte / vídeo** · estratégia → **plano** ·
ângulo → **jeito de falar** · big idea → **a ideia** · landing/destino → **para onde vai quem clicar** · verba diária → **quanto gastar por dia** ·
publicar pausada → **montar desligado** · ativar → **ligar o anúncio** · lead → **interessado / contato** · piloto/run → **estrategista / andamento** ·
retomar → **continuar**. "Stories", "reels" e "tráfego pago" ficam como estão, porque o Diego usa essas palavras.

## Problemas encontrados

| Sev. | Onde | Problema | Heurística | Correção |
|---|---|---|---|---|
| 4 | Conferência / Meta | Não sei se o conjunto de anúncios recebe data de fim. Sem ela, "até 27/11" é falso e o gasto segue depois do período | 1, 5 | Confirmar com o arquiteto; se não houver data de fim, criar com `end_time` = fim da campanha ou mudar o texto |
| 3 | `guides.ts` `campaign` passo 5 | Diz que a campanha é publicada pausada ao aprovar; na verdade "Publicar na Meta" é outro botão | 2, 10 | Texto novo acima |
| 3 | Arquitetura §2.7 | Intake → formulário de 5 passos **obrigatório** → Criar → painel: o Diego refaria tudo à mão | 7, 8 | O "Entendi" já é a revisão; o formulário fica fechado ("Ver/ajustar") |
| 3 | Publicar manual | Verba `\|\| 20` silenciosa e geo "Brasil inteiro" continuam no caminho manual (o piloto já não usa) | 5 | Bloquear o "Publicar na Meta" sem verba e sem cidade resolvida, com frase e campo |
| 3 | Ausência de aviso fora do app | O Diego vive no celular/WhatsApp; bloqueio ou "pronto para ligar" só aparecem se ele abrir o Meu Funil | 1 | Decisão do dono (abaixo) |
| 2 | `app-shell.tsx` NAV | Menu em inglês (Campaigns, Approvals, Integrations, Brands, Settings) enquanto textos e toasts dizem "Aprovações/Integrações" | 2, 4 | Os botões do painel levam direto ao lugar; renomear o menu é decisão do dono (quebra o 1:1 do port) |
| 2 | Detalhe, topo | StatCards de Verba, Investido, CPL e ROAS aparecem numa campanha em rascunho: números antes da ação | 8 | Painel do estrategista primeiro; números só com `meta_campaign_id` |
| 2 | Detalhe, cabeçalho | Até 5 botões no `PageHeader` em 360 px; "Encerrar" perto de "Publicar" | 4, 5 | Selo + menu `⋯` (Encerrar, Pausar); 1 CTA fixo por estado |
| 2 | `button.tsx` | `default` h-9 (36 px), `sm` h-8 (32 px): passa no piso de 24 px do WCAG 2.5.8, mas fica abaixo dos 44 px que usamos no toque | — | `className="h-11"` no celular, como já faz o `status-card.tsx` |
| 2 | Formulário passo 4 | 7 campos (verba, metas, ticket, margem, CAC) | 8 | No caminho do estrategista ficam em "Metas (opcional)", fechado |
| 2 | Arquitetura `steps` | Etapas sem horário de conclusão: não dá para mostrar "pronto há 3 h" nem "desde ontem" | 1 | Pedido ao arquiteto 4 |
| 2 | Arquitetura `COST_CAP` | O único caminho é "Retomar"; falta "seguir com o que tem" | 3 | Pedido ao arquiteto 5 |
| 2 | Arquitetura G1 | Arte aprovada pela nota já vai para a Meta; na conferência não dá para tirar uma arte de que ele não gostou | 3 | "Não usar esta" (pausa o anúncio dela) ou G2 na 1ª campanha |
| 2 | Arquitetura `NO_IG_PLAN` | "Regere a estratégia" muda a versão já aprovada do pacote | 3 | "Refazer só a parte do Instagram", sem nova aprovação |
| 2 | Créditos "0 com chave própria" | Na tela, "0" parece de graça, mas a OpenAI/Google cobra na conta dele | 2 | Frase explícita no "Ver a conta" |
| 2 | B0 Montando o plano | A geração é chamada pelo navegador; se a aba fechar, ao voltar a tela não sabe que está gerando e ele gera v2 | 1, 5 | "Fique nesta tela" até o servidor guardar o status (pedido 3) |
| 1 | Formulário | "B2B ou B2C" é jargão | 2 | "Vende para empresas / para pessoas" |

## Acessibilidade (WCAG 2.2 AA, as Diretrizes de Acessibilidade para Conteúdo Web)

| Item | Situação |
|---|---|
| Caixa com `<label for>` visível; ajuda via `aria-describedby`; o placeholder não substitui o label | ✓ no desenho |
| Chips = `ToggleGroup` (Radix, já existe em `ui/`) com `type="single"`, setas do teclado, ≥ 44 px de altura e 8 px entre eles | ✓ |
| Perguntas em `fieldset` + `legend`; erro junto do campo com `aria-invalid` + `aria-describedby` | ✓ |
| Foco: depois do "Mandar" vai para "Entendi" (h2 `tabIndex=-1`); depois do "Aprovar e começar", para "Andamento"; ao fechar a conferência, volta ao botão que a abriu | ✓ |
| `aria-live="polite"` **só** em "Precisa de você", no status do microfone, no "Lendo o estilo…" e no resultado do ligar. **Não** na linha do tempo inteira, que muda a cada consulta (mesmo motivo do comentário em `status-card.tsx:116`); anunciar só quando uma etapa muda de estado | ✓ |
| Linha do tempo em `<ol>`; cada item com o estado em texto ("Artes e vídeo: 4 de 7 prontas"); ícones `aria-hidden` | ✓ |
| Cor nunca sozinha: estado = ícone + palavra (1.4.1); texto 4,5:1, ícones e bordas 3:1 | a medir na implementação (`text-muted-foreground` sobre `bg-surface`) |
| CTA fixo não cobre o conteúdo (padding-bottom igual à altura do CTA + safe-area) e não esconde o foco (2.4.11, Foco não encoberto) | ✓ no desenho |
| Zoom de 200% e 320 px de largura sem rolagem lateral; a conferência rola, com o CTA sempre visível | a testar |
| `prefers-reduced-motion`: sem giro no ◐ e sem `scrollIntoView` suave | ✓ |
| Vídeos nas miniaturas: sem autoplay com som, com controles; imagens com `alt` (jeito de falar + formato) | ✓ |
| Arrastar não é exigido (2.5.7): o raio usa chips e stepper, não slider | ✓ |
| Polling de 15 s só enquanto `running`; para em `blocked`/`done` e com a aba oculta | ✓ |

**Não fazer:** começar a produção sem o toque em "Aprovar e começar"; marcar a verba de antemão; desabilitar o CTA sem dizer o que falta; mostrar
"Continuar" para quem espera aprovação; deixar bloqueio só em toast (tem de ficar no painel); abrir modal dentro de drawer; spinner de tela cheia;
cair em "Brasil inteiro"; somar créditos com R$ no mesmo número; prometer um prazo de artes que o job não cumpre; mostrar o botão "Falar" quebrado
no iPhone; carrossel que passa sozinho.

## Decisões que só o dono toma

1. **Destino do contato:** formulário da Meta (cai no CRM, a Rebeca liga) × página de cadastro do Freela. Nos dois casos, qual é o link de privacidade?
2. **Verba:** quais valores entram nos chips (R$ 20/30/50?) e qual o teto mensal da empresa.
3. **"1ª contratação grátis":** existe por escrito? O que é grátis (taxa do Freela, diária ou as duas), até quando, só empresa nova, e como se prova que veio
   da campanha. Sem isso o anúncio não promete. Vale a caixa "Confirmo que o Freela cumpre essa oferta" na conferência?
4. **G1 × G2:** recomendo G1 **se** a conferência permitir "Não usar esta arte"; sem isso, G2 na 1ª campanha.
5. **Instagram:** "Eu aprovo cada post" (recomendado na 1ª) × "Posta sozinho".
6. **Pinterest por link:** só com OK jurídico; sem ele, só envio de arquivo.
7. **Créditos:** quanto vale 1 crédito em R$, se a tela mostra o saldo (hoje não existe) e o teto padrão (48).
8. **Aviso fora do app** (WhatsApp/e-mail/push) quando o estrategista precisar dele ou estiver pronto para ligar.
9. **Renomear para o português** o menu (Campaigns → Campanhas, Approvals → Aprovações, Integrations → Integrações) e as abas (Copies → Textos, Criativos → Artes).
   Isso quebra o "1:1 com o protótipo".
10. **Raio padrão** (20 km, como hoje) e se o botão "Falar" entra (o Chrome manda o áudio para o reconhecimento do Google).
11. **Categoria especial "Emprego"** da Meta se alguma campanha recrutar freelancers.

## Pedidos ao arquiteto (para o desenho funcionar)

1. Confirmar se o conjunto de anúncios vai para a Meta com `end_time` = fim da campanha (afeta a frase "até 27/11"; severidade 4).
2. A lista de campanhas precisa de um resumo do piloto (status, código do 1º bloqueio, contagens) para a linha do estrategista no cartão.
3. Guardar no servidor que a estratégia está sendo gerada (ou gerá-la dentro do fluxo do piloto) para poder dizer "pode fechar".
4. `steps.*.finished_at` (e `started_at`) para "pronto há 3 h" e "desde ontem".
5. `COST_CAP`/`NO_CREATIVE_PASSED`: ação "seguir com o que tem" (marca o resto como pulado) além de "aumentar o teto".
6. "Não usar esta arte" antes de ligar (pausar o anúncio dela na Meta) ou assumir G2.
7. `NO_IG_PLAN`: refazer só o plano do Instagram, sem nova versão da estratégia aprovada.
8. Intake: no máximo 3 `missing`, na ordem verba → destino → oferta; `assumptions` como `{field, text}` para o "Mudar"; condições da oferta como pergunta.
9. Uma fonte única para o web saber se o estrategista está liberado para a empresa (hoje o 404 por lista só aparece ao chamar a rota).
10. O `estimate` devolve as parcelas da conta (artes, refações, vídeo, Instagram) para a tela mostrar com a fonte.
11. Caminho manual: bloquear o publicar sem verba (fim do `|| 20`) e sem cidade resolvida.

Fontes externas: faixa de raio de cidade 17–80 km
([Meta Marketing API — Basic Targeting](https://developers.facebook.com/documentation/ads-commerce/marketing-api/audiences/reference/basic-targeting));
regra de até 75% acima do orçamento diário num dia e 7× na semana ([Jon Loomer — Updates to Meta Ads Budgeting](https://www.jonloomer.com/updates-to-meta-ads-budgeting/),
citando a Meta).
