-- RLS policies for the existing private `documents` storage bucket.

drop policy if exists "Authenticated users can upload documents" on storage.objects;
create policy "Authenticated users can upload documents"
on storage.objects for insert
with check (
  bucket_id = 'documents'
  and auth.uid() is not null
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Document owners and admins can read documents" on storage.objects;
create policy "Document owners and admins can read documents"
on storage.objects for select
using (
  bucket_id = 'documents'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or exists (
      select 1
      from public.profiles profile
      join public.roles role on role.id = profile.role_id
      where profile.id = auth.uid()
        and role.name in ('super_admin', 'admin', 'manager')
    )
  )
);