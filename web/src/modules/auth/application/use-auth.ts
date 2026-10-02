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
      // Cancela as consultas, apaga o token e SÓ ENTÃO limpa o cache: assim nada
      // é rebuscado com o token antigo, e os dados da conta anterior não
      // aparecem por um instante na próxima.
      await queryClient.cancelQueries();
      await signOut();
      queryClient.clear();
    },
  };
}
