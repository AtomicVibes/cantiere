import React from 'react';
import { useTranslation } from 'react-i18next';
import { Search, UserRoundCheck, Users } from 'lucide-react';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getInitials } from '@/lib/avatar';
import { getContactDisplayName } from '@/lib/contactSearch';
import { cn } from '@/lib/utils';

// Shared document audience picker: searchable member list with avatars,
// selected-state indicator and count. Authorization behavior is unchanged
// (checkbox-gated selection owned by the caller); only presentation is
// shared across the upload dialog, access dialog and timeline entry form.
export default function AudiencePicker({
  members = [],
  selectedIds = [],
  onToggle,
  idPrefix = 'aud',
  titleKey = 'selectAudience',
  titleFallback = 'Select audience',
  helpKey = 'audienceHelp',
  helpFallback = 'Only the selected people can view this document.',
}) {
  const { t } = useTranslation();
  const [query, setQuery] = React.useState('');

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return members;
    return members.filter((m) =>
      [m.full_name, m.email, m.job_title, m.department]
        .filter(Boolean)
        .some((f) => String(f).toLowerCase().includes(q))
    );
  }, [members, query]);

  return (
    <div className="space-y-2 border rounded-md p-3">
      <div className="flex items-center justify-between gap-2">
        <Label className="flex items-center gap-1.5">
          <Users aria-hidden className="w-4 h-4 text-muted-foreground" />
          {t(titleKey, titleFallback)}
        </Label>
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" role="status">
          <UserRoundCheck aria-hidden className="w-3.5 h-3.5" />
          {selectedIds.length} {t('visibility.selected', 'Selected')}
        </span>
      </div>
      <div className="relative">
        <Search aria-hidden className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('searchTeamMembers', 'Search team members...')}
          aria-label={t('searchTeamMembers', 'Search team members...')}
          className="pl-9 h-8 text-xs"
        />
      </div>
      <div className="max-h-40 space-y-1 overflow-y-auto pr-1" role="group" aria-label={t(titleKey, titleFallback)}>
        {filtered.map((member) => {
          const checked = selectedIds.includes(member.id);
          const checkboxId = `${idPrefix}-${member.id}`;
          return (
            <label
              key={member.id}
              htmlFor={checkboxId}
              className={cn(
                'flex items-center gap-2 text-sm rounded-md px-1.5 py-1 cursor-pointer transition-colors',
                checked ? 'bg-primary/10' : 'hover:bg-muted'
              )}
            >
              <input
                id={checkboxId}
                type="checkbox"
                checked={checked}
                onChange={() => onToggle(member.id)}
                className="w-4 h-4 shrink-0 accent-primary"
              />
              <Avatar className="w-6 h-6 shrink-0">
                {member.avatar_url && <AvatarImage src={member.avatar_url} alt="" />}
                <AvatarFallback className="bg-primary/10 text-primary text-[10px] font-semibold">
                  {getInitials(getContactDisplayName(member))}
                </AvatarFallback>
              </Avatar>
              <span className="flex-1 min-w-0 text-left">
                <span className="block truncate font-medium">{getContactDisplayName(member)}</span>
                {(member.job_title || member.department) && (
                  <span className="block truncate text-xs text-muted-foreground">
                    {[member.job_title, member.department].filter(Boolean).join(' · ')}
                  </span>
                )}
              </span>
              {checked && (
                <UserRoundCheck aria-hidden className="w-4 h-4 shrink-0 text-primary" />
              )}
            </label>
          );
        })}
        {filtered.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-3">
            {t('contactEmpty', 'No team members found.')}
          </p>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{t(helpKey, helpFallback)}</p>
    </div>
  );
}
