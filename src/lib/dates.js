// Pure date-only helpers (YYYY-MM-DD). All conversions use LOCAL calendar
// components so a selected date is never shifted by UTC/timezone handling.

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidDateOnlyString(value) {
  if (typeof value !== 'string') return false;
  const m = DATE_ONLY_RE.exec(value.trim());
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const dt = new Date(y, mo - 1, d);
  return (
    dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d
  );
}

// Local-midnight Date for a YYYY-MM-DD string (equivalent to the canonical
// `new Date(value + 'T00:00:00')` used across the app). Returns null when invalid.
export function parseDateOnly(value) {
  if (!isValidDateOnlyString(value)) return null;
  const m = DATE_ONLY_RE.exec(value.trim());
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

// Local YYYY-MM-DD for a Date (no UTC conversion, no day shift).
export function toDateOnlyString(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${mo}-${d}`;
}

// Canonical display for date-only values (matches the New Invoice picker).
export function formatDateOnlyDisplay(value) {
  const dt = parseDateOnly(value);
  if (!dt) return '';
  const dd = String(dt.getDate()).padStart(2, '0');
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${dt.getFullYear()}`;
}
