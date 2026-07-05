import { useEffect, useRef } from 'react';
import { supabase } from '@/services/supabase';
import { useAuth } from '@/lib/AuthContext';

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;

function urlBase64ToUint8Array(base64String) {
  if (!base64String || typeof base64String !== 'string') {
    throw new Error(
      `VAPID key must be a non-empty string, got ${typeof base64String} (length: ${base64String?.length})`
    );
  }

  // Strip any existing '=' padding first, then add the correct amount
  const withoutPad = base64String.replace(/=+$/, '');
  const padding = '='.repeat((4 - (withoutPad.length % 4)) % 4);
  const base64 = (withoutPad + padding).replace(/-/g, '+').replace(/_/g, '/');

  let rawData;
  try {
    rawData = atob(base64);
  } catch (e) {
    console.error('[PushNotification] atob failed', {
      input: base64String,
      withoutPad: { length: withoutPad.length, chars: withoutPad.slice(0, 8) + '…' + withoutPad.slice(-8) },
      encoded: { length: base64.length, chars: base64.slice(0, 8) + '…' + base64.slice(-8) },
      paddingAdded: padding.length,
      error: e.message,
    });
    throw e;
  }

  const output = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    output[i] = rawData.charCodeAt(i);
  }
  return output;
}

export function usePushNotification() {
  const { user, isAuthenticated } = useAuth();
  const subscribedRef = useRef(false);

  useEffect(() => {
    if (!isAuthenticated || !user || !VAPID_PUBLIC_KEY) return;
    if (subscribedRef.current) return;

    let cancelled = false;

    async function initPush() {
      if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
        return;
      }

      if (Notification.permission === 'denied') return;

      if (Notification.permission === 'default') {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') return;
      }

      try {
        // 1. Register the SW and wait until it's fully active
        await navigator.serviceWorker.register('/sw.js', { scope: '/' });
        const registration = await navigator.serviceWorker.ready;

        // 2. Check if we already have a valid subscription stored in our DB
        const existingPushSub = await registration.pushManager.getSubscription();

        if (existingPushSub) {
          const subJson = existingPushSub.toJSON();
          const { data: known } = await supabase
            .from('push_subscriptions')
            .select('id')
            .eq('user_id', user.id)
            .eq('subscription', subJson)
            .maybeSingle();

          if (known) {
            // Already subscribed and stored — nothing to do
            subscribedRef.current = true;
            return;
          }

          // Subscription exists in browser but isn't in our DB.
          // Unsubscribe first, then re-subscribe below so the push
          // service gets a clean state.
          await existingPushSub.unsubscribe();
        }

        // 3. Convert the VAPID public key
        let applicationServerKey;
        try {
          applicationServerKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
          console.debug('[PushNotification] VAPID key converted', {
            byteLength: applicationServerKey.length,
            firstBytes: Array.from(applicationServerKey.slice(0, 4)),
          });
        } catch (keyErr) {
          console.error('[PushNotification] VAPID key conversion failed — aborting subscribe', keyErr);
          return;
        }

        // 4. Subscribe
        const subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey,
        });

        if (cancelled) return;

        // 5. Persist to Supabase
        const { error: dbErr } = await supabase.from('push_subscriptions').upsert(
          { user_id: user.id, subscription: subscription.toJSON() },
          { onConflict: 'user_id,subscription' }
        );

        if (dbErr) {
          console.error('[PushNotification] Failed to save subscription to DB:', dbErr);
          return;
        }

        subscribedRef.current = true;
      } catch (err) {
        console.error('[PushNotification] Subscription failed', {
          name: err.name,
          message: err.message,
          vapidKey: VAPID_PUBLIC_KEY
            ? {
                present: true,
                length: VAPID_PUBLIC_KEY.length,
                firstChars: VAPID_PUBLIC_KEY.slice(0, 8),
                lastChars: VAPID_PUBLIC_KEY.slice(-8),
                hasPadding: VAPID_PUBLIC_KEY.includes('='),
              }
            : { present: false },
        });
      }
    }

    initPush();

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, user]);
}
