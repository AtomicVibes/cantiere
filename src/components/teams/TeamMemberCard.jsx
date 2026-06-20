import React from 'react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Mail, Phone, Pencil, Trash2 } from 'lucide-react';
import StatusBadge from '@/components/shared/StatusBadge';
import MessagePopover from '@/components/teams/MessagePopover';

const JOB_TITLES = [
  { value: 'project_manager', label: 'Project Manager' },
  { value: 'project_coordinator', label: 'Project Coordinator' },
  { value: 'supervisor', label: 'Supervisor' },
  { value: 'architect', label: 'Architect' },
  { value: 'civil_engineer', label: 'Civil Engineer' },
  { value: 'interior_designer', label: 'Interior Designer' },
  { value: 'technician', label: 'Technician' },
  { value: 'accountant', label: 'Accountant' },
  { value: 'procurement_officer', label: 'Procurement Officer' },
  { value: 'supplier', label: 'Supplier' },
  { value: 'contractor', label: 'Contractor' },
  { value: 'safety_officer', label: 'Safety Officer' },
  { value: 'surveyor', label: 'Surveyor' },
  { value: 'consultant', label: 'Consultant' },
];

const getInitials = (name) => name?.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || '??';

export default function TeamMemberCard({ member, layout = 'grid', onEdit, onDelete }) {
  const jobLabel = JOB_TITLES.find(j => j.value === member.job_title)?.label || member.job_title;
  const waLink = member.phone ? `https://wa.me/${member.phone.replace(/\D/g, '')}` : null;

  if (layout === 'list') {
    return (
      <div className="bg-card rounded-xl border border-border px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-4 hover:shadow-md transition-shadow">
        <Avatar className="w-10 h-10 shrink-0">
          <AvatarFallback className="bg-primary/10 text-primary font-semibold text-sm">
            {getInitials(member.full_name)}
          </AvatarFallback>
        </Avatar>

        <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-3 gap-1 sm:gap-4">
          <div>
            <p className="font-semibold truncate">{member.full_name}</p>
            <p className="text-xs text-muted-foreground">{jobLabel}</p>
          </div>
          <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
            {member.email && <span className="flex items-center gap-1 truncate"><Mail className="w-3 h-3 shrink-0" />{member.email}</span>}
            {member.phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3 shrink-0" />{member.phone}</span>}
          </div>
          <div className="flex items-center">
            <StatusBadge status={member.status} />
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <MessagePopover member={member} />
          {waLink && (
            <a href={waLink} target="_blank" rel="noopener noreferrer">
              <Button variant="outline" size="sm" className="gap-1.5 text-xs h-8 text-green-600 border-green-200 hover:bg-green-50">
                <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-current"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.123.554 4.112 1.522 5.836L.057 23.928l6.235-1.635A11.945 11.945 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.891 0-3.659-.498-5.191-1.37l-.371-.221-3.702.972.985-3.608-.244-.387A9.947 9.947 0 012 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/></svg>
                WhatsApp
              </Button>
            </a>
          )}
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onEdit(member)}>
            <Pencil className="w-3.5 h-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => onDelete(member.id)}>
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
    );
  }

  // Grid layout
  return (
    <div className="bg-card rounded-xl border border-border p-5 hover:shadow-md transition-shadow flex flex-col gap-4">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <Avatar className="w-11 h-11">
            <AvatarFallback className="bg-primary/10 text-primary font-semibold text-sm">
              {getInitials(member.full_name)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <h3 className="font-semibold truncate">{member.full_name}</h3>
            <p className="text-xs text-muted-foreground">{jobLabel}</p>
          </div>
        </div>
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onEdit(member)}>
            <Pencil className="w-3.5 h-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => onDelete(member.id)}>
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      <div className="space-y-1 text-xs text-muted-foreground">
        {member.email && <div className="flex items-center gap-1.5 truncate"><Mail className="w-3 h-3 shrink-0" />{member.email}</div>}
        {member.phone && <div className="flex items-center gap-1.5"><Phone className="w-3 h-3 shrink-0" />{member.phone}</div>}
      </div>

      <div className="flex items-center justify-between flex-wrap gap-2 mt-auto">
        <StatusBadge status={member.status} />
        <div className="flex items-center gap-2">
          <MessagePopover member={member} />
          {waLink && (
            <a href={waLink} target="_blank" rel="noopener noreferrer">
              <Button variant="outline" size="sm" className="gap-1.5 text-xs h-8 text-green-600 border-green-200 hover:bg-green-50">
                <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-current"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.123.554 4.112 1.522 5.836L.057 23.928l6.235-1.635A11.945 11.945 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.891 0-3.659-.498-5.191-1.37l-.371-.221-3.702.972.985-3.608-.244-.387A9.947 9.947 0 012 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/></svg>
                WA
              </Button>
            </a>
          )}
        </div>
      </div>
    </div>
  );
}