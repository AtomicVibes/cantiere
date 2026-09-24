// Contract tests for audit-log administration silence.
// Verifies at the source (SQL trigger function + frontend paths) that
// selecting/archiving/deleting audit logs creates no audit entries,
// while the canonical audit writer and per-entity triggers stay intact.
// Run with: node --test src/lib/auditSelfAudit.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');

const NEW_MIGRATION = 'supabase/migrations/20261003120000_audit_logs_admin_no_self_audit.sql';

describe('audit-log administration creates no audit entries', () => {
  it('the self-audit trigger function writes nothing on UPDATE or DELETE', () => {
    const sql = read(NEW_MIGRATION);
    assert.match(sql, /create or replace function public\.log_audit_log_changes\(\)/);
    assert.match(sql, /security definer/);
    assert.match(sql, /set search_path = ''/);
    // Scope to the function body only (comments describe what is NOT done).
    const fnBody = sql.slice(
      sql.indexOf('as $$'),
      sql.indexOf('$$;', sql.indexOf('as $$'))
    );
    assert.ok(!/write_audit_log/i.test(fnBody), 'must not call the canonical writer');
    assert.ok(!/insert into/i.test(fnBody), 'must not insert audit rows');
    assert.ok(!/AUDIT_LOG_DELETE/i.test(fnBody), 'AUDIT_LOG_DELETE self-audit must be gone');
    assert.match(fnBody, /return null/);
  });

  it('the trigger hook itself is preserved (not dropped)', () => {
    const sql = read(NEW_MIGRATION);
    assert.match(sql, /create trigger trg_audit_audit_log_changes/);
    assert.match(sql, /after update of archived or delete on public\.audit_logs/);
  });

  it('no history is destroyed and no auth model changes', () => {
    const sql = read(NEW_MIGRATION);
    // Strip SQL line comments so prose ("not truncated", ...) cannot trip the check.
    const code = sql
      .split('\n')
      .map((line) => line.replace(/--.*$/, ''))
      .join('\n');
    for (const forbidden of [/truncate/i, /drop table/i, /delete from/i, /create policy/i, /drop policy/i, /revoke/i, /\bgrant\b/i]) {
      assert.ok(!forbidden.test(code), `must not contain ${forbidden}`);
    }
  });

  it('frontend audit-log admin paths call no audit writer', () => {
    const logs = read('src/pages/Logs.jsx');
    assert.ok(!/write_audit_log/i.test(logs), 'Logs.jsx must not write audit entries');
  });

  it('per-entity audit triggers and the canonical writer are untouched', () => {
    const sql = read(NEW_MIGRATION);
    assert.ok(!/trg_audit_events/i.test(sql));
    assert.ok(!/trg_audit_projects/i.test(sql));
    assert.ok(!/create or replace function public\.write_audit_log/i.test(sql));
    // The reminder engine and events table are not referenced/modified.
    assert.ok(!/sync_event_reminder_due/i.test(sql));
    assert.ok(!/events_reminder/i.test(sql));
    assert.ok(!/alter table/i.test(sql));
  });
});
