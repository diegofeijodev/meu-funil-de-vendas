/**
 * Regras do "Apagar empresa" (contrato §31) sem banco nem framework: o nome confere? o que impede apagar?
 * O serviço usa a MESMA função no preview e dentro da transação do DELETE — as duas leituras não podem divergir.
 */

export const ERR_ONLY_OWNER_DELETES = 'Só o dono da empresa pode apagá-la.';
export const ERR_NAME_MISMATCH = 'O nome digitado não confere com o nome da empresa.';

export type BlockerCode = 'LIVE_META_CAMPAIGNS' | 'LIVE_OTHER_AD_CAMPAIGNS' | 'LAST_WORKSPACE';
export type BlockerItem = { id: string; name: string };
export type DeletionBlocker = { code: BlockerCode; message: string; items?: BlockerItem[] };

/** Campanha publicada num canal que ainda pode estar gastando (o serviço já filtrou pelo status de veiculação). */
export type LiveCampaign = { id: string; name: string; channel: 'meta' | 'google' | 'tiktok' };

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
};

/**
 * Publicada e NÃO pausada em cada canal. Olha o status de veiculação, não o `status` da campanha: "Encerrar" deixa `finished` com
 * `meta_delivery_status = 'ACTIVE'` quando a pausa na Meta falha (a campanha continua gastando). Status vazio com id publicado também
 * conta como ligada — não dá para provar que parou. Pausado: Meta/Google `PAUSED`, TikTok `DISABLE`.
 */
export function liveCampaigns(rows: CampaignChannels[]): LiveCampaign[] {
  return rows.flatMap((c): LiveCampaign[] => {
    const out: LiveCampaign[] = [];
    if (c.meta_campaign_id && c.meta_delivery_status !== 'PAUSED') out.push({ id: c.id, name: c.name, channel: 'meta' });
    if (c.google_campaign_id && c.google_status !== 'PAUSED') out.push({ id: c.id, name: c.name, channel: 'google' });
    if (c.tiktok_campaign_id && c.tiktok_status !== 'DISABLE') out.push({ id: c.id, name: c.name, channel: 'tiktok' });
    return out;
  });
}

/** Compara o nome digitado com o atual (espaços nas pontas não contam; maiúsculas contam). */
export function confirmNameMatches(typed: string | null | undefined, current: string): boolean {
  const t = (typed ?? '').trim();
  return t.length > 0 && t === current.trim();
}

const names = (items: BlockerItem[]) => items.map((i) => i.name.trim() || 'Campanha sem nome').join(', ');

/**
 * Bloqueios, na ordem em que a tela mostra. `memberships` = em quantas empresas o usuário é membro (qualquer papel), contando esta.
 * - Anúncio publicado e não pausado: apagar a empresa apaga os ids e as credenciais do canal — ninguém mais conseguiria pausar pelo app.
 * - Última empresa: o app não tem tela para "nenhuma empresa".
 */
export function deletionBlockers(input: { live: LiveCampaign[]; memberships: number }): DeletionBlocker[] {
  const out: DeletionBlocker[] = [];
  const meta = input.live.filter((c) => c.channel === 'meta').map(({ id, name }) => ({ id, name }));
  if (meta.length) {
    out.push({
      code: 'LIVE_META_CAMPAIGNS',
      message: `${meta.length === 1 ? 'Esta campanha ainda está ligada' : 'Estas campanhas ainda estão ligadas'} na Meta: ${names(meta)}. Encerre a campanha (ou pause na Meta) antes de apagar a empresa.`,
      items: meta,
    });
  }
  const other = input.live.filter((c) => c.channel !== 'meta');
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
