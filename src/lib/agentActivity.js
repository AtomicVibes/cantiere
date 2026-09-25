// Pure activity aggregation helpers (dependency-free, unit-tested).
// Status and durations derive from session timestamps only.

export const ONLINE_WINDOW_MS = 2 * 60 * 1000;
export const IDLE_WINDOW_MS = 15 * 60 * 1000;

export function agentStatus(lastHeartbeatAt, now = Date.now()) {
  if (!lastHeartbeatAt) return 'offline';
  const age = now - new Date(lastHeartbeatAt).getTime();
  if (!Number.isFinite(age) || age < 0) return 'offline';
  if (age <= ONLINE_WINDOW_MS) return 'online';
  if (age <= IDLE_WINDOW_MS) return 'idle';
  return 'offline';
}

export function sessionActiveSeconds(session, now = Date.now()) {
  if (!session?.login_at) return 0;
  const start = new Date(session.login_at).getTime();
  const end = session.logout_at ? new Date(session.logout_at).getTime() : now;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;
  return Math.floor((end - start) / 1000);
}

export function totalActiveSeconds(sessions, now = Date.now()) {
  return (sessions || []).reduce((s, row) => s + sessionActiveSeconds(row, now), 0);
}

export function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h === 0 && m === 0) return `${s}s`;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

export function rangeStart(range, now = Date.now()) {
  const days = range === '30d' ? 30 : range === '7d' ? 7 : 1;
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  if (days > 1) d.setDate(d.getDate() - (days - 1));
  return d.toISOString();
}

export function summarizeAgents(sessions, profilesById, now = Date.now()) {
  const byUser = new Map();
  for (const row of sessions || []) {
    if (!row?.user_id) continue;
    if (!byUser.has(row.user_id)) byUser.set(row.user_id, []);
    byUser.get(row.user_id).push(row);
  }
  return [...byUser.entries()].map(([userId, rows]) => {
    const profile = profilesById?.[userId] || {};
    const sorted = [...rows].sort(
      (a, b) => new Date(b.login_at).getTime() - new Date(a.login_at).getTime()
    );
    const latest = sorted[0];
    const lastActive = rows
      .map((r) => r.last_heartbeat_at || r.logout_at || r.login_at)
      .filter(Boolean)
      .sort()
      .pop() || null;
    return {
      userId,
      name: profile.full_name || profile.email || 'Unknown',
      jobTitle: profile.job_title || '',
      status: agentStatus(latest?.is_active ? latest?.last_heartbeat_at : null, now),
      lastLogin: latest?.login_at || null,
      lastActive,
      totalSeconds: totalActiveSeconds(rows, now),
    };
  });
}
