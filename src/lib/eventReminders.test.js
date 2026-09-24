// Focused tests for the events_reminder_frequency_check contract fix.
// Every supported frequency must normalize to a row the CHECK accepts:
//   non-custom => value NULL + unit NULL
//   custom    => positive integer value + valid unit
// Run with: node --test src/lib/eventReminders.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  coerceReminderFormOnFrequencyChange,
  normalizeEventReminder,
  validateEventReminder,
  DEFAULT_REMINDER_FREQUENCY,
} from './eventReminders.js';

// Mirrors the CHECK in 20261001120000_event_reminders_sms.sql.
function satisfiesCheck(row) {
  const freqs = ['disabled', '30_minutes', '1_hour', '24_hours', 'weekly', 'monthly', 'custom'];
  if (!freqs.includes(row.reminder_frequency)) return false;
  if (row.reminder_frequency === 'custom') {
    return (
      Number.isInteger(row.reminder_interval_value) &&
      row.reminder_interval_value > 0 &&
      ['minutes', 'hours', 'days', 'weeks'].includes(row.reminder_interval_unit)
    );
  }
  return row.reminder_interval_value === null && row.reminder_interval_unit === null;
}

describe('normalizeEventReminder', () => {
  it('default (24_hours) submits NULL interval fields', () => {
    const out = normalizeEventReminder({ frequency: '24_hours', value: '', unit: 'hours' });
    assert.deepEqual(out, {
      reminder_frequency: '24_hours',
      reminder_interval_value: null,
      reminder_interval_unit: null,
    });
    assert.ok(satisfiesCheck(out));
  });

  it('every predefined frequency submits NULL interval fields', () => {
    for (const f of ['disabled', '30_minutes', '1_hour', '24_hours', 'weekly', 'monthly']) {
      // Simulate the old violating payload shape (stale unit/value present).
      const out = normalizeEventReminder({ frequency: f, value: 24, unit: 'hours' });
      assert.equal(out.reminder_interval_value, null, f);
      assert.equal(out.reminder_interval_unit, null, f);
      assert.ok(satisfiesCheck(out), f);
    }
  });

  it('the exact previously-violating payload now conforms', () => {
    // Old bug: { 24_hours, NULL, 'hours' } => 23514.
    const out = normalizeEventReminder({ frequency: '24_hours', value: null, unit: 'hours' });
    assert.deepEqual(out, {
      reminder_frequency: '24_hours',
      reminder_interval_value: null,
      reminder_interval_unit: null,
    });
    assert.ok(satisfiesCheck(out));
  });

  it('custom with valid interval passes through as integer', () => {
    const out = normalizeEventReminder({ frequency: 'custom', value: '30', unit: 'minutes' });
    assert.deepEqual(out, {
      reminder_frequency: 'custom',
      reminder_interval_value: 30,
      reminder_interval_unit: 'minutes',
    });
    assert.ok(satisfiesCheck(out));
  });

  it('custom rejects missing/zero/negative/non-integer values', () => {
    for (const bad of ['', null, undefined, '0', 0, -5, 'abc', 2.5, '3.5']) {
      assert.throws(
        () => normalizeEventReminder({ frequency: 'custom', value: bad, unit: 'hours' }),
        /greater than zero/,
        JSON.stringify(bad)
      );
    }
  });

  it('custom rejects missing/invalid units', () => {
    for (const bad of ['', null, undefined, 'hour', 'Months']) {
      assert.throws(
        () => normalizeEventReminder({ frequency: 'custom', value: 5, unit: bad }),
        /unit is required/i,
        JSON.stringify(bad)
      );
    }
  });

  it('unknown frequency falls back to the 24_hours default', () => {
    assert.equal(DEFAULT_REMINDER_FREQUENCY, '24_hours');
    const out = normalizeEventReminder({ frequency: 'bogus', value: 9, unit: 'days' });
    assert.equal(out.reminder_frequency, '24_hours');
    assert.ok(satisfiesCheck(out));
  });
});

describe('edit transitions', () => {
  it('custom -> predefined clears stale interval fields', () => {
    const form = { reminder_frequency: 'custom', reminder_interval_value: '30', reminder_interval_unit: 'minutes' };
    const next = coerceReminderFormOnFrequencyChange(form, '24_hours');
    assert.equal(next.reminder_interval_value, '');
    const out = normalizeEventReminder({
      frequency: next.reminder_frequency,
      value: next.reminder_interval_value,
      unit: next.reminder_interval_unit,
    });
    assert.ok(satisfiesCheck(out));
  });

  it('predefined -> custom requires a valid interval before save', () => {
    const form = { reminder_frequency: '24_hours', reminder_interval_value: '', reminder_interval_unit: 'minutes' };
    const next = coerceReminderFormOnFrequencyChange(form, 'custom');
    assert.equal(next.reminder_frequency, 'custom');
    const toArgs = (f) => ({ frequency: f.reminder_frequency, value: f.reminder_interval_value, unit: f.reminder_interval_unit });
    assert.notEqual(validateEventReminder(toArgs(next)), null); // empty value invalid
    const filled = { ...next, reminder_interval_value: '45' };
    assert.equal(validateEventReminder(toArgs(filled)), null);
    assert.ok(
      satisfiesCheck(
        normalizeEventReminder({
          frequency: filled.reminder_frequency,
          value: filled.reminder_interval_value,
          unit: filled.reminder_interval_unit,
        })
      )
    );
  });

  it('saved values reload and re-normalize identically', () => {
    const saved = { reminder_frequency: 'weekly', reminder_interval_value: null, reminder_interval_unit: null };
    const out = normalizeEventReminder({ frequency: saved.reminder_frequency, value: saved.reminder_interval_value, unit: saved.reminder_interval_unit });
    assert.deepEqual(out, saved);
  });
});
