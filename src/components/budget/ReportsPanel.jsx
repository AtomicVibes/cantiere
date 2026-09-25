import React from 'react';
import { useTranslation } from 'react-i18next';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import DatePicker from '@/components/ui/DatePicker';
import { computeScopeTotals, formatMoney } from '@/lib/budgetMath';
import { buildExpenseRows, buildBudgetSummaryRows, exportBudgetExpensesToExcel } from '@/lib/budgetExport';
import { logAppError } from '@/lib/userErrors';
import { toast } from 'sonner';

function emptyFilters() {
  return {
    budget_id: 'all', project_id: 'all', category_id: 'all', status: 'all',
    expense_type: 'all', vendor: '', date_from: '', date_to: '',
  };
}

export default function ReportsPanel({ budgets, expenses, refunds, categories, projects, onAudit }) {
  const { t } = useTranslation();
  const [filters, setFilters] = React.useState(emptyFilters());
  const [exporting, setExporting] = React.useState(false);

  const set = (key) => (value) => setFilters((f) => ({ ...f, [key]: value }));

  const categoryName = React.useCallback(
    (id) => (categories || []).find((c) => c.id === id)?.name || '',
    [categories]
  );
  const projectName = React.useCallback(
    (id) => (projects || []).find((p) => p.id === id)?.name || '',
    [projects]
  );
  const budgetName = React.useCallback(
    (id) => (budgets || []).find((b) => b.id === id)?.name || '',
    [budgets]
  );

  const filtered = React.useMemo(() => {
    const vendor = filters.vendor.trim().toLowerCase();
    return (expenses || []).filter((e) => {
      if (e.archived) return false;
      if (filters.budget_id !== 'all' && e.budget_id !== filters.budget_id) return false;
      if (filters.project_id !== 'all' && e.project_id !== filters.project_id) return false;
      if (filters.category_id !== 'all' && e.category_id !== filters.category_id && e.subcategory_id !== filters.category_id) return false;
      if (filters.status !== 'all' && e.payment_status !== filters.status) return false;
      if (filters.expense_type !== 'all' && e.expense_type !== filters.expense_type) return false;
      if (vendor && !(e.vendor || '').toLowerCase().includes(vendor)) return false;
      if (filters.date_from && (e.expense_date || '') < filters.date_from) return false;
      if (filters.date_to && (e.expense_date || '') > filters.date_to) return false;
      return true;
    });
  }, [expenses, filters]);

  const totals = React.useMemo(
    () => computeScopeTotals({ total: 0, allocated: 0, expenses: filtered, refunds }),
    [filtered, refunds]
  );

  const byCategory = React.useMemo(() => {
    const children = new Map((categories || []).map((c) => [c.id, c]));
    const agg = new Map();
    for (const e of filtered) {
      if (e.payment_status === 'cancelled') continue;
      let catId = e.category_id;
      let guard = 0;
      while (catId && children.get(catId)?.parent_category_id && guard < 10) {
        catId = children.get(catId).parent_category_id;
        guard += 1;
      }
      const key = categoryName(catId) || t('miscellaneous', 'Miscellaneous');
      // Budget vs actual per top-level category: actual = net spent here.
      const entry = agg.get(key) || { name: key, budget: 0, actual: 0 };
      entry.actual += Number(e.amount) || 0;
      agg.set(key, entry);
    }
    // Attribute sub-budget totals as the "budget" side where names match.
    for (const b of budgets || []) {
      const entry = agg.get(b.name);
      if (entry) entry.budget += Number(b.total_amount) || 0;
    }
    return [...agg.values()].map((r) => ({
      ...r,
      budget: Math.round(r.budget * 100) / 100,
      actual: Math.round(r.actual * 100) / 100,
      variance: Math.round((r.budget - r.actual) * 100) / 100,
      usage: r.budget > 0 ? Math.round((r.actual / r.budget) * 10000) / 100 : 0,
    }));
  }, [filtered, budgets, categories, categoryName, t]);

  async function handleExport() {
    setExporting(true);
    try {
      const expenseRows = buildExpenseRows(filtered, refunds, {
        resolveCategory: categoryName,
        resolveProject: projectName,
        resolveBudget: budgetName,
      });
      const totalsByBudget = {};
      for (const b of budgets || []) {
        const scoped = (expenses || []).filter((e) => e.budget_id === b.id);
        totalsByBudget[b.id] = computeScopeTotals({ total: Number(b.total_amount) || 0, allocated: 0, expenses: scoped, refunds });
      }
      const summaryRows = buildBudgetSummaryRows(budgets, totalsByBudget);
      await exportBudgetExpensesToExcel(expenseRows, summaryRows, `budget-export-${new Date().toISOString().slice(0, 10)}.xlsx`);
      await onAudit?.('BUDGET_EXPORTED', 'Budget report exported', { rows: expenseRows.length });
      toast.success(t('exportSuccess') || 'Export ready.');
    } catch (err) {
      logAppError('Budget', err, { operation: 'export-excel' });
      toast.error(t('exportFailed') || 'Export failed. Please try again.');
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <div>
          <Label>{t('budget', 'Budget')}</Label>
          <Select value={filters.budget_id} onValueChange={set('budget_id')}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('all') || 'All'}</SelectItem>
              {(budgets || []).map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>{t('project', 'Project')}</Label>
          <Select value={filters.project_id} onValueChange={set('project_id')}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('all') || 'All'}</SelectItem>
              {(projects || []).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>{t('category', 'Category')}</Label>
          <Select value={filters.category_id} onValueChange={set('category_id')}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('all') || 'All'}</SelectItem>
              {(categories || []).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>{t('status', 'Status')}</Label>
          <Select value={filters.status} onValueChange={set('status')}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('all') || 'All'}</SelectItem>
              {['planned', 'pending', 'approved', 'paid', 'partially_paid', 'overdue', 'cancelled', 'refunded', 'partially_refunded'].map((s) => (
                <SelectItem key={s} value={s} className="capitalize">{s.replace(/_/g, ' ')}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>{t('expenseTypeLabel', 'Type')}</Label>
          <Select value={filters.expense_type} onValueChange={set('expense_type')}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('all') || 'All'}</SelectItem>
              <SelectItem value="fixed">{t('expenseFixed', 'Fixed')}</SelectItem>
              <SelectItem value="flexible">{t('expenseFlexible', 'Flexible')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>{t('expenseVendor', 'Vendor')}</Label>
          <Input value={filters.vendor} onChange={(e) => set('vendor')(e.target.value)} placeholder="…" />
        </div>
        <div><Label>{t('dateFrom', 'From')}</Label><DatePicker value={filters.date_from} onChange={set('date_from')} allowClear /></div>
        <div><Label>{t('dateTo', 'To')}</Label><DatePicker value={filters.date_to} onChange={set('date_to')} allowClear /></div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
        <div className="bg-card rounded-lg border border-border p-3"><p className="text-xs text-muted-foreground">{t('budgetSpent', 'Spent')}</p><p className="font-bold">{formatMoney(totals.spent)}</p></div>
        <div className="bg-card rounded-lg border border-border p-3"><p className="text-xs text-muted-foreground">{t('budgetRefunded', 'Refunded')}</p><p className="font-bold">{formatMoney(totals.refunded)}</p></div>
        <div className="bg-card rounded-lg border border-border p-3"><p className="text-xs text-muted-foreground">{t('budgetRemaining', 'Remaining')}</p><p className="font-bold">{formatMoney(totals.remaining)}</p></div>
        <div className="bg-card rounded-lg border border-border p-3"><p className="text-xs text-muted-foreground">{t('budgetCount', 'Expenses')}</p><p className="font-bold">{filtered.length}</p></div>
      </div>

      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead>{t('category', 'Category')}</TableHead>
                <TableHead className="text-right">{t('budget', 'Budget')}</TableHead>
                <TableHead className="text-right">{t('budgetActual', 'Actual')}</TableHead>
                <TableHead className="text-right">{t('budgetVariance', 'Variance')}</TableHead>
                <TableHead className="text-right">{t('budgetUsage', 'Usage')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {byCategory.map((row) => (
                <TableRow key={row.name}>
                  <TableCell className="font-medium">{row.name}</TableCell>
                  <TableCell className="text-right">{formatMoney(row.budget)}</TableCell>
                  <TableCell className="text-right">{formatMoney(row.actual)}</TableCell>
                  <TableCell className={`text-right font-semibold ${row.variance < 0 ? 'text-destructive' : 'text-emerald-600'}`}>
                    {formatMoney(row.variance)}
                  </TableCell>
                  <TableCell className="text-right">{row.usage}%</TableCell>
                </TableRow>
              ))}
              {byCategory.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground text-sm py-8">{t('noData')}</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" className="gap-2" disabled={exporting} onClick={handleExport}>
          <Download className="w-4 h-4" /> {exporting ? (t('exporting') || 'Exporting...') : (t('exportExcel') || 'Export Excel')}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setFilters(emptyFilters())}>
          {t('clearFilters') || 'Clear filters'}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{t('sheetsNote', 'Google Sheets sync is not connected. Excel export above carries the same rows for import.')}</p>
    </div>
  );
}
