/** `SessionView` do contrato (§2). */
export interface AuthUser {
  id: string;
  email: string;
}

export interface AuthSession {
  access_token: string;
  refresh_token: string;
  token_type: 'bearer';
  expires_in: number;
  expires_at: number;
  user: AuthUser;
}

/** `GET /v1/auth/me` (§2). */
export interface MeResponse {
  user: { id: string; email: string; created_at: string };
  profile: { id: string; email: string | null; full_name: string | null; avatar_url: string | null; created_at: string };
}
