/**
 * Safely extracts avatar initials from a user's full name or username.
 *
 * Multi-word names → first letter of first name + first letter of last name
 * Single-word names → first and last character of the string
 * Missing/invalid input → 'U'
 *
 * @param {string|null|undefined} name
 * @returns {string}
 */
export function getAvatarLetters(name) {
  if (!name || typeof name !== 'string') return 'U';
  const trimmed = name.trim();
  if (!trimmed) return 'U';

  const parts = trimmed.split(/\s+/);
  if (parts.length > 1) {
    return `${parts[0].charAt(0)}${parts[parts.length - 1].charAt(0)}`.toUpperCase();
  }

  return `${trimmed.charAt(0)}${trimmed.charAt(trimmed.length - 1)}`.toUpperCase();
}
