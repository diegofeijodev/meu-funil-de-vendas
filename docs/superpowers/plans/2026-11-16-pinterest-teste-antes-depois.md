# Teste antes e depois — referências de estilo (Passo 0 do desenho do Pinterest automático)

Desenho: `docs/superpowers/specs/2026-11-16-pinterest-automatico-design.md` · Preparado em 16/11/2026 · **Rodou em 16/11/2026, 17h20–17h35** (resultado no fim).

## O que o teste responde

A referência de estilo, do jeito que o sistema lê hoje (resumo em palavras), muda a arte de forma visível? Sem código novo.

## Onde

Produção, empresa **Freela App**, numa campanha de teste em rascunho. Gasta a IA da Freela App: 5 leituras de imagem + 4 artes.

## Referências escolhidas

Cinco fotos de bar e restaurante tiradas de pastas públicas do Pinterest, guardadas em `~/meufunil-deploy/teste-pinterest/`
(`ref-08.jpg`, `ref-09.jpg`, `ref-11.jpg`, `ref-14.jpg`, `ref-19.jpg`):

| Arquivo | O que mostra | Origem |
|---|---|---|
| ref-08 | bartender servindo, luz quente e escura | pasta `dasfotohaus/bartenders-photography` |
| ref-09 | bartender no balcão, luz dramática | pasta `dasfotohaus/bartenders-photography` |
| ref-11 | mãos servindo a taça, bar escuro | pasta `shotbywizphoto/cocktail-lifestyle` |
| ref-14 | bartender mexendo o drink, taças em primeiro plano | pasta `shotbywizphoto/cocktail-lifestyle` |
| ref-19 | garçonete servindo pratos à mesa | Pin `1135681231061063159` |

Entram por **"Enviar imagem"**, não por link. Motivo: os Pins que vêm do RSS das pastas têm id longo (`e1_Af…`) e o endereço público
do Pin (`oembed.json`) responde 400 para eles (conferido em 16/11); colar o link cairia no caminho de reserva (`og:image`), que não foi
testado. Enviar a imagem liga a referência **só à campanha** e não muda os posts automáticos da marca. Colar uma pasta valeria para a marca
inteira: não fazer no teste.

## Passos

1. Campanhas → nova campanha em rascunho na Freela App, nome "TESTE referências (apagar)".
2. **Antes:** pedir 2 artes, sem nenhuma referência, com exatamente estes pedidos (formato 4:5):
   - A: "Bartender preparando um drink no balcão de um bar movimentado à noite."
   - B: "Garçom servindo pratos em um restaurante cheio no jantar."
3. Seção "Estilo das artes" → "Enviar imagem" com as 5 fotos. Esperar todas saírem de "Lendo o estilo…" e anotar o texto "O que eu peguei".
4. **Depois:** pedir de novo A e B, mesmas palavras, mesmo formato, mesmo provedor de IA.
5. Guardar as 4 artes lado a lado (antes/depois de A e de B) e os dois prompts finais do diretor de arte de cada uma.
6. Limpeza: remover as 5 referências e apagar a campanha de teste.

## Como ler o resultado

- **Melhorou de forma visível** (luz, enquadramento e acabamento mais perto das referências, sem copiar pessoa, marca ou texto): segue o
  desenho inteiro.
- **Não mudou ou mudou pouco:** fazer primeiro só a leitura mais rica (seção 5.2 do desenho), repetir o teste, e só então espalhar.
- **Copiou algo da referência** (rosto, marca, texto): parar e levar ao dono; é o anti-objetivo 3.

Uma arte de cada lado é pouco para afirmar com certeza: se a diferença for duvidosa, repetir A e B mais uma vez de cada lado antes de concluir.

## Resultado (16/11/2026)

Como rodou, diferente do roteiro: na campanha em rascunho que já existia, "Bares e Restaurantes SP — Plano Grátis (WhatsApp)" (escolha
do Denner: criar campanha pelo formulário dispara sozinho o estrategista e as copies). Artes pelo Creative Studio, formato Instagram Feed
4:5, 1 variação, layout "Limpo", IA Gemini (a OpenAI da Freela App aparece sem créditos), "Prompt visual" vazio em todos os pedidos (o campo
guarda o prompt da arte anterior e, se ficar preenchido, o diretor de arte não roda de novo). Gasto: 5 leituras de imagem + 4 artes.
As 5 referências foram removidas no fim (contador de volta a 0). Ficaram na biblioteca da Freela App as 4 artes "TESTE referências — …".

Comparações lado a lado: `~/meufunil-deploy/teste-pinterest/resultado-A-bartender.jpg` e `resultado-B-garcom.jpg`.

### O que o sistema leu de cada referência ("O que eu peguei")

As cinco leituras saíram quase iguais entre si: "luz suave e quente, vinda de um lado", "plano médio/close-up, ângulo levemente
inclinado", "clima elegante e sofisticado/acolhedor", e paletas de bege, dourado, marrom, cinza, verde escuro.

### Texto do diretor de arte

| | Antes (sem referência) | Depois (com 5 referências) |
|---|---|---|
| A bartender | "drink colorido com ingredientes frescos e vibrantes… iluminada por luzes de neon… atmosfera dinâmica" | "luzes de néon… A luz é suave e quente, vinda de fontes difusas, plano próximo em angulação lateral… tons de azul e verde, elegância e modernidade" |
| B garçom | "luz suave e acolhedora das lâmpadas… ângulo baixo, lente grande angular… cores do logotipo do Freela App" | "luz suave e quente… garçom e pratos em primeiro plano, fundo levemente desfocado… tons de roxo, azul e cinza claro, sofisticação e aconchego" |

### Leitura

- **Mudou de forma visível nas duas duplas, na direção das referências.** A: de bar claro com cinco drinks coloridos e neon rosa
  (cara de banco de imagem) para bar escuro, luz lateral, bartender em ação com respingo. B: de garçom com a cabeça cortada e mesa clara
  para garçom inteiro em plano médio, salão escuro com luzes quentes ao fundo.
- **Entraram a luz, o enquadramento e o clima; a paleta das referências não entrou** (bege/dourado/marrom): venceram as cores da marca
  (verde-azulado, roxo). Pode ser o certo para a marca, mas mostra que a paleta da nota hoje é ignorada.
- Nada copiado das referências (pessoa, marca ou texto).
- **Limite do teste:** uma arte de cada lado. A geração varia sozinha de um pedido para outro, então parte da diferença pode ser acaso.
  A nota do crítico não aparece na tela do Estúdio e não foi comparada. Se "melhor" é melhor, é julgamento do dono.
- Como as cinco leituras saíram quase idênticas e genéricas, a Fatia 1 (leitura mais rica, com assunto e acabamento) continua valendo.

### Achados à parte

- Abrir o endereço de uma campanha direto (ou recarregar a página) mostra "Campanha não encontrada ou sem acesso neste workspace";
  entrando pela lista de campanhas abre normal. Não investigado.
- O campo "Prompt visual" do Estúdio fica com o prompt da arte anterior; quem pede outra arte sem apagar recebe a anterior de novo.
