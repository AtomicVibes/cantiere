import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import TopBar from '@/components/layout/TopBar';
import EmptyState from '@/components/shared/EmptyState';
import StatusBadge from '@/components/shared/StatusBadge';
import StatCard from '@/components/dashboard/StatCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Search, DollarSign, TrendingUp, TrendingDown, Receipt, Pencil, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import { useUserRole } from '@/hooks/useUserRole';
import { useInvoiceFormFields } from '@/hooks/useFormSchema';
import { useDirection } from '@/i18n/LanguageProvider';
import { PERMISSIONS } from '@/lib/permissions';
import { handleMutationError } from '@/lib/rbac';

const emptyInvoice = {
  invoice_number: '', client_id: '', project_id: '', category: 'miscellaneous',
  supplier: '', amount: '', tax: '', total: '', issue_date: '', due_date: '',
  payment_status: 'draft', notes: '',
};

export default function Finance() {
  const { t } = useTranslation();
  const { dir } = useDirection();
  const { role } = useUserRole();
  const canCreate = PERMISSIONS.canCreateInvoice.includes(role);
  const canDelete = PERMISSIONS.canDeleteInvoice.includes(role);
  const { fields, categoryOptions, statusOptions } = useInvoiceFormFields();
  const [showForm, setShowForm] = useState(false);
  const [editInvoice, setEditInvoice] = useState(null);
  const [form, setForm] = useState(emptyInvoice);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [saving, setSaving] = useState(false);
  const queryClient = useQueryClient();

  const { data: invoices = [] } = useQuery({
    queryKey: ['invoices'],
    queryFn: () => base44.entities.Invoice.list('-created_date'),
    initialData: [],
  });
  const { data: clients = [] } = useQuery({ queryKey: ['clients'], queryFn: () => base44.entities.Client.list(), initialData: [] });
  const { data: projects = [] } = useQuery({ queryKey: ['projects'], queryFn: () => base44.entities.Project.list(), initialData: [] });

  const clientMap = Object.fromEntries(clients.map(c => [c.id, c.name]));
  const projectMap = Object.fromEntries(projects.map(p => [p.id, p.name]));

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.Invoice.create(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['invoices'] }),
    onError: (err) => handleMutationError(err, t, toast),
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Invoice.update(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['invoices'] }),
    onError: (err) => handleMutationError(err, t, toast),
  });
  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Invoice.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['invoices'] }),
    onError: (err) => handleMutationError(err, t, toast),
  });

  const openEdit = (inv) => {
    setEditInvoice(inv);
    setForm({
      invoice_number: inv.invoice_number || '', client_id: inv.client_id || '', project_id: inv.project_id || '',
      category: inv.category || 'miscellaneous', supplier: inv.supplier || '', amount: inv.amount || '',
      tax: inv.tax || '', total: inv.total || '', issue_date: inv.issue_date || '', due_date: inv.due_date || '',
      payment_status: inv.payment_status || 'draft', notes: inv.notes || '',
    });
    setShowForm(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!canCreate && !editInvoice) {
      toast.error(t('accessDenied'));
      return;
    }
    setSaving(true);
    const data = { ...form, amount: Number(form.amount) || 0, tax: Number(form.tax) || 0, total: Number(form.total) || 0 };
    if (editInvoice) await updateMutation.mutateAsync({ id: editInvoice.id, data });
    else await createMutation.mutateAsync(data);
    setSaving(false);
    setShowForm(false);
    setEditInvoice(null);
    setForm(emptyInvoice);
  };

  const totalRevenue = invoices.filter(i => i.payment_status === 'paid').reduce((s, i) => s + (i.total || 0), 0);
  const totalPending = invoices.filter(i => i.payment_status === 'pending' || i.payment_status === 'partially_paid').reduce((s, i) => s + (i.total || 0), 0);
  const totalOverdue = invoices.filter(i => i.payment_status === 'overdue').reduce((s, i) => s + (i.total || 0), 0);

  const filtered = invoices.filter(i => {
    const matchesSearch = !search || i.invoice_number?.toLowerCase().includes(search.toLowerCase()) || i.supplier?.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === 'all' || i.payment_status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <div>
      <TopBar title={t('finance')} />
      <div className="p-6 space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard title={t('revenuePaid')} value={`€${totalRevenue.toLocaleString()}`} icon={TrendingUp} color="success" />
          <StatCard title={t('pending')} value={`€${totalPending.toLocaleString()}`} icon={DollarSign} color="warning" />
          <StatCard title={t('overdue')} value={`€${totalOverdue.toLocaleString()}`} icon={TrendingDown} color="destructive" />
        </div>

        <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
          <div className="flex gap-3 flex-1">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input placeholder={t('searchInvoices')} value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-36"><SelectValue placeholder={t('all')} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('allStatuses')}</SelectItem>
                {statusOptions.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {canCreate && (
            <Button onClick={() => { setEditInvoice(null); setForm(emptyInvoice); setShowForm(true); }} className="gap-2">
              <Plus className="w-4 h-4" /> {t('newInvoice')}
            </Button>
          )}
        </div>

        {filtered.length === 0 ? (
          <EmptyState icon={Receipt} title={t('noDocuments')} description="Create your first invoice" actionLabel={canCreate ? t('newInvoice') : undefined} onAction={canCreate ? () => setShowForm(true) : undefined} />
        ) : (
          <div className="bg-card rounded-xl border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead>{t('invoiceNumber')}</TableHead>
                  <TableHead className="hidden md:table-cell">{t('client')}</TableHead>
                  <TableHead className="hidden lg:table-cell">{t('filter')}</TableHead>
                  <TableHead>{t('amount')}</TableHead>
                  <TableHead className="hidden md:table-cell">{t('dueDate')}</TableHead>
                  <TableHead>{t('status')}</TableHead>
                  <TableHead className="w-20">{t('actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(inv => (
                  <TableRow key={inv.id} className="hover:bg-muted/30">
                    <TableCell className="font-medium">{inv.invoice_number}</TableCell>
                    <TableCell className="hidden md:table-cell">{clientMap[inv.client_id] || '-'}</TableCell>
                    <TableCell className="hidden lg:table-cell capitalize">{inv.category?.replace(/_/g, ' ')}</TableCell>
                    <TableCell className="font-semibold">€{(inv.total || 0).toLocaleString()}</TableCell>
                    <TableCell className="hidden md:table-cell">{inv.due_date ? format(new Date(inv.due_date), 'MMM d, yyyy') : '-'}</TableCell>
                    <TableCell><StatusBadge status={inv.payment_status} /></TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(inv)}><Pencil className="w-3.5 h-3.5" /></Button>
                        {canDelete && (
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => deleteMutation.mutate(inv.id)}><Trash2 className="w-3.5 h-3.5" /></Button>
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

      <Dialog open={showForm} onOpenChange={(v) => { setShowForm(v); if (!v) setEditInvoice(null); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="font-heading">{editInvoice ? t('editInvoice') : t('newInvoice')}</DialogTitle></DialogHeader>
          <form onSubmit={handleSave} className="space-y-4" dir={dir}>
            <div className="grid grid-cols-2 gap-4">
              {fields.filter(f => ['invoice_number', 'supplier'].includes(f.key)).map(f => (
                <div key={f.key}><Label>{f.label}{f.required ? ' *' : ''}</Label><Input type={f.type} value={form[f.key] || ''} onChange={e => setForm({...form, [f.key]: e.target.value})} required={f.required} /></div>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-4">
              {fields.filter(f => ['client_id', 'project_id'].includes(f.key)).map(f => {
                const data = f.key === 'client_id' ? clients : projects;
                return (
                  <div key={f.key}>
                    <Label>{f.label}</Label>
                    <Select value={form[f.key]} onValueChange={v => setForm({...form, [f.key]: v})}>
                      <SelectTrigger><SelectValue placeholder={t('select')} /></SelectTrigger>
                      <SelectContent>{data.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                );
              })}
            </div>
            <div className="grid grid-cols-3 gap-4">
              {fields.filter(f => ['amount', 'tax', 'total'].includes(f.key)).map(f => (
                <div key={f.key}><Label>{f.label}</Label><Input type="number" value={form[f.key] || ''} onChange={e => {
                  const newForm = { ...form, [f.key]: e.target.value };
                  if (f.key === 'amount') newForm.total = String(Number(e.target.value) + Number(form.tax || 0));
                  if (f.key === 'tax') newForm.total = String(Number(form.amount || 0) + Number(e.target.value));
                  setForm(newForm);
                }} /></div>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label>{t('category')}</Label>
                <Select value={form.category} onValueChange={v => setForm({...form, category: v})}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{categoryOptions.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              {fields.filter(f => ['issue_date', 'due_date'].includes(f.key)).map(f => (
                <div key={f.key}><Label>{f.label}</Label><Input type="date" value={form[f.key] || ''} onChange={e => setForm({...form, [f.key]: e.target.value})} /></div>
              ))}
            </div>
            <div>
              <Label>{t('paymentStatus')}</Label>
              <Select value={form.payment_status} onValueChange={v => setForm({...form, payment_status: v})}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{statusOptions.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowForm(false)}>{t('cancel')}</Button>
              <Button type="submit" disabled={saving || !form.invoice_number}>{saving ? t('saving') : t('save')}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}