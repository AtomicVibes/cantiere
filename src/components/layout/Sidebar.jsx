import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { signOut } from '@/services/authService';

import {
  LayoutDashboard, FolderKanban, Users, UserCircle,
  Bell, DollarSign, Calendar, BarChart3, FileText,
  Settings, ScrollText, ChevronLeft, ChevronRight, LogOut,
  ClipboardList, ShieldCheck
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useUserRole } from '@/hooks/useUserRole';

export default function Sidebar({ collapsed: collapsedProp, setCollapsed: setCollapsedProp }) {
  const { t } = useTranslation();
  const { role, isLoading } = useUserRole();
  const isSuperAdmin = role === 'super_admin';

  const allNavItems = [
    { label: t('dashboard'), icon: LayoutDashboard, path: '/' },
    { label: t('projects'), icon: FolderKanban, path: '/projects' },
    { label: t('teams'), icon: Users, path: '/teams', requires: 'super_admin' },
    { label: t('clients'), icon: UserCircle, path: '/clients' },
    { label: t('notifications'), icon: Bell, path: '/notifications' },
    { label: t('finance'), icon: DollarSign, path: '/finance' },
    { label: t('calendar'), icon: Calendar, path: '/calendar' },
    { label: t('reports'), icon: BarChart3, path: '/reports', requires: 'super_admin' },
    { label: t('documents'), icon: FileText, path: '/documents' },
    { label: t('requests'), icon: ClipboardList, path: '/requests' },
    { label: t('requestManagement'), icon: ShieldCheck, path: '/admin/requests', requires: 'super_admin' },
    { label: t('logs.auditLogs'), icon: ScrollText, path: '/logs', requires: 'super_admin' },
    { label: t('settings'), icon: Settings, path: '/settings' },
  ];

  const navItems = isLoading
    ? allNavItems.filter((item) => !item.requires)
    : allNavItems.filter((item) => !item.requires || isSuperAdmin);

  const [collapsedInternal, setCollapsedInternal] = useState(false);
  const collapsed = collapsedProp !== undefined ? collapsedProp : collapsedInternal;
  const setCollapsed = setCollapsedProp || setCollapsedInternal;
  const location = useLocation();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await signOut();
    navigate('/login');
  };

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 h-full bg-card border-r border-border z-40 flex flex-col transition-all duration-300",
        collapsed ? "w-[72px]" : "w-[260px]"
      )}
    >
      <div className="flex items-center justify-start gap-[10px] p-3 border-b border-border">
        {collapsed ? (
          <svg viewBox="19 19 38 38" width="28" height="28" xmlns="http://www.w3.org/2000/svg" className="shrink-0 ml-2">
            <path fill="#FFFFFF" d="M 19,19L 24,19L 24,20L 44,20L 44,32L 56,32L 56,52L 57,52L 57,57L 52,57L 52,56L 32,56L 32,44L 20,44L 20,24L 19,24L 19,19 Z M 41,23L 24,23L 24,24L 23,24L 23,41L 32,41L 32,32.0001L 41,32.0001L 41,23 Z M 51.9999,19.0001L 56.9999,19.0001L 56.9999,24.0001L 51.9999,24.0001L 51.9999,19.0001 Z M 19,52L 24,52L 24,57L 19,57L 19,52 Z M 51.9999,52L 52.9999,52L 52.9999,35L 44,35L 44,44L 35,44L 35,53L 51.9999,53L 51.9999,52 Z M 35,35L 35,41L 41,41L 41,35L 35,35 Z M 20,20L 20,23L 23,23L 23,20L 20,20 Z M 53,20L 53,23L 56,23L 56,20L 53,20 Z M 20,53L 20,56L 23,56L 23,53L 20,53 Z M 53,53L 53,56L 56,56L 56,53L 53,53 Z" />
          </svg>
        ) : (
          <>
            <svg viewBox="19 19 38 38" width="48" height="48" xmlns="http://www.w3.org/2000/svg" className="shrink-0 ml-2">
              <path fill="#FFFFFF" d="M 19,19L 24,19L 24,20L 44,20L 44,32L 56,32L 56,52L 57,52L 57,57L 52,57L 52,56L 32,56L 32,44L 20,44L 20,24L 19,24L 19,19 Z M 41,23L 24,23L 24,24L 23,24L 23,41L 32,41L 32,32.0001L 41,32.0001L 41,23 Z M 51.9999,19.0001L 56.9999,19.0001L 56.9999,24.0001L 51.9999,24.0001L 51.9999,19.0001 Z M 19,52L 24,52L 24,57L 19,57L 19,52 Z M 51.9999,52L 52.9999,52L 52.9999,35L 44,35L 44,44L 35,44L 35,53L 51.9999,53L 51.9999,52 Z M 35,35L 35,41L 41,41L 41,35L 35,35 Z M 20,20L 20,23L 23,23L 23,20L 20,20 Z M 53,20L 53,23L 56,23L 56,20L 53,20 Z M 20,53L 20,56L 23,56L 23,53L 20,53 Z M 53,53L 53,56L 56,56L 56,53L 53,53 Z" />
            </svg>
            <span className="font-display font-bold text-lg truncate shrink-0">Geometra</span>
          </>
        )}
      </div>

      <nav className="flex-1 py-4 px-3 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const isActive = location.pathname === item.path ||
            (item.path !== '/' && location.pathname.startsWith(item.path));
          return (
            <Link
              key={item.path}
              to={item.path}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200",
                isActive
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent"
              )}
            >
              <item.icon className={cn("w-5 h-5 flex-shrink-0", isActive && "text-primary-foreground")} />
              {!collapsed && <span className="truncate">{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      <div className="p-3 border-t border-border space-y-1">
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent w-full transition-colors"
        >
          <LogOut className="w-5 h-5 flex-shrink-0" />
          {!collapsed && <span>{t('logout')}</span>}
        </button>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-accent w-full transition-colors"
        >
          {collapsed ? <ChevronRight className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />}
          {!collapsed && <span>{t('collapse')}</span>}
        </button>
      </div>
    </aside>
  );
}
