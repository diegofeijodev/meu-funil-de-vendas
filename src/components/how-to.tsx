import { useState } from "react";
import { BookOpen, ChevronDown, ExternalLink } from "lucide-react";

export type HowToStep = string | { text: string; link?: { label: string; url: string } };

/**
 * "Como fazer": passos numerados, links diretos e referências oficiais.
 * Usado em todas as telas de conexão e nos módulos (Fase 8).
 */
export function HowTo({
  title = "Passo a passo",
  steps,
  references = [],
  defaultOpen = false,
}: {
  title?: string;
  steps: HowToStep[];
  references?: { label: string; url: string }[];
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg border border-border/70 bg-surface/40">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm font-medium"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="flex items-center gap-2">
          <BookOpen className="size-4 text-primary" />
          {title}
        </span>
        <ChevronDown className={`size-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="space-y-3 border-t border-border/60 px-3 py-3 text-sm">
          <ol className="list-decimal space-y-1.5 pl-5 text-muted-foreground">
            {steps.map((s, i) => {
              const step = typeof s === "string" ? { text: s } : s;
              return (
                <li key={i}>
                  {step.text}
                  {step.link && (
                    <>
                      {" "}
                      <a href={step.link.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-primary underline">
                        {step.link.label}
                        <ExternalLink className="size-3" />
                      </a>
                    </>
                  )}
                </li>
              );
            })}
          </ol>
          {references.length > 0 && (
            <div className="text-xs text-muted-foreground">
              Referências:{" "}
              {references.map((r, i) => (
                <span key={r.url}>
                  {i > 0 && " · "}
                  <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-primary underline">
                    {r.label}
                  </a>
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
