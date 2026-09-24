// Project progress model (mirrors the database trigger
// refresh_project_progress in 20261008120000):
//   auto mode   -> progress = min(100, timelineCount * 5)
//   manual mode -> progress frozen; super-admin sets manual_progress.
// Pure helpers so the UI and tests share the exact contract.

export const PROGRESS_PER_SUBMISSION = 5;
export const PROGRESS_MAX = 100;

// Central priority -> progress-bar color mapping (Tailwind classes must be
// literal for the compiler). Reused by cards, list rows and detail so the
// filled portion always inherits the project priority color. Dark-mode safe
// tints; the track stays neutral (bg-secondary on the component).
export const PRIORITY_PROGRESS_CLASSES = {
  low: 'bg-emerald-500',
  medium: 'bg-yellow-500',
  high: 'bg-orange-500',
  critical: 'bg-red-500',
};

export function getPriorityProgressClass(priority) {
  return PRIORITY_PROGRESS_CLASSES[priority] ?? 'bg-primary';
}

export function computeAutoProgress(timelineCount) {
  const count = Number.isFinite(Number(timelineCount)) ? Math.max(0, Math.floor(Number(timelineCount))) : 0;
  return Math.min(PROGRESS_MAX, count * PROGRESS_PER_SUBMISSION);
}

export function isManualProgressMode(project) {
  return project?.progress_mode === 'manual';
}

export function clampProgress(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(PROGRESS_MAX, Math.max(0, Math.round(n)));
}

// Effective displayed progress: manual override when active, otherwise the
// stored (trigger-maintained) auto value.
export function getEffectiveProgress(project) {
  if (isManualProgressMode(project)) {
    return clampProgress(project?.manual_progress ?? project?.progress ?? 0);
  }
  return clampProgress(project?.progress ?? 0);
}
