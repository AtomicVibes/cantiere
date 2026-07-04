/**
 * Crash-safe parser that extracts initials from a name string.
 *
 * Multi-word names → first letter of first name + first letter of last name
 * Single-word names → first two characters of the word
 * Missing/invalid input → 'U'
 *
 * @param {string|null|undefined} nameString
 * @returns {string}
 */
export function getInitials(nameString) {
  if (!nameString || typeof nameString !== 'string') return 'U';
  const parts = nameString.trim().split(/\s+/);
  if (parts.length > 1) {
    return `${parts[0].charAt(0)}${parts[parts.length - 1].charAt(0)}`.toUpperCase();
  }
  return parts[0].length >= 2 ? parts[0].substring(0, 2).toUpperCase() : 'U';
}
