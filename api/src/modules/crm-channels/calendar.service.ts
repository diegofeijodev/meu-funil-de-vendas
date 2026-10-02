import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/database/prisma.service';
import { ChannelHttp, ChannelSecrets } from './channel-http';
import { UserFacingError } from './channel-errors';
import { TZ } from './channel-common';

/** Agenda do SDR pelo Cal.com (porte de `crm/calendar.server.ts`): horários livres reais e reserva confirmada. */
@Injectable()
export class CalendarService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly http: ChannelHttp,
    private readonly secrets: ChannelSecrets,
  ) {}

  private integration(workspaceId: string) {
    return this.prisma.crm_integrations.findFirst({ where: { workspace_id: workspaceId, kind: 'calendar', status: 'connected' } });
  }

  private async key(workspaceId: string) {
    const key = await this.secrets.get(workspaceId, 'CALCOM_API_KEY');
    if (!key) throw new UserFacingError('Chave do Cal.com (CALCOM_API_KEY) não configurada.');
    return key;
  }

  private eventTypeId(integration: { config: unknown } | null): number {
    return Number((integration?.config as { event_type_id?: string } | undefined)?.event_type_id ?? 0);
  }

  /** Próximos horários livres (ISO) do tipo de evento, espalhados pelos dias. */
  async availableSlots(workspaceId: string, days = 5, max = 8): Promise<string[]> {
    const integration = await this.integration(workspaceId);
    const eventTypeId = this.eventTypeId(integration);
    if (!integration || !eventTypeId) return [];
    const key = await this.key(workspaceId);
    const qs = new URLSearchParams({
      eventTypeId: String(eventTypeId),
      start: new Date(Date.now() + 2 * 3600e3).toISOString(),
      end: new Date(Date.now() + days * 86400e3).toISOString(),
      timeZone: TZ,
    });
    const res = await this.http.request(`${this.http.calBase}/slots?${qs}`, { headers: { Authorization: `Bearer ${key}`, 'cal-api-version': '2024-09-04' } });
    if (!res.ok) throw new Error(`Cal.com [${res.status}]: ${res.text.slice(0, 200)}`);
    const j = JSON.parse(res.text || '{}') as { data?: Record<string, ({ start: string } | string)[]> };
    const all = Object.values(j.data ?? {}).flat().map((s) => (typeof s === 'string' ? s : s.start)).filter(Boolean);
    const byDay = new Map<string, string[]>();
    for (const s of all) {
      const d = s.slice(0, 10);
      byDay.set(d, [...(byDay.get(d) ?? []), s]);
    }
    const out: string[] = [];
    for (const list of byDay.values()) {
      out.push(...[list[0], list[Math.floor(list.length / 2)]].filter((x): x is string => !!x));
      if (out.length >= max) break;
    }
    return [...new Set(out)].slice(0, max);
  }

  formatSlot(iso: string): string {
    return new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, weekday: 'long', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
  }

  /** Cria a reserva no Cal.com (o convite chega por e-mail para o lead e para o responsável). */
  async bookSlot(workspaceId: string, input: { start: string; name: string; email: string; phone?: string | null }): Promise<{ uid: string | null; start: string; url: string | null }> {
    const integration = await this.integration(workspaceId);
    const eventTypeId = this.eventTypeId(integration);
    if (!integration || !eventTypeId) throw new UserFacingError('Agenda não configurada.');
    const key = await this.key(workspaceId);
    const res = await this.http.request(`${this.http.calBase}/bookings`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'cal-api-version': '2024-08-13', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        start: input.start,
        eventTypeId,
        attendee: { name: input.name, email: input.email, timeZone: TZ, language: 'pt', ...(input.phone ? { phoneNumber: input.phone } : {}) },
      }),
    });
    if (!res.ok) throw new Error(`Cal.com [${res.status}]: ${res.text.slice(0, 300)}`);
    const j = JSON.parse(res.text || '{}') as { data?: { uid?: string; start?: string; meetingUrl?: string; location?: string } };
    return { uid: j.data?.uid ?? null, start: j.data?.start ?? input.start, url: j.data?.meetingUrl ?? j.data?.location ?? null };
  }

  async test(workspaceId: string, eventTypeId: string): Promise<{ title: string; minutes: number | null }> {
    const key = await this.key(workspaceId);
    const res = await this.http.request(`${this.http.calBase}/event-types/${encodeURIComponent(eventTypeId)}`, { headers: { Authorization: `Bearer ${key}`, 'cal-api-version': '2024-06-14' } });
    if (!res.ok) throw new UserFacingError(`Cal.com recusou (HTTP ${res.status}). Confira a chave e o ID do tipo de evento.`);
    const j = JSON.parse(res.text || '{}') as { data?: { title?: string; lengthInMinutes?: number } };
    return { title: j.data?.title ?? 'Evento', minutes: j.data?.lengthInMinutes ?? null };
  }
}
