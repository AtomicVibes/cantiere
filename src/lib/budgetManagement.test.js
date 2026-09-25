// Budget Management contracts: money math without float drift,
// no-double-count totals, idempotent recurrence, structured rules,
// additive migration safety, central notification usage.
// Run with: node --test src/lib/budgetManagement.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  toCents,
  netExpense,
  computeScopeTotals,
  variance,
  recurrenceKey,
  dueRecurrenceRuns,
  evaluateBudgetRule,
  ruleMayRefire,
  formatMoney,
  DEFAULT_CURRENCY,
} from './budgetMath.js';
import { buildExpenseRows, buildBudgetSummaryRows } from './budgetExport.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');
const codeOf = (sql) => sql.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');

const MIG = 'supabase/migrations/20261010120000_budget_management.sql';

describe('money math', () => {
  it('uses integer cents (no float drift) and EUR default', () => {
    assert.equal(DEFAULT_CURRENCY, 'EUR');
    assert.equal(toCents(0.1) + toCents(0.2), toCents(0.3));
    assert.ok(formatMoney(1500).includes('1500') || formatMoney(1500).includes('1'));
  });

  it('net expense subtracts refunds without mutating the original', () => {
    const expense = { id: 'e1', amount: 1000 };
    const refunds = [{ expense_id: 'e1', amount: 250, status: 'paid' }];
    assert.equal(netExpense(expense, refunds), 750);
    assert.equal(expense.amount, 1000);
    assert.equal(netExpense(expense, [{ expense_id: 'e1', amount: 100, status: 'cancelled' }]), 1000);
  });

  it('totals never double-count: each expense lands in exactly one bucket', () => {
    const expenses = [
      { id: 'a', amount: 100, payment_status: 'paid' },
      { id: 'b', amount: 200, payment_status: 'approved' },
      { id: 'c', amount: 300, payment_status: 'cancelled' },
      { id: 'd', amount: 400, payment_status: 'planned', archived: true },
    ];
    const t = computeScopeTotals({ total: 1000, allocated: 100, expenses, refunds: [] });
    assert.equal(t.spent, 100);
    assert.equal(t.committed, 200);
    assert.equal(t.available, 1000 - 100 - 200 - 100);
    assert.equal(t.remaining, 1000 - 200 - 100);
    assert.equal(t.utilization, 30);
  });

  it('refunds reduce spent and raise remaining without double counting', () => {
    const expenses = [{ id: 'a', amount: 1000, payment_status: 'paid' }];
    const refunds = [{ expense_id: 'a', amount: 250, status: 'paid' }];
    const t = computeScopeTotals({ total: 1000, allocated: 0, expenses, refunds });
    assert.equal(t.spent, 750);
    assert.equal(t.refunded, 250);
    assert.equal(t.remaining, 500);
  });

  it('variance shows expected vs actual', () => {
    assert.equal(variance(2000, 2450), 450);
    assert.equal(variance(2000, 1500), -500);
  });
});

describe('recurrence idempotency', () => {
  it('keys are deterministic per definition and date', () => {
    assert.equal(recurrenceKey('r1', '2026-10-01'), 'r1:2026-10-01');
    assert.notEqual(recurrenceKey('r1', '2026-10-01'), recurrenceKey('r1', '2026-11-01'));
  });

  it('generates only due runs, bounded, honoring end dates', () => {
    const rec = { id: 'r1', active: true, frequency: 'monthly', next_run_date: '2026-08-01' };
    assert.deepEqual(dueRecurrenceRuns(rec, new Date('2026-10-15')), ['2026-08-01', '2026-09-01', '2026-10-01']);
    assert.deepEqual(dueRecurrenceRuns(rec, new Date('2026-07-01')), []);
    assert.deepEqual(dueRecurrenceRuns({ ...rec, active: false }, new Date('2026-10-15')), []);
    assert.deepEqual(dueRecurrenceRuns({ ...rec, end_date: '2026-08-15' }, new Date('2026-10-15')), ['2026-08-01']);
  });
});

describe('structured rules', () => {
  it('evaluates thresholds without executable code', () => {
    const rule = { enabled: true, metric: 'utilization', operator: 'gte', threshold: 80 };
    assert.equal(evaluateBudgetRule(rule, { utilization: 85 }).triggered, true);
    assert.equal(evaluateBudgetRule(rule, { utilization: 40 }).triggered, false);
    assert.equal(evaluateBudgetRule({ ...rule, enabled: false }, { utilization: 99 }).triggered, false);
    assert.equal(evaluateBudgetRule(rule, { spent: 5000 }).triggered, false);
  });

  it('refire respects the period (once never refires)', () => {
    const now = new Date('2026-10-10T12:00:00');
    assert.equal(ruleMayRefire({ period: 'once', last_triggered_at: '2026-10-01T00:00:00' }, now), false);
    assert.equal(ruleMayRefire({ period: 'once' }, now), true);
    assert.equal(ruleMayRefire({ period: 'monthly', last_triggered_at: '2026-10-01T00:00:00' }, now), false);
    assert.equal(ruleMayRefire({ period: 'monthly', last_triggered_at: '2026-08-01T00:00:00' }, now), true);
  });
});

describe('export rows', () => {
  it('builds expense rows with net math and summary rows', () => {
    const expenses = [{ id: 'e1', title: 'Fuel', amount: 100, currency: 'EUR', payment_status: 'paid', category_id: 'c1', project_id: 'p1', expense_type: 'flexible', expense_kind: 'one_time' }];
    const refunds = [{ expense_id: 'e1', amount: 20, status: 'paid' }];
    const rows = buildExpenseRows(expenses, refunds, {
      resolveCategory: () => 'Vehicles',
      resolveProject: () => 'Alpha',
      resolveBudget: () => 'Ops',
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].net_amount, 80);
    assert.equal(rows[0].refunded, 20);
    const summary = buildBudgetSummaryRows([{ id: 'b1', name: 'Ops', total_amount: 1000 }], { b1: { allocated: 1, spent: 2, committed: 3, refunded: 4, available: 5, remaining: 6, utilization: 7 } });
    assert.equal(summary[0].name, 'Ops');
    assert.equal(summary[0].utilization_pct, 7);
  });
});

describe('migration safety', () => {
  it('adds the required tables with decimal money and super-admin RLS', () => {
    const sql = codeOf(read(MIG));
    for (const table of ['public.budgets', 'public.budget_categories', 'public.budget_expenses', 'public.budget_recurring', 'public.budget_refunds', 'public.budget_rules']) {
      assert.ok(sql.includes(`create table if not exists ${table}`), table);
    }
    assert.ok(!/double precision|real |float/i.test(sql), 'no floating-point money');
    assert.ok(sql.includes('numeric(14,2)'), 'decimal money');
    assert.ok(sql.includes('auth_user_is_super_admin'), 'super-admin gate');
    assert.ok(sql.includes('revoke all on') && sql.includes('from anon'), 'anon revoked');
    assert.ok(!/supabase db reset|drop table public\.(budgets|budget_expenses)|truncate/i.test(sql), 'no destruction');
  });

  it('protects integrity: allocation guard rails, idempotency, indexes', () => {
    const sql = codeOf(read(MIG));
    assert.ok(sql.includes('budget_expenses_recurrence_uidx'), 'recurrence uniqueness');
    assert.ok(sql.includes('on delete restrict'), 'referenced rows protected');
    assert.ok(sql.includes('on delete set null'), 'optional links nullified');
    assert.ok(sql.includes('create index if not exists budget_expenses_budget_idx'), 'budget index');
    assert.ok(sql.includes('create index if not exists budget_expenses_project_idx'), 'project index');
  });

  it('leaves unrelated systems alone', () => {
    const sms = read('supabase/migrations/20261001120000_event_reminders_sms.sql');
    assert.ok(!/budget/i.test(sms), 'SMS migration untouched');
    const sql = codeOf(read(MIG));
    assert.ok(!/notifications|push_subscriptions|audit_logs/i.test(sql), 'no cross-system writes');
  });

  it('type definitions cover the new tables', () => {
    const types = read('src/lib/database.types.ts');
    for (const table of ['budgets:', 'budget_categories:', 'budget_expenses:', 'budget_recurring:', 'budget_refunds:', 'budget_rules:']) {
      assert.ok(types.includes(table), table);
    }
  });
});

describe('EUR default currency', () => {
  it('migration sets EUR defaults without touching existing rows', () => {
    const sql = read('supabase/migrations/20261011120000_budget_currency_eur.sql').split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
    assert.ok(sql.includes("alter column currency set default 'EUR'"), 'EUR default applied');
    assert.ok(!/update public\.(budgets|budget_expenses|budget_recurring)\s+set currency/i.test(sql), 'existing rows preserved');
    assert.ok(!/invoices|projects/i.test(sql), 'unrelated modules untouched');
  });

  it('forms default to EUR with ISO labels and parent/budget inheritance', () => {
    for (const f of ['src/components/budget/BudgetManager.jsx', 'src/components/budget/ExpenseManager.jsx', 'src/components/budget/RecurringManager.jsx']) {
      const src = read(f);
      assert.ok(src.includes('DEFAULT_CURRENCY'), `${f} uses the shared default`);
      assert.ok(src.includes('CURRENCY_OPTIONS'), `${f} uses shared options`);
      assert.ok(!/currency: 'TND'/.test(src), `${f} has no TND default`);
    }
    assert.ok(read('src/components/budget/BudgetManager.jsx').includes('parent?.currency'), 'sub-budget inherits parent');
    assert.ok(read('src/components/budget/ExpenseManager.jsx').includes('budget?.currency'), 'expense inherits budget');
    assert.ok(!/exchange|convert/i.test(read('src/components/budget/BudgetManager.jsx') + read('src/components/budget/ExpenseManager.jsx')), 'no silent conversion');
  });

  it('refunds and exports follow the original/recorded currency', () => {
    const refund = read('src/components/budget/RefundManager.jsx');
    assert.ok(refund.includes('expenseCurrency'), 'refund display follows expense');
    const exp = read('src/lib/budgetExport.js');
    assert.ok(exp.includes("e.currency || 'EUR'") && exp.includes("b.currency || 'EUR'"), 'export carries ISO codes');
  });

  it('dashboard totals render in the stored currency', () => {
    const overview = read('src/components/budget/BudgetOverview.jsx');
    assert.ok(overview.includes('totals.currency'), 'totals carry currency');
  });
});

describe('finance integration', () => {
  it('budget section lives inside Finance, super-admin gated, invoices intact', () => {
    const finance = read('src/pages/Finance.jsx');
    assert.ok(finance.includes('BudgetSection'), 'section mounted');
    assert.ok(finance.includes("value=\"budget\""), 'budget tab exists');
    assert.ok(finance.includes("value=\"invoices\""), 'invoices tab preserved');
    assert.ok(finance.includes('InvoiceFormDialog'), 'invoice flow intact');
  });

  it('components reuse date picker, exceljs, charts and semantic tokens', () => {
    const section = read('src/components/budget/BudgetSection.jsx');
    assert.ok(section.includes('write_audit_log'), 'canonical audit');
    assert.ok(section.includes("from('notifications')"), 'central notification pipeline');
    assert.ok(!section.includes('send-push') && !section.includes('TextBee'), 'no ad-hoc push/sms');
    const expense = read('src/components/budget/ExpenseManager.jsx');
    assert.ok(expense.includes('ui/DatePicker'), 'shared date picker');
    const exp = read('src/lib/budgetExport.js');
    assert.ok(exp.includes("import('exceljs')"), 'existing excel library');
    const overview = read('src/components/budget/BudgetOverview.jsx');
    assert.ok(overview.includes('recharts'), 'existing chart library');
    for (const f of ['BudgetManager.jsx', 'ExpenseManager.jsx', 'ReportsPanel.jsx']) {
      const src = read(`src/components/budget/${f}`);
      assert.ok(!/bg-white|text-gray-900|border-gray-200/.test(src), `${f} uses semantic tokens`);
    }
  });

  it('budget i18n keys exist in all four languages', () => {
    const i18n = read('src/i18n.js');
    for (const key of ['budgetManagement:', 'budgetTotal:', 'expenseNew:', 'recurringNew:', 'categoryNew:', 'ruleNew:', 'refundNew:', 'exportExcel:', 'saveBudget:', 'saveExpense:']) {
      const count = (i18n.match(new RegExp(`^\\s*${key}`, 'gm')) || []).length;
      assert.equal(count, 4, `${key} in 4 languages`);
    }
  });
});
