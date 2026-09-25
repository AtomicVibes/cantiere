import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  Plus, Pencil, Search, Receipt, Banknote, Repeat, CalendarClock, X,
} from 'lucide-react';
import { supabase } from '@/services/supabase';
import { useAuth } from '@/lib/AuthContext';
import { logAppError, getUserFriendlyMessage } from '@/lib/userErrors';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import DatePicker from '@/components/ui/DatePicker';
import EmptyState from '@/components/shared/EmptyState';
import { netExpense, refundedTotal, formatMoney, variance, DEFAULT_CURRENCY, CURRENCY_OPTIONS } from '@/lib/budgetMath';
import { toast } from 'sonner';

const STATUSES = ['planned', 'pending', 'approved', 'paid', 'partially_paid', 'overdue', 'cancelled', 'refunded', 'partially_refunded'];
const PAGE_SIZE = 50;

function emptyExpense() {
  return {
    title: '', description: '', amount: '', expected_amount: '', currency: DEFAULT_CURRENCY,
    expense_date: '', category_id: 'none', subcategory_id: 'none', budget_id: 'none',
    project_id: 'none', vendor: '', reference: '', payment_status: 'pending',
    expense_type: 'flexible', notes: '', document_id: 'none',
  };
}

export default function ExpenseManager({ expenses, refunds, categories, budgets, projects, onChanged, onAudit, onNotify }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [search, setSearch] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState('all');
  const [typeFilter, setTypeFilter] = React.useState('all');
  const [visibleCount, setVisibleCount] = React.useState(PAGE_SIZE);
  const [showForm, setShowForm] = React.useState(false);
  const [editing, setEditing] = React.useState(null);
  const [form, setForm] = React.useState(emptyExpense());
  const [saving, setSaving] = React.useState(false);
  const [detail, setDetail] = React.useState(null);
  const [documents, setDocuments] = React.useState([]);

  const categoryName = React.useCallback(
    (id) => (categories || []).find((c) => c.id === id)?.name || '',
    [categories]
  );
  const subcategories = React.useMemo(
    () => (categories || []).filter((c) => c.parent_category_id),
    [categories]
  );
  const topCategories = React.useMemo(
    () => (categories || []).filter((c) => !c.parent_category_id),
    [categories]
  );

  React.useEffect(() => {
    supabase
      .from('documents')
      .select('id, file_name')
      .order('created_at', { ascending: false })
      .limit(200)
      .then(({ data, error }) => {
        if (!error) setDocuments(data ?? []);
        else logAppError('Budget', error, { operation: 'load-documents' });
      });
  }, []);

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return (expenses || [])
      .filter((e) => !e.archived)
      .filter((e) => (statusFilter === 'all' ? true : e.payment_status === statusFilter))
      .filter((e) => (typeFilter === 'all' ? true : e.expense_type === typeFilter))
      .filter((e) => {
        if (!q) return true;
        return [e.title, e.description, e.vendor, e.reference, categoryName(e.category_id)]
          .filter(Boolean)
          .some((f) => String(f).toLowerCase().includes(q));
      });
  }, [expenses, search, statusFilter, typeFilter, categoryName]);

  const visible = filtered.slice(0, visibleCount);

  function openCreate() {
    setEditing(null);
    setForm(emptyExpense());
    setShowForm(true);
  }

  function handleBudgetChange(budgetId) {
    // An expense linked to a budget inherits that budget's currency so a
    // EUR budget never silently holds another currency.
    const budget = (budgets || []).find((b) => b.id === budgetId);
    setForm((f) => ({
      ...f,
      budget_id: budgetId,
      currency: budget?.currency || f.currency || DEFAULT_CURRENCY,
    }));
  }

  function openEdit(expense) {
    setEditing(expense);
    setDetail(null);
    setForm({
      title: expense.title || '',
      description: expense.description || '',
      amount: expense.amount ?? '',
      expected_amount: expense.expected_amount ?? '',
      currency: expense.currency || DEFAULT_CURRENCY,
      expense_date: expense.expense_date || '',
      category_id: expense.category_id || 'none',
      subcategory_id: expense.subcategory_id || 'none',
      budget_id: expense.budget_id || 'none',
      project_id: expense.project_id || 'none',
      vendor: expense.vendor || '',
      reference: expense.reference || '',
      payment_status: expense.payment_status || 'pending',
      expense_type: expense.expense_type || 'flexible',
      notes: expense.notes || '',
      document_id: expense.document_id || 'none',
    });
    setShowForm(true);
  }

  async function handleSave(e) {
    e.preventDefault();
    const amount = Number(form.amount);
    if (!form.title.trim() || !Number.isFinite(amount) || amount < 0) {
      toast.error(t('expenseInvalid', 'Please enter a valid title and amount.'));
      return;
    }
    if (!form.expense_date) {
      toast.error(t('expenseDateRequired') || 'Please select a date.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        title: form.title.trim(),
        description: form.description?.trim() || null,
        amount,
        expected_amount: form.expected_amount === '' ? null : Number(form.expected_amount),
        currency: form.currency || DEFAULT_CURRENCY,
        expense_date: form.expense_date,
        category_id: form.category_id !== 'none' ? form.category_id : null,
        subcategory_id: form.subcategory_id !== 'none' ? form.subcategory_id : null,
        budget_id: form.budget_id !== 'none' ? form.budget_id : null,
        project_id: form.project_id !== 'none' ? form.project_id : null,
        vendor: form.vendor?.trim() || null,
        reference: form.reference?.trim() || null,
        payment_status: form.payment_status,
        expense_type: form.expense_type,
        notes: form.notes?.trim() || null,
        document_id: form.document_id !== 'none' ? form.document_id : null,
      };
      if (editing) {
        const { error } = await supabase.from('budget_expenses').update(payload).eq('id', editing.id);
        if (error) throw error;
        await onAudit('EXPENSE_UPDATED', 'Expense updated', { id: editing.id, title: payload.title });
      } else {
        const { data, error } = await supabase
          .from('budget_expenses')
          .insert({ ...payload, expense_kind: 'one_time', created_by: user?.id || null })
          .select('id')
          .single();
        if (error) throw error;
        await onAudit('EXPENSE_CREATED', 'Expense created', { id: data?.id, title: payload.title });
        // Large-expense notice: configurable per-expense threshold is out of
        // scope; amounts >= 10,000 in budget currency notify super admins.
        if (amount >= 10000) {
          await onNotify(`Large expense recorded: "${payload.title}" (${formatMoney(amount, payload.currency)}).`);
        }
      }
      toast.success(t('save') || 'Save');
      setShowForm(false);
      onChanged();
    } catch (err) {
      logAppError('Budget', err, { operation: 'save-expense' });
      toast.error(getUserFriendlyMessage(err, t, 'errors.saveExpense'));
    } finally {
      setSaving(false);
    }
  }

  async function handleStatus(expense, payment_status) {
    try {
      const { error } = await supabase.from('budget_expenses').update({ payment_status }).eq('id', expense.id);
      if (error) throw error;
      const action = { approved: 'EXPENSE_APPROVED', paid: 'EXPENSE_PAID', cancelled: 'EXPENSE_CANCELLED' }[payment_status] || 'EXPENSE_UPDATED';
      await onAudit(action, `Expense ${payment_status}`, { id: expense.id, title: expense.title });
      onChanged();
    } catch (err) {
      logAppError('Budget', err, { operation: 'expense-status' });
      toast.error(getUserFriendlyMessage(err, t, 'errors.saveExpense'));
    }
  }

  const detailRefunds = detail ? (refunds || []).filter((r) => r.expense_id === detail.id && r.status !== 'cancelled') : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => { setSearch(e.target.value); setVisibleCount(PAGE_SIZE); }} placeholder={t('searchExpenses') || 'Search expenses...'} className="pl-9" aria-label={t('searchExpenses') || 'Search expenses'} />
        </div>
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setVisibleCount(PAGE_SIZE); }}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('all') || 'All'}</SelectItem>
            {STATUSES.map((s) => <SelectItem key={s} value={s} className="capitalize">{s.replace(/_/g, ' ')}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v); setVisibleCount(PAGE_SIZE); }}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('all') || 'All'}</SelectItem>
            <SelectItem value="fixed">{t('expenseFixed', 'Fixed')}</SelectItem>
            <SelectItem value="flexible">{t('expenseFlexible', 'Flexible')}</SelectItem>
          </SelectContent>
        </Select>
        <Button onClick={openCreate} size="sm" className="gap-2 sm:ml-auto">
          <Plus className="w-4 h-4" /> {t('expenseNew', 'New expense')}
        </Button>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={Receipt} title={t('expenseEmpty', 'No expenses yet')} description={t('expenseEmptyHint', 'Record your first expense to start tracking.')} />
      ) : (
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead>{t('date') || 'Date'}</TableHead>
                  <TableHead>{t('expenseTitle', 'Expense')}</TableHead>
                  <TableHead className="hidden md:table-cell">{t('category', 'Category')}</TableHead>
                  <TableHead className="hidden lg:table-cell">{t('project', 'Project')}</TableHead>
                  <TableHead className="text-right">{t('amount', 'Amount')}</TableHead>
                  <TableHead className="hidden sm:table-cell">{t('status', 'Status')}</TableHead>
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((e) => (
                  <TableRow key={e.id} className="hover:bg-muted/30">
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{e.expense_date || ''}</TableCell>
                    <TableCell>
                      <button className="text-left font-medium hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded" onClick={() => setDetail(e)}>
                        {e.title}
                      </button>
                      {e.expense_type === 'fixed' ? (
                        <Badge variant="outline" className="ml-2 text-[10px] gap-1"><Banknote className="w-3 h-3" aria-hidden />{t('expenseFixed', 'Fixed')}</Badge>
                      ) : null}
                      {e.expense_kind === 'recurring' ? (
                        <Badge variant="outline" className="ml-1 text-[10px] gap-1"><Repeat className="w-3 h-3" aria-hidden />{t('recurring', 'Recurring')}</Badge>
                      ) : null}
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{categoryName(e.category_id)}</TableCell>
                    <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                      {(projects || []).find((p) => p.id === e.project_id)?.name || ''}
                    </TableCell>
                    <TableCell className="text-right font-semibold whitespace-nowrap">
                      {formatMoney(netExpense(e, refunds), e.currency)}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <Badge variant="secondary" className="text-[10px] capitalize">{String(e.payment_status || '').replace(/_/g, ' ')}</Badge>
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(e)} aria-label={`${t('edit') || 'Edit'}: ${e.title}`}>
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {filtered.length > visible.length && (
            <div className="p-3 text-center border-t border-border">
              <Button variant="outline" size="sm" onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}>
                {t('showMore') || `Show more (${filtered.length - visible.length})`}
              </Button>
            </div>
          )}
        </div>
      )}

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-heading">{editing ? (t('expenseEdit', 'Edit expense')) : (t('expenseNew', 'New expense'))}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-3">
            <div><Label>{t('expenseTitle', 'Title')} *</Label><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required maxLength={160} /></div>
            <div><Label>{t('description', 'Description')}</Label><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} maxLength={500} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{t('amount', 'Amount')} *</Label>
                <Input type="number" min="0" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
              </div>
              <div>
                <Label>{t('budgetCurrency', 'Currency')}</Label>
                <Select value={form.currency} onValueChange={(v) => setForm({ ...form, currency: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{CURRENCY_OPTIONS.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>{t('date') || 'Date'} *</Label><DatePicker value={form.expense_date} onChange={(v) => setForm({ ...form, expense_date: v })} /></div>
              <div>
                <Label>{t('expenseExpected', 'Expected amount')}</Label>
                <Input type="number" min="0" step="0.01" value={form.expected_amount} onChange={(e) => setForm({ ...form, expected_amount: e.target.value })} placeholder="2000" />
              </div>
            </div>
            {form.expected_amount !== '' && Number.isFinite(Number(form.expected_amount)) && (
              <p className="text-xs text-muted-foreground">
                {t('expenseVariance', 'Variance')}: {formatMoney(variance(form.expected_amount, form.amount || 0), form.currency)}
              </p>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{t('category', 'Category')}</Label>
                <Select value={form.category_id} onValueChange={(v) => setForm({ ...form, category_id: v, subcategory_id: 'none' })}>
                  <SelectTrigger><SelectValue placeholder={t('none', 'None')} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t('none', 'None')}</SelectItem>
                    {topCategories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>{t('subcategory', 'Subcategory')}</Label>
                <Select value={form.subcategory_id} onValueChange={(v) => setForm({ ...form, subcategory_id: v })}>
                  <SelectTrigger><SelectValue placeholder={t('none', 'None')} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t('none', 'None')}</SelectItem>
                    {subcategories
                      .filter((c) => !form.category_id || form.category_id === 'none' || c.parent_category_id === form.category_id)
                      .map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{t('budget', 'Budget')}</Label>
                <Select value={form.budget_id} onValueChange={handleBudgetChange}>
                  <SelectTrigger><SelectValue placeholder={t('none', 'None')} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t('none', 'None')}</SelectItem>
                    {(budgets || []).map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>{t('project', 'Project')}</Label>
                <Select value={form.project_id} onValueChange={(v) => setForm({ ...form, project_id: v })}>
                  <SelectTrigger><SelectValue placeholder={t('none', 'None')} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t('none', 'None')}</SelectItem>
                    {(projects || []).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>{t('expenseVendor', 'Vendor')}</Label><Input value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} maxLength={160} /></div>
              <div><Label>{t('expenseReference', 'Reference')}</Label><Input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} maxLength={120} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{t('status', 'Status')}</Label>
                <Select value={form.payment_status} onValueChange={(v) => setForm({ ...form, payment_status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((s) => <SelectItem key={s} value={s} className="capitalize">{s.replace(/_/g, ' ')}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>{t('expenseTypeLabel', 'Type')}</Label>
                <Select value={form.expense_type} onValueChange={(v) => setForm({ ...form, expense_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fixed">{t('expenseFixed', 'Fixed')}</SelectItem>
                    <SelectItem value="flexible">{t('expenseFlexible', 'Flexible')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>{t('expenseDocument', 'Supporting document')}</Label>
              <Select value={form.document_id} onValueChange={(v) => setForm({ ...form, document_id: v })}>
                <SelectTrigger><SelectValue placeholder={t('none', 'None')} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t('none', 'None')}</SelectItem>
                  {documents.map((d) => <SelectItem key={d.id} value={d.id}>{d.file_name || d.id}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label>{t('notes', 'Notes')}</Label><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} maxLength={500} /></div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowForm(false)}>{t('cancel')}</Button>
              <Button type="submit" disabled={saving}>{saving ? (t('saving') || 'Saving...') : (t('save') || 'Save')}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!detail} onOpenChange={(open) => !open && setDetail(null)}>
        {detail && (
          <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="font-heading flex items-center gap-2">
                <Receipt className="w-4 h-4 text-muted-foreground" aria-hidden />
                <span className="truncate">{detail.title}</span>
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">{t('amount', 'Amount')}</span><span className="font-semibold">{formatMoney(detail.amount, detail.currency)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">{t('budgetRefunded', 'Refunded')}</span><span>{formatMoney(refundedTotal(detail, refunds), detail.currency)}</span></div>
              <div className="flex justify-between border-t border-border pt-2"><span className="text-muted-foreground">{t('budgetNet', 'Net amount')}</span><span className="font-bold">{formatMoney(netExpense(detail, refunds), detail.currency)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">{t('category', 'Category')}</span><span>{categoryName(detail.category_id)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">{t('project', 'Project')}</span><span>{(projects || []).find((p) => p.id === detail.project_id)?.name || ''}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">{t('expenseVendor', 'Vendor')}</span><span>{detail.vendor || ''}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">{t('status', 'Status')}</span><span className="capitalize">{String(detail.payment_status || '').replace(/_/g, ' ')}</span></div>
              {detail.expected_amount != null && (
                <div className="flex justify-between"><span className="text-muted-foreground">{t('expenseVariance', 'Variance')}</span><span>{formatMoney(variance(detail.expected_amount, detail.amount), detail.currency)}</span></div>
              )}
              {detail.notes && <p className="text-muted-foreground whitespace-pre-wrap pt-1">{detail.notes}</p>}
              {detailRefunds.length > 0 && (
                <div className="pt-1">
                  <p className="text-xs font-semibold uppercase text-muted-foreground mb-1">{t('refunds', 'Refunds')}</p>
                  {detailRefunds.map((r) => (
                    <p key={r.id} className="text-xs text-muted-foreground">{r.refund_date} · {formatMoney(r.amount, detail.currency)} · {r.reason || ''}</p>
                  ))}
                </div>
              )}
              {detail.expense_date && (
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <CalendarClock className="w-3.5 h-3.5" aria-hidden />{detail.expense_date}
                </p>
              )}
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" size="sm" onClick={() => openEdit(detail)}>{t('edit') || 'Edit'}</Button>
              {['approved', 'pending'].includes(detail.payment_status) && (
                <Button size="sm" onClick={() => { handleStatus(detail, 'paid'); setDetail({ ...detail, payment_status: 'paid' }); }}>
                  {t('markPaid') || 'Mark paid'}
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => setDetail(null)} aria-label={t('close') || 'Close'}>
                <X className="w-4 h-4" />
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
