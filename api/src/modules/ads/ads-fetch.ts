/** Porta HTTP dos provedores de anúncios (Google Ads / TikTok Business / OAuth do Google): hosts fixos; nos testes entra um fake. */
export type AdsFetch = (url: string, init?: RequestInit) => Promise<Response>;
export const ADS_FETCH = Symbol('ADS_FETCH');
