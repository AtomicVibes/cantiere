// Focused tests for the canonical date-only handling shared by DatePicker.
// Guarantees: YYYY-MM-DD preservation, no UTC day-shift, locale-independent
// numeric behavior, and graceful handling of invalid input.
// Run with: node --test src/lib/dates.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatDateOnlyDisplay,
  isValidDateOnlyString,
  parseDateOnly,
  toDateOnlyString,
} from './dates.js';

describe('date-only helpers', () => {
  it('round-trips YYYY-MM-DD without shifting the day', () => {
    for (const s of ['2026-01-01', '2026-02-28', '2024-02-29', '2026-12-31', '2026-10-02']) {
      const dt = parseDateOnly(s);
      assert.ok(dt instanceof Date, s);
      assert.equal(toDateOnlyString(dt), s, s);
    }
  });

  it('does not apply UTC conversion (local components preserved)', () => {
    // 10:30 local must still serialize to the same calendar day.
    const dt = new Date(2026, 9, 2, 10, 30, 0);
    assert.equal(toDateOnlyString(dt), '2026-10-02');
    const parsed = parseDateOnly('2026-10-02');
    assert.equal(parsed.getFullYear(), 2026);
    assert.equal(parsed.getMonth(), 9);
    assert.equal(parsed.getDate(), 2);
    assert.equal(parsed.getHours(), 0);
  });

  it('formats the canonical dd/MM/yyyy display', () => {
    assert.equal(formatDateOnlyDisplay('2026-10-02'), '02/10/2026');
    assert.equal(formatDateOnlyDisplay(''), '');
    assert.equal(formatDateOnlyDisplay('not-a-date'), '');
    assert.equal(formatDateOnlyDisplay(null), '');
  });

  it('rejects invalid date-only strings', () => {
    for (const bad of ['', null, undefined, '2026-13-01', '2026-02-30', '02/10/2026', '2026-1-1', 'red']) {
      assert.equal(isValidDateOnlyString(bad), false, JSON.stringify(bad));
      assert.equal(parseDateOnly(bad), null, JSON.stringify(bad));
    }
    assert.equal(toDateOnlyString(new Date('invalid')), '');
    assert.equal(toDateOnlyString(null), '');
  });

  it('parses the canonical invoice-style midnight construction identically', () => {
    const a = new Date(`2026-10-02T00:00:00`);
    const b = parseDateOnly('2026-10-02');
    assert.equal(a.getTime(), b.getTime());
  });
});
