'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from './auth.store';

export function useAuth() {
  const { user, hydrated, hydrate, signIn, signUp, setSession, signOut } = useAuthStore();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!hydrated) hydrate();
  }, [hydrated, hydrate]);

  return {
    user,
    loading: !hydrated,
    signIn,
    signUp,
    setSession,
    signOut: async () => {
      // Limpa o cache ANTES de trocar de conta — senão os dados da conta anterior
      // aparecem por um instante na próxima.
      await queryClient.cancelQueries();
      queryClient.clear();
      await signOut();
    },
  };
}
