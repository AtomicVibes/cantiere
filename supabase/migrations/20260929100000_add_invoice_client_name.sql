-- =============================================================
-- Migration: free-text client name for invoices
--
-- Additive, idempotent, non-destructive. Verified convention match
-- against supabase/migrations/20260921120000_invoice_management.sql,
-- which uses `add column if not exists` / `create index if not exists`
-- throughout and never drops or recreates tables.
--
-- Ground truth (from that migration): public.invoices already has
--   client_id   uuid references public.clients(id) on delete set null
--   project_id  uuid references public.projects(id) on delete set null
--   invoice_date / due_date / invoice_number / totals / snapshots
-- but NO free-text client-name column.
--
-- Design intent (matches the app's saved-object rules):
--   * When an existing client is selected -> client_id (uuid) is set
--     and client_name is left NULL (never denormalised over a real
--     client record, so clients <-> invoices relationship and RLS
--     stay intact).
--   * When the user types free text      -> client_name holds the
--     text; client_id stays NULL; NO fake clients row is ever created
--     and no project_id association is fabricated.
--   * One invoice keeps EITHER the uuid reference OR the free text,
--     never conflicting data.
--
-- Anything else (date defaults, index on (client_id, client_name),
-- RLS policy, audit logging) stays EXACTLY as-is. This runs last in
-- its own file so every earlier additive invoice migration is already
-- applied to the live DB first and nothing here depends on them.
--
-- Idempotency: safe to run more than once; does not touch other
-- invoices columns, the audit trigger, or any RLS policy.
-- =============================================================
alter table public.invoices
  add column if not exists client_name text;

create index if not exists invoices_client_name_idx
  on public.invoices (client_name);
