import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import Logo from '@/components/Logo';
import {
  LayoutDashboard, FolderKanban, Users, DollarSign,
  Calendar, Menu
} from 'lucide-react';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import Sidebar from './Sidebar';
import { useTranslation } from 'react-i18next';
import { useUserRole } from '@/hooks/useUserRole';

export default function MobileNav() {
  const { t } = useTranslation();
  const { role } = useUserRole();
  const isSuperAdmin = role === 'super_admin';
  const location = useLocation();

  const bottomItems = [
    { icon: LayoutDashboard, path: '/', label: t('home') },
    { icon: FolderKanban, path: '/projects', label: t('projects') },
    { icon: Users, path: '/teams', label: t('teams'), requires: 'super_admin' },
    { icon: DollarSign, path: '/finance', label: t('finance') },
    { icon: Calendar, path: '/calendar', label: t('calendar') },
  ];

  const bottomNav = bottomItems.filter((item) => !item.requires || isSuperAdmin);

  return (
    <>
      <div className="fixed top-0 left-0 right-0 h-14 bg-card border-b border-border z-40 flex items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <Logo className="w-6 h-6 text-primary" />
          <span className="font-display font-bold">Geometra</span>
        </div>
        <Sheet>
          <SheetTrigger asChild>
            <button className="p-2"><Menu className="w-5 h-5" /></button>
          </SheetTrigger>
          <SheetContent side="left" className="p-0 w-[260px]">
            <Sidebar collapsed={false} setCollapsed={() => {}} />
          </SheetContent>
        </Sheet>
      </div>

      <div className="fixed bottom-0 left-0 right-0 bg-card border-t border-border z-40 flex items-center justify-around py-2 px-1">
        {bottomNav.map(item => {
          const isActive = location.pathname === item.path ||
            (item.path !== '/' && location.pathname.startsWith(item.path));
          return (
            <Link
              key={item.path}
              to={item.path}
              className={cn(
                "flex flex-col items-center gap-0.5 py-1 px-3 rounded-lg text-xs transition-colors",
                isActive ? "text-primary" : "text-muted-foreground"
              )}
            >
              <item.icon className="w-5 h-5" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </div>
    </>
  );
}
