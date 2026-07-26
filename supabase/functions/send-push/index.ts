import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sendNotification } from 'https://esm.sh/web-push-neo@0.1.2';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY')!;
const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY')!;
const vapidSubject = Deno.env.get('VAPID_SUBJECT') || Deno.env.get('VAPID_CONTACT_EMAIL') || 'mailto:notifications@geometra.app';

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

const vapidOptions = { subject: vapidSubject, publicKey: vapidPublicKey, privateKey: vapidPrivateKey };

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

    const { title, body, receiver_id, type, url, notification_id } = await req.json();

    if (!title || !receiver_id) {
      return respond({ error: 'Missing required fields: title, receiver_id' }, 400);
    }

    const { data: subscriptions, error: subError } = await supabase
      .from('push_subscriptions')
      .select('id, subscription')
      .eq('user_id', receiver_id);

    if (subError) {
      console.error('Error fetching subscriptions:', subError);
      return respond({ error: 'Failed to fetch subscriptions' }, 500);
    }

    if (!subscriptions || subscriptions.length === 0) {
      return respond({ sent: 0, message: 'No subscriptions found' });
    }

    const displayBody = body && body.length > 200 ? body.substring(0, 200) + '…' : body || '';
    const payload = JSON.stringify({ title, body: displayBody, type, url, notification_id });

    const results = await Promise.allSettled(
      subscriptions.map(async (sub) => {
        console.log('Processing subscription structure:', JSON.stringify(sub.subscription));

        try {
          const res = await sendNotification(sub.subscription, payload, { vapidDetails: vapidOptions });
          return res;
        } catch (err) {
          console.error('Detailed push error for endpoint:', sub.subscription?.endpoint, err);
          if (err.statusCode === 410 || err.statusCode === 404) {
            await supabase
              .from('push_subscriptions')
              .delete()
              .eq('id', sub.id);
            console.log('Deleted expired subscription', sub.id);
          }
          throw err;
        }
      })
    );

    const successful = results.filter((r) => r.status === 'fulfilled').length;

    return respond({
      sent: successful,
      total: subscriptions.length,
      failed: subscriptions.length - successful,
      details: results.map(r => r.status === 'rejected' ? r.reason?.message : 'success'),
    });
  } catch (err) {
    console.error('Unexpected error:', err);
    return respond({ error: 'Internal server error', detail: err?.message }, 500);
  }
});
