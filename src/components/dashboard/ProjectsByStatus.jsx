import React from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';

const STATUS_COLORS = {
  draft: '#94a3b8',
  planning: '#3b82f6',
  permit_approval: '#f59e0b',
  in_progress: '#6366f1',
  inspection: '#8b5cf6',
  on_hold: '#ef4444',
  completed: '#10b981',
  archived: '#64748b',
};

const STATUS_LABELS = {
  draft: 'Draft',
  planning: 'Planning',
  permit_approval: 'Permit Approval',
  in_progress: 'In Progress',
  inspection: 'Inspection',
  on_hold: 'On Hold',
  completed: 'Completed',
  archived: 'Archived',
};

export default function ProjectsByStatus({ projects }) {
  const statusCounts = projects.reduce((acc, p) => {
    acc[p.status] = (acc[p.status] || 0) + 1;
    return acc;
  }, {});

  const data = Object.entries(statusCounts).map(([status, count]) => ({
    name: STATUS_LABELS[status] || status,
    value: count,
    fill: STATUS_COLORS[status] || '#6366f1',
  }));

  if (data.length === 0) {
    return (
      <div className="bg-card rounded-xl border border-border p-5">
        <h3 className="font-heading font-semibold mb-4">Projects by Status</h3>
        <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">
          No projects yet
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card rounded-xl border border-border p-5">
      <h3 className="font-heading font-semibold mb-4">Projects by Status</h3>
      <ResponsiveContainer width="100%" height={240}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={55}
            outerRadius={85}
            paddingAngle={3}
            dataKey="value"
          >
            {data.map((entry, index) => (
              <Cell key={index} fill={entry.fill} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              borderRadius: '8px',
              border: '1px solid hsl(var(--border))',
              background: 'hsl(var(--card))',
              color: 'hsl(var(--foreground))',
            }}
          />
          <Legend
            wrapperStyle={{ fontSize: '12px' }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}