-- Fase 7: várias empresas.
-- 7.1 Uma empresa pode herdar as conexões de IA (OpenAI, Gemini, Higgsfield, Canva) de outra (a da agência).
alter table public.workspaces add column if not exists ai_inherit_from uuid references public.workspaces(id) on delete set null;

-- 7.3 Ativar campanha (gastar verba) só por dono/admin: reforço no banco para mudanças de entrega.
create or replace function public.guard_campaign_delivery()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(auth.jwt()->>'role', '') <> 'authenticated' then
    return new;
  end if;
  if new.meta_delivery_status = 'ACTIVE' and old.meta_delivery_status is distinct from 'ACTIVE'
     and not public.has_workspace_role(new.workspace_id, array['owner','admin']::public.workspace_role[]) then
    raise exception 'Só o dono ou um administrador pode ativar a veiculação (gastar verba).' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists guard_campaign_delivery on public.campaigns;
create trigger guard_campaign_delivery
  before update of meta_delivery_status on public.campaigns
  for each row execute function public.guard_campaign_delivery();
