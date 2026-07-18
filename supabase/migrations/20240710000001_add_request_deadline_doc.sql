ALTER TABLE public.project_requests
ADD COLUMN IF NOT EXISTS estimated_deadline DATE,
ADD COLUMN IF NOT EXISTS document_url TEXT;
