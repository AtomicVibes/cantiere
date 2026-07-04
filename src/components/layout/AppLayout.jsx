import React, { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import MobileNav from './MobileNav';

export default function AppLayout() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      <div className="hidden md:block">
        <Sidebar collapsed={collapsed} setCollapsed={setCollapsed} />
      </div>
      <div className="md:hidden">
        <MobileNav />
      </div>
      <main className={`min-h-screen transition-all duration-300 pt-14 md:pt-0 pb-16 md:pb-0 max-w-full min-w-0 ${collapsed ? 'md:ml-[72px]' : 'md:ml-[260px]'}`}>
        <Outlet />
      </main>
    </div>
  );
}