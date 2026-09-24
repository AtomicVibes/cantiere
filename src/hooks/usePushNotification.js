import { supabase } from '@/services/supabase';

const VITE_VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;

function urlB64ToUint8Array(base64String) {
  if (!base64String || typeof base64String !== 'string') {
    console.error('Push: VAPID key is empty or not a string');
    return null;
  }

  const urlSafe = /^[A-Za-z0-9\-_]+$/;
  if (!urlSafe.test(base64String.replace(/=+$/, ''))) {
    console.error('Push: VAPID key contains invalid characters (not URL-safe base64)');
    return null;
  }

  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  let rawData;
  try {
    rawData = window.atob(base64);
  } catch (e) {
    console.error('Push: VAPID key base64 decode failed', e.message);
    return null;
  }

  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }

  if (outputArray.length !== 65) {
    console.error('Push: VAPID key decoded to', outputArray.length, 'bytes (expected 65)');
    return null;
  }

  return outputArray;
}

async function persistSubscription(userId, subscription) {
  await supabase
    .from('push_subscriptions')
    .upsert(
      { user_id: userId, subscription: subscription.toJSON() },
      { onConflict: 'user_id,subscription' }
    );
  await supabase
    .rpc('claim_push_subscription', { p_endpoint: subscription.endpoint || subscription.toJSON().endpoint });
}

export async function subscribeUserToPush(userId) {
  if (!('serviceWorker' in navigator)) {
    console.warn('Push: serviceWorker not available');
    return null;
  }
  if (!('PushManager' in window)) {
    console.warn('Push: PushManager not available');
    return null;
  }
  if (!VITE_VAPID_PUBLIC_KEY) {
    console.warn('Push: VITE_VAPID_PUBLIC_KEY not configured');
    return null;
  }

  // Browser permission and the app subscription are separate concepts.
  // subscribe() itself triggers the browser prompt when called from a user
  // gesture; a hard denial must surface so Settings can show "blocked".
  if (typeof Notification !== 'undefined' && Notification.permission === 'denied') {
    const err = new Error('Push: browser notification permission is denied');
    err.name = 'PermissionDeniedError';
    console.error(err.message);
    throw err;
  }

  const applicationServerKey = urlB64ToUint8Array(VITE_VAPID_PUBLIC_KEY);
  if (!applicationServerKey) {
    console.error('Push: cannot subscribe — invalid VAPID public key');
    return null;
  }

  let reg;
  try {
    reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  } catch (err) {
    console.error('Push: SW registration failed', err);
    return null;
  }

  try {
    reg = await navigator.serviceWorker.ready;
  } catch (err) {
    console.error('Push: SW ready failed', err);
    return null;
  }

  let existingSub;
  try {
    existingSub = await reg.pushManager.getSubscription();
  } catch (err) {
    console.error('Push: getSubscription failed', err);
  }
  if (existingSub) {
    try {
      await persistSubscription(userId, existingSub);
    } catch (err) {
      console.error('Push: DB upsert of existing sub failed', err);
    }
    return existingSub;
  }

  let sub;
  try {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey,
    });
  } catch (err) {
    console.error('Push: subscribe failed', err.name, err.message);
    if (err.code === 20 || err.name === 'AbortError') {
      console.warn('Push: subscription aborted (AbortError) — browser may require user gesture');
    }
    if (err.name === 'NotSupportedError') {
      console.warn('Push: encryption not supported on this browser');
    }
    if (err.name === 'InvalidStateError') {
      console.warn('Push: subscription already exists or service worker not activated');
    }
    return null;
  }

  try {
    await persistSubscription(userId, sub);
  } catch (err) {
    console.error('Push: DB upsert failed', err);
    return null;
  }

  return sub;
}

// Reclaims the current browser endpoint for the signed-in user WITHOUT
// subscribing or prompting: safe to run on every login/session change.
// Prevents cross-account leakage on shared browsers (User A logs out,
// User B logs in -> the endpoint moves to B, so A stops receiving pushes
// here and B receives their own). Idempotent server-side.
export async function claimCurrentSubscription() {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return 0;
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub?.endpoint) return 0;
    const { error } = await supabase
      .rpc('claim_push_subscription', { p_endpoint: sub.endpoint });
    if (error) {
      console.error('Push: claim failed', error);
      return 0;
    }
    return 1;
  } catch (err) {
    console.error('Push: claim failed', err);
    return 0;
  }
}
// Bridges service-worker pushsubscriptionchange renewals (public/sw.js
// posts PUSH_SUBSCRIPTION_CHANGED) into push_subscriptions for the user
// that is currently signed in, and reclaims the endpoint for that user.
// Safe to start once globally: the handler resolves the current session
// at message time, so it stays correct across login/logout/account switch.
export function startPushSubscriptionRelay() {
  if (!('serviceWorker' in navigator)) {
    return () => {};
  }

  const handler = (event) => {
    if (event.data?.type !== 'PUSH_SUBSCRIPTION_CHANGED') return;
    const subscription = event.data.subscription;
    if (!subscription?.endpoint) return;

    (async () => {
      try {
        const { data: { user }, error } = await supabase.auth.getUser();
        if (error || !user) return;
        await supabase
          .from('push_subscriptions')
          .upsert(
            { user_id: user.id, subscription },
            { onConflict: 'user_id,subscription' }
          );
        await supabase
          .rpc('claim_push_subscription', { p_endpoint: subscription.endpoint });
      } catch (err) {
        console.error('Push: relay persist failed', err);
      }
    })();
  };

  navigator.serviceWorker.addEventListener('message', handler);
  return () => navigator.serviceWorker.removeEventListener('message', handler);
}