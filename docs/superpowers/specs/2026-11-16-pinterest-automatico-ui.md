# Referências do Pinterest automáticas — telas e textos

Acompanha `2026-11-16-pinterest-automatico-design.md` (v3; Fatia 4 em v4 de 17/11). Textos propostos pelo ux-designer em 16/11/2026, prontos para copiar.
Quem usa: dono e funcionário de pequeno negócio e uma pessoa de marketing, muito pelo celular. Palavra do dia a dia, sem termo técnico.

Regra que atravessa tudo: **"referência" vale só para estilo** (nunca aparece na arte). Foto própria é "foto da sua marca" (pode aparecer).

## 1. Marca, aba Identidade visual (bloco que já existe)

- Título: "Logo e fotos da sua marca"
- Descrição: "Fotos de verdade do seu negócio. Elas podem aparecer nas artes."
- Botão: "Foto da sua marca" · seletor "Foto de: Produto"
- Aviso fixo junto do envio: "Só envie aqui fotos que são suas. Imagem do Pinterest ou de outra empresa vai em Estilo das artes, na aba Guia visual."
- Sucesso: "Foto enviada. Ela pode aparecer nas artes."
- No guia (`BrandDetail.tsx:643`): "Envie as fotos da sua marca na aba Identidade visual."

Mudar esses rótulos sai do 1:1 com o protótipo: depende da decisão 4 do dono (seção 5.1 do desenho).

## 2. Marca, aba Guia visual — painel "Estilo das artes" (acima do guia)

- Título: "Estilo das artes"
- Descrição: "Mostre imagens de que você gosta. O Meu Funil lê as cores, a luz e o clima e usa em todas as artes, posts e vídeos desta marca. A imagem nunca aparece na arte nem é publicada."
- Campo: "Link do Pinterest" · ajuda: "Pin, pasta ou perfil público. No Pinterest, toque em Compartilhar e em Copiar link. Com pasta ou perfil, os Pins novos entram sozinhos todo dia."
- Botões: "Adicionar" / "Buscando…" · "Enviar imagem" / "Enviando…"
- Vazio: "Nenhuma referência ainda. Cole o link de uma pasta do Pinterest com o estilo que você quer."
- Carregando: "Carregando as referências…"
- Erro de carga: "Não conseguimos carregar as referências. Verifique a conexão e toque em Tentar de novo."
- Contador: "{n} de 30 referências nesta marca. Quando enche, as mais antigas das pastas dão lugar às novas."
- Parar pasta (com confirmação): "Parar de acompanhar esta pasta? As {n} referências que vieram dela saem da marca." · [Parar de acompanhar] [Continuar]
- Remover Pin que veio de pasta: "Referência removida. Ela não volta, mesmo continuando na pasta."
- Trocar "vira fonte" por "pasta acompanhada" (na Marca, "Fonte" já quer dizer letra).
- Na campanha, ao colar pasta ou perfil: avisar na hora que ela vale para a marca inteira.

### Linha de cada referência (ícone e texto)

- Origem: "Imagem enviada" · "Pin do Pinterest" · "Pasta {título}"
- Onde vale: "vale para toda a marca" · "só na campanha {nome}"
- Estados:
  - "Lendo o estilo…"
  - "Em uso. O que eu peguei: {resumo}"
  - "Não deu para ler agora. Tentando de novo sozinho ({n} de 3)."
  - "Não conseguimos ler esta imagem. Remova e tente outra."

### Celular e acessibilidade

- Uma coluna; "Remover" embaixo do texto (miniatura, texto e botão na mesma linha deixam cerca de 90 px para o resumo).
- Lista mostra 4 e "Ver todas ({n})" (pode chegar a 38 itens).
- Campo do link com a mesma altura do botão (44 px); o exemplo do link sai do placeholder, que corta em 360 px.
- Texto de apoio em 14 px (hoje há 12 e 11 px). Erro da pasta com ícone e cor de erro, não em cinza.
- Uma única região `aria-live="polite"` no painel anuncia "lendo" e "pronta"; `aria-label` do "Remover" com a origem; `id` do campo não fixo.

## 3. Seleção do Meu Funil (Fatia 4, v4 de 17/11: automática e da própria empresa)

Fica dentro do painel "Estilo das artes" (aba Guia visual), abaixo das referências próprias. Só aparece com `features.style_library`.
Revisado pelo ux-designer em 17/11.

Regras de escrita deste bloco:
- O nome é "Seleção do Meu Funil", com maiúscula. Depois da primeira menção vira "a seleção", com minúscula.
- O que a seleção traz é "referência" (só estilo, como na §2).
- A chave é sempre "chave de IA da empresa", porque pode ser a herdada da agência. É o mesmo termo de "Quem faz a foto", nas Vagas.
- O botão é "Abrir Integrações", como em `status-card.tsx`.
- Falta de saldo é "sem créditos", como na faixa do topo (`health-alerts.ts`).
- Todo {n} tem singular e plural.

### 3.1 Ordem na tela (celular, 360 px, uma coluna)

As pastas e as referências da seleção ficam **dentro do bloco**, logo abaixo do interruptor que as controla. As suas continuam em cima,
como na §2. Assim as 4 primeiras da lista de cima são sempre suas, e quem chega numa pasta da seleção já leu o que ela é e quem a tira.

```text
┌──────────────────────────────────┐
│ Estilo das artes                 │
│ (descrição, campo e botões §2)   │
│ 2 de 30 referências nesta marca… │
│ Suas pastas acompanhadas         │
│ Suas referências (4 + Ver todas) │
├──────────────────────────────────┤
│ Seleção do Meu Funil             │
│ Quando você tem menos de 4…      │
│ ┌──────────────────────────────┐ │
│ │ Usar a Seleção do Meu   [●─] │ │  ← a linha inteira é o alvo (≥ 44 px)
│ │ Funil nesta marca            │ │
│ │ Liga e desliga na hora…      │ │
│ └──────────────────────────────┘ │
│ (linha de estado, §3.3)          │
│ Ramo: Açaí e sorvete, pelo       │
│ Segmento da marca (aba DNA).     │
│ [        Trocar o ramo         ] │
│ 8 de 12 referências da seleção…  │
│ Pastas da seleção                │
│ ┌──────────────────────────────┐ │
│ │ Acai bowls photography       │ │
│ │ Seleção do Meu Funil         │ │
│ │ Atualizada em 17/11/2026     │ │
│ │ Para tirar, desligue a…      │ │
│ └──────────────────────────────┘ │
│ Referências da seleção           │
│ ┌──────────────────────────────┐ │
│ │ [img] Seleção do Meu Funil · │ │
│ │       vale para toda a marca │ │
│ │       Em uso. O que eu peguei│ │
│ │ [Remover]                    │ │
│ └──────────────────────────────┘ │
│ [   Ver todas da seleção (8)   ] │
└──────────────────────────────────┘
```

### 3.2 Textos fixos

- Título do bloco (título de nível 3, abaixo do título da seção): "Seleção do Meu Funil"
- Explicação, sempre visível e em 14 px. Diz que é automático e que gasta a chave:
  "Quando você tem menos de 4 referências suas, o Meu Funil põe sozinho nesta marca referências de pastas públicas do Pinterest do seu ramo, escolhidas pela nossa equipe. Cada uma é lida uma vez com a chave de IA da empresa (em Integrações), e isso gasta crédito dela. São no máximo 12 por vez, e as suas vêm sempre primeiro."
- Interruptor: "Usar a Seleção do Meu Funil nesta marca". Dica em 14 px: "Liga e desliga na hora, sem precisar salvar."
- Para quem não pode editar (viewer), junto do interruptor desabilitado: "Só quem edita a marca pode ligar, desligar ou trocar o ramo."
- Linha do ramo, nos estados 6 a 12:
  - ramo automático: "Ramo: {ramo}, pelo Segmento da marca (aba DNA)."
  - ramo escolhido: "Ramo: {ramo}, escolhido por você."
  - botão [Trocar o ramo]
- Contador da seleção, quando `count` > 0: "{n} de 12 referências da seleção nesta marca."
- Subtítulos da lista: "Pastas da seleção" · "Referências da seleção". O botão de expandir é "Ver todas da seleção ({n})", e a lista mostra 4.

### 3.3 Estados do bloco (vale o primeiro da tabela que bater)

Os campos são os da vista `GET /style-refs/library` (P24). `ai_credit` e `role` estão descritos na §3.11.

| # | Quando | Texto da linha de estado | Ação |
|---|---|---|---|
| 1 | carregando a vista | "Carregando a Seleção do Meu Funil…" (título e explicação já aparecem; o interruptor espera) | — |
| 2 | erro ao carregar | "Não conseguimos carregar a Seleção do Meu Funil. Verifique a conexão e toque em Tentar de novo." | [Tentar de novo] |
| 3 | `enabled` = false | "Desligada. As artes seguem só as suas referências." | — |
| 4 | `segment_source` = `none` | "Ligada, mas sem ramo: você escolheu “Nenhum desses”, então a seleção não traz referências. Escolha um ramo ou desligue a seleção." | [Escolher o ramo] |
| 5 | ramo não reconhecido (`segment` nulo), com o Segmento preenchido | "Ainda não temos seleção para “{segmento}”. Escolha o ramo mais parecido com o seu negócio:" e, embaixo, "Até você escolher, a seleção não traz nada nem gasta a chave de IA." | lista e [Usar este ramo] (§3.4) |
| 5b | igual ao 5, com o Segmento vazio | "Escolha o ramo do seu negócio:" e "Até você escolher, a seleção não traz nada nem gasta a chave de IA." | igual ao 5 |
| 5c | 5 ou 5b, para quem não pode editar | "Esta marca ainda não tem ramo para a seleção. Só quem edita a marca pode escolher." | — |
| 6 | `own_ready` ≥ 4 | "Em pausa: você já tem 4 ou mais referências suas para a marca toda, e elas bastam. A seleção para de trazer referências novas e volta sozinha se você ficar com menos de 4." | — |
| 7 | `needs_ai_key`, dono ou administrador | "Falta a chave de IA da empresa. A seleção usa essa chave para ler as referências. Cadastre uma chave do ChatGPT ou do Gemini em Integrações; até lá, a seleção não traz nada novo." | [Abrir Integrações] |
| 7b | `needs_ai_key`, outros papéis | "Falta a chave de IA da empresa. A seleção usa essa chave para ler as referências. Peça ao dono ou a um administrador para cadastrar uma chave do ChatGPT ou do Gemini em Integrações; até lá, a seleção não traz nada novo." | — |
| 8 | `ai_credit` = `no_credit` | "Sua IA está sem créditos, então a seleção parou de trazer referências novas. As que já estão aqui continuam valendo, e ela volta sozinha quando a conta tiver crédito." | [Abrir Integrações] (só dono ou administrador) |
| 8b | `ai_credit` = `daily_limit` | "Sua IA chegou ao limite de uso de hoje. A seleção para de trazer referências novas e continua amanhã, sozinha." | — |
| 9 | `count` = 0, `reading` = 0, `sources_count` > 0 e todas as pastas da seleção com erro (a tela confere pela lista) | "As pastas do Pinterest deste ramo não responderam agora. Tentamos de novo amanhã, sozinhos." | — |
| 10 | `count` = 0, `reading` = 0 e `daily_left` = 0 (a cota de hoje acabou: ligar, desligar ou trocar de ramo não zera a cota) | "Trazendo as referências do ramo {ramo}. As primeiras chegam amanhã, sozinhas." | — |
| 10b | `count` = 0 e `reading` = 0, logo depois de a pessoa ligar, escolher ou trocar o ramo nesta tela (a API reconcilia na hora) | "Trazendo as referências do ramo {ramo}. As primeiras chegam em alguns minutos; pode sair desta tela." | — |
| 10c | `count` = 0 e `reading` = 0, com a tela já aberta assim, sem gravação nesta visita (chave cadastrada depois, marca nova, chave do servidor recém-ligada: quem traz é o job, 10 marcas por rodada) | "Trazendo as referências do ramo {ramo}. As primeiras chegam nas próximas horas, sozinhas; pode sair desta tela." | — |
| 11 | `count` = 0 e `reading` > 0 | "Lendo o estilo de 1 referência da seleção… Pode sair desta tela." / "Lendo o estilo de {n} referências da seleção… Pode sair desta tela." | — |
| 12 | `in_use` | "Em uso. As suas referências vêm sempre primeiro; a seleção completa o estilo enquanto você tiver menos de 4 para a marca toda." Com `reading` > 0, junta: "Lendo o estilo de mais 1 referência…" / "Lendo o estilo de mais {n} referências…" | — |

- O estado 6 vem antes do 7 porque, com 4 ou mais referências próprias, a seleção não é usada, e não faz sentido pedir a chave.
- Os estados 2 e 9 levam ícone de alerta e cor de erro. Os estados 7, 7b, 8 e 8b levam ícone e cor de atenção (o `Notice` de `status-card.tsx`). Cor nunca aparece sozinha.

### 3.4 Escolher e trocar o ramo

- [Trocar o ramo] e [Escolher o ramo] abrem a lista **na própria tela**, sem janela por cima.
- Pergunta: "Escolha o ramo mais parecido com o seu negócio:"
- Opções, nesta ordem:
  1. "Açaí e sorvete"
  2. "Hamburgueria e lanches"
  3. "Churrasco e espetinho"
  4. "Bar e bebidas"
  5. "Restaurante"
  6. "Vagas e equipe"
  7. "Nenhum desses"

  O ramo atual leva " (atual)" no fim do nome.
- Tocar numa opção só marca. Nada muda até o botão: com as setas do teclado o rádio troca a cada tecla, e cada troca tiraria e leria referências com a chave.
- Logo acima do botão vem a consequência. Ela aparece quando a opção marcada é diferente da atual e a marca já tem referências da seleção:
  - outro ramo: "As {n} referências da seleção de agora saem desta marca. Entram as do ramo {ramo novo}, lidas com a chave de IA da empresa." / "A referência da seleção de agora sai desta marca. Entram as do ramo {ramo novo}, lidas com a chave de IA da empresa."
  - "Nenhum desses": "As {n} referências da seleção saem desta marca e nada entra no lugar." / "A referência da seleção sai desta marca e nada entra no lugar."
- Botões:
  - [Usar este ramo]; com "Nenhum desses" marcado, o botão vira [Ficar sem seleção].
  - [Cancelar].
  - Na primeira escolha (estados 5 e 5b) não há "(atual)", nem consequência, nem [Cancelar].
- Aviso depois (toast):
  - primeira escolha: "Ramo escolhido: {ramo}."
  - troca sem referências da seleção na marca: "Ramo trocado para {ramo}."
  - troca com referências: "Ramo trocado para {ramo}. As referências da seleção anterior saíram."
  - "Nenhum desses": "Pronto. A seleção não traz referências para esta marca."
- Erro ao gravar (toast; a lista continua aberta, com a opção marcada): "Não conseguimos trocar o ramo. Verifique a conexão e tente de novo."

### 3.5 Ligar e desligar

- **Ligar:** sem confirmação. A explicação fixa, logo acima do interruptor, já diz que a seleção é automática e gasta a chave. Toast: "Seleção ligada."
  - Ressalva: hoje `brands.style_library_enabled` nasce `true`, então na maioria das marcas ninguém terá ligado. A seleção começa a gastar a chave sem a empresa pedir. Isso é decisão do dono, ainda aberta, e estes textos valem para os dois casos.
- **Desligar com referências da seleção na marca** (`limits.in_selection` > 0): confirma antes, no `AlertDialog` do "Parar".
  - Título: "Desligar a Seleção do Meu Funil?"
  - Texto: "As {n} referências da seleção saem desta marca. Se você ligar de novo, elas são lidas outra vez com a chave de IA da empresa." / "A referência da seleção sai desta marca. Se você ligar de novo, ela é lida outra vez com a chave de IA da empresa."
  - Botões: [Desligar a seleção] · [Manter ligada]
  - Toast: "Seleção desligada. As referências dela saíram desta marca."
- **Desligar sem referências da seleção:** desliga direto. Toast: "Seleção desligada."
- **Erro ao gravar** (toast; o interruptor volta para onde estava): "Não conseguimos mudar a seleção. Verifique a conexão e tente de novo."
- **Para o "saíram" ser verdade:** a API apaga em segundo plano (P20′), então a tela some com as referências na hora.
  - Ao desligar, some com todas as da seleção.
  - Ao trocar de ramo, some com as que estavam na tela antes da troca.
  - Depois, confere a lista de novo.

### 3.6 Pastas e referências da seleção (dentro do bloco)

**Pasta da seleção**
- Linha: link "{título da pasta}" (sem título: "Pasta do Pinterest") e, embaixo, o rótulo "Seleção do Meu Funil".
- Situação igual à da §2: "Atualizada em {data}" / "Aguardando a primeira leitura".
- Não tem o botão "Parar". Ajuda: "Para tirar, desligue a seleção ou troque o ramo."
- Com erro, o texto da tela entra no lugar do `last_error` da API. O texto da API ("A pasta está vazia ou não é pública.") pede uma ação a quem não escolheu a pasta. Texto da tela, com ícone e cor de erro: "Esta pasta não respondeu agora. Tentamos de novo amanhã, sozinhos; as outras pastas da seleção continuam."

**Referência da seleção**
- Origem e alcance: "Seleção do Meu Funil · vale para toda a marca"
- Estados:
  - lendo e nova tentativa: "Lendo o estilo…" e "Não deu para ler agora. Tentando de novo sozinho ({n} de 3)." (iguais aos da §2)
  - pronta, com a seleção em uso: "Em uso. O que eu peguei: {resumo}" (igual ao da §2)
  - pronta, com a seleção em pausa (estado 6): "Guardada: entra se você ficar com menos de 4 referências suas. O que eu peguei: {resumo}"
  - falhou de vez (`failed` com `attempts` < 3; sai sozinha no próximo sync): "Não conseguimos ler esta imagem. Ela sai sozinha da seleção."
  - falhou depois de 3 tentativas (`failed` com `attempts` = 3; volta para a fila): "Não deu para ler agora. Tentamos de novo mais tarde, sozinhos."
- [Remover] continua, com `aria-label` "Remover referência: Seleção do Meu Funil". Toast: "Referência removida. Ela não volta; outra da seleção pode entrar no lugar."

**Colar o link de uma pasta ou Pin que já veio da seleção** (P26′). O toast abaixo substitui o de hoje:
- pasta: "Essa pasta já vinha da Seleção do Meu Funil. Agora ela é sua e fica mesmo se a seleção for desligada."
- Pin: "Esse Pin já vinha da Seleção do Meu Funil. Agora ele é seu e fica mesmo se a seleção for desligada."

### 3.7 O que muda no painel da §2 quando a seleção tem pastas ou referências

- A lista de cima mostra só as suas, e o "Ver todas ({n})" de cima conta só as suas.
- O título "Pastas acompanhadas" vira "Suas pastas acompanhadas". A lista de referências de cima ganha o subtítulo "Suas referências".
- O contador "{n} de 30 referências nesta marca…" continua contando só as suas. A seleção tem o contador dela (§3.2).
- Vazio quando não há nenhuma sua, mas a seleção tem referências: "Nenhuma referência sua ainda. Por enquanto as artes seguem a Seleção do Meu Funil. Cole o link de uma pasta do Pinterest com o estilo que você quer."
  Sem nenhuma referência, nem da seleção, o vazio da §2 não muda.
- **Uma região viva só para o painel inteiro.** Na Marca, ela sai do `StyleRefsPanel` e vai para a seção "Estilo das artes", que contém os dois. Na campanha, onde não existe o bloco, o painel mantém a região dele.
  - As frases da §2 têm prioridade. Uma frase da seleção só entra quando nenhuma da §2 vale, e no máximo uma por conferência.
  - Quando aparecem referências da seleção: "A Seleção do Meu Funil está trazendo referências."
  - Quando alguma passa de lendo a pronta: "Referências da seleção prontas."
  - Não repete uma frase por referência.
- Ligar, desligar, trocar o ramo e remover avisam por toast, e a região viva não repete esses avisos.
- **Conferência automática.** Nos estados 10b, 11 e 12 com `reading` > 0, a tela confere a vista da seleção a cada 10 s, por até 10 min.
  - Ela refaz a lista só quando `count`, `reading` ou `sources_count` mudam. A lista não entra nessa conferência porque cada refeita renova as URLs assinadas das miniaturas (ver `refsPollInterval`).
  - Sem isso, o "chegam em alguns minutos" nunca se cumpre na tela sem recarregar: hoje a vista não confere sozinha.

### 3.8 Na campanha

- A campanha não tem o bloco nem o interruptor.
- Se a lista trouxer pasta ou referência da seleção, ela vai no fim, com os rótulos da §3.6 e sem "Parar".
- Ajuda: "Para tirar, desligue a Seleção do Meu Funil na marca, aba Guia visual."
- O contador "{n} de 8 referências nesta campanha." não conta a seleção.

### 3.9 Erro da API ao parar uma pasta da seleção

`DELETE /style-refs/sources/:id` numa pasta `origin='selection'` responde `400`, com `code` sugerido `SELECTION_SOURCE`:

"Esta pasta é da Seleção do Meu Funil e não dá para parar por aqui. Para tirar, desligue a seleção ou troque o ramo na marca, aba Guia visual."

A tela nunca mostra "Parar" nessa pasta. A frase só aparece com a lista desatualizada ou com chamada direta à API, e o web a mostra no toast pela `apiErrorMessage`.

### 3.10 Celular e acessibilidade

- O `Switch` mede 20 × 36 px (`h-5 w-9`), abaixo de 44. A linha inteira (rótulo, dica e interruptor) é o alvo, com pelo menos 44 px de altura, e tocar no texto liga e desliga.
- Os botões do bloco têm 44 px de altura e, no celular, ficam um embaixo do outro, o principal primeiro. São eles: "Trocar o ramo", "Escolher o ramo", "Usar este ramo", "Ficar sem seleção", "Cancelar", "Abrir Integrações", "Tentar de novo" e "Ver todas da seleção".
- Cada opção de ramo ocupa uma linha de 44 px (já é assim).
- Texto de apoio em 14 px. A dica do interruptor hoje está em 12 px (`text-xs`).
- O interruptor usa `aria-describedby` com a explicação e a linha de estado. Quem não pode editar vê o interruptor desabilitado e o texto do porquê, não só o cinza.
- [Trocar o ramo] usa `aria-expanded`. Ao abrir, o foco vai para a opção marcada; ao confirmar ou cancelar, volta para o botão. A lista usa `aria-labelledby` com a pergunta.
- A confirmação de desligar é o único diálogo, sem diálogo dentro de diálogo.

### 3.11 O que estes textos pedem à API e ao web (software-architect)

1. A vista `GET /style-refs/library` ganha `ai_credit: null | "no_credit" | "daily_limit"`, o mesmo aviso que pausa a seleção na P21′. Ele alimenta os estados 8 e 8b.
2. **Prazo depois de cadastrar a chave.** Cadastrar a chave em Integrações deveria pôr na frente da fila as marcas da empresa e as das empresas que herdam a chave (`style_library_checked_at = null`). Hoje, pela P20, o job só volta à marca em até 6 h. O 10c ("nas próximas horas") é verdade nos dois casos; com o pedido atendido, a espera real cai para minutos.
3. A vista ganha `daily_left`, quantas leituras ainda cabem hoje, para o estado 10.
4. `options[].label` e `segment_label` usam rótulos e ordem de tela próprios da seleção (§3.4). `STYLE_CATEGORY_LABEL` continua valendo para o resto, mas "ambiente e salão" e "equipe e vagas" não dizem nada a quem tem restaurante. A ordem de reconhecimento da P16 não muda.
5. Colar uma pasta ou um Pin que já era da seleção devolve `promoted: true`, para os toasts da §3.6.
6. O `400` da §3.9.
7. No web:
   - `role` (dono ou administrador, para [Abrir Integrações]).
   - O `retry` e os estados 1 e 2, no lugar do `return null` de `style-library.tsx`.
   - A região viva e a conferência da §3.7.
   - Esconder na hora as referências da seleção, como na §3.5.

## 4. Vagas, Ajustes (Fatia 5) — depois de "Quem faz a foto", entra no "Salvar ajustes"

- Título: "Estilo da foto" · opção: "Seguir as referências da marca {nome}"
- Ajuda: "Muda só as cores, a luz e o clima da foto. Textos, arte modelo e selos continuam iguais. Se a foto sair com letras, o sistema refaz sem as referências. Gere uma prévia para ver."
- Marca sem referências: "A marca {nome} ainda não tem referências em uso; ligar agora não muda nada." · [Pôr referências]
- Sem marca: "As vagas ainda não estão ligadas a uma marca. Envie a arte modelo e a marca entra sozinha."

## 5. Convite onde a arte é vista (Estúdio, Aprovações, Pacote)

- "Estilo: sem referências." · [Mostrar o estilo que eu quero]
- "Estilo: seguiu {n} referências suas."
- Só a seleção (já está no código, `styleInvite`): "Estilo: seguiu a Seleção do Meu Funil." · [Mostrar o estilo que eu quero]
- Suas e da seleção juntas (caso novo de 17/11): "Estilo: seguiu 1 referência sua e a Seleção do Meu Funil." / "Estilo: seguiu {n} referências suas e a Seleção do Meu Funil." Sem botão, como no caso de só as suas.

## 6. Fica fora desta versão

- Vídeo como referência (o desenho de 29/10 prometia; o painel só aceita JPG e PNG).
- Trocar a marca das vagas pela tela.
