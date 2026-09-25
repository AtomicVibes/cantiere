import React from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Wallet } from 'lucide-react';
import { supabase } from '@/services/supabase';
import { useAuth } from '@/lib/AuthContext';
import { logAppError } from '@/lib/userErrors';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import BudgetOverview from '@/components/budget/BudgetOverview';
import BudgetManager from '@/components/budget/BudgetManager';
import ExpenseManager from '@/components/budget/ExpenseManager';
import RecurringManager from '@/components/budget/RecurringManager';
import CategoryManager from '@/components/budget/CategoryManager';
import RulesManager from '@/components/budget/RulesManager';
import RefundManager from '@/components/budget/RefundManager';
import ReportsPanel from '@/components/budget/ReportsPanel';
import { dueRecurrenceRuns, recurrenceKey, addFrequency, toDateOnlyString, evaluateBudgetRule, ruleMayRefire, computeScopeTotals } from '@/lib/budgetMath';

// Budget Management sub-window (super_admin). Central data layer: all
// budget tables are loaded here once and shared with the tab panels.
// Recurring generation + rule evaluation run here so every tab benefits.
export default function BudgetSection() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [tab, setTab] = React.useState('overview');

  const budgetsQuery = useQuery({
    queryKey: ['budgets'],
    queryFn: async () => {
      const { data, error } = await supabase.from('budgets').select('*').order('name');
      if (error) throw error;
      return data ?? [];
    },
  });
  const categoriesQuery = useQuery({
    queryKey: ['budget-categories'],
    queryFn: async () => {
      const { data, error } = await supabase.from('budget_categories').select('*').order('sort_order').order('name');
      if (error) throw error;
      return data ?? [];
    },
  });
  const expensesQuery = useQuery({
    queryKey: ['budget-expenses'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('budget_expenses')
        .select('*')
        .order('expense_date', { ascending: false })
        .limit(1000);
      if (error) throw error;
      return data ?? [];
    },
  });
  const recurringQuery = useQuery({
    queryKey: ['budget-recurring'],
    queryFn: async () => {
      const { data, error } = await supabase.from('budget_recurring').select('*').order('next_run_date');
      if (error) throw error;
      return data ?? [];
    },
  });
  const refundsQuery = useQuery({
    queryKey: ['budget-refunds'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('budget_refunds')
        .select('*')
        .order('refund_date', { ascending: false })
        .limit(1000);
      if (error) throw error;
      return data ?? [];
    },
  });
  const rulesQuery = useQuery({
    queryKey: ['budget-rules'],
    queryFn: async () => {
      const { data, error } = await supabase.from('budget_rules').select('*').order('name');
      if (error) throw error;
      return data ?? [];
    },
  });
  const projectsQuery = useQuery({
    queryKey: ['budget-projects'],
    queryFn: async () => {
      const { data, error } = await supabase.from('projects').select('id, name').order('name');
      if (error) throw error;
      return data ?? [];
    },
  });

  const budgets = budgetsQuery.data ?? [];
  const categories = categoriesQuery.data ?? [];
  const expenses = expensesQuery.data ?? [];
  const recurring = recurringQuery.data ?? [];
  const refunds = refundsQuery.data ?? [];
  const rules = rulesQuery.data ?? [];
  const projects = projectsQuery.data ?? [];

  const invalidateAll = () => {
    for (const key of [['budgets'], ['budget-categories'], ['budget-expenses'], ['budget-recurring'], ['budget-refunds'], ['budget-rules']]) {
      queryClient.invalidateQueries({ queryKey: key });
    }
  };

  async function writeBudgetAudit(action, message, details) {
    try {
      await supabase.rpc('write_audit_log', {
        p_action_type: action,
        p_message: message,
        p_entity_type: 'budget',
        p_entity_id: details?.id || null,
        p_project_id: details?.project_id || null,
        p_details: details || {},
      });
    } catch (err) {
      logAppError('Budget', err, { operation: 'audit', action });
    }
  }

  async function notifyBudgetAlert(message) {
    // Central notification pipeline (in-app + push automatic via trigger).
    // Recipients: super admins; isolated so alerts never break the action.
    try {
      let ids = [];
      try {
        const { data } = await supabase.from('profiles').select('id').eq('role', 'super_admin').limit(50);
        ids = (data ?? []).map((p) => p.id);
      } catch {
        ids = [];
      }
      if (ids.length === 0 && user?.id) ids = [user.id];
      if (ids.length === 0) return;
      await supabase.from('notifications').insert(
        ids.map((uid) => ({
          user_id: uid,
          type: 'general',
          message,
          url: '/finance',
          is_read: false,
        }))
      );
    } catch (err) {
      logAppError('Budget', err, { operation: 'notify-alert' });
    }
  }

  // Idempotent recurring generation: unique recurrence_key per definition+date
  // means concurrent runs can never double-create.
  const runnerRan = React.useRef(false);
  React.useEffect(() => {
    if (runnerRan.current || recurringQuery.isLoading || !user?.id) return;
    runnerRan.current = true;
    (async () => {
      try {
        const today = new Date();
        for (const rec of recurring || []) {
          if (!rec?.active) continue;
          const runs = dueRecurrenceRuns(rec, today);
          if (runs.length === 0) continue;
          for (const due of runs) {
            const key = recurrenceKey(rec.id, due);
            const { error } = await supabase.from('budget_expenses').insert({
              title: rec.title,
              amount: rec.amount,
              currency: rec.currency || 'TND',
              expense_date: due,
              category_id: rec.category_id,
              budget_id: rec.budget_id,
              project_id: rec.project_id,
              vendor: rec.vendor,
              payment_status: 'pending',
              expense_type: 'flexible',
              expense_kind: 'recurring',
              recurring_id: rec.id,
              recurrence_key: key,
              notes: `Generated from recurring definition (${rec.frequency}).`,
              created_by: user.id,
            });
            if (error && String(error.code) !== '23505' && !String(error.message || '').toLowerCase().includes('duplicate')) {
              throw error;
            }
          }
          const lastDue = runs[runs.length - 1];
          const advanced = addFrequency(new Date(lastDue), rec.frequency);
          await supabase
            .from('budget_recurring')
            .update({
              next_run_date: advanced ? toDateOnlyString(advanced) : rec.next_run_date,
              last_generated_at: new Date().toISOString(),
            })
            .eq('id', rec.id);
        }
        queryClient.invalidateQueries({ queryKey: ['budget-expenses'] });
        queryClient.invalidateQueries({ queryKey: ['budget-recurring'] });
      } catch (err) {
        logAppError('Budget', err, { operation: 'recurring-runner' });
      }
    })();
  }, [recurringQuery.isLoading, user?.id]);

  // Structured rule evaluation after data loads: compute each enabled rule's
  // scope totals, fire once per period via the central notification pipeline.
  const rulesRan = React.useRef(false);
  React.useEffect(() => {
    if (rulesRan.current || rulesQuery.isLoading || expensesQuery.isLoading || budgetsQuery.isLoading) return;
    rulesRan.current = true;
    (async () => {
      try {
        for (const rule of rules || []) {
          if (!rule?.enabled) continue;
          const totals = scopeTotalsForRule(rule, { budgets, expenses, refunds });
          const result = evaluateBudgetRule(rule, totals);
          if (!result.triggered) continue;
          if (!ruleMayRefire(rule)) continue;
          await notifyBudgetAlert(`Budget rule "${rule.name}" triggered (${result.value}).`);
          await supabase
            .from('budget_rules')
            .update({ last_triggered_at: new Date().toISOString(), last_value: result.value })
            .eq('id', rule.id);
        }
        queryClient.invalidateQueries({ queryKey: ['budget-rules'] });
      } catch (err) {
        logAppError('Budget', err, { operation: 'rule-evaluation' });
      }
    })();
  }, [rulesQuery.isLoading, expensesQuery.isLoading, budgetsQuery.isLoading]);

  const loading = budgetsQuery.isLoading || categoriesQuery.isLoading || expensesQuery.isLoading;
  const loadError = budgetsQuery.error || categoriesQuery.error || expensesQuery.error;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Wallet className="w-5 h-5 text-primary" aria-hidden />
        <h2 className="text-lg font-heading font-bold">{t('budgetManagement', 'Budget Management')}</h2>
      </div>
      {loadError ? (
        <div className="border border-destructive/30 bg-destructive/5 rounded-xl p-6 text-center text-sm">
          {t('budgetLoadError', "We couldn't load budget data. Please try again.")}
        </div>
      ) : (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList aria-label={t('budgetManagement', 'Budget Management')} className="flex-wrap h-auto">
            <TabsTrigger value="overview">{t('budgetOverview', 'Overview')}</TabsTrigger>
            <TabsTrigger value="budgets">{t('budgets', 'Budgets')}</TabsTrigger>
            <TabsTrigger value="expenses">{t('expenses', 'Expenses')}</TabsTrigger>
            <TabsTrigger value="recurring">{t('recurring', 'Recurring')}</TabsTrigger>
            <TabsTrigger value="categories">{t('categories', 'Categories')}</TabsTrigger>
            <TabsTrigger value="rules">{t('budgetRules', 'Rules')}</TabsTrigger>
            <TabsTrigger value="refunds">{t('refunds', 'Refunds')}</TabsTrigger>
            <TabsTrigger value="reports">{t('reports', 'Reports')}</TabsTrigger>
          </TabsList>
          <TabsContent value="overview">
            <BudgetOverview budgets={budgets} expenses={expenses} refunds={refunds} categories={categories} projects={projects} loading={loading} />
          </TabsContent>
          <TabsContent value="budgets">
            <BudgetManager budgets={budgets} expenses={expenses} refunds={refunds} projects={projects} onChanged={invalidateAll} onAudit={writeBudgetAudit} onNotify={notifyBudgetAlert} />
          </TabsContent>
          <TabsContent value="expenses">
            <ExpenseManager expenses={expenses} refunds={refunds} categories={categories} budgets={budgets} projects={projects} onChanged={invalidateAll} onAudit={writeBudgetAudit} onNotify={notifyBudgetAlert} />
          </TabsContent>
          <TabsContent value="recurring">
            <RecurringManager recurring={recurring} categories={categories} budgets={budgets} projects={projects} onChanged={invalidateAll} onAudit={writeBudgetAudit} />
          </TabsContent>
          <TabsContent value="categories">
            <CategoryManager categories={categories} onChanged={invalidateAll} onAudit={writeBudgetAudit} />
          </TabsContent>
          <TabsContent value="rules">
            <RulesManager rules={rules} budgets={budgets} categories={categories} projects={projects} expenses={expenses} refunds={refunds} onChanged={invalidateAll} onAudit={writeBudgetAudit} />
          </TabsContent>
          <TabsContent value="refunds">
            <RefundManager refunds={refunds} expenses={expenses} projects={projects} categories={categories} onChanged={invalidateAll} onAudit={writeBudgetAudit} onNotify={notifyBudgetAlert} />
          </TabsContent>
          <TabsContent value="reports">
            <ReportsPanel budgets={budgets} expenses={expenses} refunds={refunds} categories={categories} projects={projects} onAudit={writeBudgetAudit} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

function scopeTotalsForRule(rule, { budgets, expenses, refunds }) {
  const inScope = (expenses || []).filter((e) => {
    if (!e || e.archived) return false;
    if (rule.scope_type === 'category' && rule.scope_id) {
      return e.category_id === rule.scope_id || e.subcategory_id === rule.scope_id;
    }
    if (rule.scope_type === 'project' && rule.scope_id) return e.project_id === rule.scope_id;
    if (rule.scope_type === 'sub_budget' && rule.scope_id) return e.budget_id === rule.scope_id;
    return true;
  });
  let total = 0;
  let allocated = 0;
  if (rule.scope_type === 'global' && !rule.scope_id) {
    const globals = (budgets || []).filter((b) => !b.parent_budget_id && b.status !== 'archived');
    total = globals.reduce((s, b) => s + (Number(b.total_amount) || 0), 0);
    allocated = (budgets || [])
      .filter((b) => b.parent_budget_id && b.status !== 'archived')
      .reduce((s, b) => s + (Number(b.total_amount) || 0), 0);
  } else if (rule.scope_type === 'sub_budget' && rule.scope_id) {
    const b = (budgets || []).find((x) => x.id === rule.scope_id);
    total = Number(b?.total_amount) || 0;
  } else if (rule.scope_type === 'global' && rule.scope_id) {
    const b = (budgets || []).find((x) => x.id === rule.scope_id);
    total = Number(b?.total_amount) || 0;
    allocated = (budgets || [])
      .filter((x) => x.parent_budget_id === rule.scope_id)
      .reduce((s, x) => s + (Number(x.total_amount) || 0), 0);
  }
  return computeScopeTotals({ total, allocated, expenses: inScope, refunds });
}
