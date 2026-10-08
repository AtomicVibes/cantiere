import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/services/supabase';

/**
 * Reads the caller's own Developer Mode row (RLS: owner AND Super Admin).
 * Read only: enabling Developer Mode always goes through the
 * `developer-mode-toggle` Edge Function, which validates the secret.
 */
export function useDeveloperMode() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (active && !cancelledRef.current) setUserId(data?.session?.user?.id ?? null);
    });
    return () => {
      active = false;
      cancelledRef.current = true;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!userId) {
      setStatus(null);
      setLoading(false);
      return null;
    }
    try {
      const { data, error } = await supabase
        .from('developer_mode')
        .select('enabled, activated_at, deactivated_at, expires_at, failed_attempts, locked_until')
        .eq('user_id', userId)
        .maybeSingle();
      if (error) throw error;
      if (cancelledRef.current) return null;

      const now = Date.now();
      const expiresAt = data?.expires_at ?? null;
      const expired = expiresAt ? new Date(expiresAt).getTime() <= now : false;
      const lockedUntil = data?.locked_until ?? null;
      const locked = lockedUntil ? new Date(lockedUntil).getTime() > now : false;

      const next = data
        ? {
            enabled: Boolean(data.enabled),
            active: Boolean(data.enabled) && !expired,
            expired,
            locked,
            lockedUntil: locked ? lockedUntil : null,
            activatedAt: data.activated_at ?? null,
            deactivatedAt: data.deactivated_at ?? null,
            expiresAt,
            failedAttempts: data.failed_attempts ?? 0,
          }
        : null;

      setStatus(next);
      return next;
    } catch {
      if (!cancelledRef.current) setStatus(null);
      return null;
    } finally {
      if (!cancelledRef.current) setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { status, active: Boolean(status?.active), loading, refresh };
}
