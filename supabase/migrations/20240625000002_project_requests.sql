CREATE TABLE IF NOT EXISTS public.project_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  project_name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.project_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Clients can insert own requests"
  ON public.project_requests FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
      AND role_id = (SELECT id FROM public.roles WHERE name = 'client')
    )
  );

CREATE POLICY "Clients can view own requests"
  ON public.project_requests FOR SELECT
  USING (
    client_id IN (
      SELECT c.id FROM public.clients c
      WHERE c.profile_id = auth.uid()
    )
  );

CREATE POLICY "Admins can view all requests"
  ON public.project_requests FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
      AND role_id IN (SELECT id FROM public.roles WHERE name IN ('super_admin', 'admin'))
    )
  );

CREATE POLICY "Admins can update requests"
  ON public.project_requests FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
      AND role_id IN (SELECT id FROM public.roles WHERE name IN ('super_admin', 'admin'))
    )
  );

CREATE INDEX idx_project_requests_client_id ON public.project_requests(client_id);
CREATE INDEX idx_project_requests_status ON public.project_requests(status);
