import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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
import { Plus, Search, UserCircle, Pencil, Trash2, Mail, Phone, Building2 } from 'lucide-react';

const emptyClient = { name: '', company_name: '', email: '', phone: '', address: '', zip_code: '', vat_number: '', notes: '', status: 'active' };

export default function Clients() {
  const { t } = useTranslation();
  const [showForm, setShowForm] = useState(false);
  const [editClient, setEditClient] = useState(null);
  const [form, setForm] = useState(emptyClient);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const queryClient = useQueryClient();

  const { data: clients = [] } = useQuery({
    queryKey: ['clients'],
    queryFn: () => base44.entities.Client.list('-created_date'),
    initialData: [],
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.Client.create(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['clients'] }),
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Client.update(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['clients'] }),
  });
  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Client.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['clients'] }),
  });

  const openEdit = (client) => {
    setEditClient(client);
    setForm({
      name: client.name || '', company_name: client.company_name || '', email: client.email || '',
      phone: client.phone || '', address: client.address || '', zip_code: client.zip_code || '',
      vat_number: client.vat_number || '', notes: client.notes || '', status: client.status || 'active',
    });
    setShowForm(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    if (editClient) await updateMutation.mutateAsync({ id: editClient.id, data: form });
    else await createMutation.mutateAsync(form);
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
          <Button onClick={() => { setEditClient(null); setForm(emptyClient); setShowForm(true); }} className="gap-2">
            <Plus className="w-4 h-4" /> {t('addClient')}
          </Button>
        </div>

        {filtered.length === 0 ? (
          <EmptyState icon={UserCircle} title={t('noClients')} description={t('addFirstClient')} actionLabel={t('addClient')} onAction={() => setShowForm(true)} />
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
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => deleteMutation.mutate(client.id)}><Trash2 className="w-3.5 h-3.5" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <Dialog open={showForm} onOpenChange={(v) => { setShowForm(v); if (!v) setEditClient(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle className="font-heading">{editClient ? t('editClient') : t('addClient')}</DialogTitle></DialogHeader>
          <form onSubmit={handleSave} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Name *</Label><Input value={form.name} onChange={e => setForm({...form, name: e.target.value})} required /></div>
              <div><Label>Company</Label><Input value={form.company_name} onChange={e => setForm({...form, company_name: e.target.value})} /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Email</Label><Input type="email" value={form.email} onChange={e => setForm({...form, email: e.target.value})} /></div>
              <div><Label>Phone</Label><Input value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} /></div>
            </div>
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
    </div>
  );
}