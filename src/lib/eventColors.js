// Canonical effective event color resolution for custom event types.
//
// Priority (single authoritative path — use this everywhere events are rendered):
//   1. event-specific `events.event_color`
//   2. event type `event_types.color` (database-backed default)
//   3. current application accent (`--primary` theme variable)
//
// Legacy `events.type` string values keep working through LEGACY_EVENT_TYPE_HEX,
// which acts as a built-in type default when no database-backed color exists.
// Stored colors are never rewritten when the application accent changes: only
// missing/NULL colors resolve to the current accent at render time.

export const APP_ACCENT_FALLBACK = '#C8102E';

export const EVENT_COLOR_PALETTE = [
  { key: 'red', hex: '#EF4444' },
  { key: 'orange', hex: '#F97316' },
  { key: 'gold', hex: '#F59E0B' },
  { key: 'emerald', hex: '#10B981' },
  { key: 'teal', hex: '#14B8A6' },
  { key: 'blue', hex: '#3B82F6' },
  { key: 'royalBlue', hex: '#1D4ED8' },
  { key: 'purple', hex: '#8B5CF6' },
  { key: 'pink', hex: '#EC4899' },
  { key: 'slate', hex: '#64748B' },
];

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export function isValidHexColor(value) {
  return typeof value === 'string' && HEX_RE.test(value.trim());
}

export function normalizeHexColor(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return HEX_RE.test(trimmed) ? trimmed.toUpperCase() : null;
}

// Built-in defaults for legacy `events.type` string values. These preserve the
// previous CalendarPage EVENT_TYPES_BASE dot colors after the migration to the
// database-backed `event_types` system. They are only used when neither an
// event-specific color nor a database type color exists.
export const LEGACY_EVENT_TYPE_HEX = {
  deadline: '#EF4444',
  meeting: '#3B82F6',
  site_visit: '#10B981',
  inspection: '#8B5CF6',
  permit_expiry: '#F59E0B',
  payment_due: '#6366F1',
  other: '#64748B',
};

export function getLegacyEventTypeHex(type) {
  if (!type || typeof type !== 'string') return null;
  return LEGACY_EVENT_TYPE_HEX[type] ?? null;
}

function hslToHex(h, s, l) {
  const hh = ((Number(h) % 360) + 360) % 360 / 360;
  const ss = Math.min(1, Math.max(0, Number(s) / 100));
  const ll = Math.min(1, Math.max(0, Number(l) / 100));
  const hue2rgb = (p, q, tt) => {
    let t = tt;
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  let r;
  let g;
  let b;
  if (ss === 0) {
    r = ll;
    g = ll;
    b = ll;
  } else {
    const q = ll < 0.5 ? ll * (1 + ss) : ll + ss - ll * ss;
    const p = 2 * ll - q;
    r = hue2rgb(p, q, hh + 1 / 3);
    g = hue2rgb(p, q, hh);
    b = hue2rgb(p, q, hh - 1 / 3);
  }
  const toHex = (v) =>
    Math.round(v * 255)
      .toString(16)
      .padStart(2, '0')
      .toUpperCase();
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// Reads the CURRENT application accent from the existing theme system
// (`--primary` CSS variable, HSL triplet like "351 77% 47%"). Falls back to
// APP_ACCENT_FALLBACK when unavailable (SSR, tests, missing variable).
export function getAppAccentColor() {
  if (typeof window === 'undefined' || typeof getComputedStyle === 'undefined') {
    return APP_ACCENT_FALLBACK;
  }
  try {
    const raw = getComputedStyle(document.documentElement)
      .getPropertyValue('--primary')
      .trim();
    if (!raw) return APP_ACCENT_FALLBACK;
    if (raw.startsWith('#') && HEX_RE.test(raw)) return raw.toUpperCase();
    const parts = raw.split(/\s+/);
    if (parts.length >= 3) {
      const h = parseFloat(parts[0]);
      const s = parseFloat(parts[1].replace('%', ''));
      const l = parseFloat(parts[2].replace('%', ''));
      if (Number.isFinite(h) && Number.isFinite(s) && Number.isFinite(l)) {
        return hslToHex(h, s, l);
      }
    }
  } catch {
    // ignore and fall through to the fallback
  }
  return APP_ACCENT_FALLBACK;
}

// Resolve a joined/looked-up event type record for an event. Accepts the
// Supabase-joined object (`event.event_type`), a plain record, an array of
// records matched by `event.event_type_id`, or a Map keyed by id.
export function resolveEventType(event, eventTypeOrList) {
  if (!eventTypeOrList) {
    return event?.event_type && typeof event.event_type === 'object'
      ? event.event_type
      : null;
  }
  if (Array.isArray(eventTypeOrList)) {
    const id = event?.event_type_id;
    if (!id) return null;
    return eventTypeOrList.find((t) => t?.id === id) ?? null;
  }
  if (eventTypeOrList instanceof Map) {
    const id = event?.event_type_id;
    if (!id) return null;
    return eventTypeOrList.get(id) ?? null;
  }
  if (typeof eventTypeOrList === 'object') return eventTypeOrList;
  return null;
}

// Single authoritative resolver used by calendar, list, detail, cards and
// indicators. `accentColor` defaults to the live application accent.
export function getEffectiveEventColor(event, eventTypeOrList, accentColor) {
  const accent =
    typeof accentColor === 'string' && accentColor
      ? accentColor
      : getAppAccentColor();

  const eventColor =
    event && typeof event.event_color === 'string'
      ? event.event_color.trim()
      : null;
  if (eventColor && HEX_RE.test(eventColor)) return eventColor.toUpperCase();

  const eventType = resolveEventType(event, eventTypeOrList);
  const typeColor =
    eventType && typeof eventType.color === 'string'
      ? eventType.color.trim()
      : null;
  if (typeColor && HEX_RE.test(typeColor)) return typeColor.toUpperCase();

  const legacy = getLegacyEventTypeHex(event?.type);
  if (legacy) return legacy;

  return accent;
}

// Human-readable color name for a hex value. Never returns a raw HEX as the
// primary label: known palette entries map to translated names, anything else
// maps to the translated "Custom color" label. `t` is the i18n translate
// function; when omitted, English labels are used.
export function getEventHexColorName(hex, t) {
  const translate =
    typeof t === 'function'
      ? t
      : (key, fallback) => fallback ?? key;
  const normalized =
    typeof hex === 'string' ? hex.trim().toUpperCase() : null;
  if (!normalized) return translate('eventColors.defaultColor', 'Default color');
  const entry = EVENT_COLOR_PALETTE.find(
    (c) => c.hex.toUpperCase() === normalized
  );
  if (entry) {
    const fallbacks = {
      red: 'Red',
      orange: 'Orange',
      gold: 'Gold',
      emerald: 'Emerald',
      teal: 'Teal',
      blue: 'Blue',
      royalBlue: 'Royal Blue',
      purple: 'Purple',
      pink: 'Pink',
      slate: 'Slate',
    };
    return translate(
      `eventColors.${entry.key}`,
      fallbacks[entry.key] ?? entry.key
    );
  }
  return translate('eventColors.customColor', 'Custom color');
}
