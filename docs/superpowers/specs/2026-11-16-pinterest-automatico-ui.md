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
Rascunho do coordenador em 17/11; passa pelo ux-designer antes de construir.

- Interruptor: "Usar a seleção do Meu Funil" · "Vale na hora, sem precisar salvar."
- Linha do ramo: "Seleção do Meu Funil para {ramo}: {N} referências de pastas públicas do Pinterest escolhidas pela nossa equipe." · [Trocar o ramo]
- Ligado: "Suas referências vêm primeiro; a seleção completa quando você tem menos de 4."
- Ligado sem efeito: "Sem uso agora: você já tem 4 ou mais referências suas."
- Desligado: "As artes seguem só as suas referências."
- Ligado, ainda lendo: "Estamos trazendo as referências da seleção. Leva alguns minutos."
- Sem chave de IA: "A seleção usa a sua chave de IA para ler as imagens. Cadastre uma chave do ChatGPT ou do Gemini em Integrações." · [Ir para Integrações]
- Ramo não reconhecido: "Ainda não temos seleção para "{segmento}". Escolha o ramo mais parecido:" com as opções e "Nenhum desses".
- Trocar o ramo (ramo já reconhecido ou escolhido): "Escolha o ramo mais parecido:" com as opções, "Nenhum desses" e o atual marcado.
- Ao trocar ou desligar (aviso na hora, toast): "Pronto. As referências da seleção anterior saíram."

### Na lista do painel

- Pasta da Seleção: "Seleção do Meu Funil · {título da pasta}" · sem o botão "Parar" (quem tira é o interruptor) · ajuda: "Para tirar, desligue a seleção."
- Referência da Seleção: origem "Seleção do Meu Funil" · "vale para toda a marca"; "Remover" continua (ela não volta).
- O contador "{n} de 30 referências nesta marca…" conta só as suas.

## 4. Vagas, Ajustes (Fatia 5) — depois de "Quem faz a foto", entra no "Salvar ajustes"

- Título: "Estilo da foto" · opção: "Seguir as referências da marca {nome}"
- Ajuda: "Muda só as cores, a luz e o clima da foto. Textos, arte modelo e selos continuam iguais. Se a foto sair com letras, o sistema refaz sem as referências. Gere uma prévia para ver."
- Marca sem referências: "A marca {nome} ainda não tem referências em uso; ligar agora não muda nada." · [Pôr referências]
- Sem marca: "As vagas ainda não estão ligadas a uma marca. Envie a arte modelo e a marca entra sozinha."

## 5. Convite onde a arte é vista (Estúdio, Aprovações, Pacote)

- "Estilo: sem referências." · [Mostrar o estilo que eu quero]
- "Estilo: seguiu {n} referências suas."

## 6. Fica fora desta versão

- Vídeo como referência (o desenho de 29/10 prometia; o painel só aceita JPG e PNG).
- Trocar a marca das vagas pela tela.
