import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/services/supabase';
import TopBar from '@/components/layout/TopBar';
import EmptyState from '@/components/shared/EmptyState';
import StatusBadge from '@/components/shared/StatusBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Plus, Search, UserCircle, Pencil, Trash2, Ban, Mail, Phone, Building2, Eye, EyeOff, ArrowUpFromLine } from 'lucide-react';
import { useUserRole } from '@/hooks/useUserRole';
import { PERMISSIONS } from '@/lib/permissions';
import { handleMutationError } from '@/lib/rbac';
import { createClient, deleteUser } from '@/services/inviteService';

const emptyForm = { full_name: '', company_name: '', email: '', password: '', phone: '', address: '', vat_number: '', notes: '' };

async function getClientRoleId() {
  const { data, error } = await supabase
    .from('roles')
    .select('id')
    .eq('name', 'client')
    .single();
  if (error) throw error;
  return data?.id;
}

export default function Clients() {
  const { t } = useTranslation();
  const { role } = useUserRole();
  const canCreate = PERMISSIONS.canCreateClient.includes(role);
  const canDelete = PERMISSIONS.canDeleteClient.includes(role);
  const canBlock = PERMISSIONS.canBlockClient.includes(role);
  const [showForm, setShowForm] = useState(false);
  const [editClient, setEditClient] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [search, setSearch] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [saving, setSaving] = useState(false);
  const [friendlyError, setFriendlyError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [promoteTarget, setPromoteTarget] = useState(null);
  const [promoteRole, setPromoteRole] = useState('');

  const queryClient = useQueryClient();

  const { data: clients = [], isLoading } = useQuery({
    queryKey: ['clients'],
    queryFn: async () => {
      const clientRoleId = await getClientRoleId();
      if (!clientRoleId) return [];

      const { data, error } = await supabase
        .from('profiles')
        .select(`
          id,
          email,
          full_name,
          phone,
          created_at,
          clients!inner (
            is_blocked
          )
        `)
        .eq('role_id', clientRoleId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []).map(p => ({
        id: p.id,
        profile_id: p.id,
        name: p.full_name || p.email || '',
        email: p.email || '',
        phone: p.phone || '',
        status: 'active',
        is_blocked: p.clients?.is_blocked ?? false,
      }));
    },
  });

  const { data: teamRoles = [] } = useQuery({
    queryKey: ['teamRoles'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('roles')
        .select('id, name')
        .in('name', ['super_admin', 'admin', 'manager'])
        .order('name');
      if (error) throw error;
      return data ?? [];
    },
    initialData: [],
  });

  const promoteMutation = useMutation({
    mutationFn: async ({ userId, newRoleId }) => {
      const { data: profile, error } = await supabase
        .from('profiles')
        .update({ role_id: newRoleId })
        .eq('id', userId)
        .select('id, role_id')
        .single();
      if (error) throw error;
      if (!profile) throw new Error('Profile not found after update');
      return { userId, newRoleId };
    },
    onSuccess: async ({ userId, newRoleId }) => {
      const roleName = teamRoles.find(r => r.id === newRoleId)?.name || 'unknown';
      const { data: { user } } = await supabase.auth.getUser();
      const { error: auditError } = await supabase
        .from('audit_logs')
        .insert({
          user_id: user?.id,
          action_type: 'ROLE_UPDATE',
          message: `Promoted ${userId} to ${roleName}`,
          details: { target_user_id: userId, new_role: roleName },
        });
      if (auditError) {
        console.warn('audit log insert failed:', auditError.message);
      }
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      queryClient.invalidateQueries({ queryKey: ['clients', 'dropdown'] });
      queryClient.invalidateQueries({ queryKey: ['clientCount'] });
      queryClient.invalidateQueries({ queryKey: ['teamMemberCount'] });
      queryClient.invalidateQueries({ queryKey: ['profiles'] });
      queryClient.invalidateQueries({ queryKey: ['teamMembers'] });
      queryClient.invalidateQueries({ queryKey: ['managers'] });
      toast.success(`Promoted to ${roleName}`, { description: 'Audit log entry created' });
    },
    onError: (err) => {
      if (!handleMutationError(err, t, toast)) {
        toast.error(err.message);
      }
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      await deleteUser(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      queryClient.invalidateQueries({ queryKey: ['clientCount'] });
      queryClient.invalidateQueries({ queryKey: ['profiles'] });
    },
    onError: (err) => {
      if (!handleMutationError(err, t, toast)) {
        toast.error(err.message);
      }
    },
  });

  const blockMutation = useMutation({
    mutationFn: async (client) => {
      const newBlocked = !client.is_blocked;
      const { error } = await supabase
        .from('clients')
        .update({ is_blocked: newBlocked })
        .eq('profile_id', client.profile_id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients'] });
    },
    onError: (err) => {
      if (!handleMutationError(err, t, toast)) {
        toast.error(err.message);
      }
    },
  });

  const handleDelete = (client) => {
    setDeleteTarget(client.profile_id);
  };

  const openEdit = (client) => {
    setEditClient(client);
    setFriendlyError('');
    setForm({
      full_name: client.name || '',
      company_name: client.company_name || '',
      email: client.email || '',
      phone: client.phone || '',
      address: client.address || '',
      vat_number: client.vat_number || '',
      notes: client.notes || '',
    });
    setShowForm(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!canCreate && !editClient) {
      toast.error(t('accessDenied'));
      return;
    }
    setSaving(true);
    setFriendlyError('');

    try {
      if (editClient) {
        const { error: profileError } = await supabase
          .from('profiles')
          .update({ full_name: form.full_name, phone: form.phone })
          .eq('id', editClient.profile_id);
        if (profileError) throw profileError;
      } else {
        if (!form.email) {
          setFriendlyError('Email is required');
          setSaving(false);
          return;
        }
        await createClient({
          email: form.email,
          password: form.password,
          full_name: form.full_name,
          phone: form.phone,
        });
        toast.success(`Client created (${form.email})`);
      }

      queryClient.invalidateQueries({ queryKey: ['clients'] });
      queryClient.invalidateQueries({ queryKey: ['clientCount'] });
      queryClient.invalidateQueries({ queryKey: ['profiles'] });
      setShowForm(false);
      setEditClient(null);
      setForm(emptyForm);
    } catch (err) {
      setFriendlyError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const filtered = clients.filter(c =>
    !search || c.name?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <TopBar title={t('clients')} />
      <div className="p-6 space-y-6">
        <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder={t('searchClients')} value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
          </div>
          {canCreate && (
            <Button onClick={() => { setEditClient(null); setForm(emptyForm); setShowForm(true); }} className="gap-2">
              <Plus className="w-4 h-4" /> {t('addClient')}
            </Button>
          )}
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState icon={UserCircle} title={t('noClients')} description={t('addFirstClient')} actionLabel={canCreate ? t('addClient') : undefined} onAction={canCreate ? () => setShowForm(true) : undefined} />
        ) : (
          <div className="bg-card rounded-xl border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead>{t('name')}</TableHead>
                  <TableHead className="hidden md:table-cell">{t('contact')}</TableHead>
                  <TableHead className="w-20">{t('actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(client => (
                  <TableRow key={client.id} className="hover:bg-muted/30">
                    <TableCell>
                      <div className="font-medium">{client.name}</div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <div className="space-y-0.5 text-sm">
                        {client.email && <div className="flex items-center gap-1"><Mail className="w-3 h-3" />{client.email}</div>}
                        {client.phone && <div className="flex items-center gap-1"><Phone className="w-3 h-3" />{client.phone}</div>}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(client)}><Pencil className="w-3.5 h-3.5" /></Button>
                        {canBlock && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => blockMutation.mutate(client)}
                            title={client.is_blocked ? t('unblockClient') : t('blockClient')}
                          >
                            <Ban className={`w-3.5 h-3.5 ${client.is_blocked ? 'text-destructive' : 'text-muted-foreground'}`} />
                          </Button>
                        )}
                        {canDelete && (
                          <>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-primary" onClick={() => { setPromoteTarget(client); setPromoteRole(''); }}><ArrowUpFromLine className="w-3.5 h-3.5" /></Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDelete(client)}><Trash2 className="w-3.5 h-3.5" /></Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <Dialog open={showForm} onOpenChange={(v) => { setShowForm(v); setFriendlyError(''); if (!v) setEditClient(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle className="font-heading">{editClient ? t('editClient') : t('addClient')}</DialogTitle></DialogHeader>
          {friendlyError && (
            <div className="bg-destructive/10 text-destructive text-sm rounded-lg px-4 py-3 border border-destructive/20">
              {friendlyError}
            </div>
          )}
          <form onSubmit={handleSave} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Name *</Label><Input value={form.full_name} onChange={e => setForm({...form, full_name: e.target.value})} required /></div>
              <div><Label>Email</Label><Input type="email" value={form.email} onChange={e => setForm({...form, email: e.target.value})} disabled={!!editClient} /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Phone</Label><Input value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} /></div>
            </div>
            {!editClient && (
              <div>
                <Label>Password</Label>
                <div className="relative">
                  <Input
                    type={showPassword ? "text" : "password"}
                    value={form.password}
                    onChange={e => setForm({...form, password: e.target.value})}
                    required={!!form.email}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    aria-pressed={showPassword}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowForm(false)}>{t('cancel')}</Button>
              <Button type="submit" disabled={saving || !form.full_name}>{saving ? t('saving') : t('save')}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete client</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this client and all of their associated data
              (projects, requests, invoices, and messages). This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteTarget(null)}>Keep it</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deleteTarget) deleteMutation.mutate(deleteTarget);
                setDeleteTarget(null);
              }}
            >
              Yes, delete it
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!promoteTarget} onOpenChange={(v) => { if (!v) setPromoteTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Promote to Team Member</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Promote <strong>{promoteTarget?.name}</strong> from client to a team role.
            </p>
            <div className="space-y-2">
              <Label>New Role</Label>
              <Select value={promoteRole} onValueChange={setPromoteRole}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a role" />
                </SelectTrigger>
                <SelectContent>
                  {teamRoles.map((r) => (
                    <SelectItem key={r.id} value={r.id}>{r.name.replace(/_/g, ' ')}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setPromoteTarget(null)}>Cancel</Button>
              <Button
                disabled={!promoteRole || promoteMutation.isPending}
                onClick={() => {
                  if (promoteTarget && promoteRole) {
                    promoteMutation.mutate({ userId: promoteTarget.profile_id, newRoleId: promoteRole });
                    setPromoteTarget(null);
                  }
                }}
              >
                {promoteMutation.isPending ? 'Promoting...' : 'Promote'}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
