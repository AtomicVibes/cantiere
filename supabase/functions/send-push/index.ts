import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'npm:web-push';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY')!;
const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY')!;
const vapidSubject = Deno.env.get('VAPID_SUBJECT') || 'mailto:notifications@geometra.app';

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function respond(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return respond({ error: 'Method not allowed' }, 405);
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return respond({ error: 'Unauthorized' }, 401);
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) {
      return respond({ error: 'Invalid authorization' }, 401);
    }

    const { title, body, receiver_id, type, notification_id } = await req.json();

    if (!title || !receiver_id) {
      return respond({ error: 'Missing required fields: title, receiver_id' }, 400);
    }

    const { data: subscriptions, error: subError } = await supabase
      .from('push_subscriptions')
      .select('subscription')
      .eq('user_id', receiver_id);

    if (subError) {
      console.error('Error fetching subscriptions:', subError);
      return respond({ error: 'Failed to fetch subscriptions' }, 500);
    }

    if (!subscriptions || subscriptions.length === 0) {
      return respond({ sent: 0, message: 'No subscriptions found' });
    }

    const displayBody = body && body.length > 200 ? body.substring(0, 200) + '…' : body || '';
    const payload = JSON.stringify({ title, body: displayBody, type, notification_id });

    const results = await Promise.allSettled(
      subscriptions.map((sub) =>
        webpush.sendNotification(sub.subscription, payload).catch(async (err) => {
          if (err.statusCode === 410 || err.statusCode === 404) {
            await supabase
              .from('push_subscriptions')
              .delete()
              .eq('id', sub.id)
              .then(() => console.log('Deleted expired subscription', sub.id));
          } else {
            console.error('Push send error:', err.message);
          }
          return null;
        })
      )
    );

    const successful = results.filter((r) => r.status === 'fulfilled' && r.value !== null).length;

    return respond({
      sent: successful,
      total: subscriptions.length,
      failed: subscriptions.length - successful,
    });
  } catch (err) {
    console.error('Unexpected error:', err);
    return respond({ error: 'Internal server error', detail: err?.message }, 500);
  }
});
