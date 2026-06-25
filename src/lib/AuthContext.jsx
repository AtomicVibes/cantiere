import React, { createContext, useState, useContext, useEffect, useCallback } from 'react';
import { supabase } from '@/services/supabase';
import { signOut as supabaseSignOut } from '@/services/authService';
import { appParams } from '@/lib/app-params';
import i18n from '@/i18n';
import { getProfileLanguage } from '@/services/profileService';

const AuthContext = createContext();

const SESSION_EVENT = {
  INITIAL: 'INITIAL_SESSION',
  SIGNED_IN: 'SIGNED_IN',
  SIGNED_OUT: 'SIGNED_OUT',
  TOKEN_REFRESHED: 'TOKEN_REFRESHED',
  USER_UPDATED: 'USER_UPDATED',
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [isLoadingPublicSettings, setIsLoadingPublicSettings] = useState(true);
  const [authError, setAuthError] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [appPublicSettings, setAppPublicSettings] = useState(null);

  const setSession = useCallback(async (session) => {
    const currentUser = session?.user ?? null;
    setUser(currentUser);
    setIsAuthenticated(!!currentUser);

    if (currentUser) {
      try {
        const preferredLang = await getProfileLanguage(currentUser.id);
        if (preferredLang) {
          await i18n.changeLanguage(preferredLang);
        }
      } catch {
        // defaults to i18n fallbackLng
      }
    }

    setIsLoadingAuth(false);
    setAuthChecked(true);
  }, []);

  const checkAppState = useCallback(async () => {
    if (!appParams.appId) {
      console.warn('AuthContext: appId is not configured — skipping public settings check');
      setIsLoadingPublicSettings(false);
      return;
    }

    setIsLoadingPublicSettings(true);
    setAuthError(null);

    try {
      const res = await fetch(`/api/apps/public/prod/public-settings/by-id/${appParams.appId}`, {
        headers: { 'X-App-Id': appParams.appId },
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw { status: res.status, data, message: data?.message || res.statusText };
      }

      const publicSettings = await res.json().catch(() => ({}));
      setAppPublicSettings(publicSettings);
    } catch (appError) {
      console.error('App state check failed:', appError);

      if (appError.status === 403 && appError.data?.extra_data?.reason) {
        const reason = appError.data.extra_data.reason;
        if (reason === 'auth_required') {
          setAuthError({ type: 'auth_required', message: 'Authentication required' });
        } else if (reason === 'user_not_registered') {
          setAuthError({ type: 'user_not_registered', message: 'User not registered for this app' });
        } else {
          setAuthError({ type: reason, message: appError.message });
        }
      } else {
        setAuthError({ type: 'unknown', message: appError.message || 'Failed to load app' });
      }
    } finally {
      setIsLoadingPublicSettings(false);
    }
  }, []);

  const checkUserAuth = useCallback(async () => {
    setIsLoadingAuth(true);
    const { data: { session } } = await supabase.auth.getSession();
    await setSession(session);
  }, [setSession]);

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (cancelled) return;
      await setSession(session);
      await checkAppState();
    };

    init();

    const { data: listener } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (cancelled) return;
      await setSession(session);

      if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
        const path = window.location.pathname;
        if (path === '/login' || path === '/auth/callback') {
          window.location.href = '/dashboard';
        }
      }
    });

    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
    };
  }, [setSession, checkAppState]);

  const logout = useCallback(async (shouldRedirect = true) => {
    setUser(null);
    setIsAuthenticated(false);
    await supabaseSignOut();
    if (shouldRedirect) {
      window.location.href = '/login';
    }
  }, []);

  const navigateToLogin = useCallback(() => {
    window.location.href = '/login';
  }, []);

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated,
      isLoadingAuth,
      isLoadingPublicSettings,
      authError,
      appPublicSettings,
      authChecked,
      logout,
      navigateToLogin,
      checkUserAuth,
      checkAppState,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
