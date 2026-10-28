import { isUuid } from '../ids/uuid';

/**
 * Lista de empresas com stories das vagas (`VACANCY_STORIES_WORKSPACE_IDS`): ids separados por vírgula.
 * Vazia = nenhuma empresa. `*` = todas, só em development/test. Id inválido derruba a subida.
 */
export function parseVacancyWorkspaces(raw: string | undefined, nodeEnv: string | undefined): '*' | Set<string> {
  const items = (raw ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (items.length === 1 && items[0] === '*') {
    if (nodeEnv !== 'development' && nodeEnv !== 'test') {
      throw new Error('VACANCY_STORIES_WORKSPACE_IDS: "*" só vale em NODE_ENV=development ou test; em produção liste os ids das empresas.');
    }
    return '*';
  }
  const out = new Set<string>();
  for (const item of items) {
    if (!isUuid(item)) throw new Error(`VACANCY_STORIES_WORKSPACE_IDS inválido: "${item}" não é um id de empresa.`);
    out.add(item.toLowerCase());
  }
  return out;
}
