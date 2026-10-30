/**
 * UTM do link de destino dos anúncios. O link que a empresa colou pode já vir marcado (ex.: o cadastro do Freela com
 * `utm_source=meta`): aí ele vale como está, sem UTM repetida — quem lê a origem do cadastro guarda o primeiro valor.
 */
export function withUtm(url: string, source: string, medium: string, campaign: string): string {
  if (/[?&]utm_source=/i.test(url)) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}utm_source=${source}&utm_medium=${medium}&utm_campaign=${encodeURIComponent(campaign)}`;
}
