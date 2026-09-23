import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/services/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Calendar } from '@/components/ui/calendar';
import {
  Popover, PopoverTrigger, PopoverContent,
} from '@/components/ui/popover';
import { format } from 'date-fns';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useDirection } from '@/i18n/LanguageProvider';
import { useUserRole } from '@/hooks/useUserRole';
import { useAuth } from '@/lib/AuthContext';
import { PERMISSIONS } from '@/lib/permissions';
import {
  computeLineTotals, computeInvoiceTotals, uploadInvoiceAttachment, createInvoiceAttachment,
  removeInvoiceAttachment, resolveInvoiceAttachmentUrl, validateInvoiceAttachment,
  validateGoogleInvoiceLink, saveInvoiceItems, removeInvoiceItems, upsertInvoiceRecord,
} from '@/services/invoiceService';
import { openInvoicePdf } from '@/services/invoicePdf';
import { Plus, Trash2, Paperclip, Link2, Loader2, FileText, Eye, X, ExternalLink } from 'lucide-react';

const NATURA_CODES = ['N1', 'N2.1', 'N2.2', 'N3', 'N4', 'N5', 'N6'];

const emptySeller = () => ({
  display_name: '', legal_name: '', address: '', city: '', postal_code: '',
  province: '', country: 'IT', vat_id: '', tax_code: '', sdi_code: '',
  pec: '', phone: '', email: '', logo_url: '',
});

const emptyForm = () => ({
  invoice_number: '', invoice_date: '', due_date: '', client_id: '', project_id: '',
  category: 'miscellaneous', payment_status: 'draft', payment_terms: '', payment_method: '',
  payment_reference: '', notes: '', stamp_duty: '',
});

const emptyItem = () => ({
  id: undefined, description: '', quantity: '1', unit_price: '', discount_percent: '', vat_rate: '', vat_natura: '',
});

const mergeProfiles = (primary, fallback) => {
  const merged = {};
  const keys = new Set([...Object.keys(primary), ...Object.keys(fallback)]);
  keys.forEach(k => {
    merged[k] = primary[k] || fallback[k] || '';
  });
  return merged;
};

const fmtEUR = (value) =>
  new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }).format(Number(value) || 0);

export default function InvoiceFormDialog({ open, onOpenChange, invoice, clients, projects, onSaved }) {
  const { t } = useTranslation();
  const { dir } = useDirection();
  const { role } = useUserRole();
  const { user } = useAuth();
  const [form, setForm] = useState(emptyForm());
  const [items, setItems] = useState([emptyItem()]);
  const [existing, setExisting] = useState([]);
  const [pending, setPending] = useState([]);
  const [seller, setSeller] = useState(emptySeller());
  const [googleUrl, setGoogleUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const fileInputRef = useRef(null);
  const detailInitRef = useRef(false);

  const canEdit = PERMISSIONS.canEditInvoice.includes(role) || PERMISSIONS.canCreateInvoice.includes(role);
  const categoryOptions = [
    'materials', 'labor', 'equipment', 'architecture', 'engineering', 'transport', 'utilities', 'miscellaneous',
  ];
  const statusOptions = ['draft', 'pending', 'paid', 'partially_paid', 'overdue'];

  const { data: profileRow, refetch: refetchProfile } = useQuery({
    queryKey: ['company-profiles', user?.id],
    enabled: open && !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('company_profiles')
        .select('*')
        .eq('created_by', user.id)
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: detail } = useQuery({
    queryKey: ['invoice', 'detail', invoice?.id],
    enabled: open && !!invoice?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('invoices')
        .select('*, invoice_items(*), invoice_attachments(*)')
        .eq('id', invoice.id)
        .single();
      if (error) throw error;
      return {
        ...data,
        items: (data.invoice_items || []).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)),
        attachments: data.invoice_attachments || [],
      };
    },
  });

  useEffect(() => {
    if (profileRow) setSeller(prev => mergeProfiles(prev, profileRow));
  }, [profileRow]);

  useEffect(() => {
    if (!open) return;
    detailInitRef.current = false;
    if (!invoice?.id) {
      setForm(emptyForm());
      setItems([emptyItem()]);
      setExisting([]);
      setPending([]);
      setGoogleUrl('');
      setSeller(s => mergeProfiles({ ...emptySeller(), country: 'IT' }, s));
    }
  }, [open, invoice?.id]);

  useEffect(() => {
    if (!detail || detailInitRef.current) return;
    detailInitRef.current = true;
    setForm({
      invoice_number: detail.invoice_number || '',
      invoice_date: detail.invoice_date || '',
      due_date: detail.due_date || '',
      client_id: detail.client_id || '',
      project_id: detail.project_id || '',
      category: detail.category || 'miscellaneous',
      payment_status: detail.payment_status || 'draft',
      payment_terms: detail.payment_terms || '',
      payment_method: detail.payment_method || '',
      payment_reference: detail.payment_reference || '',
      notes: detail.notes || '',
      stamp_duty: detail.stamp_duty ?? '',
    });
    setItems((detail.items && detail.items.length ? detail.items : [emptyItem()]).map(i => ({
      id: i.id,
      description: i.description || '',
      quantity: i.quantity ?? '',
      unit_price: i.unit_price ?? '',
      discount_percent: i.discount_percent ?? '',
      vat_rate: i.vat_rate ?? '',
      vat_natura: i.vat_natura || '',
    })));
    setExisting(detail.attachments || []);
    setPending([]);
    setGoogleUrl('');
    if (detail.seller_snapshot) setSeller(prev => mergeProfiles(prev, detail.seller_snapshot));
  }, [detail]);

  const filterableProjects = projects.filter(p => !form.client_id || !p.client_id || p.client_id === form.client_id);

  const totals = computeInvoiceTotals(items);

  const buildCustomerSnapshot = async () => {
    if (!form.client_id) return null;
    const { data: cd, error } = await supabase
      .from('clients')
      .select('company_name, address, vat_number, profile:profiles!inner(full_name)')
      .eq('id', form.client_id)
      .single();
    if (error) return null;
    return {
      display_name: cd?.company_name || cd?.profile?.full_name || '',
      legal_name: cd?.company_name || '',
      address: cd?.address || '',
      vat_id: cd?.vat_number || '',
    };
  };

  const buildPreviewInvoice = (customerSnapshot) => ({
    invoice_number: form.invoice_number,
    invoice_date: form.invoice_date,
    due_date: form.due_date,
    amount: totals.subtotal,
    tax: totals.vatTotal,
    total: totals.total,
    stamp_duty: Number(form.stamp_duty) || 0,
    payment_terms: form.payment_terms,
    payment_method: form.payment_method,
    payment_reference: form.payment_reference,
    notes: form.notes,
    seller_snapshot: seller,
    customer_snapshot: customerSnapshot,
  });

  const handlePreview = async () => {
    if (!form.invoice_number) {
      toast.error(t('invoiceNumberRequired'));
      return;
    }
    setPreviewing(true);
    try {
      const customerSnapshot = await buildCustomerSnapshot();
      const previewInvoice = buildPreviewInvoice(customerSnapshot);
      const rows = items.map(i => ({
        description: i.description,
        quantity: Number(i.quantity) || 0,
        unit_price: Number(i.unit_price) || 0,
        discount_percent: Number(i.discount_percent) || 0,
        vat_rate: Number(i.vat_rate) || 0,
        vat_natura: i.vat_natura || null,
      }));
      await openInvoicePdf(
        { invoice: previewInvoice, items: rows, logoUrl: seller.logo_url || '/Invoice_logo.png' },
        `fattura-${form.invoice_number || 'bozza'}.pdf`
      );
    } catch (err) {
      console.error('[invoice] PDF preview failed', err);
      toast.error(t('previewFailed'));
    } finally {
      setPreviewing(false);
    }
  };

  const handleSave = async () => {
    if (!form.invoice_number) {
      toast.error(t('invoiceNumberRequired'));
      return;
    }
    setSaving(true);
    try {
      const customerSnapshot = await buildCustomerSnapshot();
      const totalsToSave = computeInvoiceTotals(items);
      const sellerSnapshot = {
        display_name: seller.display_name, legal_name: seller.legal_name, address: seller.address,
        city: seller.city, postal_code: seller.postal_code, province: seller.province, country: seller.country,
        vat_id: seller.vat_id, tax_code: seller.tax_code, sdi_code: seller.sdi_code, pec: seller.pec,
        phone: seller.phone, email: seller.email, logo_url: seller.logo_url,
      };

      const payload = {
        ...(invoice?.id ? { id: invoice.id } : {}),
        invoice_number: form.invoice_number.trim(),
        invoice_date: form.invoice_date || null,
        due_date: form.due_date || null,
        client_id: form.client_id || null,
        project_id: form.project_id || null,
        category: form.category,
        currency: 'EUR',
        supplier: seller.display_name || seller.legal_name || '',
        amount: totalsToSave.subtotal,
        tax: totalsToSave.vatTotal,
        total: totalsToSave.total,
        subtotal: totalsToSave.subtotal,
        discount_total: totalsToSave.discountTotal,
        vat_total: totalsToSave.vatTotal,
        stamp_duty: Number(form.stamp_duty) || 0,
        payment_status: form.payment_status,
        status: form.payment_status,
        payment_terms: form.payment_terms || null,
        payment_method: form.payment_method || null,
        payment_reference: form.payment_reference || null,
        notes: form.notes || null,
        seller_snapshot: sellerSnapshot,
        customer_snapshot: customerSnapshot,
      };

      const saved = await upsertInvoiceRecord(payload);
      const invoiceId = saved.id;

      const existingIds = new Set(existing.map(a => a.id));
      const keptItemIds = items.filter(i => i.id).map(i => i.id);
      const removedItemIds = (detail?.items || []).filter(i => !keptItemIds.includes(i.id)).map(i => i.id);
      if (removedItemIds.length) await removeInvoiceItems(removedItemIds);
      await saveInvoiceItems(invoiceId, items);

      for (const p of pending) {
        if (p.type === 'google') {
          await createInvoiceAttachment({
            invoiceId,
            userId: user.id,
            externalUrl: p.external_url,
            externalProvider: 'google',
          });
        } else {
          const storagePath = await uploadInvoiceAttachment({ file: p.file, userId: user.id });
          await createInvoiceAttachment({ invoiceId, userId: user.id, file: p.file, storagePath });
        }
      }

      toast.success(invoice?.id ? t('invoiceSaved') : t('invoiceCreated'));
      onOpenChange(false);
      onSaved?.(saved);
    } catch (err) {
      console.error('[invoice] save failed', err);
      toast.error(err.message || t('saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const updateItem = (index, key, value) => {
    setItems(prev => prev.map((item, idx) => (idx === index ? { ...item, [key]: value } : item)));
  };

  const addItem = () => setItems(prev => [...prev, emptyItem()]);
  const removeItem = (index) => setItems(prev => (prev.length > 1 ? prev.filter((_, idx) => idx !== index) : [emptyItem()]));

  const handleFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    for (const file of files) {
      const invalid = validateInvoiceAttachment(file);
      if (invalid) {
        toast.error(invalid);
        continue;
      }
      setPending(prev => [...prev, {
        localId: crypto.randomUUID(),
        type: 'file',
        file,
        name: file.name,
        size: file.size,
        status: 'pending',
      }]);
    }
  };

  const handleAddGoogleLink = (event) => {
    event.preventDefault();
    if (!validateGoogleInvoiceLink(googleUrl)) {
      toast.error(t('invalidGoogleLink'));
      return;
    }
    setPending(prev => [...prev, {
      localId: crypto.randomUUID(),
      type: 'google',
      external_url: googleUrl.trim(),
      name: googleUrl.trim(),
      size: 0,
      status: 'google',
    }]);
    setGoogleUrl('');
  };

  const removePending = (localId) => setPending(prev => prev.filter(p => p.localId !== localId));

  const handleRemoveExisting = async (attachment) => {
    try {
      await removeInvoiceAttachment(attachment);
      setExisting(prev => prev.filter(a => a.id !== attachment.id));
      toast.success(t('attachmentRemoved'));
    } catch (err) {
      console.error('[invoice] failed to remove attachment', err);
      toast.error(err.message || t('removeFailed'));
    }
  };

  const handleOpenAttachment = async (attachment) => {
    const url = await resolveInvoiceAttachmentUrl(attachment);
    if (url) window.open(url, '_blank', 'noopener');
    else toast.error(t('openFailed'));
  };

  const handleSaveProfile = async () => {
    try {
      const values = mergeProfiles(seller, { created_by: user.id });
      if (profileRow?.id) {
        const { error } = await supabase.from('company_profiles').update(values).eq('id', profileRow.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('company_profiles').insert({ ...values, created_by: user.id });
        if (error) throw error;
        refetchProfile();
      }
      toast.success(t('companyProfileSaved'));
    } catch (err) {
      console.error('[invoice] failed to save company profile', err);
      toast.error(err.message || t('saveFailed'));
    }
  };

  const setSellerField = (key, value) => setSeller(prev => ({ ...prev, [key]: value }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" dir={dir}>
        <DialogHeader>
          <DialogTitle className="font-heading">{invoice?.id ? t('editInvoice') : t('newInvoice')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Invoice details */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            <div className="md:col-span-1">
              <Label>{t('invoiceNumber')} *</Label>
              <Input value={form.invoice_number} onChange={e => setForm({ ...form, invoice_number: e.target.value })} required placeholder={invoice?.id ? '' : t('invoiceNumberPlaceholder')} />
            </div>
            <div>
              <Label>{t('invoiceDateField')}</Label>
              <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" className="w-full justify-start text-left font-normal" type="button">
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {form.invoice_date ? format(new Date(form.invoice_date + 'T00:00:00'), 'dd/MM/yyyy') : <span className="text-muted-foreground">{t('date')}</span>}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={form.invoice_date ? new Date(form.invoice_date + 'T00:00:00') : undefined}
                          onSelect={d => setForm({ ...form, invoice_date: d ? format(d, 'yyyy-MM-dd') : '' })}
                          initialFocus
                        />
                      </PopoverContent>
                    </Popover>
            </div>
            <div>
              <Label>{t('dueDate')}</Label>
              <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" className="w-full justify-start text-left font-normal" type="button">
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {form.due_date ? format(new Date(form.due_date + 'T00:00:00'), 'dd/MM/yyyy') : <span className="text-muted-foreground">{t('date')}</span>}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={form.due_date ? new Date(form.due_date + 'T00:00:00') : undefined}
                          onSelect={d => setForm({ ...form, due_date: d ? format(d, 'yyyy-MM-dd') : '' })}
                          initialFocus
                        />
                      </PopoverContent>
                    </Popover>
            </div>
            <div>
              <Label>{t('category')}</Label>
              <Select value={form.category} onValueChange={v => setForm({ ...form, category: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {categoryOptions.map(c => <SelectItem key={c} value={c}>{t(c)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-2">
              <Label>{t('paymentStatus')}</Label>
              <Select value={form.payment_status} onValueChange={v => setForm({ ...form, payment_status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {statusOptions.map(s => <SelectItem key={s} value={s}>{t(s)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Separator />

          {/* Client & project */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label>{t('client')}</Label>
              <Select value={form.client_id} onValueChange={v => setForm({ ...form, client_id: v, project_id: '' })}>
                <SelectTrigger><SelectValue placeholder={t('select')} /></SelectTrigger>
                <SelectContent>
                  {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">{t('clientFilterHint')}</p>
            </div>
            <div>
              <Label>{t('project')}</Label>
              <Select value={form.project_id} onValueChange={v => setForm({ ...form, project_id: v })}>
                <SelectTrigger><SelectValue placeholder={t('select')} /></SelectTrigger>
                <SelectContent>
                  {filterableProjects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">{t('projectFilterHint')}</p>
            </div>
          </div>

          <Separator />

          {/* Seller / company profile */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">{t('companyProfile')}</h3>
              <Button type="button" variant="outline" size="sm" onClick={handleSaveProfile}>{t('saveProfile')}</Button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              <div><Label>{t('fullName')}</Label><Input value={seller.display_name} onChange={e => setSellerField('display_name', e.target.value)} /></div>
              <div className="md:col-span-2"><Label>{t('legalName')}</Label><Input value={seller.legal_name} onChange={e => setSellerField('legal_name', e.target.value)} /></div>
              <div className="md:col-span-2"><Label>{t('address')}</Label><Input value={seller.address} onChange={e => setSellerField('address', e.target.value)} /></div>
              <div><Label>{t('city')}</Label><Input value={seller.city} onChange={e => setSellerField('city', e.target.value)} /></div>
              <div><Label>{t('postalCode')}</Label><Input value={seller.postal_code} onChange={e => setSellerField('postal_code', e.target.value)} /></div>
              <div><Label>{t('province')}</Label><Input value={seller.province} onChange={e => setSellerField('province', e.target.value)} /></div>
              <div><Label>{t('country')}</Label><Input value={seller.country} onChange={e => setSellerField('country', e.target.value)} /></div>
              <div><Label>{t('vatId')}</Label><Input value={seller.vat_id} onChange={e => setSellerField('vat_id', e.target.value)} /></div>
              <div><Label>{t('taxCode')}</Label><Input value={seller.tax_code} onChange={e => setSellerField('tax_code', e.target.value)} /></div>
              <div><Label>{t('sdiCode')}</Label><Input value={seller.sdi_code} onChange={e => setSellerField('sdi_code', e.target.value)} /></div>
              <div><Label>{t('pec')}</Label><Input value={seller.pec} onChange={e => setSellerField('pec', e.target.value)} /></div>
              <div><Label>{t('phone')}</Label><Input value={seller.phone} onChange={e => setSellerField('phone', e.target.value)} /></div>
              <div><Label>{t('email')}</Label><Input value={seller.email} onChange={e => setSellerField('email', e.target.value)} /></div>
              <div className="md:col-span-3"><Label>{t('logoUrl')}</Label><Input value={seller.logo_url} onChange={e => setSellerField('logo_url', e.target.value)} /></div>
            </div>
            <p className="text-xs text-muted-foreground">{t('companyProfileHint')}</p>
          </div>

          <Separator />

          {/* Line items */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold">{t('lineItems')}</h3>
            <div className="space-y-2">
              {items.map((item, index) => {
                const line = computeLineTotals(item);
                return (
                  <div key={item.id || `new-${index}`} className="grid grid-cols-12 gap-2 items-center">
                    <div className="col-span-12 md:col-span-4">
                      <Input value={item.description} onChange={e => updateItem(index, 'description', e.target.value)} placeholder={t('itemDescriptionPlaceholder')} />
                    </div>
                    <div className="col-span-3 md:col-span-1">
                      <Input type="number" min="0" step="0.01" value={item.quantity} onChange={e => updateItem(index, 'quantity', e.target.value)} placeholder="1" />
                    </div>
                    <div className="col-span-3 md:col-span-2">
                      <Input type="number" min="0" step="0.01" value={item.unit_price} onChange={e => updateItem(index, 'unit_price', e.target.value)} placeholder="0,00" />
                    </div>
                    <div className="col-span-3 md:col-span-1">
                      <Input type="number" min="0" step="0.01" value={item.discount_percent} onChange={e => updateItem(index, 'discount_percent', e.target.value)} placeholder="0%" />
                    </div>
                    <div className="col-span-3 md:col-span-1">
                      <Input type="number" min="0" step="0.01" value={item.vat_rate} onChange={e => updateItem(index, 'vat_rate', e.target.value)} placeholder="22" />
                    </div>
                    <div className="col-span-5 md:col-span-1">
                      <Select value={item.vat_natura} onValueChange={v => updateItem(index, 'vat_natura', v)}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={t('natura')} /></SelectTrigger>
                        <SelectContent>
                          {NATURA_CODES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="hidden md:block col-span-2 text-right text-xs text-muted-foreground">{fmtEUR(line.lineTotal)}</div>
                    <div className="col-span-1 flex justify-end">
                      <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => removeItem(index)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })}
              <Button type="button" variant="outline" size="sm" className="gap-2" onClick={addItem}>
                <Plus className="w-4 h-4" /> {t('addItem')}
              </Button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm bg-muted/40 rounded-lg p-3">
              <div>
                <p className="text-muted-foreground text-xs">{t('subtotal')}</p>
                <p className="font-semibold">{fmtEUR(totals.subtotal)}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">{t('discountTotal')}</p>
                <p className="font-semibold">{fmtEUR(totals.discountTotal)}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">{t('vatTotal')}</p>
                <p className="font-semibold">{fmtEUR(totals.vatTotal)}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">{t('grandTotal')}</p>
                <p className="font-semibold">{fmtEUR(totals.total)}</p>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div><Label>{t('stampDuty')}</Label><Input type="number" min="0" step="0.01" value={form.stamp_duty} onChange={e => setForm({ ...form, stamp_duty: e.target.value })} placeholder="0,00" /></div>
              <div className="sm:col-span-2" />
            </div>
          </div>

          <Separator />

          {/* Payment + notes */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div><Label>{t('paymentTerms')}</Label><Input value={form.payment_terms} onChange={e => setForm({ ...form, payment_terms: e.target.value })} /></div>
            <div><Label>{t('paymentMethod')}</Label><Input value={form.payment_method} onChange={e => setForm({ ...form, payment_method: e.target.value })} /></div>
            <div><Label>{t('paymentReference')}</Label><Input value={form.payment_reference} onChange={e => setForm({ ...form, payment_reference: e.target.value })} /></div>
          </div>
          <div>
            <Label>{t('notes')}</Label>
            <Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={3} />
          </div>

          <Separator />

          {/* Attachments */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold">{t('attachments')}</h3>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              accept=".pdf,.doc,.docx,.xls,.xlsx,image/jpeg,image/png,image/webp,image/gif"
              onChange={e => { handleFiles(e.target.files); e.target.value = ''; }}
            />
            <div className="flex flex-col sm:flex-row gap-3">
              <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => fileInputRef.current?.click()}>
                <Paperclip className="w-4 h-4" /> {t('uploadAttachment')}
              </Button>
              <form className="flex flex-1 gap-2" onSubmit={handleAddGoogleLink}>
                <Input value={googleUrl} onChange={e => setGoogleUrl(e.target.value)} placeholder={t('googleDocumentLink')} className="flex-1" />
                <Button type="submit" variant="outline" size="sm" className="gap-2">
                  <Link2 className="w-4 h-4" /> {t('addLink')}
                </Button>
              </form>
            </div>

            {(existing.length > 0 || pending.length > 0) && (
              <ul className="space-y-2">
                {existing.map(a => (
                  <li key={a.id} className="flex items-center gap-2 text-sm bg-muted/40 rounded-lg px-3 py-2">
                    <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                    <span className="truncate flex-1">{a.file_name}</span>
                    <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleOpenAttachment(a)}>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </Button>
                    <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => handleRemoveExisting(a)}>
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  </li>
                ))}
                {pending.map(p => (
                  <li key={p.localId} className="flex items-center gap-2 text-sm bg-muted/40 rounded-lg px-3 py-2">
                    {p.type === 'google' ? <Link2 className="w-4 h-4 text-muted-foreground shrink-0" /> : <FileText className="w-4 h-4 text-muted-foreground shrink-0" />}
                    <span className="truncate flex-1">{p.name}</span>
                    <span className="text-xs text-muted-foreground shrink-0">{p.type === 'google' ? t('google') : t('pending')}</span>
                    <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => removePending(p.localId)}>
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t('cancel')}</Button>
          <Button type="button" variant="secondary" className="gap-2" onClick={handlePreview} disabled={previewing || saving}>
            {previewing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
            {t('previewPdf')}
          </Button>
          <Button type="button" onClick={handleSave} disabled={saving || previewing || !canEdit}>
            {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {saving ? t('saving') : t('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}