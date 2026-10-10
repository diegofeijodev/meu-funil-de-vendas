import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  children: ReactNode;
  /** Quando muda (ex.: id/versão da estratégia), a seção tenta renderizar de novo. */
  resetKey?: unknown;
  /** Ação do botão "Regenerar estratégia"; sem ela, mostra só a mensagem. */
  onRegenerate?: (() => void | Promise<void>) | undefined;
  regenerating?: boolean | undefined;
};

type State = { error: Error | null };

/** Isola uma seção da página: se ela quebrar ao renderizar, o resto continua funcionando. */
export class SectionErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[SectionErrorBoundary]", error, info.componentStack);
  }

  override componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  override render() {
    if (!this.state.error) return this.props.children;
    const { onRegenerate, regenerating } = this.props;
    return (
      <div className="flex flex-col items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">
        <p className="flex items-center gap-2 font-medium">
          <AlertTriangle className="size-4 text-destructive" />
          Não foi possível exibir esta parte
        </p>
        {onRegenerate && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => void onRegenerate()}
            disabled={regenerating}
          >
            <Sparkles className="mr-1 size-3.5" />
            {regenerating ? "Gerando (até 1 min)..." : "Regenerar estratégia"}
          </Button>
        )}
      </div>
    );
  }
}
