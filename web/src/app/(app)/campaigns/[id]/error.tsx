"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Link } from "@/lib/router";
import { Button } from "@/components/ui/button";

/** Erro ao abrir a campanha: mensagem amigável no lugar da tela genérica "This page didn't load". */
export default function CampaignError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[campaign-detail]", error);
  }, [error]);

  return (
    <div className="panel mx-auto mt-10 flex max-w-lg flex-col items-center gap-4 p-8 text-center">
      <AlertTriangle className="size-8 text-destructive" />
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Não foi possível abrir esta campanha</h2>
        <p className="text-sm text-muted-foreground">
          A campanha continua salva — só a exibição falhou. Tente de novo ou volte para a lista.
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <Button variant="outline" onClick={reset}>Tentar de novo</Button>
        <Button asChild>
          <Link to="/campaigns">Voltar para campanhas</Link>
        </Button>
      </div>
    </div>
  );
}
