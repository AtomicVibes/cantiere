-- Add optional client information fields: business_activity and website.
-- address, company_name, vat_number, notes, profile_id, FK and the existing
-- trg_audit_clients trigger stay untouched.

alter table public.clients
  add column if not exists business_activity text,
  add column if not exists website text;

comment on column public.clients.business_activity is 'Description of the client business activity';
comment on column public.clients.website is 'Client website URL (optional)';