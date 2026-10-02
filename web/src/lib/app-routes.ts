/**
 * Rotas internas (as 25 do protótipo, `docs/inventory/web.md` §1). Usado pelo
 * `(app)/layout` (só liga guarda + shell em rota conhecida) e pelo catch-all
 * `(app)/[...rest]` (rota desconhecida -> 404 do root, sem shell).
 * Cada tarefa de página troca o placeholder pelo `page.tsx` real; a lista não muda.
 */
const ID = '[^/]+';
const ROUTES: RegExp[] = [
  'agency', 'overview', 'brands', `brands/${ID}`, 'studio', 'library', 'instagram', 'calendar',
  'campaigns', 'campaigns/new', `campaigns/${ID}`, 'performance', 'insights', 'approvals', 'integrations', 'settings',
  'crm', 'crm/leads', `crm/leads/${ID}`, 'crm/inbox', 'crm/cadences', 'crm/tasks', 'crm/dashboard', 'crm/integrations', 'crm/settings',
].map((r) => new RegExp(`^/${r}/?$`));

export function isKnownAppPath(pathname: string): boolean {
  return ROUTES.some((re) => re.test(pathname));
}
