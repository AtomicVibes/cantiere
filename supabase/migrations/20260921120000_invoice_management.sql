-- =============================================================
-- Migration: Invoice management (additive data model)
--
-- Purpose
--   Gives the existing `invoices` table the fields a European/Italian
--   invoice workflow needs, plus two new child tables:
--     * invoice_items        – itemised, VAT-able lines
--     * invoice_attachments  – per-invoice files (storage) or Google links
--   and the storage bucket + RLS + auditing that supports them.
--
-- Design rules honoured
--   * 100% additive: only ADD COLUMN / CREATE TABLE / CREATE POLICY.
--      Nothing is dropped or re-created on production data.
--   * Existing invoice behaviour is preserved: `id`, `amount`, `status`,
--     `archived`, `created_at` keep their meaning. The legacy `amount`/
--     `status` columns are also kept in sync by the emitting client so the
--     canonical audit writer (log_invoice_changes) keeps working unchanged.
--   * Finance access mirrors the app roles canViewFinance =
--     [super_admin, admin, manager] via the new is_finance_staff() helper.
--   * Attachment storage mirrors the existing `documents` bucket convention
--     (server-generated path rooted at the uploader's uid, signed URLs only in
--     the UI), but scoped to the `invoice-attachments` bucket so documents and
--     invoice attachments stay fully independent.
--   * Auditing uses the single canonical writer public.write_audit_log().
--
-- Italian compliance notes (informative; no legal advice)
--   Mandatory invoice content -> art. 21, D.P.R. 633/1972 (seller data,
--   customer data, progressive number, date, nature/quality/quantity of
--   goods or services, taxable amounts + VAT or Nature code, total).
--   Electronic invoicing mandate  -> art. 1 co. 916 L. 205/2017, in force for
--   resident sellers since 1 Jan 2019; SDI technical rules: Agenzia delle
--   Entrate "regole tecniche" (Direttore's provvedimento 24 Nov 2022,
--   allegato A). FatturaPA XML emission via SDI is a FUTURE scope and is NOT
--   implemented here: the fields below are what the future XML mapper needs
--   (RegimeFiscale, Naturale/N4.., Bollo virtuale, SDI code or PEC).
--   Impresa di bollo   -> D.P.R. 642/1972; EUR 2,00 stamp duty applies to
--   VAT-exempt invoices above EUR 77,47 (treated as configurable, never
--   auto-charged by default).
-- =============================================================

-- -------------------------------------------------------------
-- 1. Finance staff helper (super_admin, admin, manager)
-- -------------------------------------------------------------
create or replace function public.is_finance_staff()
returns boolean
language sql stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    join public.roles r on r.id = p.role_id
    where p.id = auth.uid()
      and r.name in ('super_admin', 'admin', 'manager')
  );
$$;

grant execute on function public.is_finance_staff() to authenticated;

-- -------------------------------------------------------------
-- 2. Additive columns on public.invoices
-- -------------------------------------------------------------
alter table public.invoices
  add column if not exists invoice_number text,
  add column if not exists invoice_date date,
  add column if not exists due_date date,
  add column if not exists client_id uuid references public.clients(id) on delete set null,
  add column if not exists project_id uuid references public.projects(id) on delete set null,
  add column if not exists category text default 'miscellaneous',
  add column if not exists supplier text,
  add column if not exists currency char(3) default 'EUR',
  add column if not exists amount numeric(14, 2) default 0,
  add column if not exists tax numeric(14, 2) default 0,
  add column if not exists subtotal numeric(14, 2) default 0,
  add column if not exists discount_total numeric(14, 2) default 0,
  add column if not exists vat_total numeric(14, 2) default 0,
  add column if not exists total numeric(14, 2) default 0,
  add column if not exists stamp_duty numeric(14, 2) default 0,
  add column if not exists payment_status text default 'pending',
  add column if not exists payment_terms text,
  add column if not exists payment_method text,
  add column if not exists payment_reference text,
  add column if not exists notes text,
  add column if not exists tax_regime text,
  add column if not exists seller_snapshot jsonb,
  add column if not exists customer_snapshot jsonb;

create index if not exists invoices_client_id_idx on public.invoices(client_id);
create index if not exists invoices_project_id_idx on public.invoices(project_id);
create index if not exists invoices_payment_status_idx on public.invoices(payment_status);
create index if not exists invoices_invoice_number_idx on public.invoices(invoice_number);

-- -------------------------------------------------------------
-- 3. Invoice items
-- -------------------------------------------------------------
create table if not exists public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  description text not null,
  quantity numeric(14, 2) not null default 1,
  unit_price numeric(14, 2) not null default 0,
  discount_percent numeric(5, 2) not null default 0,
  discount_amount numeric(14, 2) not null default 0,
  vat_rate numeric(5, 2) default 0,
  vat_natura text,
  line_subtotal numeric(14, 2) not null default 0,
  line_vat numeric(14, 2) not null default 0,
  line_total numeric(14, 2) not null default 0,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists invoice_items_invoice_id_idx on public.invoice_items(invoice_id);

alter table public.invoice_items enable row level security;

drop policy if exists "Invoice items readable by staff" on public.invoice_items;
create policy "Invoice items readable by staff"
  on public.invoice_items for select
  to authenticated
  using (public.is_finance_staff());

drop policy if exists "Invoice items insertable by staff" on public.invoice_items;
create policy "Invoice items insertable by staff"
  on public.invoice_items for insert
  to authenticated
  with check (public.is_finance_staff());

drop policy if exists "Invoice items updatable by staff" on public.invoice_items;
create policy "Invoice items updatable by staff"
  on public.invoice_items for update
  to authenticated
  using (public.is_finance_staff())
  with check (public.is_finance_staff());

drop policy if exists "Invoice items deletable by staff" on public.invoice_items;
create policy "Invoice items deletable by staff"
  on public.invoice_items for delete
  to authenticated
  using (public.is_finance_staff());

-- -------------------------------------------------------------
-- 4. Invoice attachments (metadata; objects live in storage)
-- -------------------------------------------------------------
create table if not exists public.invoice_attachments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  storage_path text,
  external_url text,
  external_provider text,
  file_name text not null,
  mime_type text,
  file_size bigint,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists invoice_attachments_invoice_id_idx on public.invoice_attachments(invoice_id);

alter table public.invoice_attachments enable row level security;

drop policy if exists "Invoice attachments readable by staff or owner" on public.invoice_attachments;
create policy "Invoice attachments readable by staff or owner"
  on public.invoice_attachments for select
  to authenticated
  using (public.is_finance_staff() or auth.uid() = created_by);

drop policy if exists "Invoice attachments insertable by staff or owner" on public.invoice_attachments;
create policy "Invoice attachments insertable by staff or owner"
  on public.invoice_attachments for insert
  to authenticated
  with check (public.is_finance_staff() or auth.uid() = created_by);

drop policy if exists "Invoice attachments updatable by staff or owner" on public.invoice_attachments;
create policy "Invoice attachments updatable by staff or owner"
  on public.invoice_attachments for update
  to authenticated
  using (public.is_finance_staff() or auth.uid() = created_by)
  with check (public.is_finance_staff() or auth.uid() = created_by);

drop policy if exists "Invoice attachments deletable by staff or owner" on public.invoice_attachments;
create policy "Invoice attachments deletable by staff or owner"
  on public.invoice_attachments for delete
  to authenticated
  using (public.is_finance_staff() or auth.uid() = created_by);

-- -------------------------------------------------------------
-- 5. Storage bucket + object policies (mirrors documents convention)
-- -------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('invoice-attachments', 'invoice-attachments', false)
on conflict (id) do nothing;

drop policy if exists "Invoice attachment uploads" on storage.objects;
create policy "Invoice attachment uploads"
  on storage.objects for insert
  with check (
    bucket_id = 'invoice-attachments'
    and auth.uid() is not null
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Invoice attachment owners and staff can read" on storage.objects;
create policy "Invoice attachment owners and staff can read"
  on storage.objects for select
  using (
    bucket_id = 'invoice-attachments'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_finance_staff()
    )
  );

drop policy if exists "Invoice attachment owners and staff can update" on storage.objects;
create policy "Invoice attachment owners and staff can update"
  on storage.objects for update
  with check (
    bucket_id = 'invoice-attachments'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_finance_staff()
    )
  );

drop policy if exists "Invoice attachment owners and staff can delete" on storage.objects;
create policy "Invoice attachment owners and staff can delete"
  on storage.objects for delete
  using (
    bucket_id = 'invoice-attachments'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_finance_staff()
    )
  );

-- -------------------------------------------------------------
-- 6. Auditing for invoice attachments (canonical writer only)
-- -------------------------------------------------------------
create or replace function public.log_invoice_attachment_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_columns text[] := array['file_name', 'mime_type', 'file_size', 'external_provider'];
  v_action text;
  v_message text;
  v_details jsonb;
  v_old_j jsonb;
  v_new_j jsonb;
  v_changed text[];
  v_old_values jsonb;
  v_new_values jsonb;
begin
  if tg_op = 'INSERT' then
    v_action := 'INVOICE_ATTACHMENT_CREATE';
    v_message := 'Attachment added to invoice: ' || coalesce(new.file_name, '');
    v_details := jsonb_build_object('invoice_id', new.invoice_id, 'file_name', new.file_name, 'external_provider', new.external_provider);
    perform public.write_audit_log(
      v_action, v_message, v_details, new.file_name,
      'invoice_attachment', new.id, null, null,
      public.audit_value_slice(to_jsonb(new), v_columns)
    );
    return null;
  end if;

  if tg_op = 'DELETE' then
    v_action := 'INVOICE_ATTACHMENT_DELETE';
    v_message := 'Attachment removed from invoice: ' || coalesce(old.file_name, '');
    v_details := jsonb_build_object('invoice_id', old.invoice_id, 'file_name', old.file_name, 'external_provider', old.external_provider);
    perform public.write_audit_log(
      v_action, v_message, v_details, old.file_name,
      'invoice_attachment', old.id, null,
      public.audit_value_slice(to_jsonb(old), v_columns), null
    );
    return null;
  end if;

  v_old_j := public.audit_value_slice(to_jsonb(old), v_columns);
  v_new_j := public.audit_value_slice(to_jsonb(new), v_columns);
  v_changed := public.audit_changed_keys(v_old_j, v_new_j);
  if coalesce(array_length(v_changed, 1), 0) = 0 then
    return null;
  end if;
  v_old_values := (select jsonb_object_agg(column_name, v_old_j -> column_name) from unnest(v_changed) column_name);
  v_new_values := (select jsonb_object_agg(column_name, v_new_j -> column_name) from unnest(v_changed) column_name);
  v_action := 'INVOICE_ATTACHMENT_UPDATE';
  v_message := 'Attachment updated on invoice: ' || coalesce(new.file_name, '');

  perform public.write_audit_log(
    v_action, v_message, null, new.file_name,
    'invoice_attachment', new.id, null, v_old_values, v_new_values
  );
  return null;
end;
$$;

drop trigger if exists trg_audit_invoice_attachments on public.invoice_attachments;
create trigger trg_audit_invoice_attachments
  after insert or update or delete on public.invoice_attachments
  for each row execute function public.log_invoice_attachment_changes();

-- -------------------------------------------------------------
-- 7. Configurable seller / company profile (single row per owner)
--    "Company identity" for the printed invoice. Keep it intentionally
--    small and additive for now.
-- -------------------------------------------------------------
create table if not exists public.company_profiles (
  id uuid primary key default gen_random_uuid(),
  created_by uuid references public.profiles(id) on delete set null,
  legal_name text,
  display_name text,
  address text,
  city text,
  postal_code text,
  province text,
  country text default 'IT',
  vat_id text,
  tax_code text,
  sdi_code text,
  pec text,
  phone text,
  email text,
  logo_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists company_profiles_created_by_idx on public.company_profiles(created_by);

alter table public.company_profiles enable row level security;

drop policy if exists "Company profile readable by staff or owner" on public.company_profiles;
create policy "Company profile readable by staff or owner"
  on public.company_profiles for select
  to authenticated
  using (public.is_admin() or public.is_super_admin() or auth.uid() = created_by);

drop policy if exists "Company profile writable by staff or owner" on public.company_profiles;
create policy "Company profile writable by staff or owner"
  on public.company_profiles for insert
  to authenticated
  with check (public.is_admin() or public.is_super_admin() or auth.uid() = created_by);

drop policy if exists "Company profile updatable by staff or owner" on public.company_profiles;
create policy "Company profile updatable by staff or owner"
  on public.company_profiles for update
  to authenticated
  using (public.is_admin() or public.is_super_admin() or auth.uid() = created_by)
  with check (public.is_admin() or public.is_super_admin() or auth.uid() = created_by);

drop policy if exists "Company profile deletable by staff or owner" on public.company_profiles;
create policy "Company profile deletable by staff or owner"
  on public.company_profiles for delete
  to authenticated
  using (public.is_super_admin());