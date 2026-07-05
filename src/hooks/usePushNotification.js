import { useEffect, useRef } from 'react';
import { supabase } from '@/services/supabase';
import { useAuth } from '@/lib/AuthContext';

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
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
        const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });

        await navigator.serviceWorker.ready;

        const existing = await registration.pushManager.getSubscription();
        if (existing) {
          const subJson = existing.toJSON();
          const { data: existingSub } = await supabase
            .from('push_subscriptions')
            .select('id')
            .eq('user_id', user.id)
            .eq('subscription', subJson)
            .maybeSingle();

          if (existingSub) {
            subscribedRef.current = true;
            return;
          }
        }

        if (existing) {
          await existing.unsubscribe();
        }

        const subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        });

        if (cancelled) return;

        const { error } = await supabase.from('push_subscriptions').upsert(
          {
            user_id: user.id,
            subscription: subscription.toJSON(),
          },
          { onConflict: 'user_id,subscription' }
        );

        if (error) {
          console.error('Failed to save push subscription:', error);
          return;
        }

        subscribedRef.current = true;
      } catch (err) {
        console.error('Push subscription failed:', err);
      }
    }

    initPush();

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, user]);
}
