import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/services/supabase';
import { useAuth } from '@/lib/AuthContext';

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;

/**
 * Decode a URL-safe Base64-encoded VAPID public key into a Uint8Array.
 *
 * The VAPID spec (RFC 8292 §3) uses the "URL and Filename safe" Base64
 * alphabet (RFC 4648 §5) — `-` → `+`, `_` → `/` — with **omitted** padding.
 *
 * Both APNs and FCM expect the raw 65-byte uncompressed P-256 public key
 * (04 || x-coordinate || y-coordinate).  The steps are identical for every
 * push service because the algorithm is defined at the spec level.
 *
 * 1. Strip any existing `=` padding (some env sources may include it).
 * 2. Re-add the correct amount so `atob()` decodes without error.
 * 3. Replace URL-safe characters with standard Base64 equivalents.
 * 4. Decode and wrap in a Uint8Array.
 */
function urlBase64ToUint8Array(base64String) {
  if (!base64String || typeof base64String !== 'string') {
    throw new Error(
      `VAPID key must be a non-empty string, got ${typeof base64String} (length: ${base64String?.length})`
    );
  }

  // Strip any existing '=' padding, then add the correct amount
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

  // P-256 uncompressed public key MUST be exactly 65 bytes (04 || x || y)
  if (output.length !== 65) {
    console.warn(
      '[PushNotification] VAPID key has unexpected length — expected 65 bytes for P-256, got ' + output.length,
      { firstBytes: Array.from(output.slice(0, 4)), totalLength: output.length }
    );
  }

  return output;
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
  const iosToastShown = useRef(false);

  useEffect(() => {
    if (!isAuthenticated || !user || !VAPID_PUBLIC_KEY) return;
    if (subscribedRef.current) return;

    let cancelled = false;

    async function initPush() {
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
      // Push notifications on iOS Safari only work when the app runs
      // in PWA standalone mode ("Add to Home Screen").
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

        // 3. Verify the VAPID key is present before converting
        console.log('[PushNotification] VAPID key source:', {
          present: typeof VAPID_PUBLIC_KEY === 'string' && VAPID_PUBLIC_KEY.length > 0,
          type: typeof VAPID_PUBLIC_KEY,
          length: typeof VAPID_PUBLIC_KEY === 'string' ? VAPID_PUBLIC_KEY.length : 0,
          preview: typeof VAPID_PUBLIC_KEY === 'string' ? VAPID_PUBLIC_KEY.slice(0, 12) + '…' : 'N/A',
        });

        let applicationServerKey;
        try {
          applicationServerKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
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
