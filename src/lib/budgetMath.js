// Budget Management math (single source of truth, unit-tested).
// Money uses NUMERIC(14,2) in the DB; JS uses integer cents internally in
// aggregations to avoid floating-point drift. Canonical database currency
// identifier is the ISO 4217 code (EUR); formatting follows Intl.

export const DEFAULT_CURRENCY = 'EUR';

// Select options shown across Budget Management (EUR first and default).
// Amounts are never converted between currencies anywhere in the app.
export const CURRENCY_OPTIONS = [
  { value: 'EUR', label: 'EUR — Euro (€)' },
  { value: 'TND', label: 'TND — Tunisian Dinar' },
  { value: 'USD', label: 'USD — US Dollar' },
];

export function toCents(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

export function fromCents(cents) {
  return (Math.round(cents) || 0) / 100;
}

export function formatMoney(amount, currency = DEFAULT_CURRENCY, locale) {
  const n = Number(amount);
  const safe = Number.isFinite(n) ? n : 0;
  try {
    return new Intl.NumberFormat(locale || undefined, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(safe);
  } catch {
    return `${safe.toFixed(2)} ${currency}`;
  }
}

function refundedCents(expense, refunds = []) {
  const list = Array.isArray(refunds) ? refunds : [];
  return list
    .filter((r) => r && r.expense_id === expense?.id && r.status !== 'cancelled')
    .reduce((s, r) => s + toCents(r.amount), 0);
}

// Net expense = amount - refunds (refunds never mutate the original row).
export function netExpense(expense, refunds = []) {
  return fromCents(toCents(expense?.amount) - refundedCents(expense, refunds));
}

export function refundedTotal(expense, refunds = []) {
  return fromCents(refundedCents(expense, refunds));
}

// Counted rows: every non-archived, non-cancelled expense (planned and
// pending/approved included per product decision; cancelled/archived never).
export function isCountedExpense(expense) {
  if (!expense || expense.archived) return false;
  return expense.payment_status !== 'cancelled';
}

// Committed is a SUBSET of counted spend (approved/pending) shown for
// visibility; it is never subtracted a second time in totals.
export function isCommittedExpense(expense) {
  if (!expense || expense.archived) return false;
  return expense.payment_status === 'approved' || expense.payment_status === 'pending';
}

// Financial state for a scope (global pool, budget or sub-budget):
//   spent       = sum(amount) of counted rows — GROSS, never reduced by refunds
//   committed   = subset of spent still approved/pending (informational)
//   refunded    = sum(refunds) credited exactly once here
//   remaining   = total + refunded - spent          (own scope)
//   available   = total - allocated + refunded - spent (pool minus carve-outs)
//   utilization = spent / total * 100, unclamped (shows >100 when over);
//                 null when total = 0 so the UI can render N/A / Over Budget
export function computeScopeTotals({ total = 0, allocated = 0, expenses = [], refunds = [] }) {
  let spentC = 0;
  let committedC = 0;
  let refundedC = 0;
  for (const e of expenses || []) {
    if (!isCountedExpense(e)) continue;
    const amountC = toCents(e?.amount);
    spentC += amountC;
    if (isCommittedExpense(e)) committedC += amountC;
    refundedC += refundedCents(e, refunds);
  }
  const tC = toCents(total);
  const aC = toCents(allocated);
  const remaining = tC + refundedC - spentC;
  const available = tC - aC + refundedC - spentC;
  const utilization = tC > 0 ? Math.round((spentC / tC) * 10000) / 100 : null;
  return {
    total: fromCents(tC),
    allocated: fromCents(aC),
    spent: fromCents(spentC),
    committed: fromCents(committedC),
    refunded: fromCents(refundedC),
    available: fromCents(available),
    remaining: fromCents(remaining),
    utilization,
  };
}

// Usage of a budget envelope. pct is null when budget is zero so callers
// render "N/A" / "Over Budget" instead of a misleading 0%.
export function usageInfo(budget, actual) {
  const b = toCents(budget);
  const a = toCents(actual);
  if (b <= 0) return { pct: null, zeroBudget: true, over: a > 0 };
  return { pct: Math.round((Number(a) / Number(b)) * 10000) / 100, zeroBudget: false, over: a > b };
}

// --- Budget scope resolution (single source for every consumer) ------------
// All descendant budget ids of `budgetId` (depth-first, cycle-guarded).
export function descendantBudgetIds(budgets, budgetId) {
  if (!budgetId) return [];
  const children = new Map();
  for (const b of budgets || []) {
    const p = b.parent_budget_id;
    if (!children.has(p)) children.set(p, []);
    children.get(p).push(b.id);
  }
  const out = [];
  const seen = new Set([budgetId]);
  const stack = [budgetId];
  while (stack.length) {
    const cur = stack.pop();
    for (const id of children.get(cur) || []) {
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
      stack.push(id);
    }
  }
  return out;
}

// Scope for a budget filter: budget + all descendants.
// budgetId null/undefined = global pool (all non-archived global budgets).
//   budgetIds  = Set of budget ids in scope (null = unrestricted/all)
//   total      = scope root(s) total_amount
//   allocated  = carve-outs of the root(s) (direct children only — nested
//                children live inside their parent's total already)
export function budgetScope(budgets, budgetId) {
  const list = budgets || [];
  if (!budgetId) {
    const roots = list.filter((b) => !b.parent_budget_id && b.status !== 'archived');
    const rootIds = new Set(roots.map((b) => b.id));
    const total = roots.reduce((s, b) => s + (Number(b.total_amount) || 0), 0);
    const allocated = list
      .filter((b) => b.parent_budget_id && rootIds.has(b.parent_budget_id))
      .reduce((s, b) => s + (Number(b.total_amount) || 0), 0);
    return {
      budgetIds: null,
      total,
      allocated,
      currency: roots[0]?.currency || DEFAULT_CURRENCY,
    };
  }
  const root = list.find((b) => b.id === budgetId);
  const scopeIds = new Set([budgetId, ...descendantBudgetIds(list, budgetId)]);
  const allocated = list
    .filter((b) => b.parent_budget_id === budgetId)
    .reduce((s, b) => s + (Number(b.total_amount) || 0), 0);
  return {
    budgetIds: scopeIds,
    total: Number(root?.total_amount) || 0,
    allocated,
    currency: root?.currency || DEFAULT_CURRENCY,
  };
}

// Reports table rows: one row per top-level category, same counted predicate
// as computeScopeTotals so sum(rows.actual) === totals.spent for any input.
// Budget column = sum of category allocated_amount over the category subtree
// (budget_categories is the allocation source; budgets never name-match).
export function buildCategoryReportRows({ expenses = [], categories = [] }) {
  const byId = new Map((categories || []).map((c) => [c.id, c]));
  const rootOf = (id) => {
    let cur = id;
    let guard = 0;
    while (cur && byId.get(cur)?.parent_category_id && guard < 10) {
      cur = byId.get(cur).parent_category_id;
      guard += 1;
    }
    return cur;
  };
  const allocByRoot = new Map();
  for (const c of categories || []) {
    const rootId = c.parent_category_id ? rootOf(c.id) : c.id;
    allocByRoot.set(rootId, (allocByRoot.get(rootId) || 0) + toCents(c.allocated_amount));
  }
  const actualByRoot = new Map();
  const nameByRoot = new Map();
  for (const e of expenses || []) {
    if (!isCountedExpense(e)) continue;
    const rootId = e.category_id ? rootOf(e.category_id) : '';
    actualByRoot.set(rootId, (actualByRoot.get(rootId) || 0) + toCents(e.amount));
    if (!nameByRoot.has(rootId) && rootId) nameByRoot.set(rootId, byId.get(rootId)?.name || '');
  }
  const rows = [];
  for (const rootId of new Set([...actualByRoot.keys(), ...allocByRoot.keys()])) {
    const budget = fromCents(allocByRoot.get(rootId) || 0);
    const actual = fromCents(actualByRoot.get(rootId) || 0);
    // Skip pure-zero category rows (seeded categories with no envelope and
    // no spend) so the table only carries meaningful lines.
    if (budget === 0 && actual === 0) continue;
    rows.push({
      key: rootId || '__none__',
      name: nameByRoot.get(rootId) || '',
      budget,
      actual,
      variance: round2(budget - actual),
      usage: usageInfo(budget, actual),
    });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return rows;
}

export function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export function variance(expected, actual) {
  return round2((Number(actual) || 0) - (Number(expected) || 0));
}

// --- Recurrence ------------------------------------------------------------
const FREQUENCY_STEPS = {
  daily: { unit: 'day', amount: 1 },
  weekly: { unit: 'day', amount: 7 },
  monthly: { unit: 'month', amount: 1 },
  quarterly: { unit: 'month', amount: 3 },
  yearly: { unit: 'year', amount: 1 },
};

export function addFrequency(dateInput, frequency) {
  const step = FREQUENCY_STEPS[frequency];
  if (!step) return null;
  const d = new Date(dateInput);
  if (Number.isNaN(d.getTime())) return null;
  const next = new Date(d);
  if (step.unit === 'day') next.setDate(next.getDate() + step.amount);
  else if (step.unit === 'month') next.setMonth(next.getMonth() + step.amount);
  else next.setFullYear(next.getFullYear() + step.amount);
  return next;
}

export function toDateOnlyString(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Deterministic idempotency key: one generated expense per definition+date.
export function recurrenceKey(recurringId, dueDateOnly) {
  return `${recurringId}:${dueDateOnly}`;
}

// Due occurrences from next_run_date (inclusive) up to `today`, bounded so
// a long-dormant definition cannot flood the ledger in one run.
export function dueRecurrenceRuns(recurring, today = new Date(), maxRuns = 12) {
  if (!recurring?.active || !recurring?.frequency || !recurring?.next_run_date) return [];
  const end = recurring.end_date ? new Date(recurring.end_date) : null;
  const todayOnly = toDateOnlyString(today instanceof Date ? today : new Date(today));
  const runs = [];
  let cursor = new Date(recurring.next_run_date);
  while (runs.length < maxRuns) {
    if (Number.isNaN(cursor.getTime())) break;
    const cursorOnly = toDateOnlyString(cursor);
    if (cursorOnly > todayOnly) break;
    if (end && cursor > end) break;
    runs.push(cursorOnly);
    const next = addFrequency(cursor, recurring.frequency);
    if (!next) break;
    cursor = next;
  }
  return runs;
}

// --- Structured rule evaluation --------------------------------------------
export function evaluateBudgetRule(rule, scopeTotals, now = new Date()) {
  if (!rule?.enabled) return { triggered: false, reason: 'disabled' };
  if (rule.effective_from && new Date(rule.effective_from) > now) {
    return { triggered: false, reason: 'not_effective_yet' };
  }
  if (rule.effective_to && new Date(rule.effective_to) < now) {
    return { triggered: false, reason: 'expired' };
  }
  const totals = scopeTotals || {};
  let value;
  if (rule.metric === 'utilization') {
    if (totals.utilization === null) {
      // Zero-total scope: with spend it is over budget (infinite usage) —
      // unless the scope simply has no budget attached (category/project
      // rule scopes), where utilization stays undefined and never fires.
      const hasBudget = totals.hasBudget !== false;
      value = hasBudget && (Number(totals.spent) || 0) > 0 ? Number.POSITIVE_INFINITY : 0;
    } else {
      value = Number(totals.utilization) || 0;
    }
  } else if (rule.metric === 'spent') {
    value = Number(totals.spent) || 0;
  } else {
    value = Number(totals.remaining) || 0;
  }
  const threshold = Number(rule.threshold) || 0;
  const triggered = rule.operator === 'lte' ? value <= threshold : value >= threshold;
  return {
    triggered,
    value: Number.isFinite(value) ? round2(value) : null,
    reason: triggered ? 'threshold_met' : 'below_threshold',
  };
}

// A rule may re-fire only when never fired or when its period elapsed.
export function ruleMayRefire(rule, now = new Date()) {
  if (!rule?.last_triggered_at) return true;
  const last = new Date(rule.last_triggered_at);
  if (Number.isNaN(last.getTime())) return true;
  const elapsedMs = now - last;
  const dayMs = 24 * 60 * 60 * 1000;
  switch (rule.period) {
    case 'monthly':
      return elapsedMs >= 30 * dayMs;
    case 'quarterly':
      return elapsedMs >= 91 * dayMs;
    case 'yearly':
      return elapsedMs >= 365 * dayMs;
    case 'once':
      return false;
    default:
      return true;
  }
}
