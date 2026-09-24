import React from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, Globe, Lock, Users } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

// Canonical document visibility selector. Database values are preserved
// exactly ('private' | 'public' | 'selected'); only presentation is shared:
// Globe = public, Lock = private, Users = selected audience, with semantic
// theme tokens (no separate document color system) and translated labels.
export const VISIBILITY_OPTIONS = [
  { value: 'private', icon: Lock, labelKey: 'visibility.private', fallback: 'Private', iconClassName: 'text-muted-foreground' },
  { value: 'public', icon: Globe, labelKey: 'visibility.public', fallback: 'Public', iconClassName: 'text-primary' },
  { value: 'selected', icon: Users, labelKey: 'visibility.selected', fallback: 'Selected audience', iconClassName: 'text-accent-foreground' },
];

export function VisibilityIcon({ value, className }) {
  const option = VISIBILITY_OPTIONS.find((o) => o.value === value) ?? VISIBILITY_OPTIONS[0];
  const Icon = option.icon;
  return <Icon aria-hidden className={cn('w-4 h-4 shrink-0', option.iconClassName, className)} />;
}

export function VisibilityBadge({ value, className }) {
  const { t } = useTranslation();
  const option = VISIBILITY_OPTIONS.find((o) => o.value === value) ?? VISIBILITY_OPTIONS[0];
  const Icon = option.icon;
  return (
    <span className={cn('inline-flex items-center gap-1 capitalize', option.iconClassName, className)}>
      <Icon aria-hidden className="w-3.5 h-3.5" />
      {t(option.labelKey, option.fallback)}
    </span>
  );
}

export default function VisibilitySelect({ value, onValueChange, id, label }) {
  const { t } = useTranslation();
  const current = VISIBILITY_OPTIONS.find((o) => o.value === value) ?? VISIBILITY_OPTIONS[0];
  const CurrentIcon = current.icon;
  return (
    <div>
      <Label htmlFor={id} className="flex items-center gap-1.5">
        <Eye aria-hidden className="w-4 h-4 text-muted-foreground" />
        {label ?? t('visibility.label', 'Visibility')}
      </Label>
      <div className="flex items-center gap-2">
        <CurrentIcon aria-hidden className={cn('w-4 h-4 shrink-0', current.iconClassName)} />
        <Select value={value} onValueChange={onValueChange}>
          <SelectTrigger id={id} className="flex-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            {VISIBILITY_OPTIONS.map((option) => {
              const Icon = option.icon;
              return (
                <SelectItem key={option.value} value={option.value}>
                  <span className="flex items-center gap-2">
                    <Icon aria-hidden className={cn('w-4 h-4 shrink-0', option.iconClassName)} />
                    {t(option.labelKey, option.fallback)}
                  </span>
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
