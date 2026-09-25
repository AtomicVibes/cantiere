// Budget Excel exports (exceljs, same lazy pattern as exportAuditLogs).
// Row builders are exported separately so a future Google Sheets sync can
// reuse the exact same shaped rows without touching export logic.

export function buildExpenseRows(expenses, refunds, { resolveCategory, resolveProject, resolveBudget } = {}) {
  const byExpense = new Map();
  for (const r of refunds || []) {
    if (!r || r.status === 'cancelled') continue;
    if (!byExpense.has(r.expense_id)) byExpense.set(r.expense_id, []);
    byExpense.get(r.expense_id).push(r);
  }
  return (expenses || []).map((e) => {
    const related = byExpense.get(e.id) || [];
    const refunded = related.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const amount = Number(e.amount) || 0;
    return {
      expense_id: e.id || '',
      date: e.expense_date || '',
      title: e.title || '',
      category: resolveCategory ? resolveCategory(e.category_id) : e.category_id || '',
      subcategory: resolveCategory && e.subcategory_id ? resolveCategory(e.subcategory_id) : e.subcategory_id || '',
      budget: resolveBudget ? resolveBudget(e.budget_id) : e.budget_id || '',
      sub_budget: '',
      project: resolveProject ? resolveProject(e.project_id) : e.project_id || '',
      vendor: e.vendor || '',
      expense_type: e.expense_type || '',
      expense_kind: e.expense_kind || '',
      status: e.payment_status || '',
      amount,
      refunded: Math.round(refunded * 100) / 100,
      net_amount: Math.round((amount - refunded) * 100) / 100,
      currency: e.currency || 'TND',
      recurring: e.expense_kind === 'recurring' ? 'yes' : 'no',
      created_by: e.created_by || '',
      created_at: e.created_at || '',
    };
  });
}

export function buildBudgetSummaryRows(budgets, totalsByBudget) {
  return (budgets || []).map((b) => {
    const t = (totalsByBudget || {})[b.id] || {};
    return {
      budget_id: b.id || '',
      name: b.name || '',
      parent: b.parent_budget_id || '',
      total: Number(b.total_amount) || 0,
      allocated: Number(t.allocated) || 0,
      spent: Number(t.spent) || 0,
      committed: Number(t.committed) || 0,
      refunded: Number(t.refunded) || 0,
      available: Number(t.available) || 0,
      remaining: Number(t.remaining) || 0,
      utilization_pct: Number(t.utilization) || 0,
      currency: b.currency || 'TND',
      status: b.status || '',
    };
  });
}

const EXPENSE_COLUMNS = [
  { header: 'Expense ID', key: 'expense_id', width: 40 },
  { header: 'Date', key: 'date', width: 14 },
  { header: 'Title', key: 'title', width: 32 },
  { header: 'Category', key: 'category', width: 20 },
  { header: 'Subcategory', key: 'subcategory', width: 20 },
  { header: 'Budget', key: 'budget', width: 24 },
  { header: 'Project', key: 'project', width: 24 },
  { header: 'Vendor', key: 'vendor', width: 24 },
  { header: 'Expense Type', key: 'expense_type', width: 14 },
  { header: 'Status', key: 'status', width: 16 },
  { header: 'Amount', key: 'amount', width: 14 },
  { header: 'Refunded', key: 'refunded', width: 14 },
  { header: 'Net Amount', key: 'net_amount', width: 14 },
  { header: 'Currency', key: 'currency', width: 10 },
  { header: 'Recurring', key: 'recurring', width: 10 },
  { header: 'Created By', key: 'created_by', width: 40 },
  { header: 'Created At', key: 'created_at', width: 22 },
];

const SUMMARY_COLUMNS = [
  { header: 'Budget ID', key: 'budget_id', width: 40 },
  { header: 'Name', key: 'name', width: 30 },
  { header: 'Parent ID', key: 'parent', width: 40 },
  { header: 'Total', key: 'total', width: 14 },
  { header: 'Allocated', key: 'allocated', width: 14 },
  { header: 'Spent', key: 'spent', width: 14 },
  { header: 'Committed', key: 'committed', width: 14 },
  { header: 'Refunded', key: 'refunded', width: 14 },
  { header: 'Available', key: 'available', width: 14 },
  { header: 'Remaining', key: 'remaining', width: 14 },
  { header: 'Utilization %', key: 'utilization_pct', width: 14 },
  { header: 'Currency', key: 'currency', width: 10 },
  { header: 'Status', key: 'status', width: 12 },
];

async function downloadWorkbook(workbook, filename) {
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(blob);
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(anchor.href), 5000);
}

function styleSheet(sheet, columns) {
  sheet.columns = columns.map((col) => ({ ...col }));
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.alignment = { vertical: 'middle' };
}

export async function exportBudgetExpensesToExcel(expenseRows, summaryRows, filename = 'budget-export.xlsx') {
  const ExcelJSModule = await import('exceljs');
  const ExcelJS = ExcelJSModule.default ?? ExcelJSModule;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Geometra Budget Management';
  workbook.created = new Date();

  const expenses = workbook.addWorksheet('Expenses');
  styleSheet(expenses, EXPENSE_COLUMNS);
  for (const row of expenseRows) expenses.addRow(row);

  const summary = workbook.addWorksheet('Budget Summary');
  styleSheet(summary, SUMMARY_COLUMNS);
  for (const row of summaryRows) summary.addRow(row);

  await downloadWorkbook(workbook, filename);
}
