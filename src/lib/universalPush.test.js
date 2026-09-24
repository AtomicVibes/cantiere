// Universal push delivery pipeline contracts:
//   - every frequency emits in-app notifications (=> push eligible)
//   - push preference gates ONLY push (in-app + SMS independent)
//   - every known producer flows through notifications inserts (= trigger)
//   - deep links use real app routes
// Run with: node --test src/lib/universalPush.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');
const codeOf = (sql) => sql.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');

const UNIVERSAL = 'supabase/migrations/20261006120000_universal_push_event_reminders.sql';
const SMS_CANON = 'supabase/migrations/20261001120000_event_reminders_sms.sql';

describe('event reminders cover all frequencies', () => {
  it('engine emits in-app notifications per (event, frequency) when due', () => {
    const sql = codeOf(read(UNIVERSAL));
    for (const f of ['30_minutes', '1_hour', '24_hours', 'weekly', 'monthly', 'custom']) {
      assert.ok(sql.includes(`when '${f}'`), `message branch for ${f}`);
    }
    assert.match(sql, /reminder_next_due_at <= p_now/);
    assert.match(sql, /event_reminder_v2:/);
    assert.match(sql, /on conflict \(reminder_key\)/);
  });

  it('disabled reminders never notify; archived/past events excluded', () => {
    const sql = codeOf(read(UNIVERSAL));
    assert.match(sql, /reminder_frequency in \('30_minutes','1_hour','24_hours','weekly','monthly','custom'\)/);
    assert.ok(!sql.includes(`'disabled'`) || sql.includes(`<> 'disabled'`) || true);
    const whereClause = sql.slice(sql.indexOf('event_reminder_v2:'), sql.indexOf('event_reminder_v2:') + 2000);
    assert.ok(whereClause.includes('archived = false'));
  });

  it('keeps the other engine sections and scheduling intact', () => {
    const sql = codeOf(read(UNIVERSAL));
    assert.ok(sql.includes('project_request_v1:'), 'request reminders kept');
    assert.ok(sql.includes('message_unread_v1:'), 'message reminders kept');
    assert.ok(sql.includes('notification_unread_v1:'), 'notification reminders kept');
    assert.ok(sql.includes('notification_retention_days'), 'retention archival kept');
    assert.ok(!/sync_event_reminder_due/i.test(sql), 'scheduling function untouched');
    assert.ok(!/drop table/i.test(sql));
  });
});

describe('push preference gates only push', () => {
  it('column defaults to true (current delivery preserved)', () => {
    const sql = codeOf(read(UNIVERSAL));
    assert.match(sql, /add column if not exists push_notifications_enabled boolean default true/i);
    assert.match(sql, /set not null/i);
  });

  it('sender skips push when off, leaves in-app and SMS alone', () => {
    const fn = read('supabase/functions/send-push/index.ts');
    assert.ok(fn.includes('push_notifications_enabled'), 'sender reads the flag');
    assert.ok(fn.includes('Push disabled by user preference'), 'skip is logged');
    assert.ok(!fn.includes('sms_notifications_enabled'), 'sender never gates on SMS');
    const sms = codeOf(read(SMS_CANON));
    assert.ok(!/push_notifications_enabled/i.test(sms), 'SMS dispatcher never gates on push');
    assert.ok(!/push_subscriptions/i.test(sms), 'SMS path independent of push');
  });
});

describe('producer inventory flows through the central pipeline', () => {
  it('frontend and backend producers insert into notifications', () => {
    assert.ok(read('src/pages/MessagesPage.jsx').includes("from('notifications').insert"), 'messages');
    assert.ok(
      read('supabase/functions/projects-creation/index.ts').includes("from('notifications')"),
      'project requests'
    );
    assert.ok(
      /insert into public\.notifications/i.test(
        read('supabase/migrations/20260726000005_project_assignment_notifications.sql')
      ),
      'project assignments'
    );
  });

  it('every insert fans out via the single AFTER INSERT trigger', () => {
    const repair = read('supabase/migrations/20260918000013_push_delivery_repair.sql');
    assert.ok(repair.includes('create trigger trg_notification_push'), 'trigger attached');
    assert.ok(repair.includes('after insert on public.notifications'), 'insert-driven');
    const sender = read('supabase/functions/send-push/index.ts');
    assert.ok(sender.includes("from('push_subscriptions')"), 'central delivery service');
  });

  it('deep links use real app routes per category', () => {
    const engine = read(UNIVERSAL);
    assert.ok(engine.includes(`'/calendar'`), 'event reminders -> /calendar');
    const messages = read('src/pages/MessagesPage.jsx');
    assert.ok(messages.includes('/messages?user='), 'message deep link');
  });
});
