// Messages contact search contracts:
//   - server-side ilike filter across the 5 messaging fields (escaped)
//   - display-name fallback, minimal field set (no phone/secrets/role ids)
//   - super-admin discovery allowed by existing RLS (no new policy, no bypass)
//   - message send enters the central notification (= push) pipeline
// Run with: node --test src/lib/messageContacts.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  buildContactSearchOrFilter,
  escapeIlikePattern,
  getContactDisplayName,
  normalizeContactProfile,
  CONTACT_SEARCH_LIMIT,
} from './contactSearch.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');

describe('server-side contact filter', () => {
  it('searches name, email, title, department and role case-insensitively', () => {
    const f = buildContactSearchOrFilter('John');
    assert.ok(f, 'filter built');
    for (const field of ['full_name', 'email', 'job_title', 'department', 'role']) {
      assert.ok(f.includes(`${field}.ilike.%John%`), field);
    }
  });

  it('escapes ilike wildcards so input matches literally', () => {
    assert.equal(escapeIlikePattern('100%_x\\y'), '100\\%\\_x\\\\y');
    const f = buildContactSearchOrFilter('a%b_c');
    assert.ok(f.includes('a\\%b\\_c'), 'escaped inside pattern');
  });

  it('returns null for empty input (no unfiltered dump)', () => {
    assert.equal(buildContactSearchOrFilter(''), null);
    assert.equal(buildContactSearchOrFilter('   '), null);
    assert.equal(buildContactSearchOrFilter(null), null);
  });

  it('caps result volume', () => {
    assert.ok(CONTACT_SEARCH_LIMIT >= 20 && CONTACT_SEARCH_LIMIT <= 50);
  });
});

describe('contact display data', () => {
  it('prefers full_name, falls back to email, never translates user data', () => {
    assert.equal(getContactDisplayName({ full_name: 'John Doe', email: 'j@x.com' }), 'John Doe');
    assert.equal(getContactDisplayName({ full_name: '  ', email: 'j@x.com' }), 'j@x.com');
    assert.equal(getContactDisplayName({ full_name: null, email: null }), 'Unknown');
  });

  it('exposes only messaging UI fields', () => {
    const out = normalizeContactProfile({
      id: '1', full_name: 'N', email: 'e', avatar_url: 'a', job_title: 'j',
      department: 'd', role: 'admin', status: 'active',
      phone: 'P', phone_number: 'P2', role_id: 'R',
      sms_notifications_enabled: true, push_notifications_enabled: true,
    });
    assert.deepEqual(Object.keys(out).sort(), [
      'avatar_url', 'department', 'email', 'full_name', 'id', 'job_title', 'role', 'status',
    ]);
  });
});

describe('super-admin discovery without RLS bypass', () => {
  it('existing policies already allow super-admin full select (no new policy)', () => {
    const rls = read('supabase/migrations/20260726000006_fix_projects_profiles_rls.sql');
    const code = rls
      .split('\n')
      .map((line) => line.replace(/--.*$/, ''))
      .join('\n');
    assert.ok(rls.includes('"Profiles super admin manage"'), 'super admin manage exists');
    assert.ok(rls.includes('ON public.profiles FOR ALL'), 'covers select');
    assert.ok(!/USING\s*\(\s*true\s*\)/i.test(code), 'no unrestricted access');
  });

  it('combobox searches profiles directly with self excluded and active only', () => {
    const hook = read('src/hooks/useProfileContactSearch.js');
    assert.ok(hook.includes("from('profiles')"), 'canonical source');
    assert.ok(hook.includes(".eq('status', 'active')"), 'active only');
    assert.ok(hook.includes(".neq('id', currentUserId)"), 'self excluded');
    assert.ok(hook.includes('CONTACT_SEARCH_LIMIT'), 'result limit');
    assert.ok(!hook.includes("select('id, email"), 'no legacy wide select');
    const combo = read('src/components/teams/ContactCombobox.jsx');
    assert.ok(combo.includes('scopeAll'), 'super-admin scope supported');
    const page = read('src/pages/MessagesPage.jsx');
    assert.ok(page.includes('scopeAll={isSuperAdmin}'), 'wired to super-admin state');
  });

  it('selected fields exclude phone numbers, settings and role ids', async () => {
    const lib = await import('./contactSearch.js');
    assert.ok(!lib.CONTACT_SELECT_FIELDS.includes('phone'), 'no phone');
    assert.ok(!lib.CONTACT_SELECT_FIELDS.includes('role_id'), 'no role ids');
    assert.ok(!lib.CONTACT_SELECT_FIELDS.includes('sms_notifications_enabled'), 'no sms flag');
    assert.ok(!lib.CONTACT_SELECT_FIELDS.includes('push_notifications_enabled'), 'no push flag');
    for (const f of ['id', 'full_name', 'email', 'avatar_url', 'job_title', 'department', 'role', 'status']) {
      assert.ok(lib.CONTACT_SELECT_FIELDS.includes(f), `selects ${f}`);
    }
  });

  it('role label falls back to the joined roles entry', async () => {
    const lib = await import('./contactSearch.js');
    assert.equal(lib.normalizeContactProfile({ id: '1', role: '', roles: { name: 'manager' } }).role, 'manager');
    assert.equal(lib.normalizeContactProfile({ id: '1', role: 'admin', roles: { name: 'manager' } }).role, 'admin');
  });

  it('conversation RLS stays participant-scoped', () => {
    const rls = read('supabase/migrations/20260726000003_messages_notifications_rls.sql');
    assert.ok(/sender_id|receiver_id/.test(rls), 'participant scoping present');
  });
});

describe('message notifications enter the push pipeline', () => {
  it('sending a message creates a recipient notification row', () => {
    const page = read('src/pages/MessagesPage.jsx');
    assert.ok(page.includes("from('notifications').insert"), 'notification created');
    assert.ok(page.includes("type: 'message'"), 'message type set');
  });
});
