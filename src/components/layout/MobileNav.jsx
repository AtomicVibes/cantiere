import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard, FolderKanban, Users, DollarSign,
  Calendar, Menu, HardHat
} from 'lucide-react';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import Sidebar from './Sidebar';

const bottomNav = [
  { icon: LayoutDashboard, path: '/', label: 'Home' },
  { icon: FolderKanban, path: '/projects', label: 'Projects' },
  { icon: Users, path: '/teams', label: 'Teams' },
  { icon: DollarSign, path: '/finance', label: 'Finance' },
  { icon: Calendar, path: '/calendar', label: 'Calendar' },
];

export default function MobileNav() {
  const location = useLocation();

  return (
    <>
      <div className="fixed top-0 left-0 right-0 h-14 bg-card border-b border-border z-40 flex items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
            <HardHat className="w-4 h-4 text-primary-foreground" />
          </div>
          <span className="font-display font-bold">BuildPro</span>
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