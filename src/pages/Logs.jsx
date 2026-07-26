import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/services/supabase';
import TopBar from '@/components/layout/TopBar';
import EmptyState from '@/components/shared/EmptyState';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Pagination, PaginationContent, PaginationItem, PaginationLink,
  PaginationNext, PaginationPrevious,
} from '@/components/ui/pagination';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ScrollText, Search, User, Archive, Trash2, Loader2, RotateCcw } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { useIsSuperAdmin } from '@/hooks/useIsSuperAdmin';

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
  const [view, setView] = useState('active'); // 'active' | 'archived'
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [mutating, setMutating] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null); // { mode: 'selected'|'all'|'single', id?: string }

  const { isSuperAdmin } = useIsSuperAdmin();

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const from = (page - 1) * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      let query = supabase
        .from('audit_logs')
        .select('*', { count: 'exact', head: false })
        .eq('archived', view === 'archived')
        .order('created_at', { ascending: false })
        .range(from, to);

      const { data, count, error } = await query;

      if (!error && data) {
        setLogs(data);
        if (count !== null) setTotalCount(count);
      }
    } catch { } finally {
      setLoading(false);
    }
  }, [page, view]);

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

  const visibleLogs = useMemo(() => {
    if (!search) return logs;
    const q = search.toLowerCase();
    return logs.filter(
      (log) =>
        log.action_type?.toLowerCase().includes(q) ||
        log.message?.toLowerCase().includes(q) ||
        log.details?.table?.toLowerCase().includes(q)
    );
  }, [logs, search]);

  const allVisibleSelected = visibleLogs.length > 0 && visibleLogs.every((log) => selectedIds.has(log.id));

  const toggleSelectAll = () => {
    if (allVisibleSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(visibleLogs.map((log) => log.id)));
    }
  };

  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handlePageChange = (p) => {
    if (p >= 1 && p <= totalPages) {
      setPage(p);
      setSelectedIds(new Set());
    }
  };

  const handleDeleteConfirm = (mode, id) => {
    setDeleteTarget({ mode, id });
    setConfirmDeleteOpen(true);
  };

  const executeDelete = async () => {
    setMutating(true);
    try {
      let query = supabase.from('audit_logs').delete();
      let count = 0;
      if (deleteTarget.mode === 'selected') {
        query = query.in('id', [...selectedIds]);
        count = selectedIds.size;
      } else if (deleteTarget.mode === 'single') {
        query = query.eq('id', deleteTarget.id);
        count = 1;
      }
      const { error } = await query;
      if (error) throw error;
      toast.success(`Deleted ${count} audit log${count !== 1 ? 's' : ''}`);
      setSelectedIds(new Set());
      fetchLogs();
    } catch (err) {
      toast.error(err.message || 'Failed to delete');
    } finally {
      setMutating(false);
      setConfirmDeleteOpen(false);
      setDeleteTarget(null);
    }
  };

  const handleViewChange = (newView) => {
    if (newView !== view) {
      setView(newView);
      setPage(1);
      setSelectedIds(new Set());
    }
  };

  const executeRestore = async (ids) => {
    setMutating(true);
    try {
      const idsArr = Array.isArray(ids) ? ids : [ids];
      const { error } = await supabase
        .from('audit_logs')
        .update({ archived: false })
        .in('id', idsArr);
      if (error) throw error;
      toast.success(`Restored ${idsArr.length} audit log${idsArr.length !== 1 ? 's' : ''}`);
      setSelectedIds(new Set());
      fetchLogs();
    } catch (err) {
      toast.error(err.message || 'Failed to restore');
    } finally {
      setMutating(false);
    }
  };

  const executeArchive = async (ids) => {
    setMutating(true);
    try {
      const idsArr = Array.isArray(ids) ? ids : [ids];
      const { error } = await supabase
        .from('audit_logs')
        .update({ archived: true })
        .in('id', idsArr);
      if (error) throw error;
      toast.success(`Archived ${idsArr.length} audit log${idsArr.length !== 1 ? 's' : ''}`);
      setSelectedIds(new Set());
      fetchLogs();
    } catch (err) {
      toast.error(err.message || 'Failed to archive');
    } finally {
      setMutating(false);
    }
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
        {/* Search bar */}
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search actions, messages, tables..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* View toggle */}
        {isSuperAdmin && (
          <div className="flex items-center gap-1 border-b border-border pb-3">
            <button
              onClick={() => handleViewChange('active')}
              className={`px-4 py-1.5 text-sm rounded-md transition-colors ${
                view === 'active'
                  ? 'bg-primary/10 text-primary font-semibold'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Active
            </button>
            <button
              onClick={() => handleViewChange('archived')}
              className={`px-4 py-1.5 text-sm rounded-md transition-colors ${
                view === 'archived'
                  ? 'bg-primary/10 text-primary font-semibold'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Archived
            </button>
          </div>
        )}

        {/* Action bar — super admin only */}
        {isSuperAdmin && visibleLogs.length > 0 && (
          <div className="flex items-center gap-3 flex-wrap">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox checked={allVisibleSelected} onCheckedChange={toggleSelectAll} />
              Select All
            </label>

            <div className="flex items-center gap-2 ml-auto">
              {view === 'active' ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    disabled={mutating || selectedIds.size === 0}
                    onClick={() => executeArchive([...selectedIds])}
                  >
                    <Archive className="w-3.5 h-3.5" />
                    Archive Selected
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    disabled={mutating}
                    onClick={() => executeArchive(visibleLogs.map((l) => l.id))}
                  >
                    <Archive className="w-3.5 h-3.5" />
                    Archive All
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    disabled={mutating || selectedIds.size === 0}
                    onClick={() => executeRestore([...selectedIds])}
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Restore Selected
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    disabled={mutating}
                    onClick={() => executeRestore(visibleLogs.map((l) => l.id))}
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Restore All
                  </Button>
                </>
              )}

              <Button
                variant="destructive"
                size="sm"
                className="gap-2"
                disabled={mutating || selectedIds.size === 0}
                onClick={() => handleDeleteConfirm('selected')}
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete Selected
              </Button>

              <Button
                variant="destructive"
                size="sm"
                className="gap-2"
                disabled={mutating}
                onClick={() => handleDeleteConfirm('all')}
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete All
              </Button>

              {mutating && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
            </div>
          </div>
        )}

        {/* Content */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : visibleLogs.length === 0 ? (
          <EmptyState icon={ScrollText} title="Audit Logs" description={view === 'archived' ? 'No archived logs' : 'No audit logs recorded yet'} />
        ) : (
          <>
            <div className="bg-card rounded-xl border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    {isSuperAdmin && <TableHead className="w-10" />}
                    <TableHead>Timestamp</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead className="hidden sm:table-cell">Table</TableHead>
                    <TableHead className="hidden md:table-cell">Record</TableHead>
                    <TableHead className="hidden lg:table-cell">User</TableHead>
                    <TableHead className="hidden lg:table-cell">Message</TableHead>
                    {isSuperAdmin && <TableHead className="w-24" />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleLogs.map((log) => (
                    <TableRow key={log.id} className="hover:bg-muted/30">
                      {isSuperAdmin && (
                        <TableCell>
                          <Checkbox
                            checked={selectedIds.has(log.id)}
                            onCheckedChange={() => toggleSelect(log.id)}
                          />
                        </TableCell>
                      )}
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
                      {isSuperAdmin && (
                        <TableCell>
                          <div className="flex items-center gap-1">
                            {view === 'active' ? (
                              <button
                                onClick={() => executeArchive(log.id)}
                                disabled={mutating}
                                className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
                                title="Archive"
                              >
                                <Archive className="w-3.5 h-3.5" />
                              </button>
                            ) : (
                              <button
                                onClick={() => executeRestore(log.id)}
                                disabled={mutating}
                                className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
                                title="Restore"
                              >
                                <RotateCcw className="w-3.5 h-3.5" />
                              </button>
                            )}
                            <button
                              onClick={() => handleDeleteConfirm('single', log.id)}
                              disabled={mutating}
                              className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-destructive transition-colors disabled:opacity-40"
                              title="Delete"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </TableCell>
                      )}
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

      {/* Delete Confirmation Modal */}
      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Permanent Deletion</AlertDialogTitle>
            <AlertDialogDescription>
              This action is permanent and will delete everything permanently. Do you still wish to proceed?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={mutating}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={executeDelete}
              disabled={mutating}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {mutating && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Confirm Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
