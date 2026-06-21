import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/services/supabase';
import { base44 } from '@/api/base44Client';
import TopBar from '@/components/layout/TopBar';
import EmptyState from '@/components/shared/EmptyState';
import StatusBadge from '@/components/shared/StatusBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Plus, Search, UserCircle, Pencil, Trash2, Mail, Phone, Building2 } from 'lucide-react';
import { useUserRole } from '@/hooks/useUserRole';
import { PERMISSIONS } from '@/lib/permissions';
import { handleMutationError } from '@/lib/rbac';
import { inviteClientByEmail, deleteUser } from '@/services/inviteService';

const emptyClient = { name: '', company_name: '', email: '', phone: '', address: '', zip_code: '', vat_number: '', notes: '', status: 'active' };

export default function Clients() {
  const { t } = useTranslation();
  const { role } = useUserRole();
  const canCreate = PERMISSIONS.canCreateClient.includes(role);
  const canDelete = PERMISSIONS.canDeleteClient.includes(role);
  const [showForm, setShowForm] = useState(false);
  const [editClient, setEditClient] = useState(null);
  const [form, setForm] = useState(emptyClient);
  const [search, setSearch] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [saving, setSaving] = useState(false);
  const [friendlyError, setFriendlyError] = useState('');
  const [inviteMode, setInviteMode] = useState('direct');
  const queryClient = useQueryClient();

  const { data: clients = [] } = useQuery({
    queryKey: ['clients'],
    queryFn: async () => {
      const { data: profiles, error } = await supabase
        .from('profiles')
        .select('id, email, full_name, phone, roles:roles!profiles_role_id_fkey(name)')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (profiles ?? [])
        .filter(p => p.roles?.name === 'client')
        .map(p => ({
          id: p.id,
          name: p.full_name || p.email || '',
          email: p.email || '',
          phone: p.phone || '',
          company_name: '',
          vat_number: '',
          status: 'active',
        }));
    },
    initialData: [],
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.Client.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      queryClient.invalidateQueries({ queryKey: ['profiles'] });
    },
    onError: (err) => handleMutationError(err, t, toast),
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Client.update(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['clients'] }),
    onError: (err) => handleMutationError(err, t, toast),
  });
  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      await deleteUser(id);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['clients'] }),
    onError: (err) => {
      if (!handleMutationError(err, t, toast)) {
        toast.error(err.message);
      }
    },
  });

  const openEdit = (client) => {
    setEditClient(client);
    setFriendlyError('');
    setForm({
      name: client.name || '', company_name: client.company_name || '', email: client.email || '',
      phone: client.phone || '', address: client.address || '', zip_code: client.zip_code || '',
      vat_number: client.vat_number || '', notes: client.notes || '', status: client.status || 'active',
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
    if (editClient) {
      await updateMutation.mutateAsync({ id: editClient.id, data: form });
      if (form.email) {
        const { error: updateError } = await supabase
          .from('profiles')
          .update({ full_name: form.name, phone: form.phone })
          .eq('id', editClient.id);
        if (updateError) throw updateError;
      }
    } else {
      if (form.email) {
        try {
          const { user } = await inviteClientByEmail({
            email: form.email,
            full_name: form.name,
            phone: form.phone,
            mode: inviteMode,
          });
          toast.success(inviteMode === 'direct' ? `User created (${user?.email})` : 'Invite sent!');
        } catch (inviteErr) {
          setSaving(false);
          setFriendlyError(inviteErr.message);
          return;
        }
      }
      await createMutation.mutateAsync(form);
    }
    setSaving(false);
    setShowForm(false);
    setEditClient(null);
    setForm(emptyClient);
  };

  const filtered = clients.filter(c =>
    !search || c.name?.toLowerCase().includes(search.toLowerCase()) || c.company_name?.toLowerCase().includes(search.toLowerCase())
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
            <Button onClick={() => { setEditClient(null); setForm(emptyClient); setInviteMode('direct'); setShowForm(true); }} className="gap-2">
              <Plus className="w-4 h-4" /> {t('addClient')}
            </Button>
          )}
        </div>

        {filtered.length === 0 ? (
          <EmptyState icon={UserCircle} title={t('noClients')} description={t('addFirstClient')} actionLabel={canCreate ? t('addClient') : undefined} onAction={canCreate ? () => setShowForm(true) : undefined} />
        ) : (
          <div className="bg-card rounded-xl border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead>{t('name')}</TableHead>
                  <TableHead className="hidden md:table-cell">{t('company')}</TableHead>
                  <TableHead className="hidden md:table-cell">{t('contact')}</TableHead>
                  <TableHead>{t('status')}</TableHead>
                  <TableHead className="w-20">{t('actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(client => (
                  <TableRow key={client.id} className="hover:bg-muted/30">
                    <TableCell>
                      <div className="font-medium">{client.name}</div>
                      {client.vat_number && <div className="text-xs text-muted-foreground">VAT: {client.vat_number}</div>}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {client.company_name && (
                        <span className="flex items-center gap-1 text-sm"><Building2 className="w-3.5 h-3.5" />{client.company_name}</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <div className="space-y-0.5 text-sm">
                        {client.email && <div className="flex items-center gap-1"><Mail className="w-3 h-3" />{client.email}</div>}
                        {client.phone && <div className="flex items-center gap-1"><Phone className="w-3 h-3" />{client.phone}</div>}
                      </div>
                    </TableCell>
                    <TableCell><StatusBadge status={client.status} /></TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(client)}><Pencil className="w-3.5 h-3.5" /></Button>
                        {canDelete && (
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => setDeleteTarget(client.id)}><Trash2 className="w-3.5 h-3.5" /></Button>
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
              <div><Label>Name *</Label><Input value={form.name} onChange={e => setForm({...form, name: e.target.value})} required /></div>
              <div><Label>Company</Label><Input value={form.company_name} onChange={e => setForm({...form, company_name: e.target.value})} /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Email</Label><Input type="email" value={form.email} onChange={e => setForm({...form, email: e.target.value})} /></div>
              <div><Label>Phone</Label><Input value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} /></div>
            </div>
            {!editClient && (
              <div>
                <Label>Provisioning</Label>
                <select
                  value={inviteMode}
                  onChange={e => setInviteMode(e.target.value)}
                  className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option value="direct">Direct Creation (no email)</option>
                  <option value="invite">Send Invitation Email</option>
                </select>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Address</Label><Input value={form.address} onChange={e => setForm({...form, address: e.target.value})} /></div>
              <div><Label>ZIP Code</Label><Input value={form.zip_code} onChange={e => setForm({...form, zip_code: e.target.value})} /></div>
            </div>
            <div><Label>VAT Number</Label><Input value={form.vat_number} onChange={e => setForm({...form, vat_number: e.target.value})} /></div>
            <div><Label>Notes</Label><Textarea value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} rows={3} /></div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowForm(false)}>{t('cancel')}</Button>
              <Button type="submit" disabled={saving || !form.name}>{saving ? t('saving') : t('save')}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete client</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this client from the system,
              including their auth account and profile. They will lose all access.
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
    </div>
  );
}