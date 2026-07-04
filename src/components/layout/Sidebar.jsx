import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { signOut } from '@/services/authService';
import Logo from '@/components/Logo';
import {
  LayoutDashboard, FolderKanban, Users, UserCircle,
  Bell, DollarSign, Calendar, BarChart3, FileText,
  Settings, ScrollText, ChevronLeft, ChevronRight, LogOut,
  ClipboardList, ShieldCheck
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/lib/AuthContext';

export default function Sidebar({ collapsed: collapsedProp, setCollapsed: setCollapsedProp }) {
  const { t } = useTranslation();
  const { isAdmin, isLoadingAuth } = useAuth();

  const allNavItems = [
    { label: t('dashboard'), icon: LayoutDashboard, path: '/' },
    { label: t('projects'), icon: FolderKanban, path: '/projects' },
    { label: t('teams'), icon: Users, path: '/teams', requires: true },
    { label: t('clients'), icon: UserCircle, path: '/clients', requires: true },
    { label: t('notifications'), icon: Bell, path: '/notifications' },
    { label: t('finance'), icon: DollarSign, path: '/finance' },
    { label: t('calendar'), icon: Calendar, path: '/calendar' },
    { label: t('reports'), icon: BarChart3, path: '/reports', requires: true },
    { label: t('documents'), icon: FileText, path: '/documents' },
    { label: t('requests'), icon: ClipboardList, path: '/requests' },
    { label: t('requestManagement'), icon: ShieldCheck, path: '/admin/requests', requires: true },
    { label: t('logs.auditLogs'), icon: ScrollText, path: '/logs', requires: true },
    { label: t('settings'), icon: Settings, path: '/settings' },
  ];

  const navItems = isLoadingAuth
    ? allNavItems.filter((item) => !item.requires)
    : allNavItems.filter((item) => !item.requires || isAdmin);

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
      <div className="flex items-center justify-start gap-2 p-3 border-b border-border">
        {collapsed ? (
          <Logo size={28} className="shrink-0 ml-2 text-primary" />
        ) : (
          <>
            <Logo size={48} className="shrink-0 ml-2 text-primary" />
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

      <div className="mt-auto border-t border-border p-3 space-y-1">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-accent w-full transition-colors"
        >
          {collapsed ? <ChevronRight className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />}
          {!collapsed && <span>{t('collapse')}</span>}
        </button>
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent w-full transition-colors"
        >
          <LogOut className="w-5 h-5 flex-shrink-0" />
          {!collapsed && <span>{t('logout')}</span>}
        </button>
      </div>
    </aside>
  );
}
