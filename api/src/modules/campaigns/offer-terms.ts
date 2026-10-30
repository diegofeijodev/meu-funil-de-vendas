/**
 * Condições da oferta anunciada (§0.7 #1): oferta anunciada obriga (CDC), então o que a campanha promete precisa estar escrito e vira
 * restrição obrigatória nos prompts do estrategista e da copy. Ex. do Freela (29/10): "1ª contratação grátis" = cupom de 100% numa vaga,
 * liberado pela equipe no admin depois do cadastro — nunca desconto automático no pagamento.
 */
import { BadRequestException } from '@nestjs/common';
import { isDateString } from '../../common/time/dates';

export type OfferTerms = { what: string; valid_until: string; new_only: boolean; confirmed_by?: string; confirmed_at?: string };

const bad = (message: string) => new BadRequestException({ code: 'BAD_REQUEST', message });

/** Valida o objeto vindo da tela. `null`/ausente = campanha sem condições escritas. */
export function parseOfferTerms(raw: unknown): OfferTerms | null {
  if (raw == null) return null;
  const r = raw as Record<string, unknown>;
  const what = typeof r['what'] === 'string' ? r['what'].trim() : '';
  if (!what) throw bad('Diga o que é grátis ou oferecido.');
  if (what.length > 200) throw bad('Descreva o que é oferecido em até 200 letras.');
  if (!isDateString(r['valid_until'])) throw bad('Informe até quando a oferta vale.');
  const out: OfferTerms = { what, valid_until: r['valid_until'] as string, new_only: r['new_only'] === true };
  if (typeof r['confirmed_by'] === 'string') out.confirmed_by = r['confirmed_by'];
  if (typeof r['confirmed_at'] === 'string') out.confirmed_at = r['confirmed_at'];
  return out;
}

/** A linha que vai aos prompts. Sem promessa ou sem condições escritas, nada. */
export function offerConstraint(promise: string | null | undefined, terms: OfferTerms | null | undefined): string | null {
  const p = (promise ?? '').trim();
  if (!p || !terms?.what || !terms.valid_until) return null;
  const until = terms.valid_until.split('-').reverse().join('/');
  return [
    `CONDIÇÕES DA OFERTA (obrigatório): prometa só "${p}".`,
    `O que é grátis/oferecido: ${terms.what}.`,
    `Vale até ${until}.`,
    terms.new_only ? 'Só para empresas/clientes novos.' : 'Vale para todos.',
    'Não invente outras condições, prazos ou descontos.',
  ].join(' ');
}
