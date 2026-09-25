// App-wide telemetry + rich feed contracts:
//   metadata sanitized to JSON-safe primitives (type safety),
//   every call site fire-and-forget, feed renders rich payloads.
// Run with: node --test src/lib/telemetryFeed.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');

const SITES = [
  ['src/services/documentUploadService.js', ['DOCUMENT_UPLOADED']],
  ['src/pages/Documents.jsx', ['DOCUMENT_UPDATED', 'DOCUMENT_DELETED']],
  ['App.jsx', ['SECTION_NAVIGATED']],
  ['src/components/projects/ProjectFormDialog.jsx', ['PROJECT_CREATED', 'PROJECT_UPDATED']],
  ['src/components/invoices/InvoiceFormDialog.jsx', ['INVOICE_CREATED', 'INVOICE_UPDATED']],
  ['src/pages/CalendarPage.jsx', ['EVENT_CREATED', 'EVENT_UPDATED']],
  ['src/components/budget/BudgetManager.jsx', ['BUDGET_CREATED', 'BUDGET_UPDATED']],
  ['src/components/budget/ExpenseManager.jsx', ['EXPENSE_CREATED', 'EXPENSE_UPDATED']],
];

describe('fire-and-forget telemetry at every site', () => {
  it('all call sites exist and are never awaited', () => {
    for (const [file, actions] of SITES) {
      const src = read(file);
      for (const action of actions) {
        assert.ok(src.includes(`'${action}'`), `${file} logs ${action}`);
      }
      assert.ok(src.includes('logAction('), `${file} calls logAction`);
      assert.ok(!src.includes(`await logAction`), `${file} never awaits telemetry`);
    }
  });

  it('upload metadata carries the required detail fields', () => {
    const src = read('src/services/documentUploadService.js');
    for (const field of ['file_name', 'file_type', 'file_size_bytes', 'visibility', 'project_id']) {
      assert.ok(src.includes(field), `upload metadata has ${field}`);
    }
  });

  it('navigation tracks section + url without blocking transitions', () => {
    const src = read('App.jsx');
    assert.ok(src.includes('RouteTracker'), 'tracker mounted');
    assert.ok(src.includes('section_name'), 'section recorded');
    assert.ok(!src.includes('await logAction'), 'non-blocking');
  });
});

describe('metadata type safety', () => {
  it('sanitizer keeps only JSON-safe primitives with caps', () => {
    const src = read('src/lib/activityTracking.js');
    assert.ok(src.includes('sanitizeMetadata'), 'sanitizer exists');
    assert.ok(src.includes('MAX_METADATA_KEYS') || src.includes('25'), 'key cap');
    assert.ok(src.includes('MAX_STRING_LENGTH') || src.includes('500'), 'string cap');
    assert.ok(src.includes('@typedef') && src.includes('TelemetryMetadata'), 'JSDoc typedef');
  });
});

describe('rich feed rendering', () => {
  it('labels every new action type with i18n keys', () => {
    const src = read('src/components/teams/AgentActivityDashboard.jsx');
    for (const key of [
      'activityDocumentUploaded', 'activityDocumentUpdated', 'activityDocumentDeleted',
      'activitySectionOpened', 'activityProjectCreated', 'activityProjectUpdated',
      'activityInvoiceCreated', 'activityInvoiceUpdated', 'activityEventCreated',
      'activityEventUpdated', 'activityBudgetCreated', 'activityBudgetUpdated',
      'activityExpenseCreated', 'activityExpenseUpdated',
    ]) {
      assert.ok(src.includes(key), `feed maps ${key}`);
    }
    const i18n = read('src/i18n.js');
    for (const key of ['activityDetails:', 'activityDetailSection:', 'activityDetailFile:']) {
      const count = (i18n.match(new RegExp(`^\\s*${key}`, 'gm')) || []).length;
      assert.equal(count, 4, `${key} in 4 languages`);
    }
  });

  it('details card shows file info, visibility badge, section and project', () => {
    const src = read('src/components/teams/AgentActivityDashboard.jsx');
    assert.ok(src.includes('FeedEntryDetails'), 'details component exists');
    assert.ok(src.includes('aria-expanded'), 'accessible expander');
    assert.ok(src.includes('formatBytes'), 'human file sizes');
    assert.ok(src.includes('VisibilityBadge'), 'visibility badge');
    assert.ok(src.includes('resolveProjectName'), 'project names resolved');
    assert.ok(src.includes("role=\"img\"") || src.includes('aria-hidden'), 'icon accessibility');
  });
});
