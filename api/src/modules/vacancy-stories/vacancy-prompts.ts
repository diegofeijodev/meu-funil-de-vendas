import type { VacancyFields } from './vacancy-types';

/** Texto estilo "ESTILO e LAYOUT da referência": só campos limpos entram (nada de endereço, link, nome do dono). */
export function artPrompt(f: VacancyFields, hint: string | null): string {
  const estab = f.estabelecimento ? ` / Estabelecimento: ${f.estabelecimento}` : '';
  const base =
    'Crie um story vertical seguindo o ESTILO e o LAYOUT da imagem de referência (cores, letras, faixas, cartões com ícones). ' +
    'Troque TODOS os textos pelos abaixo, escritos exatamente assim: ' +
    `VAGA FREELA / ${f.funcao.toUpperCase()} / Valor para o freela: ${f.valor} / Quando: ${f.data} · ${f.horario} / Onde: ${f.cidade}${estab}. ` +
    'Não escreva nenhum outro texto. ' +
    'PROIBIDO: cartões de Endereço, Região, Bairro ou Descrição; qualquer link, site ou QR; selos do Google Play ou da App Store; ' +
    'nomes ou logos de empresas na cena. ' +
    `A foto mostra uma pessoa fazendo o trabalho de ${f.funcao} num bar ou restaurante, sem fachada, sem nome e sem logo de empresa. ` +
    'Mantenha a logo do Freela da referência. ' +
    'Deixe a faixa de baixo da arte lisa, sem texto (o rodapé é colocado depois).';
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
    'Leia esta arte de story. Liste em `textos` TODOS os textos visíveis, exatamente como aparecem, um item por bloco. ' +
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
