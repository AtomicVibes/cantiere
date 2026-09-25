import React from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Undo2 } from 'lucide-react';
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
import { formatMoney } from '@/lib/budgetMath';
import { toast } from 'sonner';

function emptyRefund() {
  return {
    expense_id: 'none', amount: '', refund_date: new Date().toISOString().slice(0, 10),
    reason: '', source: '', project_id: 'none', category_id: 'none', notes: '', status: 'paid',
  };
}

export default function RefundManager({ refunds, expenses, projects, categories, onChanged, onAudit, onNotify }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [showForm, setShowForm] = React.useState(false);
  const [form, setForm] = React.useState(emptyRefund());
  const [saving, setSaving] = React.useState(false);

  const expenseById = React.useCallback(
    (id) => (expenses || []).find((e) => e.id === id),
    [expenses]
  );

  async function handleSave(e) {
    e.preventDefault();
    const amount = Number(form.amount);
    if (form.expense_id === 'none' || !Number.isFinite(amount) || amount <= 0) {
      toast.error(t('refundInvalid', 'Please select an expense and enter a positive amount.'));
      return;
    }
    const expense = expenseById(form.expense_id);
    const alreadyRefunded = (refunds || [])
      .filter((r) => r.expense_id === form.expense_id && r.status !== 'cancelled')
      .reduce((s, r) => s + (Number(r.amount) || 0), 0);
    if (alreadyRefunded + amount > (Number(expense?.amount) || 0) + 1e-9) {
      toast.error(t('refundExceeds', 'Refund exceeds the remaining expense amount.'));
      return;
    }
    setSaving(true);
    try {
      const { data, error } = await supabase
        .from('budget_refunds')
        .insert({
          expense_id: form.expense_id,
          amount,
          refund_date: form.refund_date || new Date().toISOString().slice(0, 10),
          reason: form.reason?.trim() || null,
          source: form.source?.trim() || null,
          project_id: form.project_id !== 'none' ? form.project_id : (expense?.project_id || null),
          category_id: form.category_id !== 'none' ? form.category_id : (expense?.category_id || null),
          notes: form.notes?.trim() || null,
          status: form.status,
          created_by: user?.id || null,
        })
        .select('id')
        .single();
      if (error) throw error;
      const fullyRefunded = alreadyRefunded + amount >= (Number(expense?.amount) || 0) - 1e-9;
      await supabase
        .from('budget_expenses')
        .update({ payment_status: fullyRefunded ? 'refunded' : 'partially_refunded' })
        .eq('id', form.expense_id);
      await onAudit('REFUND_CREATED', 'Refund recorded', { id: data?.id, expense_id: form.expense_id, amount });
      await onNotify(`Refund recorded: ${formatMoney(amount)} for "${expense?.title || 'expense'}".`);
      toast.success(t('save') || 'Save');
      setShowForm(false);
      setForm(emptyRefund());
      onChanged();
    } catch (err) {
      logAppError('Budget', err, { operation: 'save-refund' });
      toast.error(getUserFriendlyMessage(err, t, 'errors.saveRefund'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" className="gap-2" onClick={() => { setForm(emptyRefund()); setShowForm(true); }}>
          <Plus className="w-4 h-4" /> {t('refundNew', 'New refund')}
        </Button>
      </div>
      {(refunds || []).length === 0 ? (
        <EmptyState icon={Undo2} title={t('refundEmpty', 'No refunds yet')} description={t('refundEmptyHint', 'Record refunds against expenses without altering the originals.')} />
      ) : (
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <ul className="divide-y divide-border">
            {(refunds || []).map((r) => {
              const expense = expenseById(r.expense_id);
              return (
                <li key={r.id} className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate">{expense?.title || r.expense_id}</p>
                    <p className="text-xs text-muted-foreground">
                      {r.refund_date} · {r.reason || ''} {r.source ? `· ${r.source}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant="secondary" className="text-[10px]">{formatMoney(r.amount)}</Badge>
                    <Badge variant="outline" className="text-[10px] capitalize">{r.status}</Badge>
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
            <DialogTitle className="font-heading">{t('refundNew', 'New refund')}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-3">
            <div>
              <Label>{t('refundExpense', 'Original expense')} *</Label>
              <Select value={form.expense_id} onValueChange={(v) => setForm({ ...form, expense_id: v })}>
                <SelectTrigger><SelectValue placeholder={t('select', 'Select')} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t('select', 'Select')}</SelectItem>
                  {(expenses || []).filter((e) => !e.archived && e.payment_status !== 'cancelled').map((e) => (
                    <SelectItem key={e.id} value={e.id}>{e.title} · {formatMoney(e.amount, e.currency)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{t('amount', 'Amount')} *</Label>
                <Input type="number" min="0.01" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
              </div>
              <div><Label>{t('date') || 'Date'}</Label><DatePicker value={form.refund_date} onChange={(v) => setForm({ ...form, refund_date: v })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>{t('refundReason', 'Reason')}</Label><Input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} maxLength={200} /></div>
              <div><Label>{t('refundSource', 'Source')}</Label><Input value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} maxLength={160} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
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
              <div>
                <Label>{t('category', 'Category')}</Label>
                <Select value={form.category_id} onValueChange={(v) => setForm({ ...form, category_id: v })}>
                  <SelectTrigger><SelectValue placeholder={t('none', 'None')} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t('none', 'None')}</SelectItem>
                    {(categories || []).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div><Label>{t('notes', 'Notes')}</Label><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} maxLength={500} /></div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowForm(false)}>{t('cancel')}</Button>
              <Button type="submit" disabled={saving}>{saving ? (t('saving') || 'Saving...') : (t('save') || 'Save')}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
