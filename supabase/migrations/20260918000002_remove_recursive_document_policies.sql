-- Remove legacy document policies that recursively queried documents and document_audience.
-- The helper-backed policies from 20260918000001 remain authoritative.

drop policy if exists "Users can view documents they are allowed to access" on public.documents;
drop policy if exists "Users can view audience of accessible documents" on public.document_audience;

notify pgrst, 'reload schema';
