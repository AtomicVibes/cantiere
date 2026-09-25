import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts';
import StatCard from '@/components/dashboard/StatCard';
import { Wallet, PiggyBank, Receipt, Hourglass, Undo2, Percent } from 'lucide-react';
import { computeScopeTotals, formatMoney, DEFAULT_CURRENCY } from '@/lib/budgetMath';

const PIE_COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#8B5CF6', '#EF4444', '#14B8A6', '#EC4899', '#64748B'];

export default function BudgetOverview({ budgets, expenses, refunds, categories, projects, loading }) {
  const { t } = useTranslation();

  const totals = React.useMemo(() => {
    const globals = (budgets || []).filter((b) => !b.parent_budget_id && b.status !== 'archived');
    const subs = (budgets || []).filter((b) => b.parent_budget_id && b.status !== 'archived');
    const total = globals.reduce((s, b) => s + (Number(b.total_amount) || 0), 0);
    const allocated = subs.reduce((s, b) => s + (Number(b.total_amount) || 0), 0);
    return { ...computeScopeTotals({ total, allocated, expenses, refunds }), currency: globals[0]?.currency || DEFAULT_CURRENCY };
  }, [budgets, expenses, refunds]);

  const categoryName = React.useCallback(
    (id) => (categories || []).find((c) => c.id === id)?.name || t('miscellaneous', 'Miscellaneous'),
    [categories, t]
  );

  const byCategory = React.useMemo(() => {
    const map = new Map();
    for (const e of expenses || []) {
      if (e.archived || e.payment_status === 'cancelled') continue;
      const key = categoryName(e.category_id);
      map.set(key, (map.get(key) || 0) + (Number(e.amount) || 0));
    }
    return [...map.entries()].map(([name, value]) => ({ name, value: Math.round(value * 100) / 100 }));
  }, [expenses, categoryName]);

  const byMonth = React.useMemo(() => {
    const map = new Map();
    for (const e of expenses || []) {
      if (!e.expense_date || e.archived || e.payment_status === 'cancelled') continue;
      const d = new Date(e.expense_date);
      if (Number.isNaN(d.getTime())) continue;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      map.set(key, (map.get(key) || 0) + (Number(e.amount) || 0));
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-8).map(([month, spent]) => ({ month, spent: Math.round(spent * 100) / 100 }));
  }, [expenses]);

  if (loading) {
    return <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">{t('loading')}</div>;
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        <StatCard title={t('budgetTotal', 'Global Budget')} value={formatMoney(totals.total, totals.currency)} icon={Wallet} color="primary" />
        <StatCard title={t('budgetAllocated', 'Allocated')} value={formatMoney(totals.allocated, totals.currency)} icon={PiggyBank} color="blue" />
        <StatCard title={t('budgetSpent', 'Spent')} value={formatMoney(totals.spent, totals.currency)} icon={Receipt} color="warning" />
        <StatCard title={t('budgetCommitted', 'Committed')} value={formatMoney(totals.committed, totals.currency)} icon={Hourglass} color="violet" />
        <StatCard title={t('budgetRefunded', 'Refunded')} value={formatMoney(totals.refunded, totals.currency)} icon={Undo2} color="success" />
        <StatCard title={t('budgetRemaining', 'Remaining')} value={formatMoney(totals.remaining, totals.currency)} icon={Percent} color={totals.remaining < 0 ? 'destructive' : 'success'} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-card rounded-xl border border-border p-5">
          <h3 className="font-heading font-semibold mb-4">{t('spendingByCategory', 'Spending by category')}</h3>
          {byCategory.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">{t('noData')}</div>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={byCategory} dataKey="value" nameKey="name" outerRadius={90} label={false}>
                  {byCategory.map((entry, i) => (
                    <Cell key={entry.name} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v) => formatMoney(v)} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
        <div className="bg-card rounded-xl border border-border p-5">
          <h3 className="font-heading font-semibold mb-4">{t('spendingOverTime', 'Spending over time')}</h3>
          {byMonth.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">{t('noData')}</div>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={byMonth} barGap={4}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
                <Tooltip formatter={(v) => formatMoney(v)} />
                <Bar dataKey="spent" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}
