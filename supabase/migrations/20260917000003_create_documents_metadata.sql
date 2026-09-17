-- Metadata table for the existing private `documents` Storage bucket.

create table if not exists public.documents (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  file_name text not null,
  storage_path text not null,
  mime_type text not null,
  file_size bigint not null default 0,
  type text not null default 'other',
  notes text null,
  project_id uuid null,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint documents_pkey primary key (id),
  constraint documents_user_id_fkey foreign key (user_id)
    references auth.users (id) on delete cascade,
  constraint documents_project_id_fkey foreign key (project_id)
    references public.projects (id) on delete set null
);

create index if not exists documents_user_id_idx on public.documents(user_id);
create index if not exists documents_project_id_idx on public.documents(project_id);
create index if not exists documents_created_at_idx on public.documents(created_at desc);

alter table public.documents enable row level security;

drop policy if exists "Users can view their own documents" on public.documents;
create policy "Users can view their own documents"
  on public.documents for select to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1
      from public.profiles profile
      join public.roles role on role.id = profile.role_id
      where profile.id = auth.uid()
        and role.name in ('super_admin', 'admin', 'manager')
    )
  );

drop policy if exists "Users can insert their own documents" on public.documents;
create policy "Users can insert their own documents"
  on public.documents for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "Users can update their own documents" on public.documents;
create policy "Users can update their own documents"
  on public.documents for update to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1
      from public.profiles profile
      join public.roles role on role.id = profile.role_id
      where profile.id = auth.uid()
        and role.name in ('super_admin', 'admin', 'manager')
    )
  )
  with check (
    user_id = auth.uid()
    or exists (
      select 1
      from public.profiles profile
      join public.roles role on role.id = profile.role_id
      where profile.id = auth.uid()
        and role.name in ('super_admin', 'admin', 'manager')
    )
  );

drop policy if exists "Users can delete their own documents" on public.documents;
create policy "Users can delete their own documents"
  on public.documents for delete to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1
      from public.profiles profile
      join public.roles role on role.id = profile.role_id
      where profile.id = auth.uid()
        and role.name = 'super_admin'
    )
  );

drop policy if exists "Document owners and admins can delete documents" on storage.objects;
create policy "Document owners and admins can delete documents"
  on storage.objects for delete
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