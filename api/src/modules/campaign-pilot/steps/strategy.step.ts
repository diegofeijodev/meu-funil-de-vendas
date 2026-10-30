import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service';
import { StrategistService } from '../../strategist/strategist.service';
import type { PilotStep, StepResult } from '../pilot-runner.service';
import type { PilotRunRow } from '../pilot.types';

/** `planning`: monta o plano pelo caminho de sempre. Versão gravada depois de a execução nascer = já feito (não gera de novo). */
@Injectable()
export class StrategyStep implements PilotStep {
  constructor(
    private readonly prisma: PrismaService,
    private readonly strategist: StrategistService,
  ) {}

  async run(run: PilotRunRow): Promise<StepResult> {
    const made = await this.prisma.campaign_strategies.findFirst({
      where: { workspace_id: run.workspace_id, campaign_id: run.campaign_id, created_at: { gte: run.created_at } },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const version = made?.version ?? (await this.strategist.generateAsSystem(run.workspace_id, run.campaign_id)).version;
    return { kind: 'done', ref: String(version), note: `Plano versão ${version}` };
  }
}
