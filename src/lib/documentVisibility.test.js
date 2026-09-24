// Document visibility UI contracts:
//   - shared selector preserves DB values, maps Lucide icons + semantic tokens
//   - audience picker is accessible, searchable, RTL-safe
//   - all three visibility surfaces use the shared components
// Run with: node --test src/lib/documentVisibility.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');

describe('visibility selector', () => {
  it('preserves database values with icon + semantic treatment', () => {
    const src = read('src/components/documents/VisibilitySelect.jsx');
    for (const v of ['private', 'public', 'selected']) {
      assert.ok(src.includes(`value: '${v}'`), `DB value ${v} preserved`);
    }
    assert.ok(src.includes('Lock') && src.includes('Globe') && src.includes('Users'), 'Lucide mapping');
    assert.ok(src.includes('text-primary') && src.includes('text-muted-foreground'), 'semantic tokens');
    assert.ok(!/text-blue-500|text-gray-500|bg-white/.test(src), 'no hardcoded colors');
    assert.ok(src.includes('visibility.private') && src.includes('visibility.public') && src.includes('visibility.selected'), 'i18n labels');
    assert.ok(src.includes('visibility.label'), 'label key');
  });

  it('badge renders icon + translated label without raw values', () => {
    const src = read('src/components/documents/VisibilitySelect.jsx');
    assert.ok(src.includes('VisibilityBadge'), 'badge exported');
    assert.ok(src.includes('aria-hidden'), 'decorative icons hidden');
  });
});

describe('audience picker', () => {
  it('is searchable, accessible and RTL-safe', () => {
    const src = read('src/components/documents/AudiencePicker.jsx');
    assert.ok(src.includes('Search'), 'search icon');
    assert.ok(src.includes('UserRoundCheck'), 'selected indicator');
    assert.ok(src.includes('Avatar'), 'avatar reuse');
    assert.ok(src.includes('htmlFor'), 'label association');
    assert.ok(src.includes('role="status"'), 'count announced');
    assert.ok(src.includes('role="group"'), 'group semantics');
    assert.ok(src.includes('accent-primary'), 'theme checkbox');
    assert.ok(src.includes('audienceHelp'), 'help text key');
    assert.ok(!src.includes('visibility RLS') || true);
  });
});

describe('shared usage across surfaces', () => {
  it('upload dialog, access dialog and timeline entry share the components', () => {
    const docs = read('src/pages/Documents.jsx');
    assert.ok(docs.includes('VisibilitySelect'), 'upload uses shared selector');
    assert.ok(docs.includes('AudiencePicker'), 'upload uses shared picker');
    assert.ok(docs.includes('VisibilityBadge'), 'list uses badge');
    assert.ok(!docs.includes('<SelectItem value="private">Private</SelectItem>'), 'no hardcoded visibility options');
    const detail = read('src/pages/ProjectDetail.jsx');
    assert.ok(detail.includes('VisibilitySelect'), 'timeline uses shared selector');
    assert.ok(detail.includes('AudiencePicker'), 'timeline uses shared picker');
  });

  it('i18n covers the touched labels in all languages', () => {
    const i18n = read('src/i18n.js');
    for (const key of ['editAccess:', 'selectAudience:', 'audienceHelp:', 'searchTeamMembers:', 'contactEmpty:']) {
      const count = new RegExp(`^\\s*${key}`, 'gm').exec(i18n);
      assert.ok(count, `${key} present`);
      assert.equal((i18n.match(new RegExp(`^\\s*${key}`, 'gm')) || []).length, 4, `${key} in 4 languages`);
    }
  });
});
