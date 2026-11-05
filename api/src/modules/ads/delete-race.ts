import { Logger } from '@nestjs/common';

/**
 * A campanha (ou a empresa inteira, "Apagar empresa") sumiu do banco enquanto o app falava com um canal de anúncios. Fica no log de
 * erro, com o id EXTERNO, para alguém conferir no canal: `paused` = a compensação pausou o que tinha acabado de ser ligado;
 * `pause_failed` = ligado e a pausa falhou (precisa pausar à mão no canal); `created_paused` = criada pausada (não gasta; sobra no canal).
 */
export type DeleteRace = {
  channel: 'meta' | 'google' | 'tiktok';
  action: 'activate' | 'activate_ad' | 'create';
  workspace_id: string;
  campaign_id: string;
  external_id: string | null;
  outcome: 'paused' | 'pause_failed' | 'created_paused';
  detail?: string;
};

export function logDeleteRace(logger: Logger, race: DeleteRace): void {
  logger.error(`[workspace-delete-race] ${JSON.stringify(race)}`);
}
