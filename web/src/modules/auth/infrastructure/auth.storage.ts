// ÚNICO arquivo autorizado a tocar em localStorage (convenção do freela-web-v2).
// Guarda a sessão (chave `authUser`) e a empresa selecionada (`aimos.workspace`,
// a mesma chave do protótipo).
import type { AuthSession } from '../domain/auth.types';

const SESSION_KEY = 'authUser';
const WORKSPACE_KEY = 'aimos.workspace';

function read(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* storage indisponível (modo privado): a sessão vale só até recarregar */
  }
}

export function getStoredAuth(): AuthSession | null {
  const raw = read(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthSession;
  } catch {
    return null;
  }
}

export function storeAuth(session: AuthSession): void {
  write(SESSION_KEY, JSON.stringify(session));
}

export function clearStoredAuth(): void {
  write(SESSION_KEY, null);
}

export function getStoredWorkspaceId(): string | null {
  return read(WORKSPACE_KEY);
}

export function storeWorkspaceId(id: string): void {
  write(WORKSPACE_KEY, id);
}
