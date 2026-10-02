'use client';

// Último recurso: falha no próprio root layout (sem providers nem CSS do app,
// por isso estilos inline mínimos). O caso comum é o `error.tsx`.
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="pt-BR">
      <body style={{ margin: 0, fontFamily: 'sans-serif' }}>
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
          <div style={{ maxWidth: 448 }}>
            <h1 style={{ fontSize: 20, fontWeight: 600 }}>This page didn&apos;t load</h1>
            <p style={{ fontSize: 14, color: '#64748b' }}>
              Something went wrong on our end. You can try refreshing or head back home.
            </p>
            <button onClick={() => reset()} style={{ marginRight: 8 }}>Try again</button>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/">Go home</a>
          </div>
        </div>
      </body>
    </html>
  );
}
