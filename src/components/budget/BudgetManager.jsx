import React from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Pencil, Archive, RotateCcw, Trash2, FolderKanban } from 'lucide-react';
import { supabase } from '@/services/supabase';
import { useAuth } from '@/lib/AuthContext';
import { logAppError, getUserFriendlyMessage } from '@/lib/userErrors';
import { logAction } from '@/lib/activityTracking';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import DatePicker from '@/components/ui/DatePicker';
import EmptyState from '@/components/shared/EmptyState';
import { computeScopeTotals, formatMoney, DEFAULT_CURRENCY, CURRENCY_OPTIONS } from '@/lib/budgetMath';
import { toast } from 'sonner';

const STATUSES = ['draft', 'active', 'paused', 'closed', 'archived'];

function emptyBudget(parentId = null, parentCurrency = null) {
  return {
    name: '', description: '', total_amount: '', currency: parentCurrency || DEFAULT_CURRENCY,
    start_date: '', end_date: '', status: 'draft', project_id: 'none',
    alert_threshold: '', notes: '', parent_budget_id: parentId,
  };
}

export default function BudgetManager({ budgets, expenses, refunds, projects, onChanged, onAudit, onNotify }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [showForm, setShowForm] = React.useState(false);
  const [editing, setEditing] = React.useState(null);
  const [parentForNew, setParentForNew] = React.useState(null);
  const [form, setForm] = React.useState(emptyBudget());
  const [overrideChecked, setOverrideChecked] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  const globals = (budgets || []).filter((b) => !b.parent_budget_id);
  const childrenOf = (id) => (budgets || []).filter((b) => b.parent_budget_id === id);

  function totalsFor(budgetId) {
    const kids = childrenOf(budgetId);
    const allocated = kids.reduce((s, k) => s + (Number(k.total_amount) || 0), 0);
    const scoped = (expenses || []).filter((e) => e.budget_id === budgetId || kids.some((k) => k.id === e.budget_id));
    const b = (budgets || []).find((x) => x.id === budgetId);
    return { ...computeScopeTotals({ total: Number(b?.total_amount) || 0, allocated, expenses: scoped, refunds }), currency: b?.currency || DEFAULT_CURRENCY };
  }

  function siblingAllocated(parentId, excludeId) {
    return (budgets || [])
      .filter((b) => (b.parent_budget_id || null) === (parentId || null) && b.id !== excludeId && b.status !== 'archived' && b.status !== 'closed')
      .reduce((s, b) => s + (Number(b.total_amount) || 0), 0);
  }

  function openCreate(parentId) {
    setEditing(null);
    setParentForNew(parentId);
    const parent = (budgets || []).find((b) => b.id === parentId);
    // A sub-budget inherits its parent's currency so a EUR envelope never
    // silently holds another currency; globals default to EUR.
    setForm(emptyBudget(parentId, parent?.currency));
    setOverrideChecked(false);
    setShowForm(true);
  }

  function openEdit(budget) {
    setEditing(budget);
    setParentForNew(budget.parent_budget_id);
    setForm({
      name: budget.name || '',
      description: budget.description || '',
      total_amount: budget.total_amount ?? '',
          currency: budget.currency || DEFAULT_CURRENCY,
      start_date: budget.start_date || '',
      end_date: budget.end_date || '',
      status: budget.status || 'draft',
      project_id: budget.project_id || 'none',
      alert_threshold: budget.alert_threshold ?? '',
      notes: budget.notes || '',
      parent_budget_id: budget.parent_budget_id,
    });
    setOverrideChecked(false);
    setShowForm(true);
  }

  async function handleSave(e) {
    e.preventDefault();
    const amount = Number(form.total_amount);
    if (!form.name.trim() || !Number.isFinite(amount) || amount < 0) {
      toast.error(t('budgetInvalidAmount', 'Please enter a valid budget name and amount.'));
      return;
    }
    // Sub-budget allocation guard with explicit controlled override.
    if (form.parent_budget_id) {
      const parent = (budgets || []).find((b) => b.id === form.parent_budget_id);
      const parentTotal = Number(parent?.total_amount) || 0;
      const others = siblingAllocated(form.parent_budget_id, editing?.id);
      if (others + amount > parentTotal && !overrideChecked) {
        toast.error(
          t('budgetExceedsParent', 'Allocation exceeds the parent budget remaining amount. Check the override to proceed explicitly.')
        );
        return;
      }
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description?.trim() || null,
        total_amount: amount,
        currency: form.currency || DEFAULT_CURRENCY,
        start_date: form.start_date || null,
        end_date: form.end_date || null,
        status: form.status,
        project_id: form.project_id && form.project_id !== 'none' ? form.project_id : null,
        alert_threshold: form.alert_threshold === '' ? null : Number(form.alert_threshold),
        notes: form.notes?.trim() || null,
        parent_budget_id: form.parent_budget_id || null,
        updated_by: user?.id || null,
      };
      let savedId = editing?.id;
      if (editing) {
        const { error } = await supabase.from('budgets').update(payload).eq('id', editing.id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from('budgets')
          .insert({ ...payload, created_by: user?.id || null })
          .select('id')
          .single();
        if (error) throw error;
        savedId = data?.id;
      }
      await onAudit(editing ? 'BUDGET_UPDATED' : 'BUDGET_CREATED', editing ? 'Budget updated' : 'Budget created', {
        id: savedId, name: payload.name, override: overrideChecked || undefined,
      });
      // Threshold check on save: notify when already at/above the threshold.
      if (payload.alert_threshold != null && savedId) {
        const totals = totalsFor(savedId);
        if (totals.utilization >= Number(payload.alert_threshold)) {
          await onNotify(`Budget "${payload.name}" is at ${totals.utilization}% utilization.`);
        }
      }
      toast.success(t('save') || 'Save');
      logAction(editing ? 'BUDGET_UPDATED' : 'BUDGET_CREATED', {
        entityType: 'budget',
        entityId: savedId || null,
        metadata: { total: payload.total_amount, currency: payload.currency },
      });
      setShowForm(false);
      onChanged();
    } catch (err) {
      logAppError('Budget', err, { operation: 'save-budget' });
      toast.error(getUserFriendlyMessage(err, t, 'errors.saveBudget'));
    } finally {
      setSaving(false);
    }
  }

  async function handleStatus(budget, status) {
    try {
      const { error } = await supabase.from('budgets').update({ status, updated_by: user?.id || null }).eq('id', budget.id);
      if (error) throw error;
      const wasArchived = budget.status === 'archived';
      const action = status === 'archived' ? 'BUDGET_ARCHIVED' : wasArchived ? 'BUDGET_RESTORED' : 'BUDGET_UPDATED';
      await onAudit(action, `Budget ${status}`, { id: budget.id, name: budget.name });
      if (status === 'closed') {
        await onNotify(`Budget "${budget.name}" was closed.`);
      }
      onChanged();
    } catch (err) {
      logAppError('Budget', err, { operation: 'budget-status' });
      toast.error(getUserFriendlyMessage(err, t, 'errors.saveBudget'));
    }
  }

  async function handleDelete(budget) {
    const childCount = childrenOf(budget.id).length;
    const linkedExpenses = (expenses || []).filter((e) => e.budget_id === budget.id).length;
    if (childCount > 0 || linkedExpenses > 0) {
      toast.error(t('budgetDeleteBlocked', 'This budget has linked records. Archive it instead of deleting.'));
      return;
    }
    if (!window.confirm(t('budgetDeleteConfirm') || 'Delete this budget permanently?')) return;
    try {
      const { error } = await supabase.from('budgets').delete().eq('id', budget.id);
      if (error) throw error;
      await onAudit('BUDGET_DELETED', 'Budget deleted', { id: budget.id, name: budget.name });
      onChanged();
    } catch (err) {
      logAppError('Budget', err, { operation: 'delete-budget' });
      toast.error(getUserFriendlyMessage(err, t, 'errors.saveBudget'));
    }
  }

  function renderBudgetCard(budget, depth = 0) {
    const totals = totalsFor(budget.id);
    const projectName = (projects || []).find((p) => p.id === budget.project_id)?.name;
    return (
      <div key={budget.id} className={depth > 0 ? 'ml-4 sm:ml-8 border-l-2 border-border pl-3' : ''}>
        <div className="bg-card rounded-xl border border-border p-4 space-y-2">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-semibold truncate">{budget.name}</p>
              <p className="text-xs text-muted-foreground">
                {formatMoney(budget.total_amount, budget.currency)} · {budget.currency}
                {projectName ? ` · ${projectName}` : ''}
              </p>
            </div>
            <Badge variant="outline" className="text-xs capitalize">{budget.status}</Badge>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <div><p className="text-muted-foreground">{t('budgetAllocated', 'Allocated')}</p><p className="font-semibold">{formatMoney(totals.allocated, totals.currency)}</p></div>
            <div><p className="text-muted-foreground">{t('budgetSpent', 'Spent')}</p><p className="font-semibold">{formatMoney(totals.spent, totals.currency)}</p></div>
            <div><p className="text-muted-foreground">{t('budgetRemaining', 'Remaining')}</p><p className="font-semibold">{formatMoney(totals.remaining, totals.currency)}</p></div>
            <div><p className="text-muted-foreground">{t('budgetUtilization', 'Utilization')}</p><p className="font-semibold">{totals.utilization}%</p></div>
          </div>
          <div className="flex flex-wrap gap-1.5 pt-1">
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs gap-1" onClick={() => openEdit(budget)}>
              <Pencil className="w-3 h-3" /> {t('edit') || 'Edit'}
            </Button>
            {!budget.parent_budget_id && (
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs gap-1" onClick={() => openCreate(budget.id)}>
                <Plus className="w-3 h-3" /> {t('budgetAddSub', 'Add sub-budget')}
              </Button>
            )}
            {budget.status !== 'archived' ? (
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs gap-1" onClick={() => handleStatus(budget, 'archived')}>
                <Archive className="w-3 h-3" /> {t('archive') || 'Archive'}
              </Button>
            ) : (
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs gap-1" onClick={() => handleStatus(budget, 'active')}>
                <RotateCcw className="w-3 h-3" /> {t('restore') || 'Restore'}
              </Button>
            )}
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs gap-1 text-destructive hover:text-destructive" onClick={() => handleDelete(budget)}>
              <Trash2 className="w-3 h-3" /> {t('delete') || 'Delete'}
            </Button>
          </div>
        </div>
        <div className="mt-2 space-y-2">
          {childrenOf(budget.id).map((child) => renderBudgetCard(child, depth + 1))}
        </div>
      </div>
    );
  }

  const exceedsParent = (() => {
    if (!form.parent_budget_id) return false;
    const parent = (budgets || []).find((b) => b.id === form.parent_budget_id);
    const amount = Number(form.total_amount);
    if (!Number.isFinite(amount)) return false;
    return siblingAllocated(form.parent_budget_id, editing?.id) + amount > (Number(parent?.total_amount) || 0);
  })();

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => openCreate(null)} className="gap-2" size="sm">
          <Plus className="w-4 h-4" /> {t('budgetNew', 'New budget')}
        </Button>
      </div>
      {globals.length === 0 ? (
        <EmptyState icon={FolderKanban} title={t('budgetEmpty', 'No budgets yet')} description={t('budgetEmptyHint', 'Create a global budget to start tracking.')} />
      ) : (
        <div className="space-y-3">
          {globals.map((g) => renderBudgetCard(g))}
        </div>
      )}

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-heading">
              {editing ? (t('budgetEdit', 'Edit budget')) : form.parent_budget_id ? (t('budgetNewSub', 'New sub-budget')) : (t('budgetNew', 'New budget'))}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-3">
            <div><Label>{t('budgetName', 'Name')} *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required maxLength={120} /></div>
            <div><Label>{t('description', 'Description')}</Label><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} maxLength={500} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{t('budgetAmount', 'Total amount')} *</Label>
                <Input type="number" min="0" step="0.01" value={form.total_amount} onChange={(e) => setForm({ ...form, total_amount: e.target.value })} required />
              </div>
              <div>
                <Label>{t('budgetCurrency', 'Currency')}</Label>
                <Select value={form.currency} onValueChange={(v) => setForm({ ...form, currency: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CURRENCY_OPTIONS.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>{t('startDate', 'Start date')}</Label><DatePicker value={form.start_date} onChange={(v) => setForm({ ...form, start_date: v })} /></div>
              <div><Label>{t('endDate', 'End date')}</Label><DatePicker value={form.end_date} onChange={(v) => setForm({ ...form, end_date: v })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{t('status', 'Status')}</Label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((s) => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>{t('budgetAlertThreshold', 'Alert at %')}</Label>
                <Input type="number" min="0" max="100" step="1" value={form.alert_threshold} onChange={(e) => setForm({ ...form, alert_threshold: e.target.value })} placeholder="80" />
              </div>
            </div>
            <div>
              <Label>{t('project', 'Project')} ({t('optional', 'optional')})</Label>
              <Select value={form.project_id} onValueChange={(v) => setForm({ ...form, project_id: v })}>
                <SelectTrigger><SelectValue placeholder={t('none', 'None')} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t('none', 'None')}</SelectItem>
                  {(projects || []).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label>{t('notes', 'Notes')}</Label><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} maxLength={500} /></div>
            {exceedsParent && (
              <label className="flex items-start gap-2 text-xs rounded-md border border-warning/40 bg-warning/10 p-2 cursor-pointer">
                <input type="checkbox" checked={overrideChecked} onChange={(e) => setOverrideChecked(e.target.checked)} className="mt-0.5" />
                <span>{t('budgetOverride', 'Allocation exceeds the parent budget. Check to explicitly override (logged in audit).')}</span>
              </label>
            )}
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
