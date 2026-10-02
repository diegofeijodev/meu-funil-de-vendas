import { MetaError } from '../instagram/meta-graph';

/** Ids da Meta/Google/TikTok são numéricos; só eles entram em caminho de URL/GAQL (nada de `../`, `?`, `/`). */
const DIGITS = /^\d{3,25}$/;
const ACT = /^act_\d{3,25}$/;

export const isDigits = (v: unknown): v is string => typeof v === 'string' && DIGITS.test(v);

/** Id de objeto da Graph (campanha, conjunto, anúncio, Página, IG, público, pixel, formulário). */
export function gid(v: unknown, what = 'identificador'): string {
  if (!isDigits(v)) throw new MetaError(`Identificador inválido (${what}).`);
  return v;
}

/** `act_123…` (aceita só dígitos e põe o prefixo). */
export function actId(v: unknown): string {
  const s = typeof v === 'string' ? (v.startsWith('act_') ? v : `act_${v}`) : '';
  if (!ACT.test(s)) throw new MetaError('Identificador inválido (conta de anúncios).');
  return s;
}

/** Só dígitos do que o usuário digitou/colou (`linkExternalCampaign`, ids de público). */
export const onlyDigits = (v: string): string => v.replace(/\D/g, '');
