import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/services/supabase';

export default function AuthCallback() {
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;

    // The client runs flowType 'pkce', but admin invite links
    // (auth.admin.inviteUserByEmail does not support PKCE) still arrive as
    // implicit tokens in the URL hash. Exchange them here so invite
    // acceptance keeps working; OAuth and password-recovery returns use the
    // normal PKCE code exchange handled by the client itself.
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const accessToken = hashParams.get('access_token');
    const refreshToken = hashParams.get('refresh_token');
    const hasImplicitTokens = Boolean(accessToken && refreshToken);
    if (hasImplicitTokens) {
      supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
        .then(({ error }) => {
          if (error && !cancelled) {
            console.error('Auth callback session exchange failed', error.message);
          }
        });
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled) return;
      if (session?.user) {
        navigate('/dashboard', { replace: true });
      } else if (!hasImplicitTokens) {
        // Nothing to exchange and no session: don't leave the user spinning.
        navigate('/login', { replace: true });
      }
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (cancelled) return;
      if (event === 'SIGNED_IN') {
        navigate('/dashboard', { replace: true });
      }
    });

    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
    };
  }, [navigate]);

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-3">
        <div className="w-10 h-10 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
        Logging you in...
      </div>
    </div>
  );
}
