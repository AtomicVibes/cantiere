import React from 'react';
import { Link } from 'react-router-dom';
import { Calendar, MapPin, DollarSign } from 'lucide-react';
import { format } from 'date-fns';
import { Progress } from '@/components/ui/progress';
import StatusBadge from '@/components/shared/StatusBadge';
import PriorityBadge from '@/components/shared/PriorityBadge';

const TYPE_LABELS = {
  construction: 'Construction',
  renovation: 'Renovation',
  apartment_sale: 'Apartment Sale',
  property_rental: 'Property Rental',
  property_management: 'Property Mgmt',
  consulting: 'Consulting',
  land_acquisition: 'Land Acquisition',
  architectural_study: 'Architectural Study',
  investment: 'Investment',
  other: 'Other',
};

export default function ProjectCard({ project, clientName }) {
  if (!project) return null;

  const progress = project.progress ?? 0;
  const budget = project.budget ?? 0;

  return (
    <Link
      to={`/projects/${project.id}`}
      className="block bg-card rounded-xl border border-border p-5 hover:shadow-lg hover:border-primary/20 transition-all duration-200 group"
    >
      <div className="flex items-start justify-between mb-3">
        <div className="min-w-0 flex-1">
          <h3 className="font-heading font-semibold text-base group-hover:text-primary transition-colors truncate">
            {project.name}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {TYPE_LABELS[project?.type] || project?.type}
            {clientName && ` · ${clientName}`}
          </p>
        </div>
        {project?.priority && <PriorityBadge priority={project.priority} />}
      </div>

      {project?.description && (
        <p className="text-sm text-muted-foreground line-clamp-2 mb-3">{project.description}</p>
      )}

      <div className="space-y-3">
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          {project?.start_date && (
            <span className="flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5" />
              {format(new Date(project.start_date), 'MMM d, yyyy')}
            </span>
          )}
          {project?.location && (
            <span className="flex items-center gap-1">
              <MapPin className="w-3.5 h-3.5" />
              {project.location}
            </span>
          )}
          {budget > 0 && (
            <span className="flex items-center gap-1">
              <DollarSign className="w-3.5 h-3.5" />
              €{budget?.toLocaleString()}
            </span>
          )}
        </div>

        <div className="flex items-center justify-between">
          <StatusBadge status={project?.status} />
          <div className="flex items-center gap-2 w-24">
            <Progress value={progress} className="h-1.5" />
            <span className="text-xs text-muted-foreground">{progress}%</span>
          </div>
        </div>
      </div>
    </Link>
  );
}