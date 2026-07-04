import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Check, MessageSquare, AlertCircle } from 'lucide-react';
import { supabase } from '@/services/supabase';
import { useAuth } from '@/lib/AuthContext';

export default function NotificationBell() {
  const [notifications, setNotifications] = useState([]);
  const [isOpen, setIsOpen] = useState(false);
  const { user } = useAuth();
  const dropdownRef = useRef(null);
  const navigate = useNavigate();

  const userId = user?.id;

  useEffect(() => {
    if (!userId) return;

    const fetchNotifications = async () => {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', userId)
        .eq('is_read', false)
        .order('created_at', { ascending: false });

      if (!error && data) {
        setNotifications(data);
      }
    };

    fetchNotifications();

    const channel = supabase
      .channel(`user-notifications-${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            const newNotif = payload.new;
            if (!newNotif.is_read) {
              setNotifications((prev) => [newNotif, ...prev]);
            }
          } else if (payload.eventType === 'UPDATE' || payload.eventType === 'DELETE') {
            fetchNotifications();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleNotificationClick = async (notification) => {
    setIsOpen(false);

    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('id', notification.id);

    if (error) {
      console.error('Failed to mark notification as read:', error);
      return;
    }

    setNotifications((prev) => prev.filter((n) => n.id !== notification.id));

    const msg = notification.message.toLowerCase();

    if (msg.includes('received a message from')) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('roles:roles!profiles_role_id_fkey(name)')
        .eq('id', userId)
        .single();
      const roleName = profile?.roles?.name;
      navigate(roleName === 'super_admin' ? '/admin/messages' : '/messages');
      return;
    }

    if (msg.includes('project')) {
      navigate('/projects');
    } else if (msg.includes('team') || msg.includes('member')) {
      navigate('/teams');
    } else if (msg.includes('invoice') || msg.includes('finance') || msg.includes('budget')) {
      navigate('/finance');
    } else {
      navigate('/dashboard');
    }
  };

  const markAllAsRead = async () => {
    if (!userId || notifications.length === 0) return;

    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', userId);

    if (!error) {
      setNotifications([]);
    }
  };

  return (
    <div className="relative inline-block text-left" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 text-muted-foreground transition-colors duration-200 rounded-full hover:text-foreground hover:bg-accent focus:outline-none"
        aria-label="Notifications"
      >
        <Bell className="w-5 h-5" />
        {notifications.length > 0 && (
          <span className="absolute top-0.5 right-0.5 inline-flex items-center justify-center px-1.5 py-0.5 text-xs font-bold leading-none text-white bg-destructive rounded-full min-w-[18px]">
            {notifications.length}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="fixed inset-x-4 top-16 z-50 mt-2 origin-top-right rounded-xl border border-border bg-card shadow-2xl ring-1 ring-black ring-opacity-5 focus:outline-none md:absolute md:right-0 md:left-auto md:w-96">
          <div className="p-4 border-b border-border flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">Notifications</h3>
            {notifications.length > 0 && (
              <button
                onClick={markAllAsRead}
                className="text-xs font-medium text-destructive hover:text-destructive/80 flex items-center gap-1 transition-colors"
              >
                <Check className="w-3.5 h-3.5" /> Mark all read
              </button>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto divide-y divide-border">
            {notifications.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground flex flex-col items-center gap-2">
                <MessageSquare className="w-8 h-8 text-muted-foreground/40" />
                <p>All caught up! No new notifications.</p>
              </div>
            ) : (
              notifications.map((notif) => (
                <button
                  key={notif.id}
                  onClick={() => handleNotificationClick(notif)}
                  className="w-full p-4 text-left transition-colors duration-150 hover:bg-accent flex items-start gap-3 focus:outline-none group"
                >
                  <div className="mt-0.5 p-1.5 bg-accent group-hover:bg-accent/80 rounded-lg text-destructive shrink-0 transition-colors">
                    <AlertCircle className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground leading-relaxed break-words">
                      {notif.message}
                    </p>
                    <span className="text-xs text-muted-foreground mt-1 block">
                      {new Date(notif.created_at).toLocaleDateString([], {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
