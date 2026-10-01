-- Fase 0 (0.8): aprovação só por owner/admin, garantida no banco.
-- Membros com outros perfis não conseguem colocar uma campanha como aprovada/ativa
-- nem decidir pedidos de aprovação pelo SDK. Alternar aprovada <-> ativa continua livre
-- para quem edita (ativar/pausar na Meta depois da aprovação).

create or replace function public.guard_campaign_approval()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(auth.jwt()->>'role', '') <> 'authenticated' then
    return new; -- servidor (service_role) e migrations
  end if;
  if new.status in ('approved', 'active')
     and (tg_op = 'INSERT' or old.status is null or old.status not in ('approved', 'active'))
     and not public.has_workspace_role(new.workspace_id, array['owner','admin']::public.workspace_role[]) then
    raise exception 'Só o dono ou um administrador da empresa pode aprovar a campanha.' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists guard_campaign_approval on public.campaigns;
create trigger guard_campaign_approval
  before insert or update of status on public.campaigns
  for each row execute function public.guard_campaign_approval();

create or replace function public.guard_approval_decision()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(auth.jwt()->>'role', '') <> 'authenticated' then
    return new;
  end if;
  if new.status is distinct from old.status
     and new.status in ('approved', 'rejected')
     and not public.has_workspace_role(new.workspace_id, array['owner','admin']::public.workspace_role[]) then
    raise exception 'Só o dono ou um administrador da empresa pode decidir aprovações.' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists guard_approval_decision on public.approval_requests;
create trigger guard_approval_decision
  before update of status on public.approval_requests
  for each row execute function public.guard_approval_decision();
