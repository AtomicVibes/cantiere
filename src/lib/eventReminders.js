// Canonical event-reminder normalization for the events table CHECK contract
// (`events_reminder_frequency_check`, see 20261001120000_event_reminders_sms.sql):
//
//   non-custom (disabled | 30_minutes | 1_hour | 24_hours | weekly | monthly):
//     reminder_interval_value IS NULL AND reminder_interval_unit IS NULL
//   custom:
//     reminder_interval_value IS NOT NULL AND > 0 (integer)
//     reminder_interval_unit IN (minutes | hours | days | weeks)
//
// The New Event form previously submitted the untouched interval unit default
// ('hours') together with predefined frequencies (e.g. 24_hours + NULL + 'hours'),
// which violates the CHECK with PostgreSQL error 23514. All event create/update
// paths must go through normalizeEventReminder() so the submitted row always
// conforms to the existing database contract. No schema/trigger change needed:
// the normalized values are exactly what sync_event_reminder_due() expects.

export const REMINDER_FREQUENCIES = [
  'disabled',
  '30_minutes',
  '1_hour',
  '24_hours',
  'weekly',
  'monthly',
  'custom',
];

export const REMINDER_UNITS = ['minutes', 'hours', 'days', 'weeks'];

export const DEFAULT_REMINDER_FREQUENCY = '24_hours';

export function isCustomReminderFrequency(frequency) {
  return frequency === 'custom';
}

function toPositiveInt(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

// Returns { reminder_frequency, reminder_interval_value, reminder_interval_unit }
// ready for Supabase insert/update. Throws an Error with a human-readable message
// when a custom reminder has no valid interval (callers surface it via form
// validation instead of letting the database reject the row).
export function normalizeEventReminder({ frequency, value, unit } = {}) {
  const reminder_frequency = REMINDER_FREQUENCIES.includes(frequency)
    ? frequency
    : DEFAULT_REMINDER_FREQUENCY;

  if (!isCustomReminderFrequency(reminder_frequency)) {
    return {
      reminder_frequency,
      reminder_interval_value: null,
      reminder_interval_unit: null,
    };
  }

  const reminder_interval_value = toPositiveInt(value);
  const reminder_interval_unit = REMINDER_UNITS.includes(unit) ? unit : null;
  if (reminder_interval_value === null) {
    throw new Error('Reminder value must be greater than zero');
  }
  if (reminder_interval_unit === null) {
    throw new Error('Reminder unit is required');
  }
  return { reminder_frequency, reminder_interval_value, reminder_interval_unit };
}

// Form-level validation returning a message key-friendly string, or null when valid.
export function validateEventReminder({ frequency, value, unit } = {}) {
  try {
    normalizeEventReminder({ frequency, value, unit });
    return null;
  } catch (err) {
    return err?.message || 'Invalid reminder value';
  }
}

// Clears stale custom interval input when leaving 'custom' so predefined
// frequencies never carry leftover interval data (defense in depth: the
// normalizer nulls them anyway at submit time).
export function coerceReminderFormOnFrequencyChange(form, nextFrequency) {
  if (!isCustomReminderFrequency(nextFrequency)) {
    return { ...form, reminder_frequency: nextFrequency, reminder_interval_value: '' };
  }
  return {
    ...form,
    reminder_frequency: nextFrequency,
    reminder_interval_unit: form.reminder_interval_unit || 'hours',
  };
}
