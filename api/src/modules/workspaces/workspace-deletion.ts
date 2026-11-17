/**
 * Regras do "Apagar empresa" (contrato §31) sem banco nem framework: o nome confere? o que impede apagar?
 * O serviço usa a MESMA função no preview e dentro da transação do DELETE — as duas leituras não podem divergir.
 */
import { CHANNEL_CREATE_LEASE_MS } from '../campaigns/campaign-labels';

export const ERR_ONLY_OWNER_DELETES = 'Só o dono da empresa pode apagá-la.';
export const ERR_NAME_MISMATCH = 'O nome digitado não confere com o nome da empresa.';

export type BlockerCode = 'CAMPAIGN_BEING_CREATED' | 'LIVE_META_CAMPAIGNS' | 'LIVE_OTHER_AD_CAMPAIGNS' | 'LAST_WORKSPACE';
export type BlockerItem = { id: string; name: string };
export type DeletionBlocker = { code: BlockerCode; message: string; items?: BlockerItem[] };

/**
 * Campanha que impede apagar num canal: `live` = publicada e não pausada (pode estar gastando); `creating` = o app está criando a
 * campanha no canal agora (reserva `*_creating_at` dentro do prazo) — o id externo ainda nem foi gravado.
 */
export type LiveCampaign = { id: string; name: string; channel: 'meta' | 'google' | 'tiktok'; state?: 'live' | 'creating' };

/** Colunas de canal de `campaigns` que dizem se a campanha foi publicada e se está pausada. */
export type CampaignChannels = {
  id: string;
  name: string;
  meta_campaign_id: string | null;
  meta_delivery_status: string | null;
  google_campaign_id: string | null;
  google_status: string | null;
  tiktok_campaign_id: string | null;
  tiktok_status: string | null;
  google_creating_at?: Date | null;
  tiktok_creating_at?: Date | null;
};

/**
 * Publicada e NÃO pausada em cada canal. Olha o status de veiculação, não o `status` da campanha: "Encerrar" deixa `finished` com
 * `meta_delivery_status = 'ACTIVE'` quando a pausa na Meta falha (a campanha continua gastando). Status vazio com id publicado também
 * conta como ligada — não dá para provar que parou. Pausado: Meta/Google `PAUSED`, TikTok `DISABLE`.
 * Google/TikTok com a reserva de criação viva (`*_creating_at` há menos de `leaseMs`) contam como `creating`: o id externo chega no fim
 * da criação. Reserva vencida (a criação morreu) não bloqueia para sempre. A Meta não tem reserva no banco (a trava de publicar é em
 * memória e a campanha nasce PAUSADA); a corrida com ela fica no log `[workspace-delete-race]` de quem publica.
 */
export function liveCampaigns(rows: CampaignChannels[], now = new Date(), leaseMs = CHANNEL_CREATE_LEASE_MS): LiveCampaign[] {
  const creating = (at: Date | null | undefined) => !!at && now.getTime() - new Date(at).getTime() < leaseMs;
  return rows.flatMap((c): LiveCampaign[] => {
    const out: LiveCampaign[] = [];
    const add = (channel: LiveCampaign['channel'], state: 'live' | 'creating') => out.push({ id: c.id, name: c.name, channel, state });
    if (c.meta_campaign_id && c.meta_delivery_status !== 'PAUSED') add('meta', 'live');
    if (c.google_campaign_id && c.google_status !== 'PAUSED') add('google', 'live');
    else if (!c.google_campaign_id && creating(c.google_creating_at)) add('google', 'creating');
    if (c.tiktok_campaign_id && c.tiktok_status !== 'DISABLE') add('tiktok', 'live');
    else if (!c.tiktok_campaign_id && creating(c.tiktok_creating_at)) add('tiktok', 'creating');
    return out;
  });
}

/** Compara o nome digitado com o atual (espaços nas pontas não contam; maiúsculas contam). */
export function confirmNameMatches(typed: string | null | undefined, current: string): boolean {
  const t = (typed ?? '').trim();
  return t.length > 0 && t === current.trim();
}

const names = (items: BlockerItem[]) => items.map((i) => i.name.trim() || 'Campanha sem nome').join(', ');

const CHANNEL_NAME: Record<LiveCampaign['channel'], string> = { meta: 'na Meta', google: 'no Google Ads', tiktok: 'no TikTok Ads' };

/**
 * Bloqueios, na ordem em que a tela mostra. `memberships` = em quantas empresas o usuário é membro (qualquer papel), contando esta.
 * - Campanha sendo criada agora num canal: espere terminar (ela nasce pausada; depois disso não bloqueia mais).
 * - Anúncio publicado e não pausado: apagar a empresa apaga os ids e as credenciais do canal — ninguém mais conseguiria pausar pelo app.
 * - Última empresa: o app não tem tela para "nenhuma empresa".
 */
export function deletionBlockers(input: { live: LiveCampaign[]; memberships: number }): DeletionBlocker[] {
  const out: DeletionBlocker[] = [];
  const creating = input.live.filter((c) => c.state === 'creating');
  if (creating.length) {
    const items = dedupe(creating).map(({ id, name }) => ({ id, name }));
    const where = [...new Set(creating.map((c) => CHANNEL_NAME[c.channel]))].join(' e ');
    out.push({
      code: 'CAMPAIGN_BEING_CREATED',
      message: `${items.length === 1 ? 'Esta campanha está sendo criada' : 'Estas campanhas estão sendo criadas'} agora ${where}: ${names(items)}. Espere terminar (leva alguns minutos) e tente de novo.`,
      items,
    });
  }
  const live = input.live.filter((c) => c.state !== 'creating');
  const meta = live.filter((c) => c.channel === 'meta').map(({ id, name }) => ({ id, name }));
  if (meta.length) {
    out.push({
      code: 'LIVE_META_CAMPAIGNS',
      message: `${meta.length === 1 ? 'Esta campanha ainda está ligada' : 'Estas campanhas ainda estão ligadas'} na Meta: ${names(meta)}. Encerre a campanha (ou pause na Meta) antes de apagar a empresa.`,
      items: meta,
    });
  }
  const other = live.filter((c) => c.channel !== 'meta');
  if (other.length) {
    const items = dedupe(other).map(({ id, name }) => ({ id, name }));
    out.push({
      code: 'LIVE_OTHER_AD_CAMPAIGNS',
      message: `${items.length === 1 ? 'Esta campanha ainda está ligada' : 'Estas campanhas ainda estão ligadas'} no Google Ads ou no TikTok Ads: ${names(items)}. Encerre a campanha antes de apagar a empresa.`,
      items,
    });
  }
  if (input.memberships <= 1) {
    out.push({ code: 'LAST_WORKSPACE', message: 'Esta é a sua única empresa. Crie outra empresa antes de apagar esta.' });
  }
  return out;
}

/** A mesma campanha pode estar ligada no Google E no TikTok: aparece uma vez só. */
function dedupe(list: LiveCampaign[]): LiveCampaign[] {
  const seen = new Set<string>();
  return list.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
}
