import type { VacancyFields } from './vacancy-types';

/** Proporção pedida à IA para a arte: 4:5 ocupa quase toda a largura da área livre do story (1080 × 1100). */
export const ART_ASPECT = '4:5';

/**
 * Arte com os MESMOS cartões da arte modelo (um cartão por informação, com o ícone e o rótulo), só com os campos limpos da vaga.
 * Endereço, região, descrição e link continuam fora: a vitrine pública do Freela não os envia.
 */
export function artPrompt(f: VacancyFields, hint: string | null): string {
  const cards = [
    ...(f.estabelecimento ? [`Estabelecimento: ${f.estabelecimento}`] : []),
    `Função: ${f.funcao}`,
    `Data: ${f.data}`,
    `Horário: ${f.horario}`,
    `Cidade: ${f.cidade}`,
    `Valor para o freela: ${f.valor}`,
  ];
  const base =
    'Crie um story vertical seguindo fielmente o ESTILO e o LAYOUT da imagem de referência: mesmas cores, mesmas letras, o título em faixas ' +
    'e os cartões empilhados, cada um com o seu ícone redondo, o rótulo pequeno em cima e o valor grande embaixo. ' +
    `No título escreva: VAGA / ${f.funcao.toUpperCase()} / FREELANCER. ` +
    `Faça exatamente ${cards.length} cartões, nesta ordem, com estes textos escritos exatamente assim: ` +
    `${cards.map((c, i) => `(${i + 1}) ${c}`).join(' ')}. ` +
    'Os cartões devem ser grandes e fáceis de ler no celular, ocupando a largura da arte. ' +
    'Troque TODOS os textos da referência pelos acima. Não escreva nenhum outro texto. ' +
    'PROIBIDO: cartões de Endereço, Região, Bairro, Descrição ou "Ver vaga"; qualquer link, site ou QR; selos do Google Play ou da App Store; ' +
    'nomes ou logos de empresas na cena. ' +
    `A foto mostra uma pessoa fazendo o trabalho de ${f.funcao} num bar ou restaurante, sem fachada, sem nome e sem logo de empresa. ` +
    'Mantenha a logo do Freela da referência uma única vez, no topo. ' +
    'Não desenhe o rodapé preto da referência: deixe a faixa de baixo da arte lisa, sem texto (o rodapé é colocado depois).';
  return hint ? `${base}\n${hint}` : base;
}

export function photoPrompt(funcao: string): string {
  return (
    `Foto realista, vertical, de uma pessoa trabalhando como ${funcao} num bar ou restaurante brasileiro. ` +
    'Sem nenhum texto, letra, número, placa, fachada, nome ou logo.'
  );
}

/** Leitura às cegas: nunca inclui os valores esperados. */
export function readPrompt(): string {
  return (
    'Leia esta arte de story. Liste em `textos` TODOS os textos visíveis, inclusive os pequenos e os da foto (placas, fachadas, uniformes), exatamente como aparecem, um item por bloco. ' +
    'Depois preencha: `funcao` (a função/cargo da vaga), `estabelecimento`, `data`, `inicio`, `fim`, `valor` (o valor em reais), `cidade`. ' +
    'Use null quando o campo não aparecer. Não invente nem corrija nada.'
  );
}

export function templateReadPrompt(): string {
  return (
    'Liste em `textos` todos os textos visíveis nesta arte, inclusive os pequenos, os da foto (placas, fachadas) e os do rodapé, ' +
    'um item por bloco, exatamente como aparecem.'
  );
}
