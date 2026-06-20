import React, { useState } from 'react';
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

const CATEGORIES = [
  { value: 'materials', label: 'Materials' },
  { value: 'labor', label: 'Labor' },
  { value: 'equipment', label: 'Equipment' },
  { value: 'architecture', label: 'Architecture' },
  { value: 'engineering', label: 'Engineering' },
  { value: 'transport', label: 'Transport' },
  { value: 'utilities', label: 'Utilities' },
  { value: 'miscellaneous', label: 'Miscellaneous' },
];

const STATUSES = [
  { value: 'draft', label: 'Draft' },
  { value: 'pending', label: 'Pending' },
  { value: 'paid', label: 'Paid' },
  { value: 'partially_paid', label: 'Partially Paid' },
  { value: 'overdue', label: 'Overdue' },
];

const emptyInvoice = {
  invoice_number: '', client_id: '', project_id: '', category: 'miscellaneous',
  supplier: '', amount: '', tax: '', total: '', issue_date: '', due_date: '',
  payment_status: 'draft', notes: '',
};

export default function Finance() {
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
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Invoice.update(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['invoices'] }),
  });
  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Invoice.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['invoices'] }),
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
      <TopBar title="Finance" />
      <div className="p-6 space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard title="Revenue (Paid)" value={`€${totalRevenue.toLocaleString()}`} icon={TrendingUp} color="success" />
          <StatCard title="Pending" value={`€${totalPending.toLocaleString()}`} icon={DollarSign} color="warning" />
          <StatCard title="Overdue" value={`€${totalOverdue.toLocaleString()}`} icon={TrendingDown} color="destructive" />
        </div>

        <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
          <div className="flex gap-3 flex-1">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input placeholder="Search invoices..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-36"><SelectValue placeholder="All" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                {STATUSES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={() => { setEditInvoice(null); setForm(emptyInvoice); setShowForm(true); }} className="gap-2">
            <Plus className="w-4 h-4" /> New Invoice
          </Button>
        </div>

        {filtered.length === 0 ? (
          <EmptyState icon={Receipt} title="No invoices" description="Create your first invoice" actionLabel="New Invoice" onAction={() => setShowForm(true)} />
        ) : (
          <div className="bg-card rounded-xl border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead>Invoice #</TableHead>
                  <TableHead className="hidden md:table-cell">Client</TableHead>
                  <TableHead className="hidden lg:table-cell">Category</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead className="hidden md:table-cell">Due Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-20">Actions</TableHead>
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
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => deleteMutation.mutate(inv.id)}><Trash2 className="w-3.5 h-3.5" /></Button>
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
          <DialogHeader><DialogTitle className="font-heading">{editInvoice ? 'Edit Invoice' : 'New Invoice'}</DialogTitle></DialogHeader>
          <form onSubmit={handleSave} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Invoice # *</Label><Input value={form.invoice_number} onChange={e => setForm({...form, invoice_number: e.target.value})} required /></div>
              <div><Label>Supplier</Label><Input value={form.supplier} onChange={e => setForm({...form, supplier: e.target.value})} /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Client</Label>
                <Select value={form.client_id} onValueChange={v => setForm({...form, client_id: v})}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>{clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Project</Label>
                <Select value={form.project_id} onValueChange={v => setForm({...form, project_id: v})}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>{projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div><Label>Amount (€)</Label><Input type="number" value={form.amount} onChange={e => setForm({...form, amount: e.target.value, total: String(Number(e.target.value) + Number(form.tax || 0))})} /></div>
              <div><Label>Tax (€)</Label><Input type="number" value={form.tax} onChange={e => setForm({...form, tax: e.target.value, total: String(Number(form.amount || 0) + Number(e.target.value))})} /></div>
              <div><Label>Total (€)</Label><Input type="number" value={form.total} onChange={e => setForm({...form, total: e.target.value})} /></div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label>Category</Label>
                <Select value={form.category} onValueChange={v => setForm({...form, category: v})}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Issue Date</Label><Input type="date" value={form.issue_date} onChange={e => setForm({...form, issue_date: e.target.value})} /></div>
              <div><Label>Due Date</Label><Input type="date" value={form.due_date} onChange={e => setForm({...form, due_date: e.target.value})} /></div>
            </div>
            <div>
              <Label>Payment Status</Label>
              <Select value={form.payment_status} onValueChange={v => setForm({...form, payment_status: v})}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{STATUSES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button type="submit" disabled={saving || !form.invoice_number}>{saving ? 'Saving...' : 'Save'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}