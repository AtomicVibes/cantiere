import React from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  Activity, Award, ListChecks, ChevronLeft, ChevronRight, ChevronDown,
  Globe, Lock, Users,
} from 'lucide-react';
import { supabase } from '@/services/supabase';
import StatCard from '@/components/dashboard/StatCard';
import EmptyState from '@/components/shared/EmptyState';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from '@/components/ui/accordion';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  formatDuration, rangeStart, summarizeAgents, getActivityIcon, getTimelineIcon,
} from '@/lib/agentActivity';

const PAGE_SIZE = 50;
const FEED_PAGE_SIZE = 25;

const STATUS_STYLES = {
  online: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  idle: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-300 border-yellow-500/30',
  offline: 'bg-muted text-muted-foreground border-border',
};

function formatDateTime(value, t) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function actionLabel(action, t) {
  const map = {
    project_view: t('activityProjectView', 'Viewed project'),
    document_view: t('activityDocumentView', 'Opened document'),
    invoice_check: t('activityInvoiceCheck', 'Checked invoice'),
    DOCUMENT_UPLOADED: t('activityDocumentUploaded', 'Uploaded document'),
    DOCUMENT_UPDATED: t('activityDocumentUpdated', 'Updated document'),
    DOCUMENT_DELETED: t('activityDocumentDeleted', 'Deleted document'),
    SECTION_NAVIGATED: t('activitySectionOpened', 'Opened section'),
    PROJECT_CREATED: t('activityProjectCreated', 'Created project'),
    PROJECT_UPDATED: t('activityProjectUpdated', 'Updated project'),
    INVOICE_CREATED: t('activityInvoiceCreated', 'Created invoice'),
    INVOICE_UPDATED: t('activityInvoiceUpdated', 'Updated invoice'),
    EVENT_CREATED: t('activityEventCreated', 'Created event'),
    EVENT_UPDATED: t('activityEventUpdated', 'Updated event'),
    BUDGET_CREATED: t('activityBudgetCreated', 'Created budget'),
    BUDGET_UPDATED: t('activityBudgetUpdated', 'Updated budget'),
    EXPENSE_CREATED: t('activityExpenseCreated', 'Created expense'),
    EXPENSE_UPDATED: t('activityExpenseUpdated', 'Updated expense'),
  };
  return map[action] || action;
}

function formatBytes(bytes, t) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function VisibilityBadge({ value, t }) {
  if (!value) return null;
  const config = {
    public: { icon: Globe, cls: 'text-primary', label: t('visibility.public', 'Public') },
    private: { icon: Lock, cls: 'text-muted-foreground', label: t('visibility.private', 'Private') },
    selected: { icon: Users, cls: 'text-accent-foreground', label: t('visibility.selected', 'Selected') },
  }[String(value).toLowerCase()] || null;
  if (!config) return null;
  const Icon = config.icon;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${config.cls}`}>
      <Icon aria-hidden className="w-3.5 h-3.5" />
      {config.label}
    </span>
  );
}

function FeedEntryDetails({ entry, t, resolveProjectName }) {
  const [expanded, setExpanded] = React.useState(false);
  const metadata = entry.metadata && typeof entry.metadata === 'object' ? entry.metadata : {};
  const rows = [];
  if (metadata.section_name) {
    rows.push([t('activityDetailSection', 'Section'), metadata.sub_tab ? `${metadata.section_name} > ${metadata.sub_tab}` : String(metadata.section_name)]);
  }
  if (metadata.file_name) {
    const size = metadata.file_size_bytes != null ? ` (${formatBytes(metadata.file_size_bytes, t)})` : '';
    const type = metadata.file_type ? ` · ${metadata.file_type}` : '';
    rows.push([t('activityDetailFile', 'File'), `${metadata.file_name}${size}${type}`]);
  }
  if (metadata.budget) {
    rows.push([t('budget', 'Budget'), String(metadata.budget)]);
  }
  if (metadata.project_id) {
    rows.push([t('project', 'Project'), resolveProjectName(metadata.project_id)]);
  }
  if (metadata.vendor) rows.push([t('expenseVendor', 'Vendor'), String(metadata.vendor)]);
  if (metadata.total != null) rows.push([t('amount', 'Amount'), String(metadata.total)]);
  if (metadata.client_name) rows.push([t('client', 'Client'), String(metadata.client_name)]);
  if (metadata.url) rows.push([t('activityDetailLink', 'Link'), String(metadata.url)]);
  if (rows.length === 0) return null;
  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="inline-flex items-center gap-1 text-xs text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
      >
        <ChevronDown aria-hidden className={`w-3.5 h-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        {t('activityDetails', 'Details')}
      </button>
      {expanded && (
        <dl className="mt-1.5 rounded-lg border border-border bg-muted/40 px-3 py-2 space-y-1">
          {rows.map(([label, value]) => (
            <div key={label} className="flex items-start justify-between gap-3 text-xs">
              <dt className="text-muted-foreground shrink-0">{label}</dt>
              <dd className="text-right text-foreground break-words min-w-0">{value}</dd>
            </div>
          ))}
          {metadata.visibility && (
            <div className="flex items-center justify-between gap-3 text-xs">
              <dt className="text-muted-foreground shrink-0">{t('visibility.label', 'Visibility')}</dt>
              <dd><VisibilityBadge value={metadata.visibility} t={t} /></dd>
            </div>
          )}
        </dl>
      )}
    </div>
  );
}

export function AgentFeedPanel({ userId, userName, since, active, t }) {
  const [feedPage, setFeedPage] = React.useState(0);

  const feedQuery = useQuery({
    queryKey: ['agent-activity-feed', userId, feedPage, since],
    enabled: active && !!userId,
    queryFn: async () => {
      const from = feedPage * FEED_PAGE_SIZE;
      const { data, error } = await supabase
        .from('agent_action_logs')
        .select('id, action, entity_type, entity_id, metadata, created_at')
        .eq('user_id', userId)
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .range(from, from + FEED_PAGE_SIZE - 1);
      if (error) throw error;
      return data ?? [];
    },
  });

  const projectsQuery = useQuery({
    queryKey: ['agent-activity-projects'],
    enabled: active,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('projects').select('id, name').limit(300);
      if (error) throw error;
      return data ?? [];
    },
  });

  const resolveProjectName = React.useCallback(
    (projectId) => {
      if (!projectId) return '—';
      const found = (projectsQuery.data ?? []).find((p) => p.id === projectId);
      return found?.name || String(projectId).slice(0, 8);
    },
    [projectsQuery.data]
  );

  if (feedQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="w-6 h-6 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }
  if (feedQuery.error) {
    return <p className="text-sm text-destructive py-6 text-center">{t('activityLoadError', 'Could not load activity data.')}</p>;
  }
  if ((feedQuery.data ?? []).length === 0) {
    return <p className="text-sm text-muted-foreground py-6 text-center">{t('activityFeedEmpty', 'No actions in this period.')}</p>;
  }
  return (
    <>
      <ul className="relative mt-1 space-y-0 border-l-2 border-border ml-2 pl-0">
        {(feedQuery.data ?? []).map((entry) => {
          const metadata = entry.metadata && typeof entry.metadata === 'object' ? entry.metadata : {};
          const headline = metadata.file_name || metadata.section_name || null;
          const Icon = getTimelineIcon(entry);
          return (
            <li key={entry.id} className="relative pl-8 pb-4 last:pb-1">
              <span aria-hidden className="absolute left-0 top-0.5 -translate-x-1/2 w-6 h-6 rounded-full bg-muted border border-border flex items-center justify-center">
                <Icon className="w-3.5 h-3.5 text-muted-foreground" />
              </span>
              <p className="text-sm font-medium">
                {actionLabel(entry.action, t)}
                {headline ? `: ${headline}` : ''}
              </p>
              <p className="text-xs text-muted-foreground">
                {formatDateTime(entry.created_at, t)}
                {entry.entity_type ? ` · ${entry.entity_type}` : ''}
              </p>
              <FeedEntryDetails entry={entry} t={t} resolveProjectName={resolveProjectName} />
            </li>
          );
        })}
      </ul>
      <div className="flex items-center justify-between mt-3">
        <Button variant="outline" size="sm" disabled={feedPage === 0} onClick={() => setFeedPage((p) => Math.max(0, p - 1))}>
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <span className="text-xs text-muted-foreground">{t('page', 'Page')} {feedPage + 1}</span>
        <Button
          variant="outline"
          size="sm"
          disabled={(feedQuery.data ?? []).length < FEED_PAGE_SIZE}
          onClick={() => setFeedPage((p) => p + 1)}
        >
          <ChevronRight className="w-4 h-4" />
        </Button>
      </div>
    </>
  );
}

export default function AgentActivityDashboard({ active }) {
  const { t } = useTranslation();
  const [range, setRange] = React.useState('today');
  const [expanded, setExpanded] = React.useState([]);

  const since = React.useMemo(() => rangeStart(range), [range]);

  const sessionsQuery = useQuery({
    queryKey: ['agent-activity-sessions', range],
    enabled: active,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('agent_sessions')
        .select('id, user_id, login_at, logout_at, last_heartbeat_at, is_active')
        .gte('login_at', since)
        .order('login_at', { ascending: false })
        .limit(500);
      if (error) throw error;
      return data ?? [];
    },
  });

  const sessions = sessionsQuery.data ?? [];
  const userIds = React.useMemo(
    () => [...new Set(sessions.map((s) => s.user_id).filter(Boolean))],
    [sessions]
  );

  const profilesQuery = useQuery({
    queryKey: ['agent-activity-profiles', userIds.join(',')],
    enabled: active && userIds.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, email, job_title')
        .in('id', userIds);
      if (error) throw error;
      return data ?? [];
    },
  });

  const profilesById = React.useMemo(() => {
    const map = {};
    for (const p of profilesQuery.data ?? []) map[p.id] = p;
    return map;
  }, [profilesQuery.data]);

  const actionsTodayQuery = useQuery({
    queryKey: ['agent-activity-actions-today'],
    enabled: active,
    staleTime: 30_000,
    queryFn: async () => {
      const start = rangeStart('today');
      const { count, error } = await supabase
        .from('agent_action_logs')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', start);
      if (error) throw error;
      return count ?? 0;
    },
  });

  const agents = React.useMemo(
    () => summarizeAgents(sessions, profilesById).sort((a, b) => b.totalSeconds - a.totalSeconds),
    [sessions, profilesById]
  );

  const activeToday = React.useMemo(
    () => new Set(sessions.map((s) => s.user_id).filter(Boolean)).size,
    [sessions]
  );

  const mostActive = agents[0] || null;
  const actionsToday = actionsTodayQuery.data ?? 0;

  const isLoading = sessionsQuery.isLoading || profilesQuery.isLoading;
  const loadError = sessionsQuery.error || profilesQuery.error;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <h3 className="font-heading font-semibold">{t('activityTracking', 'Activity Tracking')}</h3>
        <Select value={range} onValueChange={setRange}>
          <SelectTrigger className="w-40" aria-label={t('activityRange', 'Time range')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="today">{t('activityToday', 'Today')}</SelectItem>
            <SelectItem value="7d">{t('activity7d', 'Past 7 days')}</SelectItem>
            <SelectItem value="30d">{t('activity30d', 'Past 30 days')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard title={t('activityActiveToday', 'Active agents today')} value={String(activeToday)} icon={Activity} color="primary" />
        <StatCard
          title={t('activityMostActive', 'Most active agent')}
          value={mostActive ? mostActive.name : '—'}
          icon={Award}
          color="success"
          subtitle={mostActive ? formatDuration(mostActive.totalSeconds) : undefined}
        />
        <StatCard title={t('activityActionsToday', 'Actions logged today')} value={String(actionsToday)} icon={ListChecks} color="blue" />
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
        </div>
      ) : loadError ? (
        <div className="text-center py-12 text-sm text-destructive">
          {t('activityLoadError', 'Could not load activity data.')}
        </div>
      ) : agents.length === 0 ? (
        <EmptyState icon={Activity} title={t('activityEmpty', 'No activity yet')} description={t('activityEmptyHint', 'Agent sessions will appear here.')} />
      ) : (
        <Accordion
          type="multiple"
          value={expanded}
          onValueChange={setExpanded}
          className="bg-card rounded-xl border border-border overflow-hidden px-4"
        >
          {agents.slice(0, PAGE_SIZE).map((agent) => {
            const AgentIcon = getActivityIcon('team_assignment');
            return (
              <AccordionItem key={agent.userId} value={agent.userId} className="border-b border-border/50 last:border-0">
                <AccordionTrigger className="py-3 hover:no-underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset rounded">
                  <span className="flex flex-1 flex-wrap items-center gap-x-3 gap-y-1 min-w-0 text-left">
                    <span aria-hidden className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
                      <AgentIcon className="w-4 h-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium truncate">{agent.name}</span>
                      <span className="block text-xs text-muted-foreground truncate">
                        {agent.jobTitle || t('activityAgent', 'Agent')}
                      </span>
                    </span>
                    <Badge variant="outline" className={STATUS_STYLES[agent.status]}>
                      {t(`activity${agent.status[0].toUpperCase()}${agent.status.slice(1)}`, agent.status)}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {formatDateTime(agent.lastActive, t)} · {t('activityDuration', 'Active time')}: {formatDuration(agent.totalSeconds)}
                    </span>
                  </span>
                </AccordionTrigger>
                <AccordionContent className="pb-4">
                  <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2 text-xs text-muted-foreground">
                    <p>
                      <span className="font-medium text-foreground">{t('activityLastLogin', 'Last login')}: </span>
                      {formatDateTime(agent.lastLogin, t)}
                    </p>
                    <p>
                      <span className="font-medium text-foreground">{t('activityLastActive', 'Last active')}: </span>
                      {formatDateTime(agent.lastActive, t)}
                    </p>
                  </div>
                  <AgentFeedPanel userId={agent.userId} userName={agent.name} since={since} active={active} t={t} />
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      )}
    </div>
  );
}
