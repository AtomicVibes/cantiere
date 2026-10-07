-- Account identity availability probe: close the anon hole.
--
-- Postgres grants EXECUTE to PUBLIC by default, so revoking only from anon in
-- 20261017120000_account_uniqueness.sql left the anonymous role able to call
-- account_identity_available and enumerate registered emails/usernames.
-- Restrict it to the callers that actually need it: authenticated admins
-- (Add Member / Edit Member pre-check) and service_role (edge functions).
revoke execute on function public.account_identity_available(text, text, uuid) from public, anon;
grant execute on function public.account_identity_available(text, text, uuid) to authenticated;
grant execute on function public.account_identity_available(text, text, uuid) to service_role;

notify pgrst, 'reload schema';
