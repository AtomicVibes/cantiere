// Pure activity aggregation helpers (dependency-free, unit-tested).
// Status and durations derive from session timestamps only.
import {
  Activity,
  BarChart3,
  Bell,
  CalendarClock,
  CalendarPlus,
  Calendar,
  CircleCheck,
  CircleX,
  ClipboardList,
  ClipboardPlus,
  CreditCard,
  DollarSign,
  Eye,
  FilePen,
  FileSearch,
  FileText,
  FileUp,
  FolderKanban,
  FolderOpen,
  FolderPen,
  FolderPlus,
  LayoutDashboard,
  Lock,
  LogIn,
  LogOut,
  MessageSquare,
  Receipt,
  ScrollText,
  Settings,
  Undo2,
  UserCircle,
  UserPen,
  UserPlus,
  Users,
  WalletCards,
} from 'lucide-react';

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

export function summarizeAgents(sessions, profilesById, now = Date.now()) {  const byUser = new Map();
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

// Central activity -> icon mapping (single source of truth). Every tracked
// action resolves to a meaningful Lucide icon; unknown actions fall back to
// the generic Activity icon. Finance actions reuse the Finance icon set.
const ACTIVITY_ICONS = {
  session_login: LogIn,
  session_logout: LogOut,
  project_view: Eye,
  PROJECT_CREATED: FolderPlus,
  PROJECT_UPDATED: FolderPen,
  project_completed: CircleCheck,
  DOCUMENT_UPLOADED: FileUp,
  document_view: FileSearch,
  DOCUMENT_UPDATED: FilePen,
  DOCUMENT_DELETED: FileSearch,
  EVENT_CREATED: CalendarPlus,
  EVENT_UPDATED: CalendarClock,
  request_created: ClipboardPlus,
  request_approved: CircleCheck,
  request_rejected: CircleX,
  message: MessageSquare,
  message_sent: MessageSquare,
  EXPENSE_CREATED: Receipt,
  EXPENSE_UPDATED: Receipt,
  BUDGET_CREATED: WalletCards,
  BUDGET_UPDATED: WalletCards,
  payment: CreditCard,
  REFUND_CREATED: Undo2,
  notification: Bell,
  notification_reminder: Bell,
  profile_updated: UserPen,
  team_assignment: UserPlus,
  project_assignment: UserPlus,
  settings_change: Settings,
  event: CalendarPlus,
  project_request: ClipboardList,
  general: FolderOpen,
};

export function getActivityIcon(action) {
  if (!action || typeof action !== 'string') return Activity;
  return ACTIVITY_ICONS[action] || ACTIVITY_ICONS[action.toLowerCase()] || Activity;
}

// Sidebar section -> icon mapping. Mirrors the exact icon components used
// by the main side drawer (Sidebar.jsx) so timeline nodes speak the same
// visual language. Case-insensitive; returns null when the section is
// unknown so callers fall back to the action icon, then Activity.
const SECTION_ICONS = {
  dashboard: LayoutDashboard,
  projects: FolderKanban,
  'project detail': FolderKanban,
  teams: Users,
  clients: UserCircle,
  messages: MessageSquare,
  notifications: Bell,
  finance: DollarSign,
  calendar: Calendar,
  reports: BarChart3,
  documents: FileText,
  settings: Settings,
  logs: ScrollText,
  audit: ScrollText,
  requests: ClipboardList,
  activity: Activity,
};

export function getSectionIcon(sectionName) {
  if (!sectionName || typeof sectionName !== 'string') return null;
  return SECTION_ICONS[sectionName.trim().toLowerCase()] || null;
}

// Timeline node icon: section icon first (matches the side drawer),
// then the action icon, then the generic Activity fallback.
export function getTimelineIcon(entry) {
  return (
    getSectionIcon(entry?.metadata?.section_name) ||
    getActivityIcon(entry?.action) ||
    Activity
  );
}
