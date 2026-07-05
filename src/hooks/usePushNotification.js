import { useEffect } from 'react';
import { supabase } from '@/services/supabase';
import { useAuth } from '@/lib/AuthContext';

const VITE_VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;

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

async function subscribeUserToPush(userId) {
  try {
    console.log('--- Push Subscription Debug ---');
    console.log('Step 1: Checking for service worker support...');
    if (!('serviceWorker' in navigator)) {
      console.log('Web Push not supported');
      return;
    }

    console.log('Step 2: Waiting for service worker to be ready...');
    const reg = await navigator.serviceWorker.ready;
    console.log('Service worker is ready! Scope: ' + reg.scope);

    console.log('Step 3: Requesting notification permission...');
    const permission = await Notification.requestPermission();
    console.log('Permission result: ' + permission);
    if (permission !== 'granted') {
      return;
    }

    console.log('Step 4: Converting VAPID key...');
    console.log('Converting key: ' + VITE_VAPID_PUBLIC_KEY);
    const applicationServerKey = urlB64ToUint8Array(VITE_VAPID_PUBLIC_KEY);

    console.log('Step 5: Subscribing to push...');
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey,
    });
    console.log('Browser generated push subscription token successfully!');

    console.log('Step 6: Saving to Supabase...');
    const { error } = await supabase
      .from('push_subscriptions')
      .upsert({ user_id: userId, subscription: sub.toJSON() }, { onConflict: 'user_id,subscription' });
    if (error) {
      console.error('Supabase write failed:', error);
    } else {
      console.log('Successfully saved token to push_subscriptions table!');
    }
  } catch (error) {
    console.log('Push subscription error: ' + error.message);
  }
}

export function usePushNotification() {
  const { user, isAuthenticated } = useAuth();

  useEffect(() => {
    if (!isAuthenticated || !user || !VITE_VAPID_PUBLIC_KEY) return;

    subscribeUserToPush(user.id);
  }, [isAuthenticated, user]);
}
