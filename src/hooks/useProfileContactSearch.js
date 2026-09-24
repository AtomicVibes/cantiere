import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/services/supabase';
import { logAppError } from '@/lib/userErrors';
import {
  CONTACT_SEARCH_DEBOUNCE_MS,
  CONTACT_SEARCH_LIMIT,
  CONTACT_SEARCH_MIN_LENGTH,
  CONTACT_SELECT_FIELDS,
  buildContactSearchOrFilter,
  normalizeContactProfile,
} from '@/lib/contactSearch';

// Canonical profiles contact search for Messaging.
//
// Queries public.profiles DIRECTLY with server-side filtering:
//   status = 'active' AND self excluded AND (
//     full_name ILIKE %q% OR email ILIKE %q% OR job_title ILIKE %q%
//     OR department ILIKE %q% OR role ILIKE %q% )
// ordered by name, limited to 30 rows. Only messaging UI fields are
// selected (no notification settings, no phone numbers, no role ids).
//
// RLS governs visibility: super admins can discover every active team
// member; other roles only see rows their policies allow (existing
// messaging/contact permissions are preserved).

export function useDebouncedValue(value, delayMs) {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

export function useProfileContactSearch({ searchText, currentUserId, enabled = true } = {}) {
  const debounced = useDebouncedValue(searchText, CONTACT_SEARCH_DEBOUNCE_MS);
  const trimmed = String(debounced ?? '').trim();
  const orFilter = buildContactSearchOrFilter(trimmed);

  const query = useQuery({
    queryKey: ['profileContactSearch', trimmed, currentUserId],
    enabled: Boolean(enabled && orFilter && trimmed.length >= CONTACT_SEARCH_MIN_LENGTH),
    staleTime: 30 * 1000,
    queryFn: async () => {
      try {
        let builder = supabase
          .from('profiles')
          .select(CONTACT_SELECT_FIELDS)
          .eq('status', 'active')
          .or(orFilter)
          .order('full_name', { ascending: true })
          .limit(CONTACT_SEARCH_LIMIT);
        if (currentUserId) builder = builder.neq('id', currentUserId);
        const { data, error } = await builder;
        if (error) throw error;
        return (data ?? []).map(normalizeContactProfile).filter(Boolean);
      } catch (err) {
        logAppError('Messages', err, { operation: 'search-profiles' });
        throw err;
      }
    },
  });

  return {
    data: query.data ?? [],
    isLoading: query.isFetching,
    isError: query.isError,
    searched: Boolean(orFilter),
  };
}
