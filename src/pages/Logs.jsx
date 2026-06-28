import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/services/supabase';
import TopBar from '@/components/layout/TopBar';
import EmptyState from '@/components/shared/EmptyState';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from '@/components/ui/pagination';
import { ScrollText, Search } from 'lucide-react';
import { format } from 'date-fns';

const PAGE_SIZE = 25;

const ACTION_BADGES = {
  PROJECT_CREATE: 'bg-green-500',
  PROJECT_UPDATE: 'bg-blue-500',
  PROJECT_DELETE: 'bg-red-500',
  TIMELINE_CREATE: 'bg-purple-500',
  TIMELINE_UPDATE: 'bg-amber-500',
  TIMELINE_DELETE: 'bg-red-400',
};

function getBadgeClass(action) {
  return ACTION_BADGES[action] || 'bg-slate-500';
}

function getActionLabel(action, t) {
  const key = `logs.${action?.toLowerCase().replace(/_([a-z])/g, (_, c) => c.toUpperCase())}`;
  const label = t(key);
  return label === key ? action?.replace(/_/g, ' ') : label;
}

export default function Logs() {
  const { t } = useTranslation();
  const [logs, setLogs] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [tableFilter, setTableFilter] = useState('all');

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const from = (page - 1) * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      let query = supabase.from('audit_logs').select('*', { count: 'exact', head: false });

      if (tableFilter !== 'all') {
        query = query.eq('table_name', tableFilter);
      }

      const { data, count, error } = await query
        .order('created_at', { ascending: false })
        .range(from, to);

      if (!error && data) {
        setLogs(data);
        if (count !== null) setTotalCount(count);
      }
    } catch { } finally {
      setLoading(false);
    }
  }, [page, tableFilter]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  useEffect(() => {
    const channel = supabase
      .channel('audit_logs_changes')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'audit_logs' }, (payload) => {
        setLogs((prev) => {
          const next = [payload.new, ...prev];
          return next.slice(0, PAGE_SIZE);
        });
        setTotalCount((prev) => prev + 1);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  useEffect(() => {
    setPage(1);
  }, [search, tableFilter]);

  const filteredLogs = useMemo(() => {
    if (!search) return logs;
    const q = search.toLowerCase();
    return logs.filter((log) => log.action?.toLowerCase().includes(q));
  }, [logs, search]);

  const handlePageChange = (p) => {
    if (p >= 1 && p <= totalPages) setPage(p);
  };

  const renderPageNumbers = () => {
    const pages = [];
    const start = Math.max(1, page - 2);
    const end = Math.min(totalPages, page + 2);

    for (let i = start; i <= end; i++) {
      pages.push(
        <PaginationItem key={i}>
          <PaginationLink isActive={i === page} onClick={() => handlePageChange(i)}>
            {i}
          </PaginationLink>
        </PaginationItem>
      );
    }
    return pages;
  };

  return (
    <div>
      <TopBar title={t('logs.auditLogs')} />
      <div className="p-6 space-y-6">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder={t('search')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="w-full sm:w-48">
            <Select value={tableFilter} onValueChange={setTableFilter}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('all')}</SelectItem>
                <SelectItem value="projects">projects</SelectItem>
                <SelectItem value="project_timeline">project_timeline</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
          </div>
        ) : filteredLogs.length === 0 ? (
          <EmptyState icon={ScrollText} title={t('logs.auditLogs')} description="No audit logs recorded yet" />
        ) : (
          <>
            <div className="bg-card rounded-xl border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead>{t('logs.time')}</TableHead>
                    <TableHead>{t('logs.action')}</TableHead>
                    <TableHead className="hidden md:table-cell">Table</TableHead>
                    <TableHead className="hidden lg:table-cell">Record</TableHead>
                    <TableHead className="hidden lg:table-cell">{t('logs.message')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredLogs.map((log) => (
                    <TableRow key={log.id} className="hover:bg-muted/30">
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                        {log.created_at ? format(new Date(log.created_at), 'MMM d, h:mm a') : '-'}
                      </TableCell>
                      <TableCell>
                        <Badge className={`${getBadgeClass(log.action)} text-white`}>
                          {getActionLabel(log.action, t)}
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                        {log.table_name || '-'}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell text-sm text-muted-foreground font-mono">
                        {log.record_id ? log.record_id.substring(0, 8) + '...' : '-'}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell text-sm text-muted-foreground max-w-xs truncate">
                        {log.details ? JSON.stringify(log.details) : '-'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {totalPages > 1 && (
              <Pagination>
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious onClick={() => handlePageChange(page - 1)} />
                  </PaginationItem>
                  {renderPageNumbers()}
                  <PaginationItem>
                    <PaginationNext onClick={() => handlePageChange(page + 1)} />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            )}
          </>
        )}
      </div>
    </div>
  );
}
