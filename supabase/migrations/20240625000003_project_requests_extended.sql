ALTER TABLE public.project_requests
ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
ADD COLUMN IF NOT EXISTS category TEXT,
ADD COLUMN IF NOT EXISTS address TEXT,
ADD COLUMN IF NOT EXISTS budget NUMERIC;

ALTER TABLE public.project_requests
DROP CONSTRAINT IF EXISTS project_requests_status_check;

ALTER TABLE public.project_requests
ADD CONSTRAINT project_requests_status_check
CHECK (status IN ('pending', 'verification', 'validated', 'rejected'));

INSERT INTO storage.buckets (id, name, public)
VALUES ('project-docs', 'project-docs', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Clients can upload project docs"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'project-docs'
  AND auth.role() = 'authenticated'
);

CREATE POLICY "Admins can read all project docs"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'project-docs'
  AND (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
      AND role_id IN (SELECT id FROM public.roles WHERE name IN ('super_admin', 'admin'))
    )
    OR (storage.foldername(name))[1] IN (
      SELECT c.id::text FROM public.clients c WHERE c.profile_id = auth.uid()
    )
  )
);

CREATE OR REPLACE FUNCTION public.validate_project_request(p_request_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_request public.project_requests%ROWTYPE;
  v_project_id UUID;
BEGIN
  SELECT * INTO v_request FROM public.project_requests WHERE id = p_request_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Request not found');
  END IF;

  IF v_request.status != 'verification' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Request must be in verification status');
  END IF;

  INSERT INTO public.projects (name, client_id, budget, status)
  VALUES (v_request.project_name, v_request.client_id, v_request.budget, 'draft')
  RETURNING id INTO v_project_id;

  UPDATE public.project_requests
  SET status = 'validated'
  WHERE id = p_request_id;

  RETURN jsonb_build_object('success', true, 'project_id', v_project_id);
END;
$$;
