import React from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  Activity, Award, ListChecks, X, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { supabase } from '@/services/supabase';
import StatCard from '@/components/dashboard/StatCard';
import EmptyState from '@/components/shared/EmptyState';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import {
  formatDuration, rangeStart, summarizeAgents,
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
  };
  return map[action] || action;
}

export default function AgentActivityDashboard({ active }) {
  const { t } = useTranslation();
  const [range, setRange] = React.useState('today');
  const [selectedAgent, setSelectedAgent] = React.useState(null);
  const [feedPage, setFeedPage] = React.useState(0);

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

  const feedQuery = useQuery({
    queryKey: ['agent-activity-feed', selectedAgent?.userId, feedPage, range],
    enabled: active && !!selectedAgent,
    queryFn: async () => {
      const from = feedPage * FEED_PAGE_SIZE;
      const { data, error } = await supabase
        .from('agent_action_logs')
        .select('id, action, entity_type, entity_id, metadata, created_at')
        .eq('user_id', selectedAgent.userId)
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .range(from, from + FEED_PAGE_SIZE - 1);
      if (error) throw error;
      return data ?? [];
    },
  });

  const openAgent = (agent) => {
    setSelectedAgent(agent);
    setFeedPage(0);
  };

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
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 text-left">
                  <th className="px-4 py-2.5 font-semibold">{t('activityAgent', 'Agent')}</th>
                  <th className="px-4 py-2.5 font-semibold hidden md:table-cell">{t('jobTitle')}</th>
                  <th className="px-4 py-2.5 font-semibold">{t('activityStatus', 'Status')}</th>
                  <th className="px-4 py-2.5 font-semibold hidden sm:table-cell">{t('activityLastLogin', 'Last login')}</th>
                  <th className="px-4 py-2.5 font-semibold hidden sm:table-cell">{t('activityLastActive', 'Last active')}</th>
                  <th className="px-4 py-2.5 font-semibold">{t('activityDuration', 'Active time')}</th>
                </tr>
              </thead>
              <tbody>
                {agents.slice(0, PAGE_SIZE).map((agent) => (
                  <tr
                    key={agent.userId}
                    onClick={() => openAgent(agent)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') openAgent(agent); }}
                    tabIndex={0}
                    className="border-t border-border hover:bg-muted/30 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                  >
                    <td className="px-4 py-2.5 font-medium">{agent.name}</td>
                    <td className="px-4 py-2.5 text-muted-foreground hidden md:table-cell">{agent.jobTitle || '—'}</td>
                    <td className="px-4 py-2.5">
                      <Badge variant="outline" className={STATUS_STYLES[agent.status]}>
                        {t(`activity${agent.status[0].toUpperCase()}${agent.status.slice(1)}`, agent.status)}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground hidden sm:table-cell">{formatDateTime(agent.lastLogin, t)}</td>
                    <td className="px-4 py-2.5 text-muted-foreground hidden sm:table-cell">{formatDateTime(agent.lastActive, t)}</td>
                    <td className="px-4 py-2.5">{formatDuration(agent.totalSeconds)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Sheet open={!!selectedAgent} onOpenChange={(v) => { if (!v) setSelectedAgent(null); }}>
        <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="font-heading">
              {selectedAgent?.name} — {t('activityFeed', 'Activity feed')}
            </SheetTitle>
          </SheetHeader>
          {feedQuery.isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-6 h-6 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
            </div>
          ) : feedQuery.error ? (
            <p className="text-sm text-destructive py-8 text-center">{t('activityLoadError', 'Could not load activity data.')}</p>
          ) : (feedQuery.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">{t('activityFeedEmpty', 'No actions in this period.')}</p>
          ) : (
            <>
              <ul className="mt-4 space-y-3">
                {(feedQuery.data ?? []).map((entry) => (
                  <li key={entry.id} className="border-b border-border/50 pb-2.5">
                    <p className="text-sm font-medium">{actionLabel(entry.action, t)}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDateTime(entry.created_at, t)}
                      {entry.entity_type ? ` · ${entry.entity_type}` : ''}
                    </p>
                  </li>
                ))}
              </ul>
              <div className="flex items-center justify-between mt-4">
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
          )}
          <Button variant="ghost" size="sm" className="mt-4 gap-2" onClick={() => setSelectedAgent(null)}>
            <X className="w-4 h-4" /> {t('close')}
          </Button>
        </SheetContent>
      </Sheet>
    </div>
  );
}
