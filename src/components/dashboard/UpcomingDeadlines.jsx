import React from 'react';
import { format, isBefore, addDays } from 'date-fns';
import { Clock, AlertTriangle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export default function UpcomingDeadlines({ projects }) {
  const upcoming = projects
    .filter(p => p.end_date && p.status !== 'completed' && p.status !== 'archived')
    .sort((a, b) => new Date(a.end_date) - new Date(b.end_date))
    .slice(0, 5);

  const isOverdue = (date) => isBefore(new Date(date), new Date());
  const isSoon = (date) => isBefore(new Date(date), addDays(new Date(), 7));

  return (
    <div className="bg-card rounded-xl border border-border p-5">
      <h3 className="font-heading font-semibold mb-4">Upcoming Deadlines</h3>
      {upcoming.length === 0 ? (
        <div className="h-32 flex items-center justify-center text-muted-foreground text-sm">
          No upcoming deadlines
        </div>
      ) : (
        <div className="space-y-3">
          {upcoming.map((project) => (
            <div key={project.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
              <div className="flex items-center gap-3 min-w-0">
                {isOverdue(project.end_date) ? (
                  <AlertTriangle className="w-4 h-4 text-destructive flex-shrink-0" />
                ) : (
                  <Clock className={cn(
                    "w-4 h-4 flex-shrink-0",
                    isSoon(project.end_date) ? "text-amber-500" : "text-muted-foreground"
                  )} />
                )}
                <span className="text-sm font-medium truncate">{project.name}</span>
              </div>
              <Badge variant={isOverdue(project.end_date) ? "destructive" : isSoon(project.end_date) ? "outline" : "secondary"} className="text-xs flex-shrink-0">
                {format(new Date(project.end_date), 'MMM d')}
              </Badge>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}