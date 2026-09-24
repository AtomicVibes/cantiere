// Pure project list helpers: priority ordering, combined filtering and
// sorting. The Projects page renders from these so behavior is unit-tested.

export const PRIORITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

export function priorityRank(priority) {
  return PRIORITY_ORDER[priority] ?? 99;
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

export function matchesDeadline(project, window, now = new Date()) {
  if (!window || window === 'all') return true;
  const raw = project?.end_date;
  if (!raw) return window === 'none';
  const due = new Date(raw);
  if (Number.isNaN(due.getTime())) return false;
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);
  switch (window) {
    case 'overdue':
      return due < todayStart;
    case 'today':
      return due >= todayStart && due <= todayEnd;
    case 'week': {
      const weekEnd = new Date(todayStart);
      weekEnd.setDate(weekEnd.getDate() + 7);
      return due >= todayStart && due <= endOfDay(weekEnd);
    }
    case 'month': {
      return (
        due.getFullYear() === now.getFullYear() &&
        due.getMonth() === now.getMonth() &&
        due >= todayStart
      );
    }
    case 'none':
      return false;
    default:
      return true;
  }
}

export function matchesProjectFilters(project, filters = {}, now = new Date()) {
  const {
    search = '',
    status = 'all',
    priority = 'all',
    deadline = 'all',
    team = 'all',
    visibility = 'all',
  } = filters;
  if (search) {
    const q = search.toLowerCase();
    const haystack = [
      project?.name,
      project?.description,
      project?.status,
      project?.clientName,
      project?.managerName,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    if (!haystack.includes(q)) return false;
  }
  if (status !== 'all' && (project?.status ?? '') !== status) return false;
  if (priority !== 'all' && (project?.priority ?? '') !== priority) return false;
  if (!matchesDeadline(project, deadline, now)) return false;
  if (team !== 'all') {
    const members = project?.memberIds || project?.teamIds || [];
    const ids = [project?.manager_id, project?.managerId, ...(Array.isArray(members) ? members : [])].filter(Boolean);
    if (!ids.includes(team)) return false;
  }
  if (visibility !== 'all' && (project?.visibility ?? 'private') !== visibility) return false;
  return true;
}

function deadlineTime(project) {
  if (!project?.end_date) return null;
  const t = new Date(project.end_date).getTime();
  return Number.isNaN(t) ? null : t;
}

export function sortProjects(projects, sortKey = 'created_desc') {
  const list = [...(projects ?? [])];
  switch (sortKey) {
    case 'name_asc':
      return list.sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || '')));
    case 'priority': {
      return list.sort((a, b) => {
        const d = priorityRank(a?.priority) - priorityRank(b?.priority);
        if (d !== 0) return d;
        return String(a?.name || '').localeCompare(String(b?.name || ''));
      });
    }
    case 'deadline_asc':
      return list.sort((a, b) => {
        const da = deadlineTime(a);
        const db = deadlineTime(b);
        if (da === null && db === null) return 0;
        if (da === null) return 1;
        if (db === null) return -1;
        return da - db;
      });
    case 'progress_desc':
      return list.sort((a, b) => (Number(b?.progress) || 0) - (Number(a?.progress) || 0));
    case 'updated_desc':
      return list.sort(
        (a, b) => new Date(b?.updated_at || b?.created_at || 0) - new Date(a?.updated_at || a?.created_at || 0)
      );
    case 'created_desc':
    default:
      return list.sort(
        (a, b) => new Date(b?.created_at || 0) - new Date(a?.created_at || 0)
      );
  }
}
