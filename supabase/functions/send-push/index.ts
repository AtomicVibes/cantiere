import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sendNotification, WebPushError } from 'https://esm.sh/web-push-neo@0.1.2';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY')!;
const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY')!;
const vapidSubject = Deno.env.get('VAPID_SUBJECT') || Deno.env.get('VAPID_CONTACT_EMAIL') || 'mailto:notifications@geometra.app';
const internalPushToken = Deno.env.get('INTERNAL_PUSH_TOKEN')!;

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

const vapidOptions = { subject: vapidSubject, publicKey: vapidPublicKey, privateKey: vapidPrivateKey };

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, x-push-token, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function respond(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function safeMessage(err: unknown, maxLength = 160): string {
  if (!(err instanceof WebPushError)) {
    return ((err as Error)?.message || 'Unknown error').slice(0, maxLength);
  }
  return `status ${err.statusCode}: ${(err.body || err.message).toString().slice(0, maxLength)}`;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return respond({ error: 'Method not allowed' }, 405);
  }

  if (!vapidPublicKey || !vapidPrivateKey) {
    return respond({ error: 'Server misconfigured: VAPID keys not set' }, 500);
  }

  let receiverId: string | undefined;
  let caller: 'internal' | 'user' | null = null;

  // 1. Authenticate the caller.
  //    - The database trigger (handle_new_notification_push) sends
  //      x-push-token = INTERNAL_PUSH_TOKEN (Vault + function env).
  //    - Any valid user JWT is accepted, but receiver is forced to
  //      that user's own id.
  //    - Service-role tokens are NOT trusted here: the old embedded
  //      key leaked and must stay useless for this endpoint.
  const xPushToken = req.headers.get('x-push-token');
  if (xPushToken && internalPushToken && xPushToken === internalPushToken) {
    caller = 'internal';
  } else {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return respond({ error: 'Unauthorized' }, 401);
    }
    const token = authHeader.replace(/^Bearer\s+/i, '');
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user?.id) {
      return respond({ error: 'Invalid authorization' }, 401);
    }
    caller = 'user';
    receiverId = user.id;
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return respond({ error: 'Invalid JSON body' }, 400);
  }

  const { title, body: bodyText, type, url, notification_id } = body || {};

  if (caller === 'internal') {
    receiverId = body?.receiver_id;
  } else if (body?.receiver_id && body.receiver_id !== receiverId) {
    return respond({ error: 'Forbidden: can only push to yourself' }, 403);
  }

  if (!title || !receiverId) {
    return respond({ error: 'Missing required fields: title, receiver_id' }, 400);
  }

  const { data: subscriptions, error: subError } = await supabase
    .from('push_subscriptions')
    .select('id, subscription')
    .eq('user_id', receiverId);

  if (subError) {
    console.error('Error fetching subscriptions:', subError);
    return respond({ error: 'Failed to fetch subscriptions' }, 500);
  }

  // Account-level push preference: OFF means no push delivery for this user.
  // In-app notifications and SMS are unaffected (handled elsewhere).
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('push_notifications_enabled')
    .eq('id', receiverId)
    .maybeSingle();

  if (profileError) {
    console.error('Error fetching push preference:', profileError);
    return respond({ error: 'Failed to fetch push preference' }, 500);
  }

  if (profile && profile.push_notifications_enabled === false) {
    try {
      await supabase.from('push_delivery_log').insert({
        notification_id: notification_id || null,
        user_id: receiverId,
        subscription_id: null,
        status: 'skipped',
        error: 'Push disabled by user preference',
      });
    } catch (logErr) {
      console.error('Failed to write push delivery log:', logErr);
    }
    return respond({ sent: 0, message: 'Push disabled by user preference' });
  }

  if (!subscriptions || subscriptions.length === 0) {
    try {
      await supabase.from('push_delivery_log').insert({
        notification_id: notification_id || null,
        user_id: receiverId,
        subscription_id: null,
        status: 'skipped',
        error: 'No subscriptions found',
      });
    } catch (logErr) {
      console.error('Failed to write push delivery log:', logErr);
    }
    return respond({ sent: 0, message: 'No subscriptions found' });
  }

  const displayBody = bodyText && bodyText.length > 200 ? bodyText.substring(0, 200) + '…' : (bodyText || '');
  const payload = JSON.stringify({ title, body: displayBody, type, url, notification_id });

  async function writeLog(entry: {
    notification_id?: string | null;
    user_id: string;
    subscription_id?: string | null;
    status: 'sent' | 'failed' | 'skipped' | 'stale_removed';
    error?: string | null;
  }) {
    try {
      await supabase.from('push_delivery_log').insert({
        notification_id: entry.notification_id ?? (notification_id || null),
        user_id: entry.user_id,
        subscription_id: entry.subscription_id ?? null,
        status: entry.status,
        error: entry.error ?? null,
      });
    } catch (logErr) {
      console.error('Failed to write push delivery log:', logErr);
    }
  }

  const results = await Promise.allSettled(
    subscriptions.map(async (sub) => {
      try {
        const res = await sendNotification(sub.subscription, payload, {
          vapidDetails: vapidOptions,
          signal: AbortSignal.timeout(10_000),
        });
        await writeLog({ user_id: receiverId, subscription_id: sub.id, status: 'sent' });
        return { ok: true, statusCode: res.statusCode };
      } catch (err) {
        if (err instanceof WebPushError) {
          // Permanent: endpoint gone (404/410) or push-service auth failure
          // (400/401/403, e.g. after a VAPID rotation). The subscription can
          // never succeed again, so remove it; the browser re-subscribes on
          // next enable and the fresh endpoint is persisted + claimed.
          if ([400, 401, 403, 404, 410].includes(err.statusCode)) {
            const { error: deleteError } = await supabase
              .from('push_subscriptions')
              .delete()
              .eq('id', sub.id);
            if (deleteError) {
              console.error('Failed to delete stale subscription', sub.id, deleteError);
            } else {
              console.log('Deleted stale subscription', sub.id, `status ${err.statusCode}`);
            }
            await writeLog({
              user_id: receiverId,
              subscription_id: sub.id,
              status: 'stale_removed',
              error: safeMessage(err),
            });
          } else {
            await writeLog({
              user_id: receiverId,
              subscription_id: sub.id,
              status: 'failed',
              error: safeMessage(err),
            });
          }
        } else {
          await writeLog({
            user_id: receiverId,
            subscription_id: sub.id,
            status: 'failed',
            error: safeMessage(err),
          });
        }
        throw err;
      }
    })
  );

  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  const rejected = results.filter((r) => r.status === 'rejected');

  return respond({
    sent: fulfilled.length,
    total: subscriptions.length,
    failed: rejected.length,
    details: results.map((r) =>
      r.status === 'fulfilled'
        ? { ok: true, statusCode: r.value.statusCode }
        : { ok: false, error: safeMessage(r.reason) }
    ),
  });
});