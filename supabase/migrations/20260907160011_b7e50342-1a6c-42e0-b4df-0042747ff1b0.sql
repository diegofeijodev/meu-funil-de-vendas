CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare ws uuid;
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)));

  insert into public.workspaces (name, slug, owner_id)
  values (coalesce(new.raw_user_meta_data->>'company_name', 'Meu Workspace'),
          'ws-' || substr(replace(new.id::text,'-',''),1,10), new.id)
  returning id into ws;

  insert into public.workspace_members (workspace_id, user_id, role) values (ws, new.id, 'owner');
  return new;
end $function$;

DROP FUNCTION IF EXISTS public.seed_demo_workspace(uuid);