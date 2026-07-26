import { useState, useEffect } from 'react';
import { supabase } from '@/services/supabase';

export function useIsSuperAdmin() {
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const { data } = await supabase.rpc('auth_user_is_super_admin');
        if (!cancelled) setIsSuperAdmin(data === true);
      } catch {
        if (!cancelled) setIsSuperAdmin(false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    check();
    return () => { cancelled = true; };
  }, []);

  return { isSuperAdmin, loading };
}
