import axios from "axios";
import { z } from "zod";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/modules/shared/infrastructure/http";

const str = z.string().nullish().transform((v) => v ?? null);
const num = z.coerce.number();

const fieldCheck = z.object({ key: z.string(), label: z.string(), ok: z.boolean(), read: str, expected: str }).passthrough();
const attemptLog = z
  .object({
    n: num,
    at: z.string(),
    kind: z.enum(["ai", "fallback_photo", "fallback_plain"]),
    ok: z.boolean(),
    wrong: z.array(z.string()).default([]),
    forbidden: z.array(z.string()).default([]),
    error: str,
  })
  .passthrough();

/** Estado da prévia (`settings.preview`); `{}` = nunca gerou. */
const preview = z
  .object({
    run_id: z.string().optional(),
    status: z.enum(["running", "done", "failed"]).optional(),
    step: z.enum(["art", "check", "fallback"]).optional(),
    attempt: num.optional(),
    started_at: z.string().optional(),
    finished_at: str,
    media_url: str,
    asset_id: str,
    checks: z.array(fieldCheck).default([]),
    attempts: z.array(attemptLog).default([]),
    used_fallback: z.boolean().optional(),
    sample: z.boolean().optional(),
    vacancy: z.object({}).passthrough().nullish().transform((v) => v ?? null),
    error: str,
  })
  .passthrough();
export type VacancyPreview = z.infer<typeof preview>;

const settings = z
  .object({
    enabled: z.boolean(),
    enabled_at: str,
    auto_publish: z.boolean(),
    template: z
      .object({ asset_id: z.string(), url: str, landscape: z.boolean(), texts_count: num })
      .passthrough()
      .nullish()
      .transform((v) => v ?? null),
    template_bg: str,
    cities: z.array(z.string()).default([]),
    daily_cap: num,
    window_start: z.string(),
    window_end: z.string(),
    min_lead_minutes: num,
    vendor: z.enum(["openai", "gemini"]),
    last_poll_at: str,
    last_poll_ok_at: str,
    last_poll_error: str,
    recent_cities: z.array(z.object({ city: z.string(), count: num }).passthrough()).default([]),
    instagram: z.object({ connected: z.boolean(), username: str }).passthrough(),
    today: z.object({ posted: num, scheduled: num, cap: num }).passthrough(),
    pending_approval: num.default(0),
    counts: z.object({ ready: num, to_approve: num }).passthrough(),
    ai_error: str,
    ai_error_at: str,
    preview: preview.default({}),
    recent_outcomes: z.object({ n: num, first_try: num, redone: num, fallback: num, not_posted: num }).passthrough(),
    week: z.object({ total: num, fallback: num }).passthrough(),
  })
  .passthrough();
export type VacancySettings = z.infer<typeof settings>;

const templateResult = settings.extend({ warning: z.enum(["landscape"]).nullish().transform((v) => v ?? null) });
export type VacancyTemplateResult = z.infer<typeof templateResult>;

const story = z
  .object({
    id: z.string(),
    external_id: z.string(),
    status: z.string(),
    display: z.enum(["queued", "generating", "waiting_window", "waiting_cap", "to_approve", "ready", "live", "was_live", "skipped", "cancelled", "failed"]),
    label: z.string(),
    support: str,
    reason: str,
    funcao: z.string(),
    estabelecimento: str,
    contractor_name: str,
    valor: str,
    quando: z.string(),
    cidade: str,
    starts_at: z.string(),
    approve_until: str,
    scheduled_at: str,
    published_at: str,
    permalink: str,
    thumb_url: str,
    media_url: str,
    attempts: num,
    used_fallback: z.boolean(),
    redo_count: num,
    ig_post_id: str,
    is_test: z.boolean(),
    freela_url: z.string(),
    own_art: z.boolean(),
    can: z
      .object({
        approve: z.boolean(),
        dont_post: z.boolean(),
        post_now: z.boolean(),
        create_anyway: z.boolean(),
        redo: z.boolean(),
        retry: z.boolean(),
      })
      .passthrough(),
  })
  .passthrough();
export type VacancyStory = z.infer<typeof story>;

const storyDetail = story.extend({
  checks: z.array(fieldCheck).default([]),
  attempts_log: z.array(attemptLog).default([]),
  alt: z.string(),
});
export type VacancyStoryDetail = z.infer<typeof storyDetail>;

export type VacancyStoryFilter = "all" | "live" | "not_posted";
export type VacancyFeedback = "texto_errado" | "foto_estranha" | "nao_divulgar";
export type VacancySettingsPatch = Partial<{
  cities: string[];
  daily_cap: number;
  window_start: string;
  window_end: string;
  min_lead_minutes: 60 | 120 | 240 | 360;
  vendor: "openai" | "gemini";
}>;

const ok = z.object({ ok: z.literal(true) }).passthrough();
/** Chave da consulta das configurações (compartilhada por aba, cartão, menu e mutações). */
export const vacancySettingsKey = (ws: string | null) => ["vacancy-settings", ws] as const;
const base = (ws: string) => `/v1/workspaces/${ws}/vacancy-stories`;

export async function getVacancySettings(ws: string): Promise<VacancySettings> {
  return settings.parse((await api.get(`${base(ws)}/settings`)).data);
}
export async function patchVacancySettings(ws: string, body: VacancySettingsPatch): Promise<VacancySettings> {
  return settings.parse((await api.patch(`${base(ws)}/settings`, body)).data);
}
export async function enableVacancies(ws: string): Promise<VacancySettings> {
  return settings.parse((await api.post(`${base(ws)}/enable`)).data);
}
export async function disableVacancies(ws: string): Promise<{ cancelled: number }> {
  const { data } = await api.post(`${base(ws)}/disable`);
  return ok.extend({ cancelled: num }).parse(data);
}
export async function setVacancyAutoPublish(ws: string, auto_publish: boolean): Promise<VacancySettings> {
  return settings.parse((await api.post(`${base(ws)}/auto-publish`, { auto_publish })).data);
}
export async function uploadVacancyTemplate(ws: string, file: File): Promise<VacancyTemplateResult> {
  const form = new FormData();
  form.append("file", file, file.name);
  return templateResult.parse((await api.post(`${base(ws)}/template`, form)).data);
}
export async function startVacancyPreview(ws: string): Promise<void> {
  ok.parse((await api.post(`${base(ws)}/preview`)).data);
}
export async function listVacancyStories(ws: string, filter: VacancyStoryFilter = "all"): Promise<VacancyStory[]> {
  const { data } = await api.get(`${base(ws)}/stories`, { params: { filter } });
  return z.array(story).parse(data);
}
export async function getVacancyStory(ws: string, id: string): Promise<VacancyStoryDetail> {
  return storyDetail.parse((await api.get(`${base(ws)}/stories/${id}`)).data);
}
export async function vacancyDontPost(ws: string, id: string, feedback?: VacancyFeedback): Promise<void> {
  ok.parse((await api.post(`${base(ws)}/stories/${id}/dont-post`, feedback ? { feedback } : {})).data);
}
export async function vacancyPostNow(ws: string, id: string): Promise<void> {
  ok.parse((await api.post(`${base(ws)}/stories/${id}/post-now`)).data);
}
export async function vacancyCreateAnyway(ws: string, id: string): Promise<void> {
  ok.parse((await api.post(`${base(ws)}/stories/${id}/create-anyway`)).data);
}
export async function vacancyRedo(ws: string, id: string): Promise<void> {
  ok.parse((await api.post(`${base(ws)}/stories/${id}/redo`)).data);
}

/**
 * Configuração dos stories de vagas. 404 = empresa fora da lista (sem aba "Vagas") → `null`, em silêncio; outro erro sobe.
 * Consulta a cada 30 s só quando a empresa tem a função (não martela uma empresa que responde 404).
 */
export function useVacancySettings(ws: string | null) {
  return useQuery<VacancySettings | null>({
    queryKey: vacancySettingsKey(ws),
    enabled: !!ws,
    retry: false,
    refetchInterval: (q) => (q.state.data ? 30_000 : false),
    queryFn: async () => {
      try {
        return await getVacancySettings(ws!);
      } catch (e) {
        if (axios.isAxiosError(e) && e.response?.status === 404) return null;
        throw e;
      }
    },
  });
}
