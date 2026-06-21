-- =============================================================
-- Migration: add display fields to public.profiles + update trigger
-- =============================================================

-- 1. Add columns for team member display info
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS full_name TEXT,
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS job_title TEXT,
  ADD COLUMN IF NOT EXISTS department TEXT;

-- 2. Update the trigger function to read these from raw_user_meta_data
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_role_id UUID;
  v_default_role_id UUID;
BEGIN
  v_role_id := (NEW.raw_user_meta_data ->> 'role_id')::UUID;

  IF v_role_id IS NULL THEN
    SELECT id INTO v_default_role_id FROM public.roles WHERE name = 'client' LIMIT 1;
    v_role_id := v_default_role_id;
  END IF;

  INSERT INTO public.profiles (id, email, role_id, full_name, phone, job_title, department, created_at, updated_at)
  VALUES (
    NEW.id,
    NEW.email,
    v_role_id,
    NEW.raw_user_meta_data ->> 'full_name',
    NEW.raw_user_meta_data ->> 'phone',
    NEW.raw_user_meta_data ->> 'job_title',
    NEW.raw_user_meta_data ->> 'department',
    NOW(),
    NOW()
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;
