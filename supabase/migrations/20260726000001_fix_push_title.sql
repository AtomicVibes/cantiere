-- Fix push notification delivery: handle missing title in notifications table
-- The trigger function was passing NULL as title, causing the edge function to reject the request.

create or replace function public.handle_new_notification_push()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  edge_function_url text;
  service_role_key text;
  notification_title text;
  payload text;
begin
  edge_function_url := nullif(current_setting('app.settings.edge_function_url', true), '');
  service_role_key  := nullif(current_setting('app.settings.service_role_key', true), '');

  if edge_function_url is null or service_role_key is null then
    return new;
  end if;

  notification_title := coalesce(
    new.title,
    case new.type
      when 'message' then 'New Message'
      when 'project_update' then 'Project Update'
      when 'project_assignment' then 'Project Assignment'
      when 'role_update' then 'Role Update'
      when 'status_change' then 'Status Change'
      when 'team_assignment' then 'Team Assignment'
      when 'invoice_change' then 'Invoice Update'
      when 'permit_expiry' then 'Permit Expiry'
      when 'deadline_alert' then 'Deadline Alert'
      else 'Notification'
    end
  );

  payload := jsonb_build_object(
    'title',          notification_title,
    'body',           new.message,
    'receiver_id',    new.user_id,
    'type',           new.type,
    'url',            new.url,
    'notification_id', new.id
  )::text;

  perform net.http_post(
    url     := edge_function_url || '/functions/v1/send-push',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || service_role_key
    ),
    body    := payload
  );

  return new;
end;
$$;
