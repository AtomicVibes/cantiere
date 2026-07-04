import React from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { useAuth } from '@/lib/AuthContext';
import { useTranslation } from 'react-i18next';
import NotificationBell from '@/components/NotificationBell';
import { getAvatarLetters } from '@/lib/avatar';

export default function TopBar({ title }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const initials = getAvatarLetters(user?.full_name);

  return (
    <header className="h-16 border-b border-border bg-card/80 backdrop-blur-sm flex items-center justify-between px-6 sticky top-0 z-30">
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
          {user?.full_name && (
            <span className="text-sm font-medium hidden lg:block">{user.full_name}</span>
          )}
        </div>
      </div>
    </header>
  );
}