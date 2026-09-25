// Agent Activity standalone screen contracts: additive route/nav/page,
// manager+admin gating, leads-read RLS without weakening owner rules.
// Run with: node --test src/lib/agentActivityScreen.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');
const codeOf = (sql) => sql.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');

describe('standalone screen wiring', () => {
  it('has no duplicate sidebar entry or route; Teams sub-tab is canonical', () => {
    const app = read('App.jsx');
    assert.ok(!app.includes('pages/AgentActivity'), 'no dead page import');
    assert.ok(!app.includes('path="/activity"'), 'no dead route');
    assert.ok(app.includes('path="/teams"'), 'teams route kept');
    const nav = read('src/components/layout/Sidebar.jsx');
    assert.ok(!nav.includes("path: '/activity'"), 'no sidebar duplicate');
    assert.ok(!nav.includes('requiresManager'), 'no orphan gate flag');
    assert.ok(nav.includes("path: '/teams'"), 'teams nav kept');
  });

  it('page file is gone and the Teams sub-tab is preserved', () => {
    assert.ok(!existsSync(path.join(root, 'src', 'pages', 'AgentActivity.jsx')), 'dead page removed');
    const teams = read('src/pages/Teams.jsx');
    assert.ok(teams.includes('AgentActivityDashboard'), 'sub-tab intact');
    assert.ok(teams.includes('TeamMemberCard'), 'member UI intact');
  });
});

describe('leads-read RLS stays least-privilege', () => {
  it('adds SELECT-only policies without weakening owner rules', () => {
    const sql = codeOf(read('supabase/migrations/20261014120000_agent_activity_leads_read.sql'));
    assert.ok(sql.includes('Leads can read agent sessions'), 'sessions read policy');
    assert.ok(sql.includes('Leads can read agent action logs'), 'actions read policy');
    assert.ok(sql.includes('for select'), 'select-only');
    assert.ok(sql.includes("r.name = 'manager'"), 'manager role included');
    assert.ok(sql.includes('is_admin()'), 'admins included');
    assert.ok(!/for all|for insert|for update|for delete/i.test(sql), 'no mutation grants');
    assert.ok(!/drop policy if exists "Users manage own/i.test(sql), 'owner policies kept');
    assert.ok(!/using \(true\)|with check \(true\)/i.test(sql), 'no open access');
  });
});

describe('screen i18n', () => {
  it('nav + gate strings exist in all four languages without mojibake', () => {
    const i18n = read('src/i18n.js');
    for (const key of ['activityDashboard:', 'activityRestricted:']) {
      const matches = (i18n.match(new RegExp(`^\\s*${key}`, 'gm')) || []).length;
      assert.equal(matches, 4, `${key} in 4 languages`);
    }
    const lines = i18n.split('\n').filter((l) => /activityDashboard:|activityRestricted:/.test(l)).join('\n');
    const mojibake = new RegExp('[' + String.fromCharCode(0xc3, 0xd8, 0xd9, 0xfffd) + ']');
    assert.ok(!mojibake.test(lines), 'no mojibake in new strings');
  });
});
