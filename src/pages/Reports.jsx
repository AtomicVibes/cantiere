import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import TopBar from '@/components/layout/TopBar';
import StatCard from '@/components/dashboard/StatCard';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import { FolderKanban, DollarSign, Users, UserCircle } from 'lucide-react';

const CHART_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#3b82f6', '#ec4899', '#14b8a6'];

export default function Reports() {
  const { data: projects = [] } = useQuery({ queryKey: ['projects'], queryFn: () => base44.entities.Project.list(), initialData: [] });
  const { data: invoices = [] } = useQuery({ queryKey: ['invoices'], queryFn: () => base44.entities.Invoice.list(), initialData: [] });
  const { data: clients = [] } = useQuery({ queryKey: ['clients'], queryFn: () => base44.entities.Client.list(), initialData: [] });
  const { data: members = [] } = useQuery({ queryKey: ['teamMembers'], queryFn: () => base44.entities.TeamMember.list(), initialData: [] });

  // Project stats
  const projectsByType = projects.reduce((acc, p) => {
    const label = (p.type || 'other').replace(/_/g, ' ');
    const existing = acc.find(d => d.name === label);
    if (existing) existing.value++;
    else acc.push({ name: label, value: 1 });
    return acc;
  }, []);

  const budgetVsActual = projects
    .filter(p => p.budget > 0)
    .slice(0, 8)
    .map(p => ({ name: p.name?.slice(0, 15), budget: p.budget || 0, actual: p.actual_cost || 0 }));

  // Finance stats
  const categoryRevenue = invoices.reduce((acc, inv) => {
    const cat = (inv.category || 'miscellaneous').replace(/_/g, ' ');
    const existing = acc.find(d => d.name === cat);
    if (existing) existing.value += (inv.total || 0);
    else acc.push({ name: cat, value: inv.total || 0 });
    return acc;
  }, []);

  const totalBudget = projects.reduce((s, p) => s + (p.budget || 0), 0);
  const totalActual = projects.reduce((s, p) => s + (p.actual_cost || 0), 0);
  const totalInvoiced = invoices.reduce((s, i) => s + (i.total || 0), 0);
  const totalPaid = invoices.filter(i => i.payment_status === 'paid').reduce((s, i) => s + (i.total || 0), 0);

  return (
    <div>
      <TopBar title="Reports" />
      <div className="p-6 space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard title="Total Projects" value={projects.length} icon={FolderKanban} color="primary" />
          <StatCard title="Total Invoiced" value={`€${totalInvoiced.toLocaleString()}`} icon={DollarSign} color="blue" />
          <StatCard title="Team Members" value={members.length} icon={Users} color="violet" />
          <StatCard title="Total Clients" value={clients.length} icon={UserCircle} color="success" />
        </div>

        <Tabs defaultValue="projects">
          <TabsList>
            <TabsTrigger value="projects">Projects</TabsTrigger>
            <TabsTrigger value="finance">Finance</TabsTrigger>
          </TabsList>

          <TabsContent value="projects" className="space-y-6 mt-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-card rounded-xl border border-border p-5">
                <h3 className="font-heading font-semibold mb-4">Projects by Type</h3>
                {projectsByType.length === 0 ? (
                  <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">No data</div>
                ) : (
                  <ResponsiveContainer width="100%" height={240}>
                    <PieChart>
                      <Pie data={projectsByType} cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={3} dataKey="value">
                        {projectsByType.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                      </Pie>
                      <Tooltip contentStyle={{ borderRadius: '8px', border: '1px solid hsl(var(--border))', background: 'hsl(var(--card))', color: 'hsl(var(--foreground))' }} />
                      <Legend wrapperStyle={{ fontSize: '12px' }} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>

              <div className="bg-card rounded-xl border border-border p-5">
                <h3 className="font-heading font-semibold mb-4">Budget vs Actual Cost</h3>
                {budgetVsActual.length === 0 ? (
                  <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">No data</div>
                ) : (
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={budgetVsActual} barGap={4}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                      <XAxis dataKey="name" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                      <YAxis tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
                      <Tooltip contentStyle={{ borderRadius: '8px', border: '1px solid hsl(var(--border))', background: 'hsl(var(--card))', color: 'hsl(var(--foreground))' }} />
                      <Bar dataKey="budget" name="Budget" fill="#6366f1" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="actual" name="Actual" fill="#ef4444" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="finance" className="space-y-6 mt-4">
            <div className="bg-card rounded-xl border border-border p-5">
              <h3 className="font-heading font-semibold mb-4">Revenue by Category</h3>
              {categoryRevenue.length === 0 ? (
                <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">No data</div>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={categoryRevenue} layout="vertical" barSize={20}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
                    <XAxis type="number" tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={100} stroke="hsl(var(--muted-foreground))" />
                    <Tooltip contentStyle={{ borderRadius: '8px', border: '1px solid hsl(var(--border))', background: 'hsl(var(--card))', color: 'hsl(var(--foreground))' }} />
                    <Bar dataKey="value" name="Revenue" fill="#10b981" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}