// Regression test for the Recurring tab crash:
//   ReferenceError: Textarea is not defined
// Every budget component rendering <Textarea> must import it from the
// canonical @/components/ui/textarea (named export). Static check so the
// crash can never silently return.
// Run with: node --test src/lib/recurringTextarea.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');

const BUDGET_COMPONENTS = [
  'src/components/budget/BudgetManager.jsx',
  'src/components/budget/BudgetSection.jsx',
  'src/components/budget/BudgetOverview.jsx',
  'src/components/budget/CategoryManager.jsx',
  'src/components/budget/ExpenseManager.jsx',
  'src/components/budget/RecurringManager.jsx',
  'src/components/budget/RefundManager.jsx',
  'src/components/budget/RulesManager.jsx',
  'src/components/budget/ReportsPanel.jsx',
];

const CANONICAL_IMPORT = "from '@/components/ui/textarea'";

describe('recurring crash regression', () => {
  it('canonical textarea exists with a named export', () => {
    const src = read('src/components/ui/textarea.jsx');
    assert.ok(src.includes('export { Textarea }'), 'named export present');
  });

  it('every budget component using <Textarea> imports it', () => {
    for (const file of BUDGET_COMPONENTS) {
      const src = read(file);
      if (!/<Textarea[\s>]/.test(src)) continue;
      assert.ok(
        src.includes(CANONICAL_IMPORT),
        `${file} renders <Textarea> but does not import it`
      );
    }
  });

  it('RecurringManager (Finance > Budget > Recurring) specifically resolves Textarea', () => {
    const src = read('src/components/budget/RecurringManager.jsx');
    assert.ok(src.includes("import { Textarea } from '@/components/ui/textarea'"), 'exact canonical import');
    assert.ok(src.includes('<Textarea'), 'notes field preserved');
    assert.ok(!src.includes('Textarea is not defined'), 'sanity');
  });

  it('common primitives used across budget components are all imported', () => {
    const PRIMITIVES = ['Button', 'Input', 'Label', 'Dialog', 'Badge'];
    for (const file of BUDGET_COMPONENTS) {
      const src = read(file);
      for (const name of PRIMITIVES) {
        if (!new RegExp(`<${name}[\\s>]`).test(src)) continue;
        assert.ok(
          new RegExp(`import\\s*\\{[^}]*\\b${name}\\b`).test(src),
          `${file} renders <${name}> without importing it`
        );
      }
    }
  });
});
