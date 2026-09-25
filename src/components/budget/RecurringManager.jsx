import React from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Pencil, Power, Loader2 } from 'lucide-react';
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
import DatePicker from '@/components/ui/DatePicker';
import EmptyState from '@/components/shared/EmptyState';
import { Repeat } from 'lucide-react';
import { formatMoney, toDateOnlyString, DEFAULT_CURRENCY, CURRENCY_OPTIONS } from '@/lib/budgetMath';
import { toast } from 'sonner';

const FREQUENCIES = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'];

function emptyRecurring() {
  return {
    title: '', amount: '', currency: DEFAULT_CURRENCY, category_id: 'none', budget_id: 'none',
    project_id: 'none', vendor: '', frequency: 'monthly', start_date: toDateOnlyString(new Date()),
    end_date: '', notes: '',
  };
}

export default function RecurringManager({ recurring, categories, budgets, projects, onChanged, onAudit }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [showForm, setShowForm] = React.useState(false);
  const [editing, setEditing] = React.useState(null);
  const [form, setForm] = React.useState(emptyRecurring());
  const [saving, setSaving] = React.useState(false);

  function openCreate() {
    setEditing(null);
    setForm(emptyRecurring());
    setShowForm(true);
  }

  function openEdit(rec) {
    setEditing(rec);
    setForm({
      title: rec.title || '',
      amount: rec.amount ?? '',
      currency: rec.currency || DEFAULT_CURRENCY,
      category_id: rec.category_id || 'none',
      budget_id: rec.budget_id || 'none',
      project_id: rec.project_id || 'none',
      vendor: rec.vendor || '',
      frequency: rec.frequency || 'monthly',
      start_date: rec.start_date || toDateOnlyString(new Date()),
      end_date: rec.end_date || '',
      notes: rec.notes || '',
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
    setSaving(true);
    try {
      const firstRun = form.start_date || toDateOnlyString(new Date());
      const payload = {
        title: form.title.trim(),
        amount,
        currency: form.currency || DEFAULT_CURRENCY,
        category_id: form.category_id !== 'none' ? form.category_id : null,
        budget_id: form.budget_id !== 'none' ? form.budget_id : null,
        project_id: form.project_id !== 'none' ? form.project_id : null,
        vendor: form.vendor?.trim() || null,
        frequency: form.frequency,
        start_date: firstRun,
        end_date: form.end_date || null,
        next_run_date: editing ? undefined : firstRun,
        notes: form.notes?.trim() || null,
      };
      if (payload.next_run_date === undefined) delete payload.next_run_date;
      if (editing) {
        const { error } = await supabase.from('budget_recurring').update(payload).eq('id', editing.id);
        if (error) throw error;
        await onAudit('RECURRING_UPDATED', 'Recurring expense updated', { id: editing.id });
      } else {
        const { error } = await supabase.from('budget_recurring').insert({ ...payload, created_by: user?.id || null });
        if (error) throw error;
        await onAudit('RECURRING_CREATED', 'Recurring expense created', { title: payload.title });
      }
      toast.success(t('save') || 'Save');
      setShowForm(false);
      onChanged();
    } catch (err) {
      logAppError('Budget', err, { operation: 'save-recurring' });
      toast.error(getUserFriendlyMessage(err, t, 'errors.saveRecurring'));
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(rec) {
    try {
      const { error } = await supabase.from('budget_recurring').update({ active: !rec.active }).eq('id', rec.id);
      if (error) throw error;
      await onAudit(rec.active ? 'RECURRING_DISABLED' : 'RECURRING_ENABLED', `Recurring expense ${rec.active ? 'disabled' : 'enabled'}`, { id: rec.id });
      onChanged();
    } catch (err) {
      logAppError('Budget', err, { operation: 'toggle-recurring' });
      toast.error(getUserFriendlyMessage(err, t, 'errors.saveRecurring'));
    }
  }

  const categoryName = (id) => (categories || []).find((c) => c.id === id)?.name || '';

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" className="gap-2" onClick={openCreate}>
          <Plus className="w-4 h-4" /> {t('recurringNew', 'New recurring expense')}
        </Button>
      </div>
      {(recurring || []).length === 0 ? (
        <EmptyState icon={Repeat} title={t('recurringEmpty', 'No recurring expenses')} description={t('recurringEmptyHint', 'Define expenses that repeat on a schedule.')} />
      ) : (
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <ul className="divide-y divide-border">
            {(recurring || []).map((rec) => {
              return (
                <li key={rec.id} className="flex flex-col sm:flex-row sm:items-center gap-2 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate">{rec.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatMoney(rec.amount, rec.currency)} · <span className="capitalize">{rec.frequency}</span>
                      {categoryName(rec.category_id) ? ` · ${categoryName(rec.category_id)}` : ''}
                      {rec.next_run_date ? ` · ${t('recurringNext', 'next')}: ${rec.next_run_date}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Badge variant={rec.active ? 'secondary' : 'outline'} className="text-[10px]">
                      {rec.active ? (t('active', 'Active')) : (t('inactive', 'Inactive'))}
                    </Badge>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleToggle(rec)} aria-label={rec.active ? (t('disable') || 'Disable') : (t('enable') || 'Enable')}>
                      <Power className="w-3.5 h-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(rec)} aria-label={`${t('edit') || 'Edit'}: ${rec.title}`}>
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-heading">{editing ? (t('recurringEdit', 'Edit recurring expense')) : (t('recurringNew', 'New recurring expense'))}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-3">
            <div><Label>{t('expenseTitle', 'Title')} *</Label><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required maxLength={160} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{t('amount', 'Amount')} *</Label>
                <Input type="number" min="0" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
              </div>
              <div>
                <Label>{t('budgetCurrency', 'Currency')}</Label>
                <Select value={form.currency} onValueChange={(v) => setForm({ ...form, currency: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{CURRENCY_OPTIONS.map((c) => <SelectItem key={c} value={c}>{c.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{t('recurringFrequency', 'Recurrence')}</Label>
                <Select value={form.frequency} onValueChange={(v) => setForm({ ...form, frequency: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FREQUENCIES.map((f) => <SelectItem key={f} value={f} className="capitalize">{f}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>{t('expenseVendor', 'Vendor')}</Label><Input value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} maxLength={160} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>{t('startDate', 'Start date')}</Label><DatePicker value={form.start_date} onChange={(v) => setForm({ ...form, start_date: v })} /></div>
              <div><Label>{t('endDate', 'End date')}</Label><DatePicker value={form.end_date} onChange={(v) => setForm({ ...form, end_date: v })} allowClear /></div>
            </div>
            <div>
              <Label>{t('budget', 'Budget')}</Label>
              <Select value={form.budget_id} onValueChange={(v) => {
                const budget = (budgets || []).find((b) => b.id === v);
                setForm((f) => ({
                  ...f,
                  budget_id: v,
                  currency: budget?.currency || f.currency || DEFAULT_CURRENCY,
                }));
              }}>
                <SelectTrigger><SelectValue placeholder={t('none', 'None')} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t('none', 'None')}</SelectItem>
                  {(budgets || []).map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{t('category', 'Category')}</Label>
                <Select value={form.category_id} onValueChange={(v) => setForm({ ...form, category_id: v })}>
                  <SelectTrigger><SelectValue placeholder={t('none', 'None')} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t('none', 'None')}</SelectItem>
                    {(categories || []).filter((c) => !c.parent_category_id).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
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
            <div><Label>{t('notes', 'Notes')}</Label><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} maxLength={500} /></div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowForm(false)}>{t('cancel')}</Button>
              <Button type="submit" disabled={saving}>{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : (t('save') || 'Save')}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
