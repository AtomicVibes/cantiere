import React from 'react';
import { useTranslation } from 'react-i18next';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import DatePicker from '@/components/ui/DatePicker';
import { computeScopeTotals, formatMoney, budgetScope, buildCategoryReportRows, isCountedExpense } from '@/lib/budgetMath';
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

  // Single shared predicate for cards, table and export (budget scope is
  // applied separately via budgetScope so export can reuse it per budget).
  const matchesFilters = React.useCallback((e, f) => {
    if (e.archived) return false;
    if (f.project_id !== 'all' && e.project_id !== f.project_id) return false;
    if (f.category_id !== 'all' && e.category_id !== f.category_id && e.subcategory_id !== f.category_id) return false;
    if (f.status !== 'all' && e.payment_status !== f.status) return false;
    if (f.expense_type !== 'all' && e.expense_type !== f.expense_type) return false;
    const vendor = f.vendor.trim().toLowerCase();
    if (vendor && !(e.vendor || '').toLowerCase().includes(vendor)) return false;
    if (f.date_from && (e.expense_date || '') < f.date_from) return false;
    if (f.date_to && (e.expense_date || '') > f.date_to) return false;
    return true;
  }, []);

  // Scope: selected budget includes ALL descendant sub-budgets (same
  // resolver as Budgets tab, rules and export).
  const scope = React.useMemo(
    () => budgetScope(budgets, filters.budget_id === 'all' ? null : filters.budget_id),
    [budgets, filters.budget_id]
  );

  const filtered = React.useMemo(
    () => (expenses || []).filter((e) => {
      if (scope.budgetIds && !scope.budgetIds.has(e.budget_id)) return false;
      return matchesFilters(e, filters);
    }),
    [expenses, scope, filters, matchesFilters]
  );

  // Cards and table share the same counted predicate (gross basis) so
  // sum(table Actual) === card Spent by construction.
  const totals = React.useMemo(
    () => computeScopeTotals({ total: scope.total, allocated: scope.allocated, expenses: filtered, refunds }),
    [scope, filtered, refunds]
  );
  const expenseCount = React.useMemo(() => filtered.filter(isCountedExpense).length, [filtered]);

  const byCategory = React.useMemo(
    () => buildCategoryReportRows({ expenses: filtered, categories }),
    [filtered, categories]
  );

  async function handleExport() {
    setExporting(true);
    try {
      const expenseRows = buildExpenseRows(filtered, refunds, {
        resolveCategory: categoryName,
        resolveProject: projectName,
        resolveBudget: budgetName,
        resolveSubBudget: (budgetId) => {
          const b = (budgets || []).find((x) => x.id === budgetId);
          return b?.parent_budget_id ? budgetName(b.parent_budget_id) : '';
        },
      });
      // Summary sheet: identical non-budget filters as the visible table;
      // with a budget filter only budgets in that scope are listed, so the
      // exported totals equal the on-screen cards for the same selection.
      const base = (expenses || []).filter((e) => matchesFilters(e, { ...filters, budget_id: 'all' }));
      const visible = filters.budget_id === 'all'
        ? budgets
        : (budgets || []).filter((b) => scope.budgetIds.has(b.id));
      const totalsByBudget = {};
      for (const b of visible || []) {
        const bScope = budgetScope(budgets, b.id);
        const scoped = base.filter((e) => bScope.budgetIds.has(e.budget_id));
        totalsByBudget[b.id] = computeScopeTotals({ total: bScope.total, allocated: bScope.allocated, expenses: scoped, refunds });
      }
      const summaryRows = buildBudgetSummaryRows(visible, totalsByBudget, { resolveParent: budgetName });
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

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 text-sm">
        <div className="bg-card rounded-lg border border-border p-3"><p className="text-xs text-muted-foreground">{t('budgetSpent', 'Spent')}</p><p className="font-bold">{formatMoney(totals.spent, scope.currency)}</p></div>
        <div className="bg-card rounded-lg border border-border p-3"><p className="text-xs text-muted-foreground">{t('budgetCommitted', 'Committed')}</p><p className="font-bold">{formatMoney(totals.committed, scope.currency)}</p></div>
        <div className="bg-card rounded-lg border border-border p-3"><p className="text-xs text-muted-foreground">{t('budgetRefunded', 'Refunded')}</p><p className="font-bold">{formatMoney(totals.refunded, scope.currency)}</p></div>
        <div className="bg-card rounded-lg border border-border p-3"><p className="text-xs text-muted-foreground">{t('budgetRemaining', 'Remaining')}</p><p className={`font-bold ${totals.remaining < 0 ? 'text-destructive' : ''}`}>{formatMoney(totals.remaining, scope.currency)}</p></div>
        <div className="bg-card rounded-lg border border-border p-3"><p className="text-xs text-muted-foreground">{t('budgetCount', 'Expenses')}</p><p className="font-bold">{expenseCount}</p></div>
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
                <TableRow key={row.key}>
                  <TableCell className="font-medium">{row.name || t('miscellaneous', 'Miscellaneous')}</TableCell>
                  <TableCell className="text-right">{formatMoney(row.budget, scope.currency)}</TableCell>
                  <TableCell className="text-right">{formatMoney(row.actual, scope.currency)}</TableCell>
                  <TableCell className={`text-right font-semibold ${row.variance < 0 ? 'text-destructive' : 'text-emerald-600'}`}>
                    {formatMoney(row.variance, scope.currency)}
                  </TableCell>
                  <TableCell className="text-right">
                    {row.usage.zeroBudget
                      ? (row.usage.over ? t('budgetOverBudget', 'Over Budget') : t('budgetNotSet', 'N/A'))
                      : `${row.usage.pct}%`}
                  </TableCell>
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
