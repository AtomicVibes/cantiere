import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/services/supabase';
import TopBar from '@/components/layout/TopBar';
import EmptyState from '@/components/shared/EmptyState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Plus, Search, UserCircle, Pencil, Trash2, Ban, Mail, Phone, Eye, EyeOff, ArrowUpFromLine, Mic, MessageSquare, Globe, ExternalLink } from 'lucide-react';
import { useUserRole } from '@/hooks/useUserRole';
import { PERMISSIONS } from '@/lib/permissions';
import { handleMutationError } from '@/lib/rbac';
import { createClient, deleteUser } from '@/services/inviteService';

const emptyForm = { full_name: '', company_name: '', email: '', password: '', phone: '', address: '', vat_number: '', notes: '', business_activity: '', website: '' };

function waLink(phone) {
  if (!phone) return null;
  return `https://wa.me/${phone.replace(/\D/g, '')}`;
}

function websiteHref(website) {
  if (!website) return null;
  return website.startsWith('http://') || website.startsWith('https://') ? website : `https://${website}`;
}

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
  const [viewClient, setViewClient] = useState(null);

  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const openChat = (profileId) => {
    setViewClient(null);
    navigate(`/messages?user=${encodeURIComponent(profileId)}`);
  };

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
            id,
            company_name,
            vat_number,
            address,
            notes,
            business_activity,
            website,
            is_blocked
          )
        `)
        .eq('role_id', clientRoleId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []).map(p => {
        const client = p.clients || {};
        return {
          id: client.id || p.id,
          profile_id: p.id,
          name: p.full_name || p.email || '',
          email: p.email || '',
          phone: p.phone || '',
          company_name: client.company_name || '',
          vat_number: client.vat_number || '',
          address: client.address || '',
          notes: client.notes || '',
          business_activity: client.business_activity || '',
          website: client.website || '',
          status: 'active',
          is_blocked: client.is_blocked ?? false,
        };
      });
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
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      queryClient.invalidateQueries({ queryKey: ['clients', 'dropdown'] });
      queryClient.invalidateQueries({ queryKey: ['clientCount'] });
      queryClient.invalidateQueries({ queryKey: ['teamMemberCount'] });
      queryClient.invalidateQueries({ queryKey: ['profiles'] });
      queryClient.invalidateQueries({ queryKey: ['teamMembers'] });
      queryClient.invalidateQueries({ queryKey: ['managers'] });
      toast.success(`Promoted to ${roleName}`);
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
      toast.success('Client deleted successfully');
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      queryClient.invalidateQueries({ queryKey: ['clientCount'] });
      queryClient.invalidateQueries({ queryKey: ['profiles'] });
    },
    onError: (err) => {
      if (!handleMutationError(err, t, toast)) {
        toast.error(err.message);
      }
    },
    onSettled: () => {
      setDeleteTarget(null);
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
      business_activity: client.business_activity || '',
      website: client.website || '',
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
      const clientDetails = {
        company_name: form.company_name || null,
        vat_number: form.vat_number || null,
        address: form.address || null,
        notes: form.notes || null,
        business_activity: form.business_activity || null,
        website: form.website || null,
      };

      if (editClient) {
        const { error: profileError } = await supabase
          .from('profiles')
          .update({ full_name: form.full_name, phone: form.phone })
          .eq('id', editClient.profile_id);
        if (profileError) throw profileError;

        const { error: clientError } = await supabase
          .from('clients')
          .update(clientDetails)
          .eq('profile_id', editClient.profile_id);
        if (clientError) throw clientError;
      } else {
        if (!form.email) {
          setFriendlyError('Email is required');
          setSaving(false);
          return;
        }
        const created = await createClient({
          email: form.email,
          password: form.password,
          full_name: form.full_name,
          phone: form.phone,
        });
        const profileId = created?.user?.id;
        const { error: clientError } = await supabase
          .from('clients')
          .update(clientDetails)
          .eq('profile_id', profileId);
        if (clientError) throw clientError;
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
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setViewClient(client)} title={t('viewClient')}><Eye className="w-3.5 h-3.5" /></Button>
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
            <div className="text-sm font-semibold">{t('clientInformation')}</div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Name *</Label><Input value={form.full_name} onChange={e => setForm({...form, full_name: e.target.value})} required /></div>
              <div><Label>Email</Label><Input type="email" value={form.email} onChange={e => setForm({...form, email: e.target.value})} disabled={!!editClient} /></div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div><Label>{t('company')}</Label><Input value={form.company_name} onChange={e => setForm({...form, company_name: e.target.value})} /></div>
              <div><Label>{t('businessActivity')}</Label><Input value={form.business_activity} onChange={e => setForm({...form, business_activity: e.target.value})} /></div>
              <div><Label>{t('vatNumber')}</Label><Input value={form.vat_number} onChange={e => setForm({...form, vat_number: e.target.value})} /></div>
              <div><Label>Phone</Label><Input value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} /></div>
              <div><Label>{t('address')}</Label><Input value={form.address} onChange={e => setForm({...form, address: e.target.value})} /></div>
              <div><Label>{t('website')} ({t('optional')})</Label><Input type="url" value={form.website} onChange={e => setForm({...form, website: e.target.value})} /></div>
            </div>
            <div>
              <Label>{t('notes')}</Label>
              <Textarea value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} rows={2} className="resize-none" />
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

      <Dialog open={!!viewClient} onOpenChange={(v) => { if (!v) setViewClient(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-heading">{viewClient?.name || viewClient?.email}</DialogTitle>
          </DialogHeader>
          {viewClient && (
            <div className="space-y-5 max-h-[70vh] overflow-y-auto pr-1">
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" className="gap-1.5 text-xs" onClick={() => openChat(viewClient.profile_id)}>
                  <MessageSquare className="w-3.5 h-3.5" /> {t('message')}
                </Button>
                <Button size="sm" variant="secondary" className="gap-1.5 text-xs" onClick={() => openChat(viewClient.profile_id)}>
                  <Mic className="w-3.5 h-3.5" /> {t('audio')}
                </Button>
                {waLink(viewClient.phone) ? (
                  <a href={waLink(viewClient.phone)} target="_blank" rel="noopener noreferrer">
                    <Button size="sm" variant="outline" className="gap-1.5 text-xs text-green-600 border-green-200 hover:bg-green-50">
                      <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-current"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.123.554 4.112 1.522 5.836L.057 23.928l6.235-1.635A11.945 11.945 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.891 0-3.659-.498-5.191-1.37l-.371-.221-3.702.972.985-3.608-.244-.387A9.947 9.947 0 012 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/></svg>
                      {t('whatsapp')}
                    </Button>
                  </a>
                ) : (
                  <Button size="sm" variant="outline" disabled className="gap-1.5 text-xs text-muted-foreground" title={t('noPhoneNumber')}>
                    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-current"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.123.554 4.112 1.522 5.836L.057 23.928l6.235-1.635A11.945 11.945 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.891 0-3.659-.498-5.191-1.37l-.371-.221-3.702.972.985-3.608-.244-.387A9.947 9.947 0 012 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/></svg>
                    {t('whatsapp')}
                  </Button>
                )}
              </div>

              {viewClient.email && (
                <div className="flex items-center gap-1.5 text-sm">
                  <Mail className="w-4 h-4 shrink-0 text-muted-foreground" />
                  <a href={`mailto:${viewClient.email}`} className="text-primary hover:underline break-all">{viewClient.email}</a>
                </div>
              )}
              {viewClient.phone && (
                <div className="flex items-center gap-1.5 text-sm">
                  <Phone className="w-4 h-4 shrink-0 text-muted-foreground" />
                  <span>{viewClient.phone}</span>
                </div>
              )}

              <div className="border-t border-border pt-4">
                <div className="text-sm font-semibold mb-3">{t('clientInformation')}</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
                  <div>
                    <div className="text-xs text-muted-foreground">{t('company')}</div>
                    <div className="truncate">{viewClient.company_name || '—'}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">{t('businessActivity')}</div>
                    <div className="truncate">{viewClient.business_activity || '—'}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">{t('vatNumber')}</div>
                    <div className="truncate">{viewClient.vat_number || '—'}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">{t('phone')}</div>
                    <div className="truncate">{viewClient.phone || '—'}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">{t('address')}</div>
                    <div className="break-words">{viewClient.address || '—'}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">{t('website')}</div>
                    {websiteHref(viewClient.website) ? (
                      <a href={websiteHref(viewClient.website)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline break-all">
                        <Globe className="w-3 h-3 shrink-0" />{viewClient.website}<ExternalLink className="w-3 h-3 shrink-0" />
                      </a>
                    ) : (
                      <div className="text-muted-foreground">{t('none')}</div>
                    )}
                  </div>
                  <div className="sm:col-span-2">
                    <div className="text-xs text-muted-foreground">{t('notes')}</div>
                    <div className="whitespace-pre-wrap break-words">{viewClient.notes || '—'}</div>
                  </div>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewClient(null)}>{t('close')}</Button>
            <Button
              onClick={() => { openEdit(viewClient); setViewClient(null); }}
            >
              <Pencil className="w-4 h-4" /> {t('edit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => { if (!v) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete client</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this client and all of their associated data
              (projects, requests, invoices, and messages). This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteMutation.isPending}
              onClick={() => {
                if (deleteTarget) deleteMutation.mutate(deleteTarget);
              }}
            >
              {deleteMutation.isPending ? 'Deleting...' : 'Yes, delete it'}
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
