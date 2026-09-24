// Global push audit matrix as executable contracts.
// Every row: producer -> notification row -> central trigger -> send-push.
//   - direct producers insert notification rows (trigger fans out to push)
//   - audience shares + request decisions fan out via dedicated triggers
//   - preference gates ONLY push; failures are isolated; no secrets leak
// Run with: node --test src/lib/pushAudit.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');
const codeOf = (sql) => sql.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');

const FANOUT = 'supabase/migrations/20261007120000_notification_fanout_audience_decisions.sql';

describe('producer matrix: notification created for every legitimate recipient', () => {
  it('message send notifies the recipient', () => {
    const page = read('src/pages/MessagesPage.jsx');
    assert.ok(page.includes("from('notifications').insert"), 'insert present');
    assert.ok(page.includes("type: 'message'"), 'message type');
    assert.ok(page.includes('/messages?user='), 'conversation deep link');
  });

  it('project request creation notifies super admins', () => {
    const fn = read('supabase/functions/projects-creation/index.ts');
    assert.ok(fn.includes("from('notifications')"), 'insert present');
    assert.ok(fn.includes("type: 'project_request'"), 'request type');
  });

  it('request verify/approve/reject notifies the requester via trigger', () => {
    const sql = codeOf(read(FANOUT));
    assert.ok(sql.includes('trg_notify_request_decision'), 'decision trigger attached');
    assert.ok(sql.includes('after update of status on public.project_requests'), 'status-driven');
    assert.ok(sql.includes('is not distinct from'), 'fires on real change');
    assert.ok(sql.includes("clients c") && sql.includes('profile_id'), 'requester resolved via clients');
    assert.ok(sql.includes('/requests'), 'request deep link');
    // The review function itself stays free of notification writes;
    // the trigger is the single fan-out point (no dual dispatch).
    const review = read('supabase/functions/review-project-request/index.ts');
    assert.ok(!/from\('notifications'\)/.test(review), 'no parallel dispatch in review fn');
  });

  it('event audience shares notify the added member via trigger', () => {
    const sql = codeOf(read(FANOUT));
    assert.ok(sql.includes('trg_notify_event_audience'), 'audience trigger attached');
    assert.ok(sql.includes('after insert on public.event_audience'), 'insert-driven');
    assert.ok(sql.includes('/calendar'), 'calendar deep link');
    const rpcMigration = read('supabase/migrations/20260917000000_events_visibility.sql');
    assert.ok(rpcMigration.includes('create_event_with_audience'), 'RPC writes audience rows');
  });

  it('document audience shares notify the added member via trigger', () => {
    const sql = codeOf(read(FANOUT));
    assert.ok(sql.includes('trg_notify_document_audience'), 'audience trigger attached');
    assert.ok(sql.includes('after insert on public.document_audience'), 'insert-driven');
    assert.ok(sql.includes('/documents'), 'document deep link');
  });

  it('event reminders of every frequency reach notifications', () => {
    const engine = codeOf(read('supabase/migrations/20261006120000_universal_push_event_reminders.sql'));
    assert.ok(engine.includes('event_reminder_v2:'), 'unified reminder emission');
  });
});

describe('delivery guarantees', () => {
  it('fan-out never rolls back the business operation', () => {
    const sql = codeOf(read(FANOUT));
    assert.equal((sql.match(/exception when others/g) || []).length, 3, 'all three functions isolated');
    assert.ok(sql.includes('raise log'), 'failures diagnosed server-side');
  });

  it('no duplicate pushes: uniqueness + change-guarded triggers', () => {
    const sql = codeOf(read(FANOUT));
    assert.ok(sql.includes('is not distinct from'), 'decision fires once per transition');
    // Audience tables carry (entity, user) uniqueness (see base migrations),
    // so one share inserts exactly one audience row -> one notification.
    const docs = read('supabase/migrations/20260917000004_documents_visibility_timeline.sql');
    assert.ok(docs.includes('document_audience_unique'), 'document share uniqueness');
    const events = read('supabase/migrations/20260917000000_events_visibility.sql');
    assert.ok(events.includes('primary key (event_id, user_id)'), 'event share uniqueness');
  });

  it('self-notifications and null recipients are skipped', () => {
    const sql = codeOf(read(FANOUT));
    assert.ok(sql.includes('new.user_id = v_owner'), 'owner self-skip');
    assert.ok(sql.includes('v_profile_id is null'), 'missing requester skip');
  });

  it('preference gates only push; SMS stays independent', () => {
    const fn = read('supabase/functions/send-push/index.ts');
    assert.ok(fn.includes('push_notifications_enabled'), 'push flag checked');
    assert.ok(!fn.includes('sms_notifications_enabled'), 'no SMS coupling');
  });

  it('fan-out changes no RLS and leaks no secrets', () => {
    const sql = codeOf(read(FANOUT));
    assert.ok(!/create policy|drop policy/i.test(sql), 'RLS untouched');
    assert.ok(!/eyJ[A-Za-z0-9_-]{20,}/.test(sql), 'no embedded tokens');
    assert.ok(sql.includes('security definer'), 'trigger functions secured');
    assert.ok(sql.includes("set search_path = ''"), 'search_path protected');
  });

  it('canonical SMS migration untouched', () => {
    const sms = read('supabase/migrations/20261001120000_event_reminders_sms.sql');
    assert.ok(!/notify_event_audience|notify_document_audience|notify_request_decision/i.test(sms));
  });
});
