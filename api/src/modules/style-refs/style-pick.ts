/** Escolha das notas de estilo pelo assunto do pedido (Fatia 3; P8/P9). Função pura: o serviço lê as linhas e chama `chooseNotes`. */
import { StyleCategoryId, subjectCategories, subjectWords } from './categories';
import { MAX_NOTES, StyleNotes } from './style-notes';

export type PickRow = { id: string; campaign_id: string | null; created_at: Date; notes: StyleNotes };
export type PickedNote = { row: PickRow; full: boolean; library: boolean };

const CAMPAIGN_SLOTS = 2;

export function chooseNotes(own: PickRow[], campaignId: string | null, subject: string | null | undefined, library: PickRow[] = []): PickedNote[] {
  const cats = subjectCategories(subject);
  const words = subjectWords(subject);
  const common = (r: PickRow) => r.notes.categorias.filter((c: StyleCategoryId) => cats.includes(c)).length;
  const overlap = (r: PickRow) => subjectWords(r.notes.assunto).filter((w) => words.includes(w)).length;
  const rank = (rows: PickRow[]) =>
    rows
      .map((r) => ({ r, c: common(r), o: overlap(r) }))
      .sort((a, b) => Number(b.c > 0) - Number(a.c > 0) || b.c - a.c || b.o - a.o || b.r.created_at.getTime() - a.r.created_at.getTime())
      .map((x) => x.r);
  const usable = own.filter((r) => r.campaign_id === null || (!!campaignId && r.campaign_id === campaignId));
  const camp = rank(usable.filter((r) => r.campaign_id !== null));
  const brand = rank(usable.filter((r) => r.campaign_id === null));
  let out = [...camp.slice(0, CAMPAIGN_SLOTS), ...brand];
  if (out.length < MAX_NOTES) out = [...out, ...camp.slice(CAMPAIGN_SLOTS)];
  const full = (r: PickRow) => cats.length === 0 || common(r) > 0;
  const picked: PickedNote[] = out.slice(0, MAX_NOTES).map((row) => ({ row, full: full(row), library: false }));
  for (const row of rank(library)) {
    if (picked.length >= MAX_NOTES) break;
    picked.push({ row, full: full(row), library: true });
  }
  return picked;
}
