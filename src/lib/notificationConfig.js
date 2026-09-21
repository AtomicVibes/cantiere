import {
  AlertTriangle,
  Bell,
  Calendar,
  ClipboardList,
  Clock,
  FileText,
  FolderKanban,
  MessageCircle,
  Receipt,
  UserCog,
  Users,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Central notification type configuration (SINGLE source of truth).
//
// Used by the notification bell, the Notifications page, and (via the shared
// route map below in public/sw.js) the push click handler. Producers set the
// `type` logical category on public.notifications; the `url` column remains an
// optional specific/deep-link destination. The resolver decides navigation so
// a legacy universal `url = '/messages'` can never hijack unrelated types.
// ---------------------------------------------------------------------------

const FALLBACK = { labelKey: 'general', icon: Bell, base: '/dashboard' };

export const NOTIFICATION_TYPES = {
  // Messages (produced by MessagesPage when a message is sent)
  message: { labelKey: 'message', icon: MessageCircle, base: '/messages' },
  // Legacy alias used by older producers
  new_message: { labelKey: 'message', icon: MessageCircle, base: '/messages' },

  // Project requests (produced by projects-creation edge function)
  project_request: {
    labelKey: 'projectRequests',
    icon: ClipboardList,
    base: '/requests',
    // Only super admins may land on Request Management; normal users go to
    // "My Requests". Requests.jsx enforces the same guard server-side.
    management: '/requests?view=management',
  },

  // Projects
  project_assignment: { labelKey: 'projects', icon: FolderKanban, base: '/projects' },
  project_update: { labelKey: 'projects', icon: FolderKanban, base: '/projects' },
  team_assignment: { labelKey: 'projects', icon: FolderKanban, base: '/projects' },

  // Documents
  document: { labelKey: 'documents', icon: FileText, base: '/documents' },

  // Invoices / finance
  invoice_change: { labelKey: 'finance', icon: Receipt, base: '/finance' },

  // Events / calendar
  event: { labelKey: 'calendar', icon: Calendar, base: '/calendar' },
  permit_expiry: { labelKey: 'calendar', icon: AlertTriangle, base: '/calendar' },
  deadline_alert: { labelKey: 'calendar', icon: Clock, base: '/calendar' },

  // Clients / team / roles
  client: { labelKey: 'clients', icon: Users, base: '/clients' },
  team: { labelKey: 'teams', icon: Users, base: '/teams' },
  role_update: { labelKey: 'settings', icon: UserCog, base: '/settings' },
  status_change: { labelKey: 'settings', icon: Bell, base: '/settings' },

  // Reminder about unread notifications (produced by the reminder engine)
  notification_reminder: { labelKey: 'notifications', icon: Bell, base: '/notifications' },

  // Fallback category for unknown/legacy rows
  general: { labelKey: 'general', icon: Bell, base: '/dashboard' },
};

export const getNotificationTypeConfig = (type) => NOTIFICATION_TYPES[type] || FALLBACK;

export const getNotificationIcon = (type) => getNotificationTypeConfig(type).icon;

export const getNotificationLabelKey = (type) => getNotificationTypeConfig(type).labelKey;

const isInternalPath = (url) => typeof url === 'string' && url.length > 0 && url.startsWith('/');

// A deep link is only trusted when it belongs to the type's logical
// destination (e.g. a project notification may open /projects/:id but must
// never open /messages). This keeps notification URLs from bypassing the
// type-based routing model.
const matchesBase = (url, base) =>
  isInternalPath(url) &&
  (url === base || url.startsWith(`${base}/`) || url.startsWith(`${base}?`));

/**
 * Single source of truth for notification navigation.
 *
 * @param {object} notification - row from public.notifications
 * @param {object} [options] - { isSuperAdmin }
 * @returns {string} internal app route
 */
export const resolveNotificationDestination = (notification, { isSuperAdmin = false } = {}) => {
  if (!notification) return FALLBACK.base;

  const type = notification.type;
  const config = NOTIFICATION_TYPES[type];

  if (config) {
    // Super-admin-only request management must never be exposed to normal users.
    if (config.management) {
      return isSuperAdmin ? config.management : config.base;
    }
    if (notification.url && matchesBase(notification.url, config.base)) {
      return notification.url;
    }
    return config.base;
  }

  // Unknown/legacy type: preserve a valid explicit deep link, but never the old
  // universal '/messages' default, so unrelated rows cannot open Messages.
  if (notification.url && isInternalPath(notification.url) && notification.url !== '/messages') {
    return notification.url;
  }
  return FALLBACK.base;
};