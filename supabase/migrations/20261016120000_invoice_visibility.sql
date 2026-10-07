-- =============================================================
-- Invoice visibility: reuse the project/document visibility model
--
-- 1) invoices.visibility (private | public | selected), additive with a
--    backfill so every existing row keeps working and defaults to
--    'private' (never widens access on its own).
-- 2) invoice_audience table (selected-visibility members), mirroring
--    project_audience / document_audience + RLS.
-- 3) invoices SELECT extended (existing policies preserved, this is
--    purely additive):
--      public   -> all authenticated users,
--      selected -> audience members.
--
-- Explicitly NOT changed:
--   * Existing SELECT/INSERT/UPDATE/DELETE policies on invoices other
--     than the two additive SELECT policies below.
--   * invoice_items, invoice_attachments, audit triggers.
--   * No rows deleted, no history rewritten.
-- =============================================================

-- ---------------------------------------------------------------
-- 1. Column
-- ---------------------------------------------------------------
alter table public.invoices
  add column if not exists visibility text default 'private';

update public.invoices
   set visibility = 'private'
 where visibility is null or btrim(visibility) = '';

alter table public.invoices alter column visibility set default 'private';
alter table public.invoices alter column visibility set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'invoices_visibility_check') then
    alter table public.invoices
      add constraint invoices_visibility_check check (visibility in ('private','public','selected'));
  end if;
end $$;

comment on column public.invoices.visibility is
  'Who can see the invoice: private (creator/admins via existing policies), public (all authenticated), selected (invoice_audience members).';

-- ---------------------------------------------------------------
-- 2. Selected-audience table (+ RLS mirroring the audience model)
-- ---------------------------------------------------------------
create table if not exists public.invoice_audience (
  id uuid not null default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint invoice_audience_pkey primary key (id),
  constraint invoice_audience_unique unique (invoice_id, user_id)
);

create index if not exists invoice_audience_invoice_id_idx on public.invoice_audience(invoice_id);
create index if not exists invoice_audience_user_id_idx on public.invoice_audience(user_id);

alter table public.invoice_audience enable row level security;

drop policy if exists "Users can read own invoice audience rows" on public.invoice_audience;
create policy "Users can read own invoice audience rows"
  on public.invoice_audience for select
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists "Admins can manage invoice audience" on public.invoice_audience;
create policy "Admins can manage invoice audience"
  on public.invoice_audience for all
  using (public.is_admin())
  with check (public.is_admin());

revoke all on public.invoice_audience from anon;

-- ---------------------------------------------------------------
-- 3. Invoices SELECT visibility (existing policies preserved)
-- ---------------------------------------------------------------
drop policy if exists "Users can read public invoices" on public.invoices;
create policy "Users can read public invoices"
  on public.invoices for select
  to authenticated
  using (visibility = 'public');

drop policy if exists "Users can read selected-audience invoices" on public.invoices;
create policy "Users can read selected-audience invoices"
  on public.invoices for select
  to authenticated
  using (
    visibility = 'selected'
    and exists (
      select 1 from public.invoice_audience ia
      where ia.invoice_id = invoices.id
        and ia.user_id = auth.uid()
    )
  );

notify pgrst, 'reload schema';
