import React from 'react';
import { Toaster } from "@/components/ui/toaster"
import { Toaster as SonnerToaster } from "sonner"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import PageNotFound from '@/lib/PageNotFound';
import { useTranslation } from 'react-i18next';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import ProtectedRoute from '@/components/ProtectedRoute';
import AppLayout from '@/components/layout/AppLayout';


// Auth pages
import Login from '@/pages/Login';
import Register from '@/pages/Register';
import ForgotPassword from '@/pages/ForgotPassword';
import ResetPassword from '@/pages/ResetPassword';
import AuthCallback from '@/pages/AuthCallback';

import { startPushSubscriptionRelay, subscribeUserToPush } from '@/hooks/usePushNotification';

// App pages
import Dashboard from '@/pages/Dashboard';
import Projects from '@/pages/Projects';
import ProjectDetail from '@/pages/ProjectDetail';
import Teams from '@/pages/Teams';
import Clients from '@/pages/Clients';
import Notifications from '@/pages/Notifications';
import Finance from '@/pages/Finance';
import CalendarPage from '@/pages/CalendarPage';
import Reports from '@/pages/Reports';
import Documents from '@/pages/Documents';
import Settings from '@/pages/Settings';
import Logs from '@/pages/Logs';
import Requests from '@/pages/Requests';
import MessagesPage from '@/pages/MessagesPage';

const AuthenticatedApp = () => {
  const { t } = useTranslation();
  const { isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin } = useAuth();
  const hasRedirected = React.useRef(false);

  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-primary/20 border-t-primary rounded-full animate-spin"></div>
          {t('loading')}
        </div>
      </div>
    );
  }

  if (authError) {
    if (authError.type === 'user_not_registered') {
      return <UserNotRegisteredError />;
    } else if (authError.type === 'auth_required' && !hasRedirected.current) {
      hasRedirected.current = true;
      navigateToLogin();
      return null;
    }
  }

  return (
    <Routes>
      {/* Auth routes */}
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/auth/callback" element={<AuthCallback />} />

      {/* Protected app routes */}
      <Route element={<ProtectedRoute unauthenticatedElement={<Navigate to="/login" replace />} />}>
        <Route element={<AppLayout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/projects/:id" element={<ProjectDetail />} />
          <Route path="/teams" element={<Teams />} />
          <Route path="/clients" element={<Clients />} />
          <Route path="/notifications" element={<Notifications />} />
          <Route path="/finance" element={<Finance />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/documents" element={<Documents />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/logs" element={<Logs />} />
          <Route path="/requests" element={<Requests />} />
          <Route path="/admin/requests" element={<Navigate to="/requests?view=management" replace />} />
          <Route path="/messages" element={<MessagesPage />} />
          <Route path="/admin/messages" element={<MessagesPage />} />
        </Route>
      </Route>

      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};


function App() {
  return (
    <QueryClientProvider client={queryClientInstance}>
      <AuthProvider>
        <Router>
          <AuthenticatedApp />
        </Router>
        <PushSubscriptionRelay />
        <PushSubscriptionManager />
        <Toaster />
        <SonnerToaster position="top-right" richColors />
      </AuthProvider>
    </QueryClientProvider>
  );
}

// Listens for service-worker pushsubscriptionchange renewals and persists
// the fresh subscription for the currently signed-in user, and reclaims the
// browser endpoint from users who previously shared this browser.
function PushSubscriptionRelay() {
  const cleanupRef = React.useRef(null);

  React.useEffect(() => {
    cleanupRef.current = startPushSubscriptionRelay();
    return () => {
      if (typeof cleanupRef.current === 'function') cleanupRef.current();
      cleanupRef.current = null;
    };
  }, []);

  return null;
}

// Reflects the "I already granted Chrome permission" case into a real Web Push
// subscription. Chrome permission being granted does NOT create a subscription:
// the app only subscribed from the Settings toggle. This manager auto-subscribes
// the signed-in user whenever the browser permission is already "granted" and
// there is no active subscription. It NEVER calls requestPermission(), so it can
// never show a prompt on load.
function PushSubscriptionManager() {
  const { user } = useAuth();
  const inFlightRef = React.useRef(false);

  React.useEffect(() => {
    if (!user?.id) return;
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    if (typeof Notification !== 'undefined' && Notification.permission !== 'granted') return;
    if (inFlightRef.current) return;

    inFlightRef.current = true;
    subscribeUserToPush(user.id)
      .catch((err) => {
        console.error('Push: auto-subscribe failed', err);
      })
      .finally(() => {
        inFlightRef.current = false;
      });
  }, [user?.id]);

  return null;
}

export default App
