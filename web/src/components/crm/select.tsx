"use client";

/** `Select` nativo do CRM (no protótipo era exportado de `crm.index.tsx` e importado por 7 telas). */
export function Select({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
    >
      {children}
    </select>
  );
}
