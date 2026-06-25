import React from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import TopBar from '@/components/layout/TopBar';
import StatCard from '@/components/dashboard/StatCard';
import ProjectsByStatus from '@/components/dashboard/ProjectsByStatus';
import RevenueChart from '@/components/dashboard/RevenueChart';
import UpcomingDeadlines from '@/components/dashboard/UpcomingDeadlines';
import {
  FolderKanban, CheckCircle2, AlertTriangle, Clock,
  Users, UserCircle, DollarSign, FileWarning
} from 'lucide-react';
import { listEntities } from '@/services/dataService';
import { useDashboardData } from '@/hooks/useDashboardData';

function StatSkeleton() {
  return (
    <div className="bg-card rounded-xl border border-border p-5 animate-pulse">
      <div className="flex items-start justify-between">
        <div className="space-y-2 flex-1">
          <div className="h-3 w-20 bg-muted rounded" />
          <div className="h-8 w-16 bg-muted rounded" />
        </div>
        <div className="h-10 w-10 rounded-lg bg-muted" />
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { t } = useTranslation();
  const { clientCount, teamMemberCount, isLoading } = useDashboardData();
  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => listEntities('projects'),
    placeholderData: [],
  });
  const { data: invoices = [] } = useQuery({
    queryKey: ['invoices'],
    queryFn: () => listEntities('invoices'),
    placeholderData: [],
  });

  const activeProjects = projects.filter(p => p.status === 'in_progress');
  const completedProjects = projects.filter(p => p.status === 'completed');
  const delayedProjects = projects.filter(p => {
    if (!p.end_date || p.status === 'completed' || p.status === 'archived') return false;
    return new Date(p.end_date) < new Date();
  });
  const totalRevenue = invoices.filter(i => i.payment_status === 'paid').reduce((sum, i) => sum + (i.total || 0), 0);
  const outstandingInvoices = invoices.filter(i => i.payment_status === 'pending' || i.payment_status === 'partially_paid');
  const overdueInvoices = invoices.filter(i => i.payment_status === 'overdue');

  return (
    <div>
      <TopBar title={t('dashboard')} />
      <div className="p-6 space-y-6">
        {/* Stats Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard title={t('totalProjects')} value={projects.length} icon={FolderKanban} color="primary" />
          <StatCard title={t('activeProjects')} value={activeProjects.length} icon={Clock} color="blue" />
          <StatCard title={t('completed')} value={completedProjects.length} icon={CheckCircle2} color="success" />
          <StatCard title={t('delayed')} value={delayedProjects.length} icon={AlertTriangle} color="destructive" />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {isLoading ? (
            <>
              <StatSkeleton />
              <StatSkeleton />
            </>
          ) : (
            <>
              <StatCard title={t('teamMembers')} value={teamMemberCount} icon={Users} color="violet" />
              <StatCard title={t('clients')} value={clientCount} icon={UserCircle} color="blue" />
            </>
          )}
          <StatCard
            title={t('revenue')}
            value={`€${totalRevenue.toLocaleString()}`}
            icon={DollarSign}
            color="success"
          />
          <StatCard
            title={t('outstanding')}
            value={`${outstandingInvoices.length} ${t('invoices')}`}
            icon={FileWarning}
            color="warning"
          />
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <ProjectsByStatus projects={projects} />
          <RevenueChart invoices={invoices} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <UpcomingDeadlines projects={projects} />
        </div>
      </div>
    </div>
  );
}
