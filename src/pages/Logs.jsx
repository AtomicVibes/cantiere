import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/services/supabase';
import TopBar from '@/components/layout/TopBar';
import EmptyState from '@/components/shared/EmptyState';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from '@/components/ui/pagination';
import { ScrollText, Search, User } from 'lucide-react';
import { format } from 'date-fns';

const PAGE_SIZE = 25;

function badgeColor(actionType) {
  const upper = actionType?.toUpperCase() || '';
  if (upper.includes('INSERT') || upper.includes('CREATE') || upper.includes('UPLOAD')) return 'bg-green-500';
  if (upper.includes('UPDATE') || upper.includes('EDIT')) return 'bg-amber-500';
  if (upper.includes('DELETE') || upper.includes('REMOVE')) return 'bg-red-500';
  return 'bg-slate-500';
}

export default function Logs() {
  const [logs, setLogs] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const from = (page - 1) * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      const { data, count, error } = await supabase
        .from('audit_logs')
        .select('*', { count: 'exact', head: false })
        .order('created_at', { ascending: false })
        .range(from, to);

      if (!error && data) {
        setLogs(data);
        if (count !== null) setTotalCount(count);
      }
    } catch { } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  useEffect(() => {
    const channel = supabase
      .channel('audit_logs_changes')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'audit_logs' }, (payload) => {
        setLogs((prev) => [payload.new, ...prev].slice(0, PAGE_SIZE));
        setTotalCount((prev) => prev + 1);
      })
      .subscribe((status, err) => {
        if (err) console.warn('audit_logs realtime error:', err);
      });
    return () => { supabase.removeChannel(channel); };
  }, []);

  useEffect(() => { setPage(1); }, [search]);

  const filteredLogs = useMemo(() => {
    if (!search) return logs;
    const q = search.toLowerCase();
    return logs.filter(
      (log) =>
        log.action_type?.toLowerCase().includes(q) ||
        log.message?.toLowerCase().includes(q) ||
        log.details?.table?.toLowerCase().includes(q)
    );
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
          <PaginationLink isActive={i === page} onClick={() => handlePageChange(i)}>{i}</PaginationLink>
        </PaginationItem>
      );
    }
    return pages;
  };

  return (
    <div>
      <TopBar title="Audit Logs" />
      <div className="p-6 space-y-6">
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search actions, messages, tables..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
          </div>
        ) : filteredLogs.length === 0 ? (
          <EmptyState icon={ScrollText} title="Audit Logs" description="No audit logs recorded yet" />
        ) : (
          <>
            <div className="bg-card rounded-xl border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead>Timestamp</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead className="hidden sm:table-cell">Table</TableHead>
                    <TableHead className="hidden md:table-cell">Record</TableHead>
                    <TableHead className="hidden lg:table-cell">User</TableHead>
                    <TableHead className="hidden lg:table-cell">Message</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredLogs.map((log) => (
                    <TableRow key={log.id} className="hover:bg-muted/30">
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                        {log.created_at ? format(new Date(log.created_at), 'MMM dd, yyyy HH:mm') : '-'}
                      </TableCell>
                      <TableCell>
                        <Badge className={`${badgeColor(log.action_type)} text-white`}>
                          {log.action_type?.replace(/_/g, ' ') || '-'}
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
                        {log.details?.table || '-'}
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-sm text-muted-foreground font-mono">
                        {log.details?.record_id ? log.details.record_id.substring(0, 8) + '...' : '-'}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <User className="w-3 h-3" />
                          {log.user_id ? log.user_id.substring(0, 8) + '...' : '-'}
                        </span>
                      </TableCell>
                      <TableCell className="hidden lg:table-cell text-sm text-muted-foreground max-w-xs truncate">
                        {log.message || '-'}
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
