/** Texto livre (usuário ou IA) para dentro de um prompt: sem « » (o delimitador), sem quebras nem controle, com teto. */
export function cleanFree(v: unknown, max: number): string {
  return typeof v === 'string'
    ? v.replace(/[«»]/g, '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
    : '';
}
