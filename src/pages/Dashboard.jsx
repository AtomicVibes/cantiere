import React from 'react';
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

export default function Dashboard() {
  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => listEntities('projects'),
    initialData: [],
  });
  const { data: clients = [] } = useQuery({
    queryKey: ['clients'],
    queryFn: () => listEntities('clients'),
    initialData: [],
  });
  const { data: teamMembers = [] } = useQuery({
    queryKey: ['teamMembers'],
    queryFn: () => listEntities('team_members'),
    initialData: [],
  });
  const { data: invoices = [] } = useQuery({
    queryKey: ['invoices'],
    queryFn: () => listEntities('invoices'),
    initialData: [],
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
      <TopBar title="Dashboard" />
      <div className="p-6 space-y-6">
        {/* Stats Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard title="Total Projects" value={projects.length} icon={FolderKanban} color="primary" />
          <StatCard title="Active Projects" value={activeProjects.length} icon={Clock} color="blue" />
          <StatCard title="Completed" value={completedProjects.length} icon={CheckCircle2} color="success" />
          <StatCard title="Delayed" value={delayedProjects.length} icon={AlertTriangle} color="destructive" />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard title="Team Members" value={teamMembers.length} icon={Users} color="violet" />
          <StatCard title="Clients" value={clients.length} icon={UserCircle} color="blue" />
          <StatCard
            title="Revenue"
            value={`€${totalRevenue.toLocaleString()}`}
            icon={DollarSign}
            color="success"
          />
          <StatCard
            title="Outstanding"
            value={`${outstandingInvoices.length} invoices`}
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