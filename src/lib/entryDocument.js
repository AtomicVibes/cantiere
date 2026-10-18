// Pure helpers for timeline-entry document edits (rename / description /
// replace). Kept side-effect free so they can be unit-tested with node:test.

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const PATH_SEPARATORS = /[\\/]/;

export function getFileExtension(name) {
  const value = String(name ?? '');
  const dot = value.lastIndexOf('.');
  if (dot <= 0 || dot === value.length - 1) return '';
  return value.slice(dot);
}

export function hasFileExtension(name) {
  return getFileExtension(name) !== '';
}

// Normalizes the user-entered display name for a document.
// - trims surrounding whitespace
// - rejects empty names, control characters and path separators (traversal)
// - preserves the original extension by default: when the typed name carries
//   no extension, the original file's extension is appended.
// The display name never participates in the storage path, so no storage
// object is renamed as a side effect.
export function normalizeDocumentFileName(rawName, originalName) {
  const typed = String(rawName ?? '').trim();
  if (!typed) {
    const error = new Error('A file name is required');
    error.code = 'INVALID_FILE_NAME';
    throw error;
  }
  if (CONTROL_CHARS.test(typed) || PATH_SEPARATORS.test(typed) || typed === '.' || typed === '..') {
    const error = new Error('The file name contains unsupported characters');
    error.code = 'INVALID_FILE_NAME';
    throw error;
  }
  if (hasFileExtension(typed)) return typed;
  // Strip trailing dots so "report." becomes "report", never "report..pdf".
  const base = typed.replace(/\.+$/, '');
  if (!base) {
    const error = new Error('The file name contains unsupported characters');
    error.code = 'INVALID_FILE_NAME';
    throw error;
  }
  const originalExt = getFileExtension(originalName);
  return originalExt ? `${base}${originalExt}` : base;
}

// True only when the stored description differs from the edited value after
// normalization. Clearing a description counts as a change; leaving it alone
// (even with different surrounding whitespace) never does.
export function documentNotesChanged(originalNotes, editedNotes) {
  const original = String(originalNotes ?? '').trim();
  const edited = String(editedNotes ?? '').trim();
  return original !== edited;
}

// Empty descriptions persist as NULL, matching the create flow (notes || null).
export function normalizeDocumentNotes(editedNotes) {
  const edited = String(editedNotes ?? '').trim();
  return edited === '' ? null : edited;
}

export function formatFileSizeLabel(bytes) {
  const size = Number(bytes);
  if (!Number.isFinite(size) || size <= 0) return '';
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(size / 1024))} KB`;
}
