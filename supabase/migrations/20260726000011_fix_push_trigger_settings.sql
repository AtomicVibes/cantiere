-- Replace the custom-db-setting approach with hardcoded values,
-- because Supabase managed databases do not allow ALTER DATABASE SET for
-- custom app.settings.* parameters.
--
-- The service_role key is embedded in the SECURITY DEFINER function body,
-- which is the standard pattern for DB-trigger-to-edge-function calls on Supabase.

create or replace function public.handle_new_notification_push()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  edge_function_url text := 'https://hrtncnmmykzckemykesu.supabase.co/functions/v1/send-push';
  service_role_key text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhydG5jbm1teWt6Y2ttZXlrZXN1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczMjQ5MDkxMCwiZXhwIjoyMDQ4MDY2OTEwfQ.4mqWWPVIL3RO7gTTqgQ3J9NC_w6y7-1bQN4me97I4JA';
  payload text;
begin
  payload := jsonb_build_object(
    'title',          new.title,
    'body',           new.message,
    'receiver_id',    new.user_id,
    'type',           new.type,
    'url',            new.url,
    'notification_id', new.id
  )::text;

  perform net.http_post(
    url     := edge_function_url,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || service_role_key
    ),
    body    := payload
  );

  return new;
end;
$$;
