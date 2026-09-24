// Contract tests for the SMS notification opt-in:
//   - preference column defaults to false (no silent opt-in)
//   - dispatcher SKIPS sms when the flag is off, QUEUES when on
//   - in-app reminders, frequencies and the canonical SMS migration untouched
//   - RLS unchanged (owner-manage covers the new column, no new policies)
// Run with: node --test src/lib/smsPreferences.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { APP_NAME, APP_VERSION, APP_VERSION_LABEL } from './appInfo.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');

const NEW_MIGRATION = 'supabase/migrations/20261004120000_user_sms_notification_preferences.sql';
const CANONICAL_SMS_MIGRATION = 'supabase/migrations/20261001120000_event_reminders_sms.sql';

describe('sms preference storage', () => {
  it('adds an opt-in boolean defaulting to false (never silently opted in)', () => {
    const sql = read(NEW_MIGRATION);
    assert.match(sql, /add column if not exists sms_notifications_enabled boolean/i);
    assert.match(sql, /set default false/i);
    assert.match(sql, /set not null/i);
    // Existing rows keep current behavior (false).
    assert.match(sql, /sms_notifications_enabled = false/);
  });

  it('creates no duplicate preference system and changes no RLS', () => {
    const sql = read(NEW_MIGRATION);
    assert.ok(!/create table/i.test(sql), 'must reuse profiles, not a new table');
    assert.ok(!/create policy/i.test(sql), 'owner-manage already covers the column');
    assert.ok(!/drop policy/i.test(sql));
    assert.ok(!/revoke/i.test(sql.replace(/revoke all on function public\.run_reminder_sms_dispatcher\(\) from public;/i, '')));
  });
});

describe('dispatcher respects the preference', () => {
  it('skips sms delivery when the flag is off, queues when on', () => {
    const sql = read(NEW_MIGRATION);
    assert.match(sql, /create or replace function public\.run_reminder_sms_dispatcher\(\)/);
    assert.match(sql, /sms_notifications_enabled/);
    assert.match(sql, /v_sms_on is not true/);
    // Off (or null) => skipped ledger row, exactly like missing phone.
    assert.match(sql, /'skipped'\)/);
    // On => queued as before.
    assert.match(sql, /'queued'\)/);
  });

  it('preserves scheduling, frequencies, service-role-only execution', () => {
    const sql = read(NEW_MIGRATION);
    assert.match(sql, /reminder_frequency <> 'disabled'/);
    assert.match(sql, /grant execute on function public\.run_reminder_sms_dispatcher\(\) to service_role/);
    assert.match(sql, /security definer/);
    assert.match(sql, /set search_path = ''/);
  });

  it('does not touch in-app reminders or audit history', () => {
    const sql = read(NEW_MIGRATION);
    const code = sql
      .split('\n')
      .map((line) => line.replace(/--.*$/, ''))
      .join('\n');
    assert.ok(!/truncate/i.test(code));
    assert.ok(!/sync_event_reminder_due/i.test(code));
    const fnBody = code.slice(code.indexOf('as $$'));
    assert.ok(!/write_audit_log/i.test(fnBody));
  });
});

describe('canonical TextBee migration untouched', () => {
  it('contains no sms preference logic', () => {
    const sql = read(CANONICAL_SMS_MIGRATION);
    assert.ok(!/sms_notifications_enabled/i.test(sql));
  });
});

describe('about version source', () => {
  it('displays v0.1 from a single source', () => {
    assert.equal(APP_NAME, 'Geometra');
    assert.equal(APP_VERSION, '0.1');
    assert.equal(APP_VERSION_LABEL, 'v0.1');
  });
});
