import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

export default function RevenueChart({ invoices }) {
  const monthlyData = invoices.reduce((acc, inv) => {
    if (!inv.issue_date) return acc;
    const month = new Date(inv.issue_date).toLocaleString('en', { month: 'short' });
    const existing = acc.find(d => d.month === month);
    if (existing) {
      if (inv.payment_status === 'paid') existing.revenue += (inv.total || 0);
      else existing.outstanding += (inv.total || 0);
    } else {
      acc.push({
        month,
        revenue: inv.payment_status === 'paid' ? (inv.total || 0) : 0,
        outstanding: inv.payment_status !== 'paid' ? (inv.total || 0) : 0,
      });
    }
    return acc;
  }, []);

  return (
    <div className="bg-card rounded-xl border border-border p-5">
      <h3 className="font-heading font-semibold mb-4">Revenue Overview</h3>
      {monthlyData.length === 0 ? (
        <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">
          No invoice data yet
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={monthlyData} barGap={4}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
            <XAxis dataKey="month" tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
            <YAxis tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
            <Tooltip
              contentStyle={{
                borderRadius: '8px',
                border: '1px solid hsl(var(--border))',
                background: 'hsl(var(--card))',
                color: 'hsl(var(--foreground))',
              }}
            />
            <Bar dataKey="revenue" name="Revenue" fill="#6366f1" radius={[4, 4, 0, 0]} />
            <Bar dataKey="outstanding" name="Outstanding" fill="#f59e0b" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}