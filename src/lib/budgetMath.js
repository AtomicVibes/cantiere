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

// Net expense = amount - refunds (refunds never mutate the original row).
export function netExpense(expense, refunds = []) {
  const list = Array.isArray(refunds) ? refunds : [];
  const refunded = list
    .filter((r) => r && r.expense_id === expense?.id && r.status !== 'cancelled')
    .reduce((s, r) => s + toCents(r.amount), 0);
  return fromCents(toCents(expense?.amount) - refunded);
}

export function refundedTotal(expense, refunds = []) {
  const list = Array.isArray(refunds) ? refunds : [];
  return fromCents(
    list
      .filter((r) => r && r.expense_id === expense?.id && r.status !== 'cancelled')
      .reduce((s, r) => s + toCents(r.amount), 0)
  );
}

const COUNTED_STATUSES = new Set(['approved', 'paid', 'partially_paid', 'overdue', 'refunded', 'partially_refunded']);

// An expense counts toward spent unless it is planned/draft-like,
// pending approval, cancelled or archived.
export function isCountedExpense(expense) {
  if (!expense || expense.archived) return false;
  if (expense.payment_status === 'cancelled') return false;
  return COUNTED_STATUSES.has(expense.payment_status) || expense.payment_status === 'pending';
}

export function isCommittedExpense(expense) {
  if (!expense || expense.archived) return false;
  return expense.payment_status === 'approved' || expense.payment_status === 'pending';
}

// Financial state for a scope (global budget, sub-budget or project):
//   spent     = sum(net) of counted, non-committed expenses
//   committed = sum(net) of approved/pending expenses
//   refunded  = sum(refunds) on counted expenses
//   allocated = sum(sub-budget totals)  [global scope only]
//   available = total - allocated - committed - spent + refunded
//   remaining = total - spent - committed + refunded (own scope)
// No double counting: each expense contributes to exactly one of
// spent/committed via its status.
export function computeScopeTotals({ total = 0, allocated = 0, expenses = [], refunds = [], countCommittedSeparately = true }) {
  let spent = 0;
  let committed = 0;
  let refunded = 0;
  for (const e of expenses || []) {
    if (!isCountedExpense(e)) continue;
    const net = netExpense(e, refunds);
    refunded += refundedTotal(e, refunds);
    if (countCommittedSeparately && isCommittedExpense(e)) committed += net;
    else spent += net;
  }
  const t = Number(total) || 0;
  const a = Number(allocated) || 0;
  const available = t - a - committed - spent + refunded;
  const remaining = t - committed - spent + refunded;
  const utilization = t > 0 ? Math.min(100, Math.max(0, ((spent + committed) / t) * 100)) : 0;
  return {
    total: t,
    allocated: a,
    spent: round2(spent),
    committed: round2(committed),
    refunded: round2(refunded),
    available: round2(available),
    remaining: round2(remaining),
    utilization: Math.round(utilization * 100) / 100,
  };
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
  const value =
    rule.metric === 'spent'
      ? Number(totals.spent) || 0
      : rule.metric === 'remaining'
        ? Number(totals.remaining) || 0
        : Number(totals.utilization) || 0;
  const threshold = Number(rule.threshold) || 0;
  const triggered = rule.operator === 'lte' ? value <= threshold : value >= threshold;
  return { triggered, value: round2(value), reason: triggered ? 'threshold_met' : 'below_threshold' };
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
