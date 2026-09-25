// Budget categories: icon registry, construction library, custom flow,
// translation integrity (no mojibake), EUR default preserved.
// Run with: node --test src/lib/budgetCategories.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  BUDGET_CATEGORY_ICON_IDS,
  getBudgetCategoryIcon,
  isKnownCategoryIcon,
  DEFAULT_CATEGORY_ICON,
} from './budgetCategoryIcons.js';
import { PREDEFINED_SUBCATEGORIES } from './constructionSubcategories.js';
import { DEFAULT_CURRENCY } from './budgetMath.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');
const codeOf = (sql) => sql.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');

describe('central icon registry', () => {
  it('resolves every id and falls back safely', () => {
    assert.ok(BUDGET_CATEGORY_ICON_IDS.length > 40, 'usable pool size');
    for (const id of BUDGET_CATEGORY_ICON_IDS) {
      assert.ok(isKnownCategoryIcon(id), id);
      assert.equal(typeof getBudgetCategoryIcon(id), 'object', id);
    }
    assert.equal(getBudgetCategoryIcon('nope'), getBudgetCategoryIcon(DEFAULT_CATEGORY_ICON));
    assert.ok(!/\.svg|<svg|component/i.test(read('src/lib/budgetCategoryIcons.js').split('import')[1] || ''), 'no markup stored');
  });

  it('is the single mapping used by all consumers', () => {
    for (const f of [
      'src/components/budget/CategoryIconPicker.jsx',
      'src/components/budget/SubcategorySelect.jsx',
      'src/components/budget/CategoryManager.jsx',
      'src/components/budget/ExpenseManager.jsx',
    ]) {
      assert.ok(read(f).includes('getBudgetCategoryIcon'), `${f} uses the registry`);
    }
  });
});

describe('construction library integrity', () => {
  it('every entry has a unique key, a parent and a known icon', () => {
    const keys = new Set();
    for (const s of PREDEFINED_SUBCATEGORIES) {
      assert.ok(s.key && s.parent && s.icon, JSON.stringify(s));
      assert.ok(!keys.has(s.key), `duplicate key ${s.key}`);
      keys.add(s.key);
      assert.ok(isKnownCategoryIcon(s.icon), `unknown icon ${s.icon} for ${s.key}`);
    }
    assert.ok(keys.size >= 80, 'library depth');
  });

  it('seed SQL covers every library key with stable identity', () => {
    const mig = read('supabase/migrations/20261012120000_budget_subcategory_library.sql');
    for (const s of PREDEFINED_SUBCATEGORIES) {
      assert.ok(mig.includes(`'${s.key}'`), `seeded ${s.key}`);
    }
    assert.ok(mig.includes('is not distinct from') === false, 'no-op sanity');
  });
});

describe('localized labels without mojibake', () => {
  it('every predefined key has 4 localized labels, all clean UTF-8', () => {
    const i18n = read('src/i18n.js');
    for (const s of PREDEFINED_SUBCATEGORIES) {
      const matches = i18n.match(new RegExp(`['"]subcat_${s.key}['"]\\s*:`, 'g')) || [];
      assert.equal(matches.length, 4, `subcat_${s.key} in 4 languages`);
    }
    const subcatLines = i18n.split('\n').filter((l) => /subcat_/.test(l)).join('\n');
    // Mojibake markers U+00C3/U+00D8/U+00D9/U+FFFD never occur in correct
    // French/Italian/Arabic prose. (U+00E2 â is legitimate French and is
    // therefore NOT a marker.) Expressed via code points so this file
    // stays pure ASCII.
    const mojibake = new RegExp(
      '[' + String.fromCharCode(0xc3, 0xd8, 0xd9, 0xfffd) + ']'
    );
    assert.ok(!mojibake.test(subcatLines), 'no mojibake in subcategory labels');
  });

  it('custom names render verbatim (never translated)', () => {
    const src = read('src/components/budget/SubcategorySelect.jsx');
    assert.ok(src.includes('sub.subcategory_key'), 'predefined branch by key');
    assert.ok(src.includes('return sub.name'), 'custom verbatim branch');
  });

  it('fr/it category UI reads professionally', () => {
    const i18n = read('src/i18n.js');
    assert.ok(i18n.includes('Sous-catégorie'), 'fr subcategory term');
    assert.ok(i18n.includes('Sottocategoria'), 'it subcategory term');
    assert.ok(i18n.includes('Créer une sous-catégorie personnalisée'), 'fr custom flow');
    assert.ok(i18n.includes('Crea sottocategoria personalizzata'), 'it custom flow');
  });
});

describe('custom subcategory data model', () => {  it('migration adds stable identity without touching RLS or history', () => {
    const sql = codeOf(read('supabase/migrations/20261012120000_budget_subcategory_library.sql'));
    assert.ok(sql.includes('add column if not exists subcategory_key'), 'key column');
    assert.ok(sql.includes('add column if not exists is_custom'), 'custom flag');
    assert.ok(sql.includes('budget_categories_subkey_uidx'), 'key uniqueness');
    assert.ok(!/create policy|drop policy|alter table public.budget_categories enable/i.test(sql), 'RLS untouched');
    assert.ok(!/drop table|truncate|delete from/i.test(sql), 'no destruction');
  });

  it('creation persists name + parent + icon and selects the row', () => {
    const src = read('src/components/budget/SubcategorySelect.jsx');
    assert.ok(src.includes('is_custom: true'), 'custom flagged');
    assert.ok(src.includes('parent_category_id: customParent'), 'parent linked');
    assert.ok(src.includes('icon: customIcon'), 'icon persisted');
    assert.ok(src.includes('onChange(data?.id'), 'new row selected');
  });

  it('EUR default is preserved across the budget module', () => {
    assert.equal(DEFAULT_CURRENCY, 'EUR');
    const mig = codeOf(read('supabase/migrations/20261011120000_budget_currency_eur.sql'));
    assert.ok(mig.includes("set default 'EUR'"), 'DB default intact');
  });
});

describe('accordion category grouping', () => {
  it('groups children under parents in collapsible items, collapsed by default', () => {
    const src = read('src/components/budget/CategoryManager.jsx');
    assert.ok(src.includes('AccordionItem') && src.includes('AccordionTrigger') && src.includes('AccordionContent'), 'accordion parts');
    assert.ok(src.includes('type="multiple"'), 'multi-expand allowed');
    assert.ok(src.includes('useState([])') || src.includes('React.useState([])'), 'collapsed by default');
    assert.ok(src.includes('childrenOf(cat.id)'), 'parent grouping preserved');
    assert.ok(src.includes('stopPropagation') || src.includes('stop(e)'), 'row actions do not toggle');
  });

  it('CRUD, selection flows and schema stay intact', () => {
    const src = read('src/components/budget/CategoryManager.jsx');
    assert.ok(src.includes('openEdit') && src.includes('openCreate') && src.includes('handleArchive'), 'CRUD handlers kept');
    assert.ok(src.includes("from('budget_categories')"), 'same table, no new tables');
    const exp = read('src/components/budget/ExpenseManager.jsx');
    assert.ok(exp.includes('SubcategorySelect'), 'expense form untouched by refactor');
  });
});
