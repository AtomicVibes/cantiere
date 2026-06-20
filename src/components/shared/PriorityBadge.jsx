import React from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const PRIORITY_CONFIG = {
  low: { label: 'Low', className: 'bg-slate-100 text-slate-600' },
  medium: { label: 'Medium', className: 'bg-blue-50 text-blue-600' },
  high: { label: 'High', className: 'bg-amber-50 text-amber-600' },
  critical: { label: 'Critical', className: 'bg-red-50 text-red-600' },
};

export default function PriorityBadge({ priority }) {
  const config = PRIORITY_CONFIG[priority] || { label: priority, className: 'bg-gray-50 text-gray-500' };
  return (
    <Badge variant="secondary" className={cn("text-xs font-medium", config.className)}>
      {config.label}
    </Badge>
  );
}