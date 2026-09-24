// Tests for the centralized user-friendly error handling:
// user sees a localized friendly message, developer sees technical detail.
// Run with: node --test src/lib/userErrors.test.js
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  getUserFriendlyMessage,
  isMissingTableError,
  isNetworkError,
  isPermissionError,
  isReminderConstraintError,
  logAppError,
} from './userErrors.js';

const t = (key, fallback) => fallback;

describe('error classification', () => {
  it('detects the reminder CHECK violation without exposing internals', () => {
    const err = {
      code: '23514',
      message: 'new row for relation "events" violates check constraint "events_reminder_frequency_check"',
    };
    assert.equal(isReminderConstraintError(err), true);
    const msg = getUserFriendlyMessage(err, t, 'errors.saveEvent');
    assert.ok(!msg.includes('23514'), 'no raw code to users');
    assert.ok(!msg.includes('violates'), 'no raw SQL to users');
    assert.ok(msg.toLowerCase().includes('reminder'), 'actionable hint kept');
  });

  it('maps permission errors to the permission message', () => {
    assert.equal(isPermissionError({ code: '42501', message: 'permission denied for table x' }), true);
    assert.equal(
      getUserFriendlyMessage({ message: 'permission denied' }, t),
      "You don't have permission to perform this action."
    );
  });

  it('maps network errors to the connectivity message', () => {
    assert.equal(isNetworkError({ message: 'Failed to fetch' }), true);
    assert.ok(
      getUserFriendlyMessage({ message: 'Failed to fetch' }, t).toLowerCase().includes('connect')
    );
  });

  it('detects missing-table / schema-cache backend failures', () => {
    const err = { code: 'PGRST205', message: "Could not find the table 'public.event_types' in the schema cache" };
    assert.equal(isMissingTableError(err), true);
    const msg = getUserFriendlyMessage(err, t);
    assert.ok(!msg.includes('schema cache'), 'no PostgREST internals to users');
    assert.ok(!msg.includes('PGRST'), 'no raw codes to users');
  });

  it('never surfaces WHERE-less delete internals to users', () => {
    const msg = getUserFriendlyMessage({ message: 'DELETE requires a WHERE clause' }, t, 'errors.deleteAuditLogs');
    assert.ok(!msg.includes('WHERE'), 'no raw SQL to users');
    assert.equal(msg, "We couldn't delete the selected logs. Please try again.");
  });

  it('falls back safely for unknown errors', () => {
    assert.equal(getUserFriendlyMessage({ message: 'weird' }, t), 'Something went wrong. Please try again.');
    assert.equal(getUserFriendlyMessage(null, t), 'Something went wrong. Please try again.');
  });
});

describe('logAppError', () => {
  let logged;
  let original;
  beforeEach(() => {
    logged = [];
    original = console.error;
    console.error = (...args) => logged.push(args);
  });
  afterEach(() => {
    console.error = original;
  });

  it('logs technical context for developers without sensitive data', () => {
    logAppError('AuditLogs', { code: '400', message: 'DELETE requires a WHERE clause', details: 'x', hint: 'y' }, { operation: 'delete', mode: 'all' });
    assert.equal(logged.length, 1);
    const [context, payload] = logged[0];
    assert.equal(context, '[AuditLogs]');
    assert.equal(payload.code, '400');
    assert.equal(payload.message, 'DELETE requires a WHERE clause');
    assert.equal(payload.operation, 'delete');
  });

  it('drops non-primitive extras (tokens, objects)', () => {
    logAppError('Ctx', { message: 'm' }, { token: 'secret-abc', nested: { a: 1 }, count: 3 });
    const [, payload] = logged[0];
    assert.equal(payload.token, undefined);
    assert.equal(payload.nested, undefined);
    assert.equal(payload.count, 3);
  });
});
