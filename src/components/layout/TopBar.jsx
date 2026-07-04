import React, { useState, useEffect } from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/services/supabase';
import { useTranslation } from 'react-i18next';
import NotificationBell from '@/components/NotificationBell';
import { getInitials } from '@/lib/avatar';

export default function TopBar({ title }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [profileName, setProfileName] = useState(null);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    supabase
      .from('profiles')
      .select('full_name')
      .eq('id', user.id)
      .single()
      .then(({ data }) => {
        if (!cancelled && data?.full_name) {
          setProfileName(data.full_name);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [user?.id]);

  const displayName = profileName || user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email;
  const initials = getInitials(displayName);

  return (
    <header className="h-16 border-b border-border bg-card/80 backdrop-blur-sm flex items-center justify-between px-4 sm:px-6 sticky top-0 z-30 w-full max-w-full overflow-hidden">
      <div className="flex items-center gap-4">
        <h1 className="text-xl font-heading font-bold">{title}</h1>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative hidden md:block">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder={t('searchPlaceholder')}
            className="pl-9 w-64 h-9 bg-secondary border-0"
          />
        </div>

        <NotificationBell />

        <div className="flex items-center gap-2">
          <Avatar className="w-8 h-8">
            <AvatarFallback className="text-xs bg-primary text-primary-foreground font-semibold">
              {initials}
            </AvatarFallback>
          </Avatar>
          {displayName && displayName !== user?.email && (
            <span className="text-sm font-medium hidden lg:block">{displayName}</span>
          )}
        </div>
      </div>
    </header>
  );
}
