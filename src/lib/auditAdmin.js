// Pure helpers for audit-log administration. Extracted so the "always
// filtered, never WHERE-less" behavior is unit-testable and shared.

// Resolves the concrete record IDs targeted by an audit-log admin action.
// - 'single'   -> [id]
// - 'selected' -> [...selectedIds]
// - 'all'      -> ids of the currently loaded/filtered view
// Returns [] when nothing is targeted (callers must abort instead of
// issuing an unfiltered request).
export function resolveAuditLogIds(mode, { selectedIds, visibleLogs, id } = {}) {
  if (mode === 'single') {
    return id ? [id] : [];
  }
  if (mode === 'selected') {
    const ids = selectedIds instanceof Set ? [...selectedIds] : (selectedIds || []);
    return ids.filter(Boolean);
  }
  if (mode === 'all') {
    return (visibleLogs || [])
      .map((log) => (typeof log === 'string' ? log : log?.id))
      .filter(Boolean);
  }
  return [];
}

// Strict guard: a mutation is safe only with at least one explicit id.
export function hasAuditLogTargets(ids) {
  return Array.isArray(ids) && ids.length > 0;
}
