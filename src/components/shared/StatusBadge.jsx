import React from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const STATUS_CONFIG = {
  draft: { label: 'Draft', className: 'bg-slate-100 text-slate-600 border-slate-200' },
  planning: { label: 'Planning', className: 'bg-blue-50 text-blue-600 border-blue-200' },
  permit_approval: { label: 'Permit Approval', className: 'bg-amber-50 text-amber-600 border-amber-200' },
  in_progress: { label: 'In Progress', className: 'bg-indigo-50 text-indigo-600 border-indigo-200' },
  inspection: { label: 'Inspection', className: 'bg-purple-50 text-purple-600 border-purple-200' },
  on_hold: { label: 'On Hold', className: 'bg-red-50 text-red-600 border-red-200' },
  completed: { label: 'Completed', className: 'bg-emerald-50 text-emerald-600 border-emerald-200' },
  archived: { label: 'Archived', className: 'bg-gray-50 text-gray-500 border-gray-200' },
  active: { label: 'Active', className: 'bg-emerald-50 text-emerald-600 border-emerald-200' },
  inactive: { label: 'Inactive', className: 'bg-gray-50 text-gray-500 border-gray-200' },
  on_leave: { label: 'On Leave', className: 'bg-amber-50 text-amber-600 border-amber-200' },
  paid: { label: 'Paid', className: 'bg-emerald-50 text-emerald-600 border-emerald-200' },
  pending: { label: 'Pending', className: 'bg-amber-50 text-amber-600 border-amber-200' },
  overdue: { label: 'Overdue', className: 'bg-red-50 text-red-600 border-red-200' },
  partially_paid: { label: 'Partially Paid', className: 'bg-blue-50 text-blue-600 border-blue-200' },
};

export default function StatusBadge({ status }) {
  const config = STATUS_CONFIG[status] || { label: status, className: 'bg-gray-50 text-gray-500' };
  return (
    <Badge variant="outline" className={cn("text-xs font-medium border", config.className)}>
      {config.label}
    </Badge>
  );
}