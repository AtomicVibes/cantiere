import React, { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import MobileNav from './MobileNav';

export default function AppLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();
  const isMessagesPath = location.pathname.includes('/messages');
  const isChatOpen = isMessagesPath && new URLSearchParams(location.search).has('user');

  return (
    <div className="min-h-screen bg-background">
      <div className="hidden md:block">
        <Sidebar collapsed={collapsed} setCollapsed={setCollapsed} />
      </div>
      {!isChatOpen && (
        <div className="md:hidden">
          <MobileNav />
        </div>
      )}
      <main className={`min-h-screen transition-all duration-300 max-w-full min-w-0 ${collapsed ? 'md:ml-[72px]' : 'md:ml-[260px]'} ${isChatOpen ? '' : 'pt-14 pb-16 md:pt-0 md:pb-0'}`}>
        <Outlet />
      </main>
    </div>
  );
}