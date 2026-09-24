import React from 'react';
import { useTranslation } from 'react-i18next';
import { Users } from 'lucide-react';
import { useStaffProfiles } from '@/hooks/useStaffProfiles';
import { useProfileContactSearch } from '@/hooks/useProfileContactSearch';
import { getContactDisplayName } from '@/lib/contactSearch';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { getInitials } from '@/lib/avatar';
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@/components/ui/combobox';

/**
 * Contact picker for the Messages window.
 *
 * Canonical source is public.profiles in both modes:
 * - scopeAll (super admin): server-side search across EVERY active profile
 *   (name/email/title/department/role, case-insensitive, limited), so any
 *   eligible team member can be found and messaged without a prior
 *   conversation. Visibility is governed by profiles SELECT RLS.
 * - default: the existing staff directory (super_admin/admin/manager),
 *   preserving normal-user contact permissions.
 *
 * Only active members are eligible and the current user is excluded.
 */
export default function ContactCombobox({ currentUserId, onSelectContact, triggerLabel = 'Contacts', scopeAll = false }) {
  const { t } = useTranslation();
  const [serverQuery, setServerQuery] = React.useState('');
  const handleQueryChange = React.useCallback((q) => setServerQuery(q), []);

  const staffQuery = useStaffProfiles();
  const serverSearch = useProfileContactSearch({
    searchText: serverQuery,
    currentUserId,
    enabled: scopeAll,
  });

  const eligible = React.useMemo(() => {
    if (!scopeAll) {
      return (staffQuery.data || []).filter(p => p.id !== currentUserId && p.status === 'active');
    }
    return serverSearch.data || [];
  }, [scopeAll, staffQuery.data, serverSearch.data, currentUserId]);

  const searchable = React.useCallback((p) => (
    [p.full_name, p.email, p.phone, p.job_title, p.department, p.role_name, p.role, p.id]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
  ), []);

  const loading = scopeAll ? serverSearch.isLoading : staffQuery.isLoading;
  const loadError = scopeAll ? serverSearch.isError : staffQuery.isError;

  const emptyMessage = loading
    ? t('contactLoading', 'Loading contacts...')
    : loadError
      ? t('contactLoadError', "We couldn't load team members. Please try again.")
      : (scopeAll && !serverSearch.searched)
        ? t('searchTeamMembers', 'Search team members...')
        : t('contactEmpty', 'No team members found.');

  return (
    <Combobox
      items={eligible}
      getItemValue={searchable}
      getItemKey={p => p.id}
      onSelect={p => onSelectContact(p)}
      onQueryChange={scopeAll ? handleQueryChange : undefined}
    >
      <ComboboxInput
        icon={<Users className="w-4 h-4" />}
        placeholder={triggerLabel}
        className="h-9 gap-0 border-0 bg-secondary px-2.5"
      />
      <ComboboxContent
        placeholder={t('searchTeamMembers', 'Search team members...')}
        className="w-80"
        shouldFilter={scopeAll ? false : undefined}
      >
        <ComboboxEmpty>
          {loading ? (
            <span className="inline-flex items-center gap-2" role="status" aria-live="polite">
              <span aria-hidden className="w-4 h-4 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
              {emptyMessage}
            </span>
          ) : (
            emptyMessage
          )}
        </ComboboxEmpty>
        <ComboboxList>
          {(contact) => (
            <ComboboxItem key={contact.id} className="gap-3">
              <Avatar className="w-8 h-8 shrink-0">
                {contact.avatar_url && <AvatarImage src={contact.avatar_url} alt="" />}
                <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
                  {getInitials(getContactDisplayName(contact))}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0 text-left">
                <p className="text-sm font-medium truncate">{getContactDisplayName(contact)}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {[contact.job_title, contact.department].filter(Boolean).join(' · ') || contact.role_name || contact.role || contact.email || ''}
                </p>
              </div>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
