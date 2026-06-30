import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { supabase } from '@/services/supabase';

const NotificationContext = createContext({
  notifications: [],
  unreadCount: 0,
  loading: true,
  error: null,
  markAsRead: async () => {},
  markAllAsRead: async () => {},
  refetch: async () => {},
});

export function useNotifications() {
  const ctx = useContext(NotificationContext);
  return ctx;
}

export function NotificationProvider({ children }) {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const channelRef = useRef(null);

  const fetchNotifications = useCallback(async () => {
    try {
      setLoading(true);
      const data = await base44.entities.Notification.list('-created_date');
      setNotifications(data || []);
      setError(null);
    } catch (err) {
      console.error('[NotificationProvider] fetch error:', err);
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  useEffect(() => {
    let channel;
    try {
      channel = supabase.channel('notifications-realtime');
      channel
        .on('postgres_changes',
          { event: '*', schema: 'public', table: 'notifications' },
          () => { fetchNotifications(); }
        )
        .subscribe((status) => {
          if (status !== 'SUBSCRIBED') {
            console.warn('[NotificationProvider] channel status:', status);
          }
        });
      channelRef.current = channel;
    } catch (err) {
      console.error('[NotificationProvider] realtime setup error:', err);
    }

    return () => {
      try {
        if (channel) supabase.removeChannel(channel);
      } catch (err) {
        console.warn('[NotificationProvider] channel cleanup:', err);
      }
    };
  }, [fetchNotifications]);

  const unreadCount = notifications.filter(n => !n.is_read).length;

  const markAsRead = useCallback(async (id) => {
    try {
      await base44.entities.Notification.update(id, { is_read: true });
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
    } catch (err) {
      console.error('[NotificationProvider] markAsRead error:', err);
    }
  }, []);

  const markAllAsRead = useCallback(async () => {
    try {
      const unread = notifications.filter(n => !n.is_read);
      await Promise.all(unread.map(n => base44.entities.Notification.update(n.id, { is_read: true })));
      setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
    } catch (err) {
      console.error('[NotificationProvider] markAllAsRead error:', err);
    }
  }, [notifications]);

  return (
    <NotificationContext.Provider value={{
      notifications,
      unreadCount,
      loading,
      error,
      markAsRead,
      markAllAsRead,
      refetch: fetchNotifications,
    }}>
      {children}
    </NotificationContext.Provider>
  );
}
