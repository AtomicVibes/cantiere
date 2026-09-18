import {
  CalendarDays,
  ClipboardList,
  FileText,
  FolderOpen,
  History,
  Receipt,
  Settings2,
  Shield,
  Users,
} from 'lucide-react';

const FEATURE_RULES = [
  { match: /^PROJECT_/, icon: FolderOpen, name: 'Projects' },
  { match: /^DOCUMENT_/, icon: FileText, name: 'Documents' },
  { match: /^CLIENT_|^ACCOUNT_/, icon: Users, name: 'Clients' },
  { match: /^INVOICE_/, icon: Receipt, name: 'Invoices' },
  { match: /^EVENT_/, icon: CalendarDays, name: 'Events' },
  { match: /^REQUEST_/, icon: ClipboardList, name: 'Requests' },
  { match: /^MEMBER_|^ROLE_/, icon: Shield, name: 'Users & Roles' },
  { match: /^AUDIT_LOG_/, icon: History, name: 'Audit' },
];

const FALLBACK_FEATURE = { icon: Settings2, name: 'System' };

export function getFeatureForAction(actionType) {
  const upper = actionType?.toUpperCase() || '';
  for (const rule of FEATURE_RULES) {
    if (rule.match.test(upper)) return rule;
  }
  return FALLBACK_FEATURE;
}