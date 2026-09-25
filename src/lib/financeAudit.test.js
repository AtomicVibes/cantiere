// Finance audit classification contracts:
//   every Finance action resolves to the Finance feature + Wallet icon
//   (never System), at the mapping source both UI and export share.
// Run with: node --test src/lib/financeAudit.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { getFeatureForAction } from './auditFeatureMapping.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');

const FINANCE_ACTIONS = [
  'BUDGET_CREATED', 'BUDGET_UPDATED', 'BUDGET_ARCHIVED', 'BUDGET_RESTORED',
  'BUDGET_DELETED', 'BUDGET_EXPORTED',
  'EXPENSE_CREATED', 'EXPENSE_UPDATED', 'EXPENSE_APPROVED', 'EXPENSE_PAID',
  'EXPENSE_CANCELLED',
  'REFUND_CREATED', 'REFUND_UPDATED',
  'RECURRING_CREATED', 'RECURRING_UPDATED', 'RECURRING_ENABLED', 'RECURRING_DISABLED',
  'CATEGORY_CREATED', 'CATEGORY_UPDATED', 'CATEGORY_ARCHIVED',
  'BUDGET_RULE_CREATED', 'BUDGET_RULE_UPDATED', 'BUDGET_RULE_DISABLED',
];

describe('finance classification at the source', () => {
  it('every Finance action resolves to Finance (never System)', () => {
    for (const action of FINANCE_ACTIONS) {
      const feature = getFeatureForAction(action);
      assert.equal(feature.name, 'Finance', action);
      assert.notEqual(feature.name, 'System', action);
    }
  });

  it('uses the Finance Wallet icon, not the System icon', () => {
    const feature = getFeatureForAction('EXPENSE_CREATED');
    assert.equal(feature.icon?.displayName || feature.icon?.name, 'Wallet');
    const system = getFeatureForAction('SOMETHING_UNKNOWN_XYZ');
    assert.equal(system.name, 'System');
    assert.notEqual(
      feature.icon?.displayName || feature.icon?.name,
      system.icon?.displayName || system.icon?.name
    );
  });

  it('existing feature rules are unchanged', () => {
    assert.equal(getFeatureForAction('PROJECT_CREATE').name, 'Projects');
    assert.equal(getFeatureForAction('INVOICE_CREATED').name, 'Invoices');
    assert.equal(getFeatureForAction('EVENT_CREATED').name, 'Events');
    assert.equal(getFeatureForAction('DOCUMENT_UPLOAD').name, 'Documents');
    assert.equal(getFeatureForAction('AUDIT_LOG_DELETE').name, 'Audit');
    assert.equal(getFeatureForAction('WHATEVER_ELSE').name, 'System');
  });
});

describe('single shared mapping for UI, filter and export', () => {
  it('audit list and excel export both resolve through getFeatureForAction', () => {
    assert.ok(read('src/pages/Logs.jsx').includes('getFeatureForAction'), 'Logs UI');
    assert.ok(read('src/lib/exportAuditLogs.js').includes('getFeatureForAction'), 'Excel export');
  });

  it('no parallel classification system exists', () => {
    const mapping = read('src/lib/auditFeatureMapping.js');
    assert.ok(mapping.includes('Finance'), 'Finance rule present');
    const hits = (mapping.match(/name: 'Finance'/g) || []).length;
    assert.equal(hits, 1, 'exactly one Finance rule');
  });
});

describe('finance audit coverage in code', () => {
  it('restore and export emit distinct audited actions', () => {
    assert.ok(read('src/components/budget/BudgetManager.jsx').includes('BUDGET_RESTORED'), 'restore audited');
    assert.ok(read('src/components/budget/ReportsPanel.jsx').includes('BUDGET_EXPORTED'), 'export audited');
  });

  it('all shipped finance actions classify correctly (case-insensitive)', () => {
    assert.equal(getFeatureForAction('budget_created').name, 'Finance');
    assert.equal(getFeatureForAction('expense_paid').name, 'Finance');
    assert.equal(getFeatureForAction(null).name, 'System');
    assert.equal(getFeatureForAction(undefined).name, 'System');
  });
});
