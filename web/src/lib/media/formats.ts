/** Formatos de destino da Biblioteca de mídia (seguro para cliente e servidor). */
export type TargetFormat =
  | "ig_feed_square"
  | "ig_feed_portrait"
  | "ig_story"
  | "ig_reel"
  | "meta_ad_square"
  | "meta_ad_vertical"
  | "meta_ad_landscape"
  | "other";

export const TARGET_FORMATS: Record<
  Exclude<TargetFormat, "other">,
  { label: string; short: string; width: number; height: number; aspect: string }
> = {
  ig_feed_square: {
    label: "Instagram Feed 1:1",
    short: "Feed 1:1",
    width: 1080,
    height: 1080,
    aspect: "1:1",
  },
  ig_feed_portrait: {
    label: "Instagram Feed 4:5",
    short: "Feed 4:5",
    width: 1080,
    height: 1350,
    aspect: "4:5",
  },
  ig_story: {
    label: "Instagram Story 9:16",
    short: "Story",
    width: 1080,
    height: 1920,
    aspect: "9:16",
  },
  ig_reel: {
    label: "Instagram Reel 9:16",
    short: "Reel",
    width: 1080,
    height: 1920,
    aspect: "9:16",
  },
  meta_ad_square: {
    label: "Anúncio quadrado 1:1",
    short: "Anúncio 1:1",
    width: 1080,
    height: 1080,
    aspect: "1:1",
  },
  meta_ad_vertical: {
    label: "Anúncio vertical 4:5",
    short: "Anúncio 4:5",
    width: 1080,
    height: 1350,
    aspect: "4:5",
  },
  meta_ad_landscape: {
    label: "Anúncio horizontal 1,91:1",
    short: "Anúncio 1,91:1",
    width: 1200,
    height: 628,
    aspect: "16:9",
  },
};

export const TARGET_FORMAT_KEYS = Object.keys(TARGET_FORMATS) as Exclude<TargetFormat, "other">[];
export const IG_FORMATS: TargetFormat[] = ["ig_feed_square", "ig_feed_portrait", "ig_story"];

export function formatLabel(f: string | null | undefined) {
  return (TARGET_FORMATS as Record<string, { short: string }>)[f ?? ""]?.short ?? "Outro";
}

export function aspectFor(f: TargetFormat) {
  return f === "other" ? "1:1" : TARGET_FORMATS[f].aspect;
}

export function targetFromAspect(aspect: string | null | undefined, video = false): TargetFormat {
  if (aspect === "1:1") return "ig_feed_square";
  if (aspect === "4:5") return "ig_feed_portrait";
  if (aspect === "9:16") return video ? "ig_reel" : "ig_story";
  if (aspect === "16:9" || aspect === "1.91:1") return "meta_ad_landscape";
  return "other";
}

/** Formato do post do Instagram → formato de destino da biblioteca. */
export function targetForIgFormat(igFormat: string): TargetFormat {
  switch (igFormat) {
    case "feed_image":
      return "ig_feed_square";
    case "feed_carousel":
      return "ig_feed_portrait";
    case "reel":
      return "ig_reel";
    default:
      return "ig_story";
  }
}

export function formatBytes(n: number | null | undefined) {
  if (!n) return "—";
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
