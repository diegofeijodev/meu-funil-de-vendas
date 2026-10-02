/** Usuário autenticado, resolvido pelo guard a cada request e anexado a `request.user`. */
export interface AuthUser {
  id: string;
  email: string;
}
