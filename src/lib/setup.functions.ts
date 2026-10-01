import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { requireRole } from "@/lib/membership";

export type SetupItem = {
  key: string;
  group: "Começo" | "Conexões" | "CRM" | "Agendadores";
  label: string;
  status: "ok" | "pending" | "error" | "optional";
  detail: string;
  link: string;
  required: boolean;
};

const ago = (iso: string) => {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return min < 60 ? `${min} min` : min < 48 * 60 ? `${Math.round(min / 60)} h` : `${Math.round(min / 1440)} dias`;
};

/** 8.3 + 8.4 Onboarding e "o que falta configurar" desta empresa, com o motivo e onde resolver. */
export const setupStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ workspaceId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireRole(context, data.workspaceId);
    const ws = data.workspaceId;
    const db = context.supabase;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [brands, strategies, published, ig, crm, sdr, stages, beats] = await Promise.all([
      db.from("brands").select("id, description, tone_of_voice, target_audience").eq("workspace_id", ws),
      db.from("campaign_strategies").select("id, status").eq("workspace_id", ws).limit(50),
      db.from("campaigns").select("id").eq("workspace_id", ws).not("meta_campaign_id", "is", null).limit(1),
      db.from("instagram_accounts").select("status, username").eq("workspace_id", ws).maybeSingle(),
      db.from("crm_integrations").select("kind, status, last_error").eq("workspace_id", ws),
      db.from("crm_sdr_agents").select("is_active").eq("workspace_id", ws).maybeSingle(),
      db.from("crm_stages").select("name, is_lost").eq("workspace_id", ws),
      supabaseAdmin.from("cron_heartbeats").select("*"),
    ]);
    const items: SetupItem[] = [];
    const add = (i: SetupItem) => items.push(i);

    // Começo
    const fullBrand = (brands.data ?? []).find((b: any) => b.description && b.tone_of_voice && b.target_audience);
    add({
      key: "brand",
      group: "Começo",
      label: "DNA da marca preenchido",
      status: fullBrand ? "ok" : "pending",
      detail: fullBrand ? "Descrição, público e tom de voz cadastrados." : "Preencha descrição, público-alvo e tom de voz: tudo que a IA cria parte daqui.",
      link: "/brands",
      required: true,
    });
    const approved = (strategies.data ?? []).some((s: any) => s.status === "approved");
    add({
      key: "strategy",
      group: "Começo",
      label: "Primeira estratégia aprovada",
      status: approved ? "ok" : "pending",
      detail: approved ? "Copy, criativos e públicos seguem a estratégia aprovada." : "Crie uma campanha e aprove a estratégia gerada pela IA.",
      link: "/campaigns/new",
      required: true,
    });
    add({
      key: "published",
      group: "Começo",
      label: "Primeira campanha publicada na Meta",
      status: published.data?.length ? "ok" : "pending",
      detail: published.data?.length ? "Já existe campanha na Meta." : "Aprove a campanha e clique em Publicar na Meta (sai pausada).",
      link: "/campaigns",
      required: false,
    });

    // Conexões
    add({
      key: "app-ai",
      group: "Conexões",
      label: "IA do app",
      status: process.env["LOVABLE_API_KEY"] ? "ok" : "error",
      detail: process.env["LOVABLE_API_KEY"] ? "Disponível para estratégia, copy, imagens e SDR." : "LOVABLE_API_KEY não configurada no servidor.",
      link: "/integrations",
      required: true,
    });
    const { getWorkspaceAiKey } = await import("./ai-keys.server");
    const { getLiveConnection } = await import("./mcp-auth.server");
    const [oKey, gKey, higgs, canva] = await Promise.all([
      getWorkspaceAiKey(ws, "openai"),
      getWorkspaceAiKey(ws, "gemini"),
      getLiveConnection(db, ws, "higgsfield").catch(() => null),
      import("./creative/canva.server").then((m) => m.canvaStatus(ws)).then((x) => (x.connected ? { status: "connected" } : null)).catch(() => null),
    ]);
    const own = [oKey && "OpenAI", gKey && "Gemini", higgs?.status === "connected" && "Higgsfield"].filter(Boolean);
    add({
      key: "own-ai",
      group: "Conexões",
      label: "Contas de IA próprias ou da agência",
      status: own.length ? "ok" : "optional",
      detail: own.length ? `Conectadas: ${own.join(", ")}.` : "Opcional: conecte Higgsfield, OpenAI ou Gemini para gerar com a sua conta (sem gastar créditos do app).",
      link: "/integrations",
      required: false,
    });
    add({
      key: "canva",
      group: "Conexões",
      label: "Canva",
      status: canva?.status === "connected" ? "ok" : "optional",
      detail: canva?.status === "connected" ? "Conectado." : "Opcional: envie criativos ao Canva e traga a edição de volta.",
      link: "/integrations",
      required: false,
    });
    const { missingSecrets } = await import("./meta/graph.server");
    const { tokenInfo } = await import("./meta/oauth.server");
    const [missing, token] = await Promise.all([missingSecrets(ws), tokenInfo(ws)]);
    const days = token.expiresAt ? Math.ceil((new Date(token.expiresAt).getTime() - Date.now()) / 86400e3) : null;
    add({
      key: "meta",
      group: "Conexões",
      label: "Meta Ads",
      status: missing.length ? "pending" : days != null && days <= 7 ? "error" : "ok",
      detail: missing.length
        ? `Faltam: ${missing.join(", ")}.`
        : days != null
          ? days <= 0
            ? "O login com Facebook venceu: entre de novo."
            : `Conectado. Login com Facebook vence em ${days} dia(s).`
          : "Conectado com usuário do sistema.",
      link: "/integrations",
      required: true,
    });
    const [{ googleMissing }, { tiktokMissing }] = await Promise.all([import("./ads/google-ads.server"), import("./ads/tiktok-ads.server")]);
    const [gMiss, tMiss] = await Promise.all([googleMissing(ws), tiktokMissing(ws)]);
    for (const [k, label, miss] of [["google-ads", "Google Ads", gMiss], ["tiktok-ads", "TikTok Ads", tMiss]] as const) {
      add({
        key: k,
        group: "Conexões",
        label,
        status: miss.length ? "optional" : "ok",
        detail: miss.length ? `Opcional: anuncie também neste canal. Falta: ${miss.join(", ")}.` : "Conectado.",
        link: "/integrations",
        required: false,
      });
    }
    add({
      key: "instagram",
      group: "Conexões",
      label: "Instagram",
      status: ig.data?.status === "connected" ? "ok" : "pending",
      detail: ig.data?.status === "connected" ? `Conectado${ig.data.username ? `: @${ig.data.username}` : ""}.` : "Conecte a conta profissional para publicar e medir.",
      link: "/instagram",
      required: true,
    });

    // CRM
    const kind = (k: string) => (crm.data ?? []).find((i: any) => i.kind === k) as { status: string; last_error: string | null } | undefined;
    const channel = (k: string, label: string, required: boolean, hint: string) => {
      const i = kind(k);
      add({
        key: `crm-${k}`,
        group: "CRM",
        label,
        status: i?.status === "connected" ? "ok" : i?.status === "error" ? "error" : required ? "pending" : "optional",
        detail: i?.status === "connected" ? "Conectado." : i?.status === "error" ? `Erro: ${i.last_error ?? "veja a integração"}` : hint,
        link: "/crm/integrations",
        required,
      });
    };
    channel("whatsapp", "WhatsApp", true, "Conecte o número para o SDR e as cadências conversarem com os leads.");
    channel("meta_lead_ads", "Formulários da Meta (Lead Ads)", false, "Opcional: leads dos formulários instantâneos entram sozinhos.");
    channel("instagram", "Direct e comentários do Instagram", false, "Opcional: conversas do Instagram viram lead.");
    channel("site_form", "Formulário do site", false, "Opcional: link e código para colar no site.");
    channel("email", "E-mail (Resend)", false, "Opcional: cadências com e-mail de verdade.");
    channel("calendar", "Agenda (Cal.com)", false, "Opcional: o SDR marca reuniões em horários livres reais.");
    add({
      key: "sdr",
      group: "CRM",
      label: "Agente SDR ativo",
      status: sdr.data?.is_active ? "ok" : "pending",
      detail: sdr.data?.is_active ? "Respondendo e qualificando." : "Configure a persona, as perguntas e ative o agente.",
      link: "/crm/settings",
      required: true,
    });
    const norm = (t: string) => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    const names = (stages.data ?? []).map((s: any) => norm(s.name));
    const needed = [
      ["qualificado", "Qualificado"],
      ["agendada", "Reunião agendada"],
    ].filter(([k]) => !names.some((n: string) => n.includes(k!)));
    const hasLost = (stages.data ?? []).some((s: any) => s.is_lost || norm(s.name).includes("perdido"));
    const missingStages = [...needed.map(([, l]) => l), ...(hasLost ? [] : ["Perdido"])];
    add({
      key: "stages",
      group: "CRM",
      label: "Etapas do funil para o SDR",
      status: missingStages.length ? "pending" : "ok",
      detail: missingStages.length ? `Crie as etapas: ${missingStages.join(", ")} (o SDR move o lead pelo nome).` : "Funil pronto para o SDR.",
      link: "/crm/settings",
      required: true,
    });

    // Agendadores
    const beat = new Map(((beats.data ?? []) as { name: string; last_run_at: string; last_status: string; last_detail: string | null }[]).map((b) => [b.name, b]));
    const cron = (name: string, label: string, maxMin: number) => {
      const b = beat.get(name);
      const late = b ? (Date.now() - new Date(b.last_run_at).getTime()) / 60000 > maxMin : true;
      add({
        key: `cron-${name}`,
        group: "Agendadores",
        label,
        status: !b ? "pending" : b.last_status === "error" ? "error" : late ? "error" : "ok",
        detail: !b
          ? "Ainda não rodou. Confira se o domínio do app aponta para a versão publicada e se as migrations foram aplicadas."
          : `Última execução há ${ago(b.last_run_at)}${b.last_status === "error" ? ` com erro: ${b.last_detail ?? ""}` : late ? " (atrasado)" : ""}.`,
        link: "/settings",
        required: false,
      });
    };
    cron("crm-cadences", "Cadências do CRM (a cada 5 min)", 20);
    cron("instagram-queue", "Fila de publicação do Instagram (a cada 5 min)", 20);
    cron("ads-sync", "Resultados da Meta (a cada 3 h)", 4 * 60);
    cron("crm-daily", "Custos diários da Meta (1x por dia)", 26 * 60);
    return { items };
  });
