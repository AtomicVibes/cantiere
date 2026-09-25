import React from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Pencil, Power, BellRing } from 'lucide-react';
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

const SCOPES = ['global', 'sub_budget', 'category', 'project'];
const METRICS = ['utilization', 'spent', 'remaining'];
const OPERATORS = ['gte', 'lte'];
const PERIODS = ['once', 'monthly', 'quarterly', 'yearly'];
const ACTIONS = ['notify', 'require_approval'];

function emptyRule() {
  return {
    name: '', scope_type: 'global', scope_id: 'none', metric: 'utilization',
    operator: 'gte', threshold: '80', period: 'once', action: 'notify',
    effective_from: '', effective_to: '', notes: '',
  };
}

export default function RulesManager({ rules, budgets, categories, projects, expenses, refunds, onChanged, onAudit }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [showForm, setShowForm] = React.useState(false);
  const [editing, setEditing] = React.useState(null);
  const [form, setForm] = React.useState(emptyRule());
  const [saving, setSaving] = React.useState(false);

  function scopeOptions() {
    if (form.scope_type === 'sub_budget' || form.scope_type === 'global') return budgets || [];
    if (form.scope_type === 'category') return categories || [];
    if (form.scope_type === 'project') return projects || [];
    return [];
  }

  function openCreate() {
    setEditing(null);
    setForm(emptyRule());
    setShowForm(true);
  }

  function openEdit(rule) {
    setEditing(rule);
    setForm({
      name: rule.name || '',
      scope_type: rule.scope_type || 'global',
      scope_id: rule.scope_id || 'none',
      metric: rule.metric || 'utilization',
      operator: rule.operator || 'gte',
      threshold: rule.threshold ?? '80',
      period: rule.period || 'once',
      action: rule.action || 'notify',
      effective_from: rule.effective_from || '',
      effective_to: rule.effective_to || '',
      notes: rule.notes || '',
    });
    setShowForm(true);
  }

  async function handleSave(e) {
    e.preventDefault();
    const threshold = Number(form.threshold);
    if (!form.name.trim() || !Number.isFinite(threshold)) {
      toast.error(t('ruleInvalid', 'Please enter a valid rule name and threshold.'));
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        scope_type: form.scope_type,
        scope_id: form.scope_id !== 'none' ? form.scope_id : null,
        metric: form.metric,
        operator: form.operator,
        threshold,
        period: form.period,
        action: form.action,
        effective_from: form.effective_from || null,
        effective_to: form.effective_to || null,
        notes: form.notes?.trim() || null,
      };
      if (editing) {
        const { error } = await supabase.from('budget_rules').update(payload).eq('id', editing.id);
        if (error) throw error;
        await onAudit('BUDGET_RULE_UPDATED', 'Budget rule updated', { id: editing.id, name: payload.name });
      } else {
        const { error } = await supabase.from('budget_rules').insert({ ...payload, created_by: user?.id || null });
        if (error) throw error;
        await onAudit('BUDGET_RULE_CREATED', 'Budget rule created', { name: payload.name });
      }
      toast.success(t('save') || 'Save');
      setShowForm(false);
      onChanged();
    } catch (err) {
      logAppError('Budget', err, { operation: 'save-rule' });
      toast.error(getUserFriendlyMessage(err, t, 'errors.saveRule'));
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(rule) {
    try {
      const { error } = await supabase.from('budget_rules').update({ enabled: !rule.enabled }).eq('id', rule.id);
      if (error) throw error;
      await onAudit(rule.enabled ? 'BUDGET_RULE_DISABLED' : 'BUDGET_RULE_UPDATED', `Budget rule ${rule.enabled ? 'disabled' : 'enabled'}`, { id: rule.id });
      onChanged();
    } catch (err) {
      logAppError('Budget', err, { operation: 'toggle-rule' });
      toast.error(getUserFriendlyMessage(err, t, 'errors.saveRule'));
    }
  }

  function scopeLabel(rule) {
    if (!rule.scope_id) return t('ruleScopeGlobal', 'Entire application');
    const pool =
      rule.scope_type === 'category'
        ? categories
        : rule.scope_type === 'project'
          ? projects
          : budgets;
    return (pool || []).find((x) => x.id === rule.scope_id)?.name || rule.scope_id;
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" className="gap-2" onClick={openCreate}>
          <Plus className="w-4 h-4" /> {t('ruleNew', 'New rule')}
        </Button>
      </div>
      {(rules || []).length === 0 ? (
        <EmptyState icon={BellRing} title={t('ruleEmpty', 'No budget rules')} description={t('ruleEmptyHint', 'Define thresholds that notify super admins.')} />
      ) : (
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <ul className="divide-y divide-border">
            {(rules || []).map((rule) => (
              <li key={rule.id} className="flex flex-col sm:flex-row sm:items-center gap-2 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium truncate">{rule.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {rule.scope_type} · {scopeLabel(rule)} · {rule.metric} {rule.operator === 'gte' ? '≥' : '≤'} {rule.action === 'notify' ? formatMoney(rule.threshold) : rule.threshold}
                    {rule.last_triggered_at ? ` · ${t('ruleLastFired', 'last fired')}: ${new Date(rule.last_triggered_at).toLocaleDateString()}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Badge variant={rule.enabled ? 'secondary' : 'outline'} className="text-[10px]">
                    {rule.enabled ? (t('enabled', 'Enabled')) : (t('disabled', 'Disabled'))}
                  </Badge>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleToggle(rule)} aria-label={rule.enabled ? (t('disable') || 'Disable') : (t('enable') || 'Enable')}>
                    <Power className="w-3.5 h-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(rule)} aria-label={`${t('edit') || 'Edit'}: ${rule.name}`}>
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-heading">{editing ? (t('ruleEdit', 'Edit rule')) : (t('ruleNew', 'New rule'))}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-3">
            <div><Label>{t('ruleName', 'Rule name')} *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required maxLength={160} placeholder="Operations reaches 80%" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{t('ruleScope', 'Applies to')}</Label>
                <Select value={form.scope_type} onValueChange={(v) => setForm({ ...form, scope_type: v, scope_id: 'none' })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SCOPES.map((s) => <SelectItem key={s} value={s} className="capitalize">{s.replace(/_/g, ' ')}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>{t('ruleTarget', 'Target')}</Label>
                <Select value={form.scope_id} onValueChange={(v) => setForm({ ...form, scope_id: v })}>
                  <SelectTrigger><SelectValue placeholder={t('ruleScopeGlobal', 'Entire application')} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t('ruleScopeGlobal', 'Entire application')}</SelectItem>
                    {scopeOptions().map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label>{t('ruleMetric', 'Metric')}</Label>
                <Select value={form.metric} onValueChange={(v) => setForm({ ...form, metric: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {METRICS.map((m) => <SelectItem key={m} value={m} className="capitalize">{m}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>{t('ruleOperator', 'Condition')}</Label>
                <Select value={form.operator} onValueChange={(v) => setForm({ ...form, operator: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {OPERATORS.map((o) => <SelectItem key={o} value={o}>{o === 'gte' ? '≥' : '≤'}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>{t('ruleThreshold', 'Threshold')} *</Label>
                <Input type="number" step="0.01" value={form.threshold} onChange={(e) => setForm({ ...form, threshold: e.target.value })} required />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{t('rulePeriod', 'Re-fire')}</Label>
                <Select value={form.period} onValueChange={(v) => setForm({ ...form, period: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PERIODS.map((p) => <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>{t('ruleAction', 'Action')}</Label>
                <Select value={form.action} onValueChange={(v) => setForm({ ...form, action: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ACTIONS.map((a) => <SelectItem key={a} value={a} className="capitalize">{a.replace(/_/g, ' ')}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>{t('ruleEffectiveFrom', 'Effective from')}</Label><DatePicker value={form.effective_from} onChange={(v) => setForm({ ...form, effective_from: v })} allowClear /></div>
              <div><Label>{t('ruleEffectiveTo', 'Effective to')}</Label><DatePicker value={form.effective_to} onChange={(v) => setForm({ ...form, effective_to: v })} allowClear /></div>
            </div>
            <div><Label>{t('notes', 'Notes')}</Label><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} maxLength={300} /></div>
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
