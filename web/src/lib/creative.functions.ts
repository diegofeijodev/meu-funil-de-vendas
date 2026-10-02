import { serverFnPost } from "@/lib/server-fn";
import type { VisualStyle } from "@/lib/creative/visual-style";

/** `POST /v1/creative/generate-brand-guide` — a IA analisa as fotos de referência e sugere o guia visual. */
export const generateBrandGuide = serverFnPost<{ brandId: string }, { guide: VisualStyle; referencias: string[] }>("/v1/creative/generate-brand-guide");
