import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/services/supabase';
import { useAuth } from '@/lib/AuthContext';

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;

function urlB64ToUint8Array(base64String) {
  if (!base64String || typeof base64String !== 'string') {
    throw new Error(
      `VAPID key must be a non-empty string, got ${typeof base64String} (length: ${base64String?.length})`
    );
  }

  // 1. Replace URL-safe characters with standard Base64 equivalents
  let base64 = base64String.replace(/-/g, '+').replace(/_/g, '/');

  // 2. Add trailing padding so the length is divisible by 4
  while (base64.length % 4 !== 0) {
    base64 += '=';
  }

  // 3. Decode
  let rawData;
  try {
    rawData = atob(base64);
  } catch (e) {
    console.error('[PushNotification] atob failed', {
      input: base64String,
      encoded: { length: base64.length, chars: base64.slice(0, 8) + '…' + base64.slice(-8) },
      error: e.message,
    });
    throw e;
  }

  // 4. Wrap in Uint8Array
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }

  console.log('Converted array length:', outputArray.length);
  return outputArray;
}

/** True when the user-agent is iOS Safari (not a third-party browser). */
function isIosSafari() {
  const ua = navigator.userAgent;
  return (
    (/iPhone|iPad|iPod/.test(ua) && /Safari/.test(ua) && !/CriOS|OPiOS|FxiOS|EdgiOS/.test(ua))
  );
}

/** True when the iOS PWA is running in standalone (full-screen) mode. */
function isIosStandalone() {
  return 'standalone' in navigator && navigator.standalone;
}

export function usePushNotification() {
  const { user, isAuthenticated } = useAuth();
  const subscribedRef = useRef(false);
  const isSubscribingRef = useRef(false);
  const iosToastShown = useRef(false);

  useEffect(() => {
    if (!isAuthenticated || !user || !VAPID_PUBLIC_KEY) return;
    if (subscribedRef.current) return;

    let cancelled = false;

    async function initPush() {
      // ── Execution lock ─────────────────────────────────────────────
      // Supabase onAuthStateChange / _useSession can fire multiple times
      // concurrently during init, racing the same async subscription path.
      // If a call is already in-flight, deflect the duplicate immediately.
      if (isSubscribingRef.current) {
        console.log('[PushNotification] Subscription already in progress, skipping duplicate call.');
        return;
      }
      isSubscribingRef.current = true;
      // ── Feature detection ──────────────────────────────────────────
      if (!('Notification' in window)) {
        console.info('[PushNotification] Notifications API unavailable — skipping registration');
        return;
      }

      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        console.info(
          '[PushNotification] Service Worker / PushManager unavailable — ' +
          'notifications will only work in-app'
        );
        return;
      }

      // ── iOS Safari standalone guard ────────────────────────────────
      if (isIosSafari() && !isIosStandalone() && !iosToastShown.current) {
        iosToastShown.current = true;
        const dismiss = toast.info(
          'Per attivare le notifiche, aggiungi Geometra alla schermata Home dal menu Condividi di Safari.',
          {
            duration: 8000,
            action: {
              label: 'OK',
              onClick: () => dismiss(),
            },
          }
        );
        return;
      }

      // ── Permission ─────────────────────────────────────────────────
      if (Notification.permission === 'denied') return;

      if (Notification.permission === 'default') {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') return;
      }

      if (cancelled) return;

      try {
        // 1. Register the SW and wait until it's fully active
        await navigator.serviceWorker.register('/sw.js', { scope: '/' });
        const registration = await navigator.serviceWorker.ready;

        // 2. If an old subscription exists, unsubscribe it first so the
        //    push service starts with a clean slate for the fresh one.
        const oldSub = await registration.pushManager.getSubscription();
        if (oldSub) {
          await oldSub.unsubscribe();
        }

        // 3. Convert the VAPID public key
        console.log('[PushNotification] VAPID key source:', {
          present: typeof VAPID_PUBLIC_KEY === 'string' && VAPID_PUBLIC_KEY.length > 0,
          type: typeof VAPID_PUBLIC_KEY,
          length: typeof VAPID_PUBLIC_KEY === 'string' ? VAPID_PUBLIC_KEY.length : 0,
          preview: typeof VAPID_PUBLIC_KEY === 'string' ? VAPID_PUBLIC_KEY.slice(0, 12) + '…' : 'N/A',
        });

        let applicationServerKey;
        try {
          applicationServerKey = urlB64ToUint8Array(VAPID_PUBLIC_KEY);
          if (applicationServerKey.length !== 65) {
            console.warn(
              '[PushNotification] VAPID key has unexpected byte length — expected 65, got ' + applicationServerKey.length,
              { firstBytes: Array.from(applicationServerKey.slice(0, 4)), totalLength: applicationServerKey.length }
            );
          } else {
            console.log('[PushNotification] VAPID key confirmed at 65 bytes — valid P-256 uncompressed point');
          }
        } catch (keyErr) {
          console.error(
            '[PushNotification] VAPID key conversion failed — aborting subscribe\n' +
            '  name: ' + keyErr.name + '\n' +
            '  message: ' + keyErr.message,
            JSON.stringify(keyErr, Object.getOwnPropertyNames(keyErr))
          );
          return;
        }

        // 4. Guard: permission may have been revoked since the earlier check
        if (Notification.permission === 'denied') {
          console.warn('[PushNotification] Push notifications are blocked by the user\'s browser settings.');
          return;
        }

        // 5. Subscribe
        const subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey,
        });

        if (cancelled) return;

        // 6. Persist to Supabase
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
        isSubscribingRef.current = false;
        console.error(
          '[PushNotification] Subscription failed\n' +
          '  name: ' + (err.name || '(no name)') + '\n' +
          '  message: ' + (err.message || '(no message)') + '\n' +
          '  VAPID key present: ' + (typeof VAPID_PUBLIC_KEY === 'string' && VAPID_PUBLIC_KEY.length > 0) + '\n' +
          '  VAPID key length: ' + (typeof VAPID_PUBLIC_KEY === 'string' ? VAPID_PUBLIC_KEY.length : 0),
          JSON.stringify(err, Object.getOwnPropertyNames(err))
        );
      }
    }

    initPush();

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, user]);
}
