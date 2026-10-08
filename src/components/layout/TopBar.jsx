import React, { useState, useEffect } from 'react';
import { Search, Zap } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/services/supabase';
import { useTranslation } from 'react-i18next';
import NotificationBell from '@/components/NotificationBell';
import { getInitials } from '@/lib/avatar';
import { useDeveloperMode } from '@/hooks/useDeveloperMode';

export default function TopBar({ title }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [profileName, setProfileName] = useState(null);
  const { active: devModeActive } = useDeveloperMode();

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
    <header className="h-16 border-b border-border bg-card/80 backdrop-blur-sm flex items-center justify-between px-4 sm:px-6 lg:px-8 sticky top-20 md:top-0 z-30 w-full max-w-full">
      <div className="flex items-center gap-4 min-w-0">
        <h1 className="text-xl font-heading font-bold truncate">{title}</h1>
      </div>

      <div className="flex items-center gap-3 sm:gap-4 shrink-0">
        <div className="relative hidden md:block">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder={t('searchPlaceholder')}
            className="pl-9 w-64 h-9 bg-secondary border-0"
          />
        </div>

        {devModeActive && (
          <Badge
            variant="outline"
            className="gap-1 border-amber-500/40 text-amber-600 dark:text-amber-400"
            title={t('devModeIndicatorDesc')}
          >
            <Zap className="w-3 h-3" aria-hidden />
            {t('devModeIndicator')}
          </Badge>
        )}

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
