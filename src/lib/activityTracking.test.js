// Agent activity tracking contracts: additive schema, session lifecycle
// constants, fire-and-forget telemetry that never blocks UI.
// Run with: node --test src/lib/activityTracking.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');
const codeOf = (sql) => sql.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');

describe('heartbeat contract', () => {
  it('ticks every 30 seconds and gates on page visibility', () => {
    const src = read('src/lib/activityTracking.js');
    assert.ok(src.includes('HEARTBEAT_INTERVAL_MS = 30_000'), '30s interval constant');
    assert.ok(src.includes('visibilityState'), 'Page Visibility API gate');
    assert.ok(src.includes('visibilitychange'), 'resumes on visible');
    assert.ok(src.includes('beforeunload'), 'best-effort close');
  });

  it('telemetry never throws and never blocks callers', () => {
    const src = read('src/lib/activityTracking.js');
    assert.ok(src.includes('if (!action || !trackedUserId) return;'), 'no-op without session');
    const logBody = src.slice(src.indexOf('export function logAction'));
    assert.ok(!logBody.includes('await supabase'), 'logAction is not awaited');
    const beatBody = src.slice(src.indexOf('function sendHeartbeat'), src.indexOf('export function startHeartbeat'));
    assert.ok(!beatBody.includes('await supabase'), 'heartbeat is not awaited');
  });
});

describe('additive migration safety', () => {
  it('creates session + action tables without touching existing schema', () => {
    const sql = codeOf(read('supabase/migrations/20261013120000_agent_activity_tracking.sql'));
    assert.ok(sql.includes('create table if not exists public.agent_sessions'), 'sessions table');
    assert.ok(sql.includes('create table if not exists public.agent_action_logs'), 'actions table');
    assert.ok(sql.includes('on delete cascade'), 'cascade deletes');
    assert.ok(sql.includes('auth.uid() = user_id'), 'owner RLS');
    assert.ok(sql.includes('to service_role'), 'service-role read');
    assert.ok(sql.includes('from anon'), 'anon revoked');
    assert.ok(!/drop table|truncate|alter table public\.(profiles|notifications)/i.test(sql), 'no destructive ops');
  });

  it('type definitions cover the new tables', () => {
    const types = read('src/lib/database.types.ts');
    assert.ok(types.includes('agent_sessions:'), 'sessions typed');
    assert.ok(types.includes('agent_action_logs:'), 'actions typed');
  });
});

describe('non-breaking wiring', () => {
  it('App mounts a null-component tracker beside existing providers', () => {
    const app = read('App.jsx');
    assert.ok(app.includes('<ActivityTracker />'), 'mounted');
    assert.ok(app.includes('return null;'), 'no UI output');
    assert.ok(app.includes('<PushSubscriptionRelay />'), 'push relay untouched');
  });

  it('action call sites are single fire-and-forget lines', () => {
    assert.ok(read('src/pages/ProjectDetail.jsx').includes("logAction('project_view'"), 'project view');
    assert.ok(read('src/pages/Documents.jsx').includes("logAction('document_view'"), 'document view');
    assert.ok(read('src/components/invoices/InvoiceFormDialog.jsx').includes("logAction('invoice_check'"), 'invoice check');
  });

  it('adds no dependencies and no secrets', () => {
    const pkg = JSON.parse(read('package.json'));
    assert.ok(!pkg.dependencies['@microsoft/teams-js'], 'no Teams SDK');
    const src = read('src/lib/activityTracking.js');
    assert.ok(!/service_role|service-role|api[_-]?key|secret|token/i.test(src), 'no secrets');
  });
});
