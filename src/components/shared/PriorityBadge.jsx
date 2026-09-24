import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Minus,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

// Priority: Low=green, Medium=yellow, High=orange, Critical=red.
// Soft tint + colored text/border reads in both light and dark modes;
// icon + text label (never color alone).
const PRIORITY_CONFIG = {
  low: { icon: ArrowDown, labelKey: 'low', fallback: 'Low', className: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30' },
  medium: { icon: Minus, labelKey: 'medium', fallback: 'Medium', className: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-300 border-yellow-500/30' },
  high: { icon: ArrowUp, labelKey: 'high', fallback: 'High', className: 'bg-orange-500/10 text-orange-700 dark:text-orange-300 border-orange-500/30' },
  critical: { icon: AlertTriangle, labelKey: 'critical', fallback: 'Critical', className: 'bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/30' },
};

export const PROJECT_PRIORITIES = Object.keys(PRIORITY_CONFIG);

export default function PriorityBadge({ priority }) {
  const { t } = useTranslation();
  const config = PRIORITY_CONFIG[priority] || { icon: Minus, labelKey: null, fallback: priority, className: 'bg-muted text-muted-foreground border-border' };
  const Icon = config.icon;
  return (
    <Badge variant="outline" className={cn('text-xs font-medium border gap-1', config.className)}>
      <Icon aria-hidden className="w-3 h-3" />
      {config.labelKey ? t(config.labelKey, config.fallback) : config.fallback}
    </Badge>
  );
}
