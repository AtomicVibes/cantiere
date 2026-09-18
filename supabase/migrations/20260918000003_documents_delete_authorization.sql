-- Align document deletion with the application permission model.
--
-- The Delete action is only rendered for super_admin (PERMISSIONS.canDeleteDocument),
-- and the storage.objects DELETE policy already authorises elevated roles to remove
-- document objects. The metadata DELETE policy was owner-only, so a super_admin
-- deleting a document they do not own matched zero rows; PostgREST answered 200 with
-- an empty array and no error, which surfaced in the app as DELETE_NOT_APPLIED while
-- the row was still there.
--
-- This widens nothing else: SELECT visibility (private / public / selected),
-- INSERT and UPDATE policies, the document_audience policies, the storage policies
-- and RLS itself are untouched, so a document stays readable only by its owner, its
-- audience and authorised roles.

drop policy if exists "Owners can delete documents" on public.documents;
drop policy if exists "Users can delete their own documents" on public.documents;
drop policy if exists "Owners and super admins can delete documents" on public.documents;

create policy "Owners and super admins can delete documents"
  on public.documents for delete to authenticated
  using (
    user_id = auth.uid()
    or public.is_super_admin()
  );

-- The policy above calls this helper; make sure authenticated users may evaluate it.
grant execute on function public.is_super_admin() to authenticated;

notify pgrst, 'reload schema';