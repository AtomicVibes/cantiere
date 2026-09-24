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

// ---------------------------------------------------------------------------
// Full-card color treatment with contrast handling.
//
// getEventCardStyle(hex) returns a tinted { background, border, text } triple
// so the selected color visually defines the ENTIRE event card while text
// stays readable: dark colors get a light foreground, light colors get a
// dark foreground (WCAG relative-luminance based, never one hardcoded
// foreground for every color).
// ---------------------------------------------------------------------------

export function hexToRgb(hex) {
  if (typeof hex !== 'string') return null;
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  return {
    r: parseInt(m[1].slice(0, 2), 16),
    g: parseInt(m[1].slice(2, 4), 16),
    b: parseInt(m[1].slice(4, 6), 16),
  };
}

export function relativeLuminance(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const channel = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

// Readable foreground for text placed on the given background color.
export function getReadableTextColor(backgroundHex) {
  const lum = relativeLuminance(backgroundHex);
  if (lum === null) return '#1F2937';
  return lum > 0.35 ? '#1F2937' : '#FFFFFF';
}

// Appends an alpha channel to a #RRGGBB hex (#RRGGBBAA). Returns null when invalid.
export function withAlpha(hex, alpha) {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const a = Math.round(Math.min(1, Math.max(0, Number(alpha) || 0)) * 255)
    .toString(16)
    .padStart(2, '0')
    .toUpperCase();
  return `${hex.trim().toUpperCase()}${a}`;
}

// Full-card style for an effective event color hex. `emphasis` controls the
// tint strength: 'card' (default soft tint for list/detail cards) or 'block'
// (stronger tint for compact calendar blocks).
//
// The triple works as follows:
//   background: soft tint of the event color (whole card surface)
//   border:     stronger event-color border (whole card outline)
//   solid:      the event color itself (badges, indicators, header bands)
//   onSolid:    luminance-computed readable text for content placed ON the
//               solid color (light foreground on dark colors, dark
//               foreground on light colors - never one hardcoded value).
// Body copy keeps the theme foreground so it stays readable in both
// light and dark modes.
export function getEventCardStyle(hex, emphasis = 'card') {
  const normalized =
    typeof hex === 'string' && HEX_RE.test(hex.trim()) ? hex.trim().toUpperCase() : null;
  if (!normalized) return { background: undefined, border: undefined, text: undefined, solid: undefined };
  const alpha = emphasis === 'block' ? 0.3 : 0.14;
  return {
    background: withAlpha(normalized, alpha),
    border: withAlpha(normalized, 0.55),
    text: getReadableTextColor(normalized),
    solid: normalized,
  };
}

// Foreground specifically for text rendered directly ON the solid color
// (badges, dots with labels). Delegates to the luminance check.
export function getSolidBadgeTextColor(hex) {
  return getReadableTextColor(hex);
}
