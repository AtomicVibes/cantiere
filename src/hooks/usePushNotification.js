import { useEffect } from 'react';
import { supabase } from '@/services/supabase';
import { useAuth } from '@/lib/AuthContext';

const VITE_VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;

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

  let permission;
  try {
    permission = await Notification.requestPermission();
  } catch (err) {
    console.error('Push: permission request failed', err);
    return null;
  }
  if (permission !== 'granted') {
    console.warn('Push: permission not granted', permission);
    return null;
  }

  try {
    const existingSub = await reg.pushManager.getSubscription();
    if (existingSub) {
      await supabase
        .from('push_subscriptions')
        .upsert(
          { user_id: userId, subscription: existingSub.toJSON() },
          { onConflict: 'user_id,subscription' }
        );
      return existingSub;
    }
  } catch (err) {
    console.error('Push: getSubscription failed', err);
  }

  let sub;
  try {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlB64ToUint8Array(VITE_VAPID_PUBLIC_KEY),
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
    await supabase
      .from('push_subscriptions')
      .upsert(
        { user_id: userId, subscription: sub.toJSON() },
        { onConflict: 'user_id,subscription' }
      );
  } catch (err) {
    console.error('Push: DB upsert failed', err);
    return null;
  }

  return sub;
}

export function usePushNotification() {
  const { user, isAuthenticated } = useAuth();

  useEffect(() => {
    if (!isAuthenticated || !user) return;

    let cancelled = false;

    (async () => {
      if (isPushSubscribingGlobal) return;
      isPushSubscribingGlobal = true;

      try {
        const sub = await subscribeUserToPush(user.id);
        if (cancelled || sub) return;
      } catch (err) {
        console.error('Push service unavailable:', err);
      } finally {
        isPushSubscribingGlobal = false;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, user]);
}
