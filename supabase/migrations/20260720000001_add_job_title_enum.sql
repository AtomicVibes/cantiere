-- =============================================================
-- Migration: Add job_title enum and apply it to profiles.job_title
-- =============================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'job_title_enum') THEN
    CREATE TYPE public.job_title_enum AS ENUM (
      'project_manager',
      'project_coordinator',
      'supervisor',
      'architect',
      'civil_engineer',
      'interior_designer',
      'technician',
      'accountant',
      'procurement_officer',
      'supplier',
      'contractor',
      'safety_officer',
      'surveyor',
      'consultant'
    );
  END IF;
END $$;

ALTER TABLE public.profiles
  ALTER COLUMN job_title TYPE public.job_title_enum
  USING (
    CASE
      WHEN job_title IS NULL OR btrim(job_title) = '' THEN NULL
      ELSE job_title::public.job_title_enum
    END
  );
