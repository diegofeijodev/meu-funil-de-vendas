"use client";
/* eslint-disable @typescript-eslint/no-explicit-any -- porte 1:1 do protótipo: os jsonb de ig_posts/ig_content_plans chegam soltos */

import { useQuery } from "@tanstack/react-query";
import { Image as ImageIcon, Images, Clapperboard, CircleDot, Film } from "lucide-react";
import { getIgAccount, listIgPosts } from "@/modules/instagram/infrastructure/instagram.api";
import { cn } from "@/lib/utils";

export type IgPost = {
  id: string;
  workspace_id: string;
  plan_id: string | null;
  format: string;
  status: string;
  scheduled_at: string | null;
  published_at: string | null;
  theme: string | null;
  hook: string | null;
  caption: string | null;
  hashtags: string[];
  cta: string | null;
  creative_brief: any;
  media: { url: string; type: string; order: number }[];
  ig_media_id: string | null;
  ig_permalink: string | null;
  ai_provider: string | null;
  ai_generation_log: any[];
  last_error: string | null;
  created_at: string;
};

export const FORMATS: Record<
  string,
  { label: string; icon: typeof ImageIcon; aspect: string; phone: boolean }
> = {
  feed_image: { label: "Feed", icon: ImageIcon, aspect: "aspect-square", phone: false },
  feed_carousel: { label: "Carrossel", icon: Images, aspect: "aspect-[4/5]", phone: false },
  reel: { label: "Reels", icon: Clapperboard, aspect: "aspect-[9/16]", phone: true },
  story_image: { label: "Story (imagem)", icon: CircleDot, aspect: "aspect-[9/16]", phone: true },
  story_video: { label: "Story (vídeo)", icon: Film, aspect: "aspect-[9/16]", phone: true },
};

export const STATUS_LABEL: Record<string, string> = {
  idea: "Ideia",
  generating: "Gerando",
  ready: "Pronto",
  pending_approval: "Aguardando aprovação",
  approved: "Aprovado",
  scheduled: "Agendado",
  publishing: "Publicando",
  published: "Publicado",
  failed: "Falhou",
  cancelled: "Cancelado",
};

export function useIgAccount(workspaceId: string | null) {
  return useQuery({
    queryKey: ["ig-account", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => (await getIgAccount(workspaceId!)) as any,
  });
}

export function useIgPosts(workspaceId: string | null) {
  return useQuery({
    queryKey: ["ig-posts", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => (await listIgPosts(workspaceId!)) as unknown as IgPost[],
    refetchInterval: (q) =>
      (q.state.data as IgPost[] | undefined)?.some(
        (p) => p.status === "generating" || p.status === "publishing",
      )
        ? 5000
        : false,
  });
}

export function MediaThumb({ post, className }: { post: IgPost; className?: string }) {
  const m = [...(post.media ?? [])].sort((a, b) => a.order - b.order)[0];
  const F = FORMATS[post.format] ?? FORMATS["feed_image"]!;
  const Icon = F.icon;
  return (
    <div className={cn("relative overflow-hidden rounded-md bg-muted", className)}>
      {m ? (
        m.type === "video" ? (
          <video src={m.url} className="size-full object-cover" muted playsInline />
        ) : (
          <img
            src={m.url}
            alt={post.theme ?? "Post"}
            className="size-full object-cover"
            loading="lazy"
          />
        )
      ) : (
        <div className="flex size-full items-center justify-center text-muted-foreground">
          <Icon className="size-5" />
        </div>
      )}
    </div>
  );
}

export const fmtNum = (n: number) => new Intl.NumberFormat("pt-BR").format(Math.round(n));
export const fmtDateTime = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "Sem data";
