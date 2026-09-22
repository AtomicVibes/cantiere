import React from 'react';
import { Users } from 'lucide-react';
import { useStaffProfiles } from '@/hooks/useStaffProfiles';
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
 * Powered by the existing staff-directory query (`useStaffProfiles`),
 * which reads `public.profiles` under the existing profiles SELECT RLS —
 * the same canonical source the Teams system derives its members from, so
 * newly created users and profile/status/role changes are picked up
 * automatically (no duplicate contacts table).
 *
 * Only active staff members are eligible, and the current user is
 * excluded so nobody can start a conversation with themselves.
 */
export default function ContactCombobox({ currentUserId, onSelectContact, triggerLabel = 'Contacts' }) {
  const { data: staffProfiles = [], isLoading, isError } = useStaffProfiles();

  const eligible = React.useMemo(
    () => (staffProfiles || []).filter(p => p.id !== currentUserId && p.status === 'active'),
    [staffProfiles, currentUserId]
  );

  const searchable = React.useCallback((p) => (
    [p.full_name, p.email, p.phone, p.job_title, p.department, p.role_name, p.id]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
  ), []);

  const emptyMessage = isLoading
    ? 'Loading contacts...'
    : isError
      ? 'Unable to load contacts.'
      : eligible.length === 0
        ? 'No contacts are currently available.'
        : 'No contacts found.';

  return (
    <Combobox
      items={eligible}
      getItemValue={searchable}
      getItemKey={p => p.id}
      onSelect={p => onSelectContact(p)}
    >
      <ComboboxInput
        icon={<Users className="w-4 h-4" />}
        placeholder={triggerLabel}
        className="h-9 gap-0 border-0 bg-secondary px-2.5"
      />
      <ComboboxContent placeholder="Search contacts..." className="w-80">
        <ComboboxEmpty>{emptyMessage}</ComboboxEmpty>
        <ComboboxList>
          {(contact) => (
            <ComboboxItem key={contact.id} className="gap-3">
              <Avatar className="w-8 h-8 shrink-0">
                {contact.avatar_url && <AvatarImage src={contact.avatar_url} alt="" />}
                <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
                  {getInitials(contact.full_name)}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0 text-left">
                <p className="text-sm font-medium truncate">{contact.full_name || contact.email || 'Unknown'}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {[contact.job_title, contact.department].filter(Boolean).join(' · ') || contact.role_name || contact.email || ''}
                </p>
              </div>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}