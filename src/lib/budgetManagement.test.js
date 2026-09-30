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
  usageInfo,
  budgetScope,
  descendantBudgetIds,
  buildCategoryReportRows,
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

  it('totals never double-count: gross spent with committed as a subset', () => {
    const expenses = [
      { id: 'a', amount: 100, payment_status: 'paid' },
      { id: 'b', amount: 200, payment_status: 'approved' },
      { id: 'c', amount: 300, payment_status: 'cancelled' },
      { id: 'd', amount: 400, payment_status: 'planned', archived: true },
      { id: 'e', amount: 50, payment_status: 'planned' },
    ];
    const t = computeScopeTotals({ total: 1000, allocated: 100, expenses, refunds: [] });
    assert.equal(t.spent, 350); // gross: paid + approved + planned counted
    assert.equal(t.committed, 200); // subset of spent, never subtracted twice
    assert.ok(t.committed <= t.spent);
    assert.equal(t.remaining, 1000 - 350); // remaining = total + refunded - spent
    assert.equal(t.available, 1000 - 100 - 350); // total - allocated - spent
    assert.equal(t.utilization, 35);
  });

  it('refunds credit exactly once: gross spent, remaining = total + refunded - spent', () => {
    const expenses = [{ id: 'a', amount: 1000, payment_status: 'paid' }];
    const refunds = [{ expense_id: 'a', amount: 250, status: 'paid' }];
    const t = computeScopeTotals({ total: 1000, allocated: 0, expenses, refunds });
    assert.equal(t.spent, 1000); // gross, not net
    assert.equal(t.refunded, 250);
    assert.equal(t.remaining, 250); // 1000 + 250 - 1000 (no double counting)
    assert.equal(t.utilization, 100);
    const full = computeScopeTotals({
      total: 1000, allocated: 0, expenses,
      refunds: [{ expense_id: 'a', amount: 1000, status: 'paid' }],
    });
    assert.equal(full.remaining, 1000);
    assert.ok(full.remaining <= full.total);
  });

  it('utilization is unclamped and zero-total scopes never show 0%', () => {
    const over = computeScopeTotals({ total: 100, expenses: [{ id: 'a', amount: 150, payment_status: 'paid' }] });
    assert.equal(over.utilization, 150); // overruns stay visible
    const zero = computeScopeTotals({ total: 0, expenses: [{ id: 'a', amount: 50, payment_status: 'paid' }] });
    assert.equal(zero.utilization, null); // division by zero is flagged, not faked
    assert.equal(zero.remaining, -50);
    const empty = computeScopeTotals({ total: 0, expenses: [] });
    assert.equal(empty.utilization, null);
  });

  it('usageInfo handles zero budgets without dividing by zero', () => {
    assert.deepEqual(usageInfo(0, 0), { pct: null, zeroBudget: true, over: false });
    assert.deepEqual(usageInfo(0, 45), { pct: null, zeroBudget: true, over: true });
    assert.equal(usageInfo(100, 50).pct, 50);
    assert.equal(usageInfo(100, 150).pct, 150);
    assert.equal(usageInfo(100, 150).over, true);
  });

  it('variance shows expected vs actual', () => {
    assert.equal(variance(2000, 2450), 450);
    assert.equal(variance(2000, 1500), -500);
  });
});

describe('budget scope resolution', () => {
  const budgets = [
    { id: 'g1', parent_budget_id: null, total_amount: 1000, status: 'active', currency: 'EUR' },
    { id: 's1', parent_budget_id: 'g1', total_amount: 400, status: 'active', currency: 'EUR' },
    { id: 's2', parent_budget_id: 's1', total_amount: 150, status: 'active', currency: 'EUR' },
    { id: 'g2', parent_budget_id: null, total_amount: 500, status: 'archived', currency: 'EUR' },
  ];

  it('scope includes all descendants once; allocated = direct carve-outs', () => {
    const scope = budgetScope(budgets, 'g1');
    assert.deepEqual([...scope.budgetIds].sort(), ['g1', 's1', 's2']);
    assert.equal(scope.total, 1000);
    assert.equal(scope.allocated, 400); // s2 already lives inside s1
    const child = budgetScope(budgets, 's1');
    assert.deepEqual([...child.budgetIds].sort(), ['s1', 's2']);
    assert.equal(child.allocated, 150);
    assert.equal(child.total, 400);
  });

  it('global pool skips archived roots and never double counts depth', () => {
    const pool = budgetScope(budgets, null);
    assert.equal(pool.total, 1000); // archived g2 excluded
    assert.equal(pool.allocated, 400); // only direct children of roots
    assert.equal(pool.budgetIds, null); // unrestricted
  });

  it('descendantBudgetIds is cycle-safe', () => {
    const cyclic = [{ id: 'a', parent_budget_id: 'b' }, { id: 'b', parent_budget_id: 'a' }];
    assert.deepEqual(descendantBudgetIds(cyclic, 'a'), ['b']);
    assert.deepEqual(descendantBudgetIds(cyclic, null), []);
  });
});

describe('reports parity', () => {
  it('sum(category rows actual) === card spent for the same rows', () => {
    const categories = [
      { id: 'c1', name: 'Vehicles', parent_category_id: null, allocated_amount: 500 },
      { id: 'c2', name: 'Fuel', parent_category_id: 'c1', allocated_amount: 100 },
      { id: 'c3', name: 'Office', parent_category_id: null, allocated_amount: 0 },
    ];
    const expenses = [
      { id: 'e1', amount: 100, payment_status: 'paid', category_id: 'c2' },
      { id: 'e2', amount: 45, payment_status: 'pending', category_id: 'c1' },
      { id: 'e3', amount: 30, payment_status: 'planned', category_id: 'c3' },
      { id: 'e4', amount: 999, payment_status: 'cancelled', category_id: 'c1' },
      { id: 'e5', amount: 700, payment_status: 'paid', category_id: null },
    ];
    const rows = buildCategoryReportRows({ expenses, categories });
    const totals = computeScopeTotals({ total: 0, expenses, refunds: [] });
    const sumActual = Math.round(rows.reduce((s, r) => s + r.actual, 0) * 100);
    assert.equal(sumActual, Math.round(totals.spent * 100)); // cards == table
    const vehicles = rows.find((r) => r.key === 'c1');
    assert.equal(vehicles.budget, 600); // subtree allocation 500 + 100
    assert.equal(vehicles.actual, 145); // nested + own, cancelled excluded
    assert.equal(vehicles.usage.pct, 24.17);
    const none = rows.find((r) => r.key === '__none__');
    assert.equal(none.actual, 700);
    assert.equal(none.usage.zeroBudget, true); // no allocation → N/A / Over
    assert.equal(none.usage.over, true);
    assert.ok(!rows.some((r) => r.budget === 0 && r.actual === 0), 'empty rows skipped');
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

  it('zero-total utilization: over budget fires gte, budgetless scopes never', () => {
    const rule = { enabled: true, metric: 'utilization', operator: 'gte', threshold: 80 };
    const overZero = evaluateBudgetRule(rule, { utilization: null, spent: 50 });
    assert.equal(overZero.triggered, true);
    assert.equal(overZero.value, null); // infinity reported as null → UI "over budget"
    assert.equal(evaluateBudgetRule(rule, { utilization: null, spent: 0 }).triggered, false);
    assert.equal(evaluateBudgetRule(rule, { utilization: null, spent: 50, hasBudget: false }).triggered, false);
    const lte = { ...rule, operator: 'lte', threshold: 50 };
    assert.equal(evaluateBudgetRule(lte, { utilization: null, spent: 50 }).triggered, false);
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
    const blankUtil = buildBudgetSummaryRows([{ id: 'b1', name: 'Ops' }], { b1: { utilization: null } });
    assert.equal(blankUtil[0].utilization_pct, ''); // zero-total stays blank, not 0%
    const namedParent = buildBudgetSummaryRows(
      [{ id: 'b2', name: 'Sub', parent_budget_id: 'g1' }],
      {},
      { resolveParent: () => 'Global' }
    );
    assert.equal(namedParent[0].parent, 'Global'); // export carries parent names
    const withSub = buildExpenseRows(
      [{ id: 'e1', title: 'Fuel', amount: 100, payment_status: 'paid' }],
      [],
      { resolveSubBudget: () => 'Emergency' }
    );
    assert.equal(withSub[0].sub_budget, 'Emergency'); // sub-budget column populated
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

describe('category allocation migration', () => {
  it('adds allocated_amount additively with decimal money only', () => {
    const sql = codeOf(read('supabase/migrations/20261015120000_budget_category_allocation.sql'));
    assert.ok(sql.includes('add column if not exists allocated_amount numeric(14,2)'), 'numeric column');
    assert.ok(sql.includes('allocated_amount >= 0'), 'non-negative guard');
    assert.ok(sql.includes('default 0'), 'defaults to zero');
    assert.ok(!/double precision|float/i.test(sql), 'no float money');
    assert.ok(!/drop table|truncate|delete from/i.test(sql), 'additive only');
    const alters = sql.match(/alter table [a-z_.]+/g) || [];
    assert.ok(alters.length > 0 && alters.every((a) => a.includes('budget_categories')), 'only budget_categories altered');
    assert.ok(!/push_subscriptions|notifications|audit_logs|invoices/i.test(sql), 'no cross-system writes');
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
