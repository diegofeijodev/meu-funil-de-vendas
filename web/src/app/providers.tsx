'use client';

import { Suspense, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/sonner';

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      {/* `useSearch()` (useSearchParams) exige Suspense em página pré-renderizada. */}
      <Suspense fallback={null}>{children}</Suspense>
      <Toaster richColors position="top-right" />
    </QueryClientProvider>
  );
}
