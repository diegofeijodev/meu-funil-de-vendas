"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertOctagon, AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, ExternalLink, Instagram, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { aiKeysTest } from "@/lib/ai-keys.functions";
import {
  AI_BACK_MESSAGE,
  aiAlertText,
  instagramAlertText,
  META_SYSTEM_USERS_URL,
  OPEN_PUBLISHING_STEPS,
  PUBLISHING_ALERT_ID,
  PUBLISH_BACK,
  PUBLISH_TEST_ERROR,
  PUBLISH_TEST_LABEL,
  PUBLISH_TESTING,
  PUBLISH_TOKEN_NOTE,
  PUBLISH_VIEWER_NOTE,
  publishingAlertText,
  showInstagramFailAlert,
  stillBlockedText,
  TEST_AGAIN_LABEL,
  type AiCreditAlert,
  type AiVendor,
  type InstagramFailAlert,
  type PublishingAlert,
} from "@/lib/health-alerts";
import { usePathname } from "next/navigation";
import { Link, useNavigate } from "@/lib/router";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace";
import { useFeatures } from "@/modules/features/infrastructure/features.api";
import { healthAlertsKey, publishCheck, useHealthAlerts } from "@/modules/health-alerts/infrastructure/health-alerts.api";
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
  const { workspaceId, canEdit } = useWorkspace();
  const { data } = useHealthAlerts(workspaceId);
  const { data: features } = useFeatures(workspaceId);
  const pathname = usePathname();
  // "Voltou" fica verde no lugar até "Fechar" ou até mudar de tela (UI §1.3 C), mesmo depois de a API parar de devolver o bloqueio.
  const [backOn, setBackOn] = useState<string | null>(null);
  const back = backOn !== null && backOn === `${workspaceId}${pathname}`;
  const publishing = data?.publishing ?? null;
  const showIg = !!data && showInstagramFailAlert(data);
  if (!workspaceId || !data || (!data.ai && !showIg && !publishing && !back)) return null;
  return (
    <div className="mb-6 flex flex-col gap-3">
      {back ? (
        <PublishingBackBanner onClose={() => setBackOn(null)} />
      ) : (
        publishing && (
          <PublishingBanner
            p={publishing}
            workspaceId={workspaceId}
            canEdit={canEdit}
            onBack={() => setBackOn(`${workspaceId}${pathname}`)}
          />
        )
      )}
      {data.ai && <AiCreditBanner ai={data.ai} workspaceId={workspaceId} vacancyStories={!!features?.vacancy_stories} publishingBlocked={!!publishing} />}
      {showIg && data.instagram && <InstagramFailBanner ig={data.instagram} />}
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

function AiCreditBanner({ ai, workspaceId, vacancyStories, publishingBlocked }: { ai: AiCreditAlert; workspaceId: string; vacancyStories: boolean; publishingBlocked: boolean }) {
  const qc = useQueryClient();
  const [testing, setTesting] = useState(false);
  const t = aiAlertText(ai, { vacancyStories, publishingBlocked });
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

/**
 * Faixa vermelha "O Instagram parou de aceitar as publicações" (UI 24/11 §1): curta em todas as telas; os 5 passos abrem no lugar.
 * Permissão: "Já corrigi — testar agora" (quem edita; 1 por minuto): a API cria um story de teste na Meta, sem publicar. Token: o botão
 * leva à reconexão.
 */
function PublishingBanner({ p, workspaceId, canEdit, onBack }: { p: PublishingAlert; workspaceId: string; canEdit: boolean; onBack: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const t = publishingAlertText(p, new Date());
  const [open, setOpen] = useState(false);
  const [testing, setTesting] = useState(false);
  const [blockedUntil, setBlockedUntil] = useState<number | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const stepsId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);

  // "Ver como resolver" da aba Vagas: abre os passos e põe o foco no título.
  useEffect(() => {
    const onOpen = () => {
      setOpen(true);
      titleRef.current?.focus();
    };
    window.addEventListener(OPEN_PUBLISHING_STEPS, onOpen);
    return () => window.removeEventListener(OPEN_PUBLISHING_STEPS, onOpen);
  }, []);
  // O botão volta depois de 60 s (limite da API), sem contagem regressiva.
  useEffect(() => {
    if (blockedUntil === null) return;
    const id = window.setTimeout(() => setBlockedUntil(null), Math.max(0, blockedUntil - Date.now()));
    return () => window.clearTimeout(id);
  }, [blockedUntil]);

  const reconnect = () => navigate({ to: "/instagram", search: { tab: "overview" } });
  const test = async () => {
    setTesting(true);
    setResult(null);
    try {
      const r = await publishCheck(workspaceId);
      if (r.unblocked) {
        onBack();
        await qc.invalidateQueries({ queryKey: healthAlertsKey(workspaceId) });
        return;
      }
      setBlockedUntil(Date.now() + 60_000);
      setResult(stillBlockedText(new Date(), r.message, r.next_check_at));
      await qc.invalidateQueries({ queryKey: healthAlertsKey(workspaceId) });
    } catch (e) {
      setResult(apiErrorMessage(e, PUBLISH_TEST_ERROR));
      await qc.invalidateQueries({ queryKey: healthAlertsKey(workspaceId) });
    } finally {
      setTesting(false);
    }
  };

  const primary =
    t.mode === "permission" ? (
      canEdit ? (
        <Button variant="destructive" className={ACTION} onClick={test} disabled={testing || blockedUntil !== null}>
          {testing ? <Loader2 className="animate-spin" aria-hidden /> : <RefreshCw aria-hidden />}
          {testing ? PUBLISH_TESTING : PUBLISH_TEST_LABEL}
        </Button>
      ) : null
    ) : (
      <Button variant="destructive" className={ACTION} onClick={reconnect}>
        Reconectar o Instagram
      </Button>
    );

  return (
    <section id={PUBLISHING_ALERT_ID} role="alert" className="scroll-mt-4 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-4 text-sm shadow-sm">
      <div className="flex items-start gap-3">
        <AlertOctagon className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden />
        <div className="min-w-0 flex-1 space-y-2">
          <h2 ref={titleRef} tabIndex={-1} className="font-display text-base font-bold leading-snug outline-none">
            {t.title}
          </h2>
          <p className="leading-relaxed">{t.body}</p>
          {t.mode !== "token" && (
            <Button
              variant="outline"
              className={ACTION}
              aria-expanded={open}
              aria-controls={stepsId}
              onClick={() => setOpen((v) => !v)}
            >
              {open ? "Esconder os passos" : "Como resolver (5 passos)"}
              {open ? <ChevronUp aria-hidden /> : <ChevronDown aria-hidden />}
            </Button>
          )}
          {open && t.mode !== "token" && (
            <div id={stepsId} className="space-y-3 rounded-md bg-background/60 p-3">
              <p>{t.intro}</p>
              <ol className="space-y-3">
                {t.steps.map((step, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="font-semibold" aria-hidden>{i + 1}</span>
                    <div className="min-w-0 space-y-2">
                      <p className="break-words [overflow-wrap:anywhere]">{step}</p>
                      {i === 0 && (
                        <Button asChild variant="outline" className={ACTION}>
                          <a href={META_SYSTEM_USERS_URL} target="_blank" rel="noopener noreferrer" aria-label="Abrir Usuários do sistema no Meta Business, em outra aba">
                            Abrir Usuários do sistema
                            <ExternalLink aria-hidden />
                          </a>
                        </Button>
                      )}
                      {i === 3 && (
                        <Button asChild variant="outline" className={ACTION}>
                          <Link to="/integrations">Abrir Integrações</Link>
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
              <p className="break-words text-muted-foreground [overflow-wrap:anywhere]">{t.note}</p>
            </div>
          )}
          <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:flex-wrap">{primary}</div>
          <div aria-live="polite" className="space-y-1">
            {testing && <p className="sr-only">{PUBLISH_TESTING}</p>}
            {result && (
              <p className="flex items-start gap-2 leading-relaxed">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                {result}
              </p>
            )}
          </div>
          {t.mode === "permission" && !canEdit && <p className="leading-relaxed text-muted-foreground">{PUBLISH_VIEWER_NOTE}</p>}
          {t.mode === "token" && <p className="leading-relaxed text-muted-foreground">{PUBLISH_TOKEN_NOTE}</p>}
          {t.nextCheck && <p className="leading-relaxed text-muted-foreground">{t.nextCheck}</p>}
        </div>
      </div>
    </section>
  );
}

/** "Voltou": a faixa fica verde no lugar até "Fechar" (UI §1.3 C). */
function PublishingBackBanner({ onClose }: { onClose: () => void }) {
  return (
    <section role="status" aria-live="polite" className="rounded-lg border border-success/50 bg-success/10 px-4 py-4 text-sm shadow-sm">
      <div className="flex items-start gap-3">
        <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
        <div className="min-w-0 flex-1 space-y-2">
          <h2 className="font-display text-base font-bold leading-snug">{PUBLISH_BACK.title}</h2>
          <p className="leading-relaxed">{PUBLISH_BACK.body}</p>
          <div className="flex flex-col gap-2 pt-1 sm:flex-row">
            <Button variant="outline" className={ACTION} onClick={onClose}>
              Fechar
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
