import { Injectable } from '@nestjs/common';
import type { PilotStep, StepResult } from '../pilot-runner.service';
import { optionsOf, type PilotRunRow } from '../pilot.types';

/** F3: o anúncio ainda não é montado pelo piloto (vem na F4, sempre pausado). A etapa só registra o motivo. */
@Injectable()
export class MetaStep implements PilotStep {
  async run(run: Pick<PilotRunRow, 'options'>): Promise<StepResult> {
    return optionsOf(run).meta?.enabled
      ? { kind: 'skipped', note: 'A montagem do anúncio na Meta entra na próxima etapa do piloto.' }
      : { kind: 'skipped', note: 'Anúncio na Meta desligado no pacote.' };
  }
}
