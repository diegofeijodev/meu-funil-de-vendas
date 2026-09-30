create policy "brand files: members read" on storage.objects for select to authenticated
using (bucket_id = 'creative-assets' and (storage.foldername(name))[1] = 'brands' and public.is_workspace_member(((storage.foldername(name))[2])::uuid));
create policy "brand files: editors upload" on storage.objects for insert to authenticated
with check (bucket_id = 'creative-assets' and (storage.foldername(name))[1] = 'brands' and public.has_workspace_role(((storage.foldername(name))[2])::uuid, array['owner','admin','marketing']::workspace_role[]));
create policy "brand files: editors delete" on storage.objects for delete to authenticated
using (bucket_id = 'creative-assets' and (storage.foldername(name))[1] = 'brands' and public.has_workspace_role(((storage.foldername(name))[2])::uuid, array['owner','admin','marketing']::workspace_role[]));