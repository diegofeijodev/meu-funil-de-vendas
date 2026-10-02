'use client';

import { create } from 'zustand';
import type { AuthSession, AuthUser } from '../domain/auth.types';
import { login, logout, signup } from '../infrastructure/auth.api';
import { clearStoredAuth, getStoredAuth, storeAuth } from '../infrastructure/auth.storage';

interface AuthState {
  user: AuthUser | null;
  hydrated: boolean;
  hydrate: () => void;
  signIn: (email: string, password: string) => Promise<AuthUser>;
  signUp: (body: { email: string; password: string; full_name?: string; company_name?: string }) => Promise<AuthUser>;
  /** Guarda uma sessão obtida por fora (retorno do Google no fragmento da URL). */
  setSession: (session: AuthSession) => void;
  signOut: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  hydrated: false,
  hydrate: () => set({ user: getStoredAuth()?.user ?? null, hydrated: true }),
  signIn: async (email, password) => {
    const session = await login(email, password);
    storeAuth(session);
    set({ user: session.user, hydrated: true });
    return session.user;
  },
  signUp: async (body) => {
    const session = await signup(body);
    storeAuth(session);
    set({ user: session.user, hydrated: true });
    return session.user;
  },
  setSession: (session) => {
    storeAuth(session);
    set({ user: session.user, hydrated: true });
  },
  signOut: async () => {
    // O logout invalida os refresh tokens no servidor; falhar (rede, 401) não
    // pode segurar a pessoa na sessão.
    await logout().catch(() => undefined);
    clearStoredAuth();
    set({ user: null, hydrated: true });
  },
}));
