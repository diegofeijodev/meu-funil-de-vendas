import type { Prisma } from '@prisma/client';
import type { IgFormat } from '../instagram/ig-types';

export type StepName = 'strategy' | 'copies' | 'instagram' | 'creatives' | 'meta';
export type StepStatus = 'pending' | 'running' | 'waiting' | 'done' | 'skipped' | 'blocked' | 'failed';
export type RunStatus = 'planning' | 'running' | 'blocked' | 'done' | 'failed' | 'cancelled';

/** Uma peça do pacote: imagem (com variações e crítico) ou vídeo (assíncrono, termina no `creative-poll-5min`). */
export type Slot = {
  slot: number;
  kind: 'image' | 'video';
  angle: string;
  status: 'pending' | 'waiting' | 'done' | 'failed' | 'skipped';
  job_id?: string | null;
  creative_id?: string | null;
  score?: number | null;
  error?: string | null;
};

export type StepState = {
  status: StepStatus;
  attempts: number;
  error_code?: string | null;
  error?: string | null;
  note?: string | null;
  ref?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  slots?: Slot[];
};

export type Steps = Partial<Record<StepName, StepState>>;

/** "Fotografia" do pacote aprovado. Os campos que mudam gasto/publicação nunca têm padrão no DTO: o web manda explícito. */
export type PilotOptions = {
  max_angles: number;
  images_per_angle: number;
  variations: number;
  videos: number;
  instagram: { enabled: boolean; mode: 'approval' | 'publish'; weekdays: number[]; times: string[]; story_times: string[]; formats: IgFormat[] };
  meta: { enabled: boolean; review_creatives: boolean };
  max_credits: number;
};

/** Etapas depois da aprovação, em ordem. `strategy` roda antes, com a execução em `planning`. */
export const RUN_STEPS: StepName[] = ['copies', 'instagram', 'creatives', 'meta'];

export type PilotRunRow = Prisma.campaign_pilot_runsGetPayload<object>;

export const stepsOf = (run: { steps: unknown }): Steps => (run.steps && typeof run.steps === 'object' ? (run.steps as Steps) : {});
export const optionsOf = (run: { options: unknown }): PilotOptions => run.options as PilotOptions;
