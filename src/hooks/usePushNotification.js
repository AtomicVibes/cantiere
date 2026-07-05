import { useEffect } from 'react';
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
  return outputArray;
}

export function usePushNotification() {
  const { user, isAuthenticated } = useAuth();

  useEffect(() => {
    if (!isAuthenticated || !user || !VITE_VAPID_PUBLIC_KEY) return;

    let cancelled = false;

    (async () => {
      if (isPushSubscribingGlobal) return;
      isPushSubscribingGlobal = true;

      try {
        if (!('serviceWorker' in navigator)) return;

        try {
          await navigator.serviceWorker.register('/sw.js', { scope: '/' });
        } catch {
          return;
        }
        const reg = await navigator.serviceWorker.ready;

        const permission = await Notification.requestPermission();
        if (permission !== 'granted') return;

        const existingSub = await reg.pushManager.getSubscription();
        if (existingSub) {
          await supabase
            .from('push_subscriptions')
            .upsert(
              { user_id: user.id, subscription: existingSub.toJSON() },
              { onConflict: 'user_id,subscription' }
            );
          return;
        }

        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlB64ToUint8Array(VITE_VAPID_PUBLIC_KEY),
        });

        if (cancelled) return;

        await supabase
          .from('push_subscriptions')
          .upsert(
            { user_id: user.id, subscription: sub.toJSON() },
            { onConflict: 'user_id,subscription' }
          );
      } catch {
        console.error('Push service unavailable');
      } finally {
        isPushSubscribingGlobal = false;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, user]);
}
