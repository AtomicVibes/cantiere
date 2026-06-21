import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/services/supabase';
import TopBar from '@/components/layout/TopBar';
import EmptyState from '@/components/shared/EmptyState';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollText } from 'lucide-react';
import { format } from 'date-fns';

const ACTION_BADGES = {
  FILE_UPLOAD: 'bg-blue-500',
  PROJECT_CREATE: 'bg-green-500',
  MEMBER_ADD: 'bg-purple-500',
  INVOICE_CREATE: 'bg-amber-500',
};

export default function Logs() {
  const { t } = useTranslation();
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchLogs = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data, error } = await supabase
      .from('audit_logs')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(100);

    if (!error && data) setLogs(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchLogs();

    const channel = supabase
      .channel('audit_logs_changes')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'audit_logs' },
        (payload) => {
          setLogs((prev) => [payload.new, ...prev].slice(0, 100));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchLogs]);

  const getBadgeClass = (actionType) => {
    return ACTION_BADGES[actionType] || 'bg-slate-500';
  };

  const getActionLabel = (actionType) => {
    const key = `logs.${actionType?.toLowerCase().replace(/_([a-z])/g, (_, c) => c.toUpperCase())}`;
    const label = t(key);
    return label === key ? actionType?.replace(/_/g, ' ') : label;
  };

  return (
    <div>
      <TopBar title={t('logs.auditLogs')} />
      <div className="p-6 space-y-6">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
          </div>
        ) : logs.length === 0 ? (
          <EmptyState icon={ScrollText} title={t('logs.auditLogs')} description="No audit logs recorded yet" />
        ) : (
          <div className="bg-card rounded-xl border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead>{t('logs.time')}</TableHead>
                  <TableHead>{t('logs.action')}</TableHead>
                  <TableHead className="hidden md:table-cell">{t('logs.document')}</TableHead>
                  <TableHead className="hidden lg:table-cell">{t('logs.message')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => (
                  <TableRow key={log.id} className="hover:bg-muted/30">
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                      {log.created_at ? format(new Date(log.created_at), 'MMM d, h:mm a') : '-'}
                    </TableCell>
                    <TableCell>
                      <Badge className={`${getBadgeClass(log.action_type)} text-white`}>
                        {getActionLabel(log.action_type)}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-sm">
                      {log.document_name || '-'}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-sm text-muted-foreground max-w-xs truncate">
                      {log.action_message || '-'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
