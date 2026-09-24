// Focused tests for the effective event color priority:
//   1. event color wins  2. type color wins  3. accent wins
//   4. accent changes never rewrite stored colors
//   5. "use type default" (NULL event color) falls back to type/accent
//   6. legacy events with only `events.type` keep their built-in color
// Run with: node --test src/lib/eventColors.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getEffectiveEventColor,
  getEventHexColorName,
  isValidHexColor,
  resolveEventType,
} from './eventColors.js';

const ACCENT_A = '#C8102E';
const ACCENT_B = '#1D4ED8';

describe('getEffectiveEventColor priority', () => {
  it('case 1: event-specific color wins over type color and accent', () => {
    const out = getEffectiveEventColor(
      { type: 'meeting', event_color: '#10B981', event_type_id: 't1' },
      { id: 't1', name: 'Meeting', color: '#8B5CF6' },
      ACCENT_A
    );
    assert.equal(out, '#10B981');
  });

  it('case 2: NULL event color + type color present => type color wins', () => {
    const out = getEffectiveEventColor(
      { type: 'meeting', event_color: null, event_type_id: 't1' },
      { id: 't1', name: 'Meeting', color: '#8B5CF6' },
      ACCENT_A
    );
    assert.equal(out, '#8B5CF6');
  });

  it('case 3: NULL event color + NULL type color => accent wins', () => {
    const out = getEffectiveEventColor(
      { type: 'some_custom_type', event_color: null, event_type_id: 't1' },
      { id: 't1', name: 'Some Custom Type', color: null },
      ACCENT_A
    );
    assert.equal(out, ACCENT_A);
  });

  it('case 4: changing the accent leaves stored event/type colors unchanged', () => {
    const event = { type: 'meeting', event_color: '#10B981', event_type_id: 't1' };
    const type = { id: 't1', name: 'Meeting', color: '#8B5CF6' };
    assert.equal(getEffectiveEventColor(event, type, ACCENT_A), '#10B981');
    assert.equal(getEffectiveEventColor(event, type, ACCENT_B), '#10B981');
    const bare = { type: 'meeting', event_color: null, event_type_id: 't1' };
    assert.equal(getEffectiveEventColor(bare, type, ACCENT_A), '#8B5CF6');
    assert.equal(getEffectiveEventColor(bare, type, ACCENT_B), '#8B5CF6');
    // Resolver is pure: inputs are not mutated.
    assert.equal(event.event_color, '#10B981');
    assert.equal(type.color, '#8B5CF6');
  });

  it('case 5: use type default (event_color NULL) resolves via type then accent', () => {
    const withType = { type: 'Workshop', event_color: null, event_type_id: 'w1' };
    assert.equal(
      getEffectiveEventColor(withType, { id: 'w1', name: 'Workshop', color: '#F97316' }, ACCENT_A),
      '#F97316'
    );
    const withoutType = { type: 'Workshop', event_color: null, event_type_id: null };
    assert.equal(getEffectiveEventColor(withoutType, null, ACCENT_A), ACCENT_A);
    assert.equal(getEffectiveEventColor(withoutType, null, ACCENT_B), ACCENT_B);
  });

  it('case 6: legacy events with only events.type keep built-in colors', () => {
    assert.equal(
      getEffectiveEventColor({ type: 'deadline' }, null, ACCENT_A),
      '#EF4444'
    );
    assert.equal(
      getEffectiveEventColor({ type: 'meeting' }, null, ACCENT_A),
      '#3B82F6'
    );
    assert.equal(
      getEffectiveEventColor({ type: 'other' }, null, ACCENT_A),
      '#64748B'
    );
  });

  it('invalid event_color strings are ignored, not returned', () => {
    assert.equal(
      getEffectiveEventColor(
        { type: 'deadline', event_color: 'red' },
        null,
        ACCENT_A
      ),
      '#EF4444'
    );
    assert.equal(
      getEffectiveEventColor({ type: 'zzz_unknown', event_color: 'nope' }, null, ACCENT_A),
      ACCENT_A
    );
  });

  it('resolves joined/array event type records', () => {
    const list = [{ id: 'a', name: 'A', color: '#14B8A6' }];
    assert.deepEqual(resolveEventType({ event_type_id: 'a' }, list), list[0]);
    assert.equal(resolveEventType({ event_type_id: 'missing' }, list), null);
  });
});

describe('color helpers', () => {
  it('validates #RRGGBB hex colors', () => {
    assert.equal(isValidHexColor('#10B981'), true);
    assert.equal(isValidHexColor('#10b981'), true);
    assert.equal(isValidHexColor('red'), false);
    assert.equal(isValidHexColor('#FFF'), false);
    assert.equal(isValidHexColor(null), false);
  });

  it('never returns raw HEX as the primary label', () => {
    const t = (key, fallback) => fallback;
    assert.equal(getEventHexColorName('#3B82F6', t), 'Blue');
    assert.equal(getEventHexColorName('#1D4ED8', t), 'Royal Blue');
    assert.equal(getEventHexColorName('#ABCDEF', t), 'Custom color');
    assert.equal(getEventHexColorName(null, t), 'Default color');
  });
});
