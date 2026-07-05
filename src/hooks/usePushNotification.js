import { useState, useEffect } from 'react';
import { supabase } from '@/services/supabase';
import { useAuth } from '@/lib/AuthContext';

const VITE_VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;

// Module-scoped lock — survives React component unmount/remount cycles
// that destroy useRef state during Supabase auth lifecycle transitions.
let isPushSubscribingGlobal = false;

function urlB64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  console.log('Converted array length:', outputArray.length);
  return outputArray;
}

export function usePushNotification() {
  const { user, isAuthenticated } = useAuth();
  const [pushError, setPushError] = useState(null);

  useEffect(() => {
    if (!isAuthenticated || !user || !VITE_VAPID_PUBLIC_KEY) return;

    let cancelled = false;

    (async () => {
      // ── Global in-flight guard ─────────────────────────────────────
      // Survives React unmount/remount cycles that destroy useRef state.
      if (isPushSubscribingGlobal) {
        console.log('[PushNotification] Global lock active. Deflecting duplicate concurrent call.');
        return;
      }
      isPushSubscribingGlobal = true;

      try {
        console.log('--- Push Subscription Debug ---');

        // ── Service worker support ─────────────────────────────────────
        console.log('Step 1: Checking for service worker support...');
        if (!('serviceWorker' in navigator)) {
          console.log('Web Push not supported');
          return;
        }

        // ── Register + ready ───────────────────────────────────────────
        console.log('Step 2: Registering and waiting for service worker...');
        try {
          await navigator.serviceWorker.register('/sw.js', { scope: '/' });
        } catch (swErr) {
          console.log('Service worker registration error: ' + swErr.message);
          return;
        }
        const reg = await navigator.serviceWorker.ready;
        console.log('Service worker is ready! Scope: ' + reg.scope);

        // ── Permission ─────────────────────────────────────────────────
        console.log('Step 3: Requesting notification permission...');
        const permission = await Notification.requestPermission();
        console.log('Permission result: ' + permission);
        if (permission !== 'granted') {
          return;
        }

        // ── Check for an existing subscription FIRST ───────────────────
        // If the browser already has one, sync it to Supabase and skip
        // the subscribe() call entirely — avoids the FCM gateway race.
        const existingSub = await reg.pushManager.getSubscription();
        if (existingSub) {
          console.log('[PushNotification] Existing subscription detected');
          const { error } = await supabase
            .from('push_subscriptions')
            .upsert(
              { user_id: user.id, subscription: existingSub.toJSON() },
              { onConflict: 'user_id,subscription' }
            );
          if (error) {
            console.error('Supabase write failed:', error);
          } else {
            console.log('Successfully synced existing subscription to push_subscriptions table!');
          }
          return;
        }

        // ── Convert the VAPID key ─────────────────────────────────────
        console.log('Step 4: Converting VAPID key...');
        console.log('Converting key: ' + VITE_VAPID_PUBLIC_KEY);
        const applicationServerKey = urlB64ToUint8Array(VITE_VAPID_PUBLIC_KEY);

        // ── Subscribe (only reached if no existing subscription) ───────
        console.log('Step 5: Subscribing to push...');
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey,
        });
        console.log('Browser generated push subscription token successfully!');

        // ── Persist to Supabase ────────────────────────────────────────
        console.log('Step 6: Saving to Supabase...');
        const { error: saveErr } = await supabase
          .from('push_subscriptions')
          .upsert(
            { user_id: user.id, subscription: sub.toJSON() },
            { onConflict: 'user_id,subscription' }
          );
        if (saveErr) {
          console.error('Supabase write failed:', saveErr);
        } else {
          console.log('Successfully saved token to push_subscriptions table!');
        }
      } catch (error) {
        if (error.name === 'AbortError') {
          console.log(
            'Push subscription error: Registration failed - push service error. ' +
            'This is a network-level failure between the browser and the push ' +
            'service gateway (FCM/APNs). Common causes:\n' +
            '  - Firewall or VPN blocking fcm.googleapis.com\n' +
            '  - Ad-blocker or privacy extension interfering\n' +
            '  - Corrupted service worker cache (try Clear Site Data in DevTools)\n' +
            '  - The VAPID key is mathematically invalid (run scripts/validate-vapid-key.mjs to confirm)'
          );
          setPushError('AbortError');
        } else if (error.name === 'InvalidStateError') {
          console.log('Push subscription error: ' + error.message + ' (already has a subscription in a bad state)');
          setPushError('InvalidStateError');
        } else if (error.name === 'NotAllowedError') {
          console.log('Push subscription error: ' + error.message + ' (permission denied or blocked)');
          setPushError('NotAllowedError');
        } else {
          console.log('Push subscription error: ' + error.message);
          setPushError(error.name || 'UnknownError');
        }
      } finally {
        isPushSubscribingGlobal = false;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, user]);

  return { pushError };
}
