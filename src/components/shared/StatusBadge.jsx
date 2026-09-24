import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  CheckCircle2,
  Circle,
  ClipboardList,
  FileEdit,
  PauseCircle,
  PlayCircle,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

// Standard statuses get dedicated icons; unknown/custom statuses keep
// their stored text with a neutral generic icon (user content is never
// translated, surrounding UI is).
const STATUS_CONFIG = {
  draft: { icon: FileEdit, labelKey: 'draft', fallback: 'Draft' },
  planning: { icon: ClipboardList, labelKey: 'planning', fallback: 'Planning' },
  in_progress: { icon: PlayCircle, labelKey: 'inProgress', fallback: 'In Progress' },
  on_hold: { icon: PauseCircle, labelKey: 'onHold', fallback: 'On Hold' },
  completed: { icon: CheckCircle2, labelKey: 'completed', fallback: 'Completed' },
};

export const PROJECT_STATUSES = [...Object.keys(STATUS_CONFIG), 'other'];

export default function StatusBadge({ status }) {
  const { t } = useTranslation();
  const humanized = String(status ?? '')
    .split('_')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
  const config = STATUS_CONFIG[status] || { icon: Circle, labelKey: null, fallback: humanized || t('other', 'Other') };
  const Icon = config.icon;
  return (
    <Badge variant="outline" className={cn('text-xs font-medium border gap-1 bg-muted text-muted-foreground border-border')}>
      <Icon aria-hidden className="w-3 h-3" />
      {config.labelKey ? t(config.labelKey, config.fallback) : config.fallback}
    </Badge>
  );
}
