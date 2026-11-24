import { addDays } from '../../common/time/dates';
import type { PrismaService } from '../../common/database/prisma.service';
import type { VacancySourceId } from './vacancy-types';

/**
 * Posts de vaga de um tipo (vagas fixas, 25/11/2026): pela LINHA ligada ao post (`vacancy_stories.source`, filtro de relação = `EXISTS`),
 * nunca por caminho JSON (o `NOT` num caminho ausente vira NULL e sumiria com os posts antigos). Diária = sem linha CLT: os posts de antes
 * deste lote (e os sem linha) contam como diária.
 */
export function postKindFilter(kind: VacancySourceId) {
  return kind === 'freela_clt'
    ? { vacancy_story: { is: { source: 'freela_clt' } } }
    : { NOT: { vacancy_story: { is: { source: 'freela_clt' } } } };
}

/** Posts de vaga que contam no "stories de vaga do dia" (o limite por dia vale também para os que ainda vão ao ar). */
export const DAY_COUNT_STATUSES = ['pending_approval', 'approved', 'ready', 'scheduled', 'publishing', 'published'];

/** Início do dia `YYYY-MM-DD` de Brasília (UTC−3 fixo, sem horário de verão desde 2019). */
const spDayStart = (day: string) => new Date(`${day}T00:00:00-03:00`);

/**
 * Stories de vaga do dia `day` (Brasília) de uma empresa, do tipo `kind` (diárias, o padrão, ou vagas fixas — cada um tem o seu limite), pela data de `published_at ?? scheduled_at ?? created_at`: `posted` =
 * publicados; `scheduled` = os que ainda vão ao ar (esperando aprovação, aprovados, prontos, agendados, publicando).
 * ÚNICA regra de "stories de vaga do dia": a tela ("Hoje: X postados de Y") e o limite por dia (Task 10) chamam esta função.
 * `exceptPostId`: o post que está sendo agendado não conta contra ele mesmo (pronto/aprovado ele já conta pelo `created_at`).
 */
export async function countVacancyStoriesOnDay(
  prisma: Pick<PrismaService, 'ig_posts'>,
  workspaceId: string,
  day: string,
  exceptPostId?: string,
  kind: VacancySourceId = 'freela',
): Promise<{ posted: number; scheduled: number }> {
  const range = { gte: spDayStart(day), lt: spDayStart(addDays(day, 1)) };
  const rows = await prisma.ig_posts.findMany({
    where: {
      workspace_id: workspaceId,
      source: 'vacancy',
      ...postKindFilter(kind),
      status: { in: DAY_COUNT_STATUSES },
      ...(exceptPostId ? { id: { not: exceptPostId } } : {}),
      OR: [
        { published_at: range },
        { published_at: null, scheduled_at: range },
        { published_at: null, scheduled_at: null, created_at: range },
      ],
    },
    select: { status: true },
  });
  const posted = rows.filter((r) => r.status === 'published').length;
  return { posted, scheduled: rows.length - posted };
}
