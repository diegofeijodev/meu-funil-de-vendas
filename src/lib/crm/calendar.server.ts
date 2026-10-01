/**
 * Agenda do SDR (somente servidor) pelo Cal.com: horários livres reais e reserva confirmada.
 * Chave por empresa (CALCOM_API_KEY em CRM → Integrações) e o tipo de evento configurado.
 */
import { admin, workspaceSecret, type Integration } from "./integrations.server";

const BASE = "https://api.cal.com/v2";
const TZ = "America/Sao_Paulo";

export async function calendarIntegration(workspaceId: string) {
  const db = await admin();
  const { data } = await db
    .from("crm_integrations")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("kind", "calendar")
    .eq("status", "connected")
    .maybeSingle();
  return (data as unknown as Integration | null) ?? null;
}

async function auth(workspaceId: string) {
  const key = await workspaceSecret(workspaceId, "CALCOM_API_KEY");
  if (!key) throw new Error("Chave do Cal.com (CALCOM_API_KEY) não configurada.");
  return key;
}

/** Próximos horários livres (ISO) do tipo de evento. */
export async function availableSlots(workspaceId: string, days = 5, max = 8): Promise<string[]> {
  const integration = await calendarIntegration(workspaceId);
  const eventTypeId = Number((integration?.config as { event_type_id?: string } | undefined)?.event_type_id ?? 0);
  if (!integration || !eventTypeId) return [];
  const key = await auth(workspaceId);
  const start = new Date(Date.now() + 2 * 3600e3);
  const end = new Date(Date.now() + days * 86400e3);
  const qs = new URLSearchParams({
    eventTypeId: String(eventTypeId),
    start: start.toISOString(),
    end: end.toISOString(),
    timeZone: TZ,
  });
  const res = await fetch(`${BASE}/slots?${qs}`, {
    headers: { Authorization: `Bearer ${key}`, "cal-api-version": "2024-09-04" },
  });
  if (!res.ok) throw new Error(`Cal.com [${res.status}]: ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as { data?: Record<string, ({ start: string } | string)[]> };
  const all = Object.values(j.data ?? {})
    .flat()
    .map((s) => (typeof s === "string" ? s : s.start))
    .filter(Boolean);
  // Espalha as opções ao longo dos dias em vez de oferecer só a manhã do primeiro dia.
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

export function formatSlot(iso: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: TZ,
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

/** Cria a reserva no Cal.com (o convite chega por e-mail para o lead e para o responsável). */
export async function bookSlot(
  workspaceId: string,
  input: { start: string; name: string; email: string; phone?: string | null },
) {
  const integration = await calendarIntegration(workspaceId);
  const eventTypeId = Number((integration?.config as { event_type_id?: string } | undefined)?.event_type_id ?? 0);
  if (!integration || !eventTypeId) throw new Error("Agenda não configurada.");
  const key = await auth(workspaceId);
  const res = await fetch(`${BASE}/bookings`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "cal-api-version": "2024-08-13", "Content-Type": "application/json" },
    body: JSON.stringify({
      start: input.start,
      eventTypeId,
      attendee: {
        name: input.name,
        email: input.email,
        timeZone: TZ,
        language: "pt",
        ...(input.phone ? { phoneNumber: input.phone } : {}),
      },
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Cal.com [${res.status}]: ${text.slice(0, 300)}`);
  const j = JSON.parse(text) as { data?: { uid?: string; start?: string; meetingUrl?: string; location?: string } };
  return { uid: j.data?.uid ?? null, start: j.data?.start ?? input.start, url: j.data?.meetingUrl ?? j.data?.location ?? null };
}

export async function testCalendar(workspaceId: string, eventTypeId: string) {
  const key = await auth(workspaceId);
  const res = await fetch(`${BASE}/event-types/${encodeURIComponent(eventTypeId)}`, {
    headers: { Authorization: `Bearer ${key}`, "cal-api-version": "2024-06-14" },
  });
  if (!res.ok) throw new Error(`Cal.com recusou (HTTP ${res.status}). Confira a chave e o ID do tipo de evento.`);
  const j = (await res.json()) as { data?: { title?: string; lengthInMinutes?: number } };
  return { title: j.data?.title ?? "Evento", minutes: j.data?.lengthInMinutes ?? null };
}
