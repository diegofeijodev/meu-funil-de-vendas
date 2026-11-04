"use client";

import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertOctagon, AlertTriangle, ExternalLink, Instagram, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { aiKeysTest } from "@/lib/ai-keys.functions";
import {
  AI_BACK_MESSAGE,
  aiAlertText,
  instagramAlertText,
  TEST_AGAIN_LABEL,
  type AiCreditAlert,
  type AiVendor,
  type InstagramFailAlert,
} from "@/lib/health-alerts";
import { useNavigate } from "@/lib/router";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace";
import { useFeatures } from "@/modules/features/infrastructure/features.api";
import { healthAlertsKey, useHealthAlerts } from "@/modules/health-alerts/infrastructure/health-alerts.api";
import { apiErrorMessage } from "@/modules/shared/infrastructure/http";

const LABEL: Record<AiVendor, string> = { openai: "ChatGPT (OpenAI)", gemini: "Gemini (Google)" };
/** Botões grandes no celular (uma coluna, largura toda) e normais a partir do `sm`. */
const ACTION = "h-11 w-full sm:h-9 sm:w-auto";

/**
 * Faixa de avisos da empresa atual, no topo de todas as telas logadas (contrato §30). Sem estado no navegador: o aviso some
 * sozinho quando a API para de devolvê-lo. Carregando, sem aviso ou com erro na consulta = nada aparece (a faixa é auxiliar;
 * a consulta tenta de novo no próximo ciclo de 5 min).
 */
export function HealthAlertsBanner() {
  const { workspaceId } = useWorkspace();
  const { data } = useHealthAlerts(workspaceId);
  const { data: features } = useFeatures(workspaceId);
  if (!workspaceId || !data || (!data.ai && !data.instagram)) return null;
  return (
    <div className="mb-6 flex flex-col gap-3">
      {data.ai && <AiCreditBanner ai={data.ai} workspaceId={workspaceId} vacancyStories={!!features?.vacancy_stories} />}
      {data.instagram && <InstagramFailBanner ig={data.instagram} />}
    </div>
  );
}

function Shell({ tone, children }: { tone: "danger" | "warning"; children: ReactNode }) {
  return (
    <section
      role={tone === "danger" ? "alert" : "status"}
      className={cn(
        "rounded-lg border px-4 py-4 text-sm shadow-sm",
        tone === "danger" ? "border-destructive/50 bg-destructive/10" : "border-warning/50 bg-warning/10",
      )}
    >
      {children}
    </section>
  );
}

function AiCreditBanner({ ai, workspaceId, vacancyStories }: { ai: AiCreditAlert; workspaceId: string; vacancyStories: boolean }) {
  const qc = useQueryClient();
  const [testing, setTesting] = useState(false);
  const t = aiAlertText(ai, { vacancyStories });
  const Icon = t.tone === "danger" ? AlertOctagon : AlertTriangle;

  // Qualquer membro pode testar (o `ai-keys-test` é de leitura); o resultado atualiza o aviso na API.
  const testNow = async () => {
    setTesting(true);
    try {
      const failures: string[] = [];
      for (const vendor of t.testVendors) {
        const r = await aiKeysTest({ data: { workspaceId, vendor } });
        if (!r.ok) failures.push(`${LABEL[vendor]}: ${r.error ?? "não respondeu."}`);
      }
      if (failures.length) toast.error(failures.join(" "));
      else toast.success(AI_BACK_MESSAGE);
    } catch (e) {
      toast.error(apiErrorMessage(e, "Não foi possível testar agora."));
    } finally {
      setTesting(false);
      await Promise.all([
        qc.invalidateQueries({ queryKey: healthAlertsKey(workspaceId) }),
        qc.invalidateQueries({ queryKey: ["ai-keys-health", workspaceId] }),
        qc.invalidateQueries({ queryKey: ["setup-status", workspaceId] }),
      ]);
    }
  };

  return (
    <Shell tone={t.tone}>
      <div className="flex items-start gap-3">
        <Icon className={cn("mt-0.5 size-5 shrink-0", t.tone === "danger" ? "text-destructive" : "text-warning")} aria-hidden />
        <div className="min-w-0 flex-1 space-y-2">
          <h2 className="font-display text-base font-bold leading-snug">{t.title}</h2>
          <p className="leading-relaxed">{t.body}</p>
          {t.inherited && <p className="leading-relaxed text-muted-foreground">{t.inherited}</p>}
          <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:flex-wrap">
            {t.links.map((l) => (
              <Button key={l.vendor} asChild variant={t.tone === "danger" ? "destructive" : "default"} className={ACTION}>
                <a href={l.href} target="_blank" rel="noopener noreferrer">
                  {l.label}
                  <ExternalLink aria-hidden />
                </a>
              </Button>
            ))}
            <Button variant="outline" className={ACTION} onClick={testNow} disabled={testing}>
              <RefreshCw className={cn(testing && "animate-spin")} aria-hidden />
              {testing ? "Testando…" : TEST_AGAIN_LABEL}
            </Button>
          </div>
        </div>
      </div>
    </Shell>
  );
}

function InstagramFailBanner({ ig }: { ig: InstagramFailAlert }) {
  const navigate = useNavigate();
  const t = instagramAlertText(ig);
  return (
    <Shell tone="warning">
      <div className="flex items-start gap-3">
        <Instagram className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
        <div className="min-w-0 flex-1 space-y-2">
          <h2 className="font-display text-base font-bold leading-snug">{t.title}</h2>
          {t.reason && <p className="break-words leading-relaxed">{t.reason}</p>}
          {t.permission && <p className="leading-relaxed">{t.permission}</p>}
          <div className="flex flex-col gap-2 pt-1 sm:flex-row">
            <Button variant="outline" className={ACTION} onClick={() => navigate({ to: "/instagram" })}>
              Ver posts
            </Button>
          </div>
        </div>
      </div>
    </Shell>
  );
}
