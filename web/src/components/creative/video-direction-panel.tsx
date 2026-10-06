"use client";
/* eslint-disable @typescript-eslint/no-explicit-any -- jsonb solto de ig_posts.creative_brief (como no resto do Instagram) */

import { useState } from "react";
import { Clapperboard, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AUDIO_INSTRUCTIONS_MAX, AUDIO_MODES, VIDEO_SCRIPT_MAX, type AudioMode } from "@/lib/instagram/production";

type Shot = { inicio_s: number; fim_s: number; enquadramento: string; acao: string; movimento_camera: string; lente: string };
type Score = { attempt: number; total: number | null; motivo: string | null; error?: string };
const sec = (n: number) => `${String(n).replace(".", ",")}s`;

/** Editor do post em vídeo (Reels/Story): roteiro final editável, tomadas, áudio, nota do crítico e "Regenerar vídeo". */
export function VideoDirectionPanel({
  brief,
  busy,
  onSave,
  onRegenerate,
}: {
  brief: any;
  busy?: boolean;
  onSave: (prompt: string, audio: { modo: AudioMode; instrucoes: string } | null) => void;
  onRegenerate: () => void;
}) {
  const vd = brief?.video_direction ?? {};
  const shots: Shot[] = Array.isArray(vd.direction?.tomadas) ? vd.direction.tomadas : [];
  const scores: Score[] = Array.isArray(vd.scores) ? vd.scores : [];
  const own = brief?.audio && typeof brief.audio === "object" ? (brief.audio as { modo?: string; instrucoes?: string }) : null;
  const ownMode = own?.modo && own.modo in AUDIO_MODES ? (own.modo as AudioMode) : null;
  const [prompt, setPrompt] = useState<string>(brief?.visual_prompt_override ?? vd.prompt ?? "");
  const [mode, setMode] = useState<AudioMode | "padrao">(ownMode ?? "padrao");
  const [text, setText] = useState<string>(own?.instrucoes ?? "");
  const winner = scores.find((s) => s.attempt === vd.winner_attempt) ?? scores[scores.length - 1];
  return (
    <div className="space-y-3 rounded-lg border border-border/70 p-3">
      <p className="flex items-center gap-2 text-sm font-semibold">
        <Clapperboard className="size-4 text-primary" /> Roteiro do vídeo
      </p>
      <div className="space-y-1.5">
        <Label className="text-xs">Roteiro final enviado ao gerador de vídeo (editável)</Label>
        <Textarea rows={8} maxLength={VIDEO_SCRIPT_MAX} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Gerado na próxima criação do vídeo." />
        <p className="text-right text-[11px] text-muted-foreground">{prompt.length}/3.000</p>
      </div>
      {shots.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium">Tomadas</p>
          <ol className="space-y-1 text-xs text-muted-foreground">
            {shots.map((t, i) => (
              <li key={i}>
                <b className="text-foreground">
                  {sec(t.inicio_s)}–{sec(t.fim_s)}
                </b>{" "}
                · {t.enquadramento} · {t.acao}
                {t.movimento_camera ? ` · câmera: ${t.movimento_camera}` : ""}
                {t.lente ? ` · ${t.lente}` : ""}
              </li>
            ))}
          </ol>
        </div>
      )}
      <div className="space-y-1.5">
        <Label className="text-xs" htmlFor="video-audio-mode">
          Áudio deste vídeo
        </Label>
        <select
          id="video-audio-mode"
          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          value={mode}
          onChange={(e) => setMode(e.target.value as AudioMode | "padrao")}
        >
          <option value="padrao">Padrão da programação</option>
          {(Object.keys(AUDIO_MODES) as AudioMode[]).map((k) => (
            <option key={k} value={k}>
              {AUDIO_MODES[k].label}
            </option>
          ))}
        </select>
        {mode !== "padrao" && mode !== "sem_audio" && (
          <Textarea
            rows={2}
            maxLength={AUDIO_INSTRUCTIONS_MAX}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder='Ex.: "trilha animada", "voz feminina calma", "sem música"'
          />
        )}
      </div>
      {winner && (
        <p className="text-xs">
          <b>Nota do crítico:</b> {winner.total ?? "—"}/50
          {winner.motivo ? ` — ${winner.motivo}` : winner.error ? ` — ${winner.error}` : ""}
          {scores.length > 1 ? ` (refeito ${scores.length - 1}× · ficou o de maior nota)` : ""}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => onSave(prompt, mode === "padrao" ? null : { modo: mode, instrucoes: mode === "sem_audio" ? "" : text })}>
          Salvar roteiro e áudio
        </Button>
        <Button size="sm" disabled={busy} onClick={onRegenerate}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Regenerar vídeo
        </Button>
      </div>
    </div>
  );
}
