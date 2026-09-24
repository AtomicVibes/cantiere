// Tests for full-card event color treatment:
//   - event-specific color overrides the type color across the ENTIRE card
//   - type stored color is never modified by an event override
//   - "use type default" falls back to type color, then accent
//   - contrast handling adapts per color (no single hardcoded foreground)
// Run with: node --test src/lib/eventCardStyle.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getEffectiveEventColor,
  getEventCardStyle,
  getReadableTextColor,
  hexToRgb,
  relativeLuminance,
  withAlpha,
  EVENT_COLOR_PALETTE,
} from './eventColors.js';

const ACCENT = '#C8102E';

describe('entire event card uses the selected color', () => {
  it('event-specific color defines background, border and solid for the whole card', () => {
    const event = { type: 'meeting', event_color: '#10B981', event_type_id: 't1' };
    const type = { id: 't1', name: 'Meeting', color: '#3B82F6' };
    const effective = getEffectiveEventColor(event, type, ACCENT);
    assert.equal(effective, '#10B981');
    const style = getEventCardStyle(effective, 'card');
    assert.ok(style.background.startsWith('#10B981'), 'tinted background derives from event color');
    assert.ok(style.border.startsWith('#10B981'), 'border derives from event color');
    assert.equal(style.solid, '#10B981');
    assert.ok(!style.background.startsWith('#3B82F6'), 'type color is ignored for this event');
  });

  it('without an override the type color defines the card', () => {
    const event = { type: 'meeting', event_color: null, event_type_id: 't1' };
    const type = { id: 't1', name: 'Meeting', color: '#3B82F6' };
    const style = getEventCardStyle(getEffectiveEventColor(event, type, ACCENT), 'card');
    assert.equal(style.solid, '#3B82F6');
  });

  it('event type stored color is unchanged by an event override', () => {
    const type = { id: 't1', name: 'Meeting', color: '#3B82F6' };
    getEffectiveEventColor({ type: 'meeting', event_color: '#10B981', event_type_id: 't1' }, type, ACCENT);
    getEventCardStyle('#10B981');
    assert.equal(type.color, '#3B82F6');
  });

  it('"use type default" (NULL) resolves to type color, then accent', () => {
    const withColor = { id: 'w1', name: 'Workshop', color: '#F97316' };
    assert.equal(
      getEffectiveEventColor({ type: 'Workshop', event_color: null, event_type_id: 'w1' }, withColor, ACCENT),
      '#F97316'
    );
    const withoutColor = { id: 'w2', name: 'Other', color: null };
    assert.equal(
      getEffectiveEventColor({ type: 'Other', event_color: null, event_type_id: 'w2' }, withoutColor, ACCENT),
      ACCENT
    );
  });

  it('accent changes never recolor stored custom events/types', () => {
    const event = { type: 'meeting', event_color: '#10B981', event_type_id: 't1' };
    const type = { id: 't1', name: 'Meeting', color: '#8B5CF6' };
    assert.equal(getEffectiveEventColor(event, type, '#C8102E'), '#10B981');
    assert.equal(getEffectiveEventColor(event, type, '#1D4ED8'), '#10B981');
    assert.equal(
      getEffectiveEventColor({ ...event, event_color: null }, type, '#1D4ED8'),
      '#8B5CF6'
    );
  });
});

describe('contrast handling', () => {
  it('dark colors get a light foreground, light colors a dark one', () => {
    assert.equal(getReadableTextColor('#1D4ED8'), '#FFFFFF'); // royal blue (dark)
    assert.equal(getReadableTextColor('#8B5CF6'), '#FFFFFF'); // purple (dark)
    assert.equal(getReadableTextColor('#F59E0B'), '#1F2937'); // gold (light)
    assert.equal(getReadableTextColor('#10B981'), '#1F2937'); // emerald (light)
  });

  it('foreground is not one hardcoded value across the palette', () => {
    const texts = new Set(EVENT_COLOR_PALETTE.map((c) => getReadableTextColor(c.hex)));
    assert.ok(texts.size > 1, 'must adapt per color');
  });

  it('helpers reject invalid input safely', () => {
    assert.equal(hexToRgb('red'), null);
    assert.equal(relativeLuminance('red'), null);
    assert.equal(withAlpha('red', 0.5), null);
    assert.equal(withAlpha('#10B981', 0.5), '#10B98180');
    const empty = getEventCardStyle(null);
    assert.equal(empty.background, undefined);
    assert.equal(empty.solid, undefined);
  });
});
