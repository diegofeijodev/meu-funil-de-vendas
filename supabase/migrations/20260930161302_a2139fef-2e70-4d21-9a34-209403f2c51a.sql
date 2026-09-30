create or replace function public.create_workspace(_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare ws uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if coalesce(trim(_name),'') = '' then raise exception 'nome obrigatório'; end if;
  insert into public.workspaces (name, slug, owner_id)
  values (trim(_name), 'ws-' || substr(replace(gen_random_uuid()::text,'-',''),1,12), auth.uid())
  returning id into ws;
  insert into public.workspace_members (workspace_id, user_id, role) values (ws, auth.uid(), 'owner');
  return ws;
end $$;
revoke execute on function public.create_workspace(text) from public, anon;
grant execute on function public.create_workspace(text) to authenticated;