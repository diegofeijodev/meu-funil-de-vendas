export type AuthUser = {
  id: string;
  email: string | null;
  encrypted_password: string | null;
  created_at: string;
  deleted_at?: string | null;
  banned_until?: string | null;
  is_anonymous?: boolean | null;
};
export type AuthIdentity = { user_id: string; provider: string; provider_id?: string | null; identity_data?: { sub?: string } | null };
export type UserRow = { id: string; email: string; password_hash: string | null; google_sub: string | null; token_version: number; created_at: string };
export type SkipReason = 'apagada' | 'banida' | 'anonima' | 'sem_email';
export type UsersPlan = { users: UserRow[]; skipped: { id: string; reason: SkipReason }[]; noLogin: string[]; nonBcrypt: string[] };

export class DuplicateEmailError extends Error {
  constructor(readonly ids: string[][]) {
    super(`e-mails repetidos (sem diferenciar maiúsculas) em ${ids.length} grupo(s) de contas: ${ids.map((g) => g.join('+')).join(', ')}. Nada foi gravado.`);
  }
}

/** Hash do GoTrue (bcrypt): `$2a$`/`$2b$`/`$2y$` — o `bcryptjs` da nossa API confere os três. */
const BCRYPT = /^\$2[aby]\$\d{2}\$/;

/** Contas do Supabase → tabela `users` (mesmo id do `profiles`). Contas apagadas/banidas/anônimas ficam de fora. */
export function mapUsers(authUsers: AuthUser[], identities: AuthIdentity[], now: Date): UsersPlan {
  const google = new Map<string, string>();
  for (const i of identities) {
    if (i.provider !== 'google') continue;
    const sub = i.provider_id || i.identity_data?.sub;
    if (sub) google.set(i.user_id, String(sub));
  }
  const out: UsersPlan = { users: [], skipped: [], noLogin: [], nonBcrypt: [] };
  for (const u of authUsers) {
    if (u.deleted_at) { out.skipped.push({ id: u.id, reason: 'apagada' }); continue; }
    if (u.banned_until && new Date(u.banned_until).getTime() > now.getTime()) { out.skipped.push({ id: u.id, reason: 'banida' }); continue; }
    if (u.is_anonymous) { out.skipped.push({ id: u.id, reason: 'anonima' }); continue; }
    const email = (u.email ?? '').trim().toLowerCase();
    if (!email) { out.skipped.push({ id: u.id, reason: 'sem_email' }); continue; }
    const password = u.encrypted_password && BCRYPT.test(u.encrypted_password) ? u.encrypted_password : null;
    if (u.encrypted_password && !password) out.nonBcrypt.push(u.id);
    const sub = google.get(u.id) ?? null;
    if (!password && !sub) out.noLogin.push(u.id);
    out.users.push({ id: u.id, email, password_hash: password, google_sub: sub, token_version: 0, created_at: u.created_at });
  }
  const byEmail = new Map<string, string[]>();
  for (const x of out.users) byEmail.set(x.email, [...(byEmail.get(x.email) ?? []), x.id]);
  const dups = [...byEmail.values()].filter((ids) => ids.length > 1);
  if (dups.length) throw new DuplicateEmailError(dups);
  return out;
}
