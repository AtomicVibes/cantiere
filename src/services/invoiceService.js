import { supabase } from '@/services/supabase';
import { DOCUMENT_FILE_FORMATS } from '@/api/base44Client';
import { parseGoogleDocLink, getGoogleDocMime } from '@/lib/googleLinks';

export const INVOICE_BUCKET = 'invoice-attachments';

const MAX_ATTACHMENT_SIZE = 50 * 1024 * 1024;
const SUPPORTED_ATTACHMENT_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export const fetchInvoiceDetail = async (id) => {
  const { data, error } = await supabase
    .from('invoices')
    .select('*, invoice_items(*), invoice_attachments(*)')
    .eq('id', id)
    .single();
  if (error) throw error;
  const items = (data.invoice_items || []).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  return { ...data, items, attachments: data.invoice_attachments || [] };
};

export const upsertInvoiceRecord = async (payload) => {
  if (payload.id) {
    const { data, error } = await supabase
      .from('invoices')
      .update(payload)
      .eq('id', payload.id)
      .select()
      .single();
    if (error) throw error;
    return data;
  }
  const { data, error } = await supabase
    .from('invoices')
    .insert([payload])
    .select()
    .single();
  if (error) throw error;
  return data;
};

export const saveInvoiceItems = async (invoiceId, items) => {
  const saved = [];
  for (const item of items || []) {
    const { invoice_id, id, ...values } = item;
    const row = {
      invoice_id: invoiceId,
      description: values.description || '',
      quantity: values.quantity,
      unit_price: values.unit_price,
      discount_percent: values.discount_percent,
      discount_amount: values.discount_amount,
      vat_rate: values.vat_rate,
      vat_natura: values.vat_natura || null,
      line_subtotal: values.line_subtotal,
      line_vat: values.line_vat,
      line_total: values.line_total,
      sort_order: values.sort_order,
    };
    if (id) {
      const { data, error } = await supabase
        .from('invoice_items')
        .update(row)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      saved.push(data);
    } else {
      const { data, error } = await supabase
        .from('invoice_items')
        .insert([row])
        .select()
        .single();
      if (error) throw error;
      saved.push(data);
    }
  }
  return saved;
};

export const removeInvoiceItems = async (ids) => {
  if (!ids || ids.length === 0) return;
  const { error } = await supabase.from('invoice_items').delete().in('id', ids);
  if (error) throw error;
};

export const validateInvoiceAttachment = (file) => {
  if (!SUPPORTED_ATTACHMENT_TYPES.has(file.type)) {
    return 'Unsupported file type. Use PDF, JPG, PNG, WebP, GIF, DOC, DOCX, XLS, or XLSX.';
  }
  if (file.size > MAX_ATTACHMENT_SIZE) {
    return 'File is too large. The maximum size is 50 MB.';
  }
  return null;
};

export const uploadInvoiceAttachment = async ({ file, userId }) => {
  if (!userId) throw new Error('Not authenticated — cannot upload file');
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const filePath = `${userId}/${crypto.randomUUID()}-${safeName}`;
  const { error } = await supabase.storage
    .from(INVOICE_BUCKET)
    .upload(filePath, file, { contentType: file.type || undefined, upsert: false });
  if (error) throw error;
  return filePath;
};

export const createInvoiceAttachment = async ({ invoiceId, userId, file, storagePath, externalUrl, externalProvider }) => {
  const row = {
    invoice_id: invoiceId,
    created_by: userId,
    file_name: file ? file.name : (externalUrl ? externalUrl.trim() : ''),
    mime_type: file ? file.type : (externalProvider ? getGoogleDocMime(parseGoogleDocLink(externalUrl)?.subtype) : null),
    file_size: file ? file.size : 0,
    storage_path: storagePath || null,
    external_url: externalUrl || null,
    external_provider: externalProvider || null,
  };
  const { data, error } = await supabase
    .from('invoice_attachments')
    .insert([row])
    .select()
    .single();
  if (error) throw error;
  return data;
};

export const removeInvoiceAttachment = async (attachment) => {
  if (attachment.storage_path) {
    const { data, error } = await supabase.storage.from(INVOICE_BUCKET).remove([attachment.storage_path]);
    if (error) throw error;
    const removed = Array.isArray(data) && data.length > 0;
    if (!removed) {
      const notRemoved = new Error('The stored file could not be removed from storage.');
      notRemoved.code = 'STORAGE_DELETE_NOT_APPLIED';
      throw notRemoved;
    }
  }
  const { error } = await supabase.from('invoice_attachments').delete().eq('id', attachment.id);
  if (error) throw error;
};

export const resolveInvoiceAttachmentUrl = async (attachment) => {
  if (attachment.external_provider) return attachment.external_url || null;
  if (!attachment.storage_path) return null;
  const { data, error } = await supabase.storage
    .from(INVOICE_BUCKET)
    .createSignedUrl(attachment.storage_path, 3600);
  if (error) {
    console.warn('[invoice] failed to create signed URL:', error.message);
    return null;
  }
  return data?.signedUrl || null;
};

export const validateGoogleInvoiceLink = (value) => {
  return parseGoogleDocLink(value);
};

export const getAttachmentFileFormat = (attachment) => {
  if (attachment.external_provider) return attachment.external_provider;
  return DOCUMENT_FILE_FORMATS[attachment.mime_type] || attachment.mime_type?.split('/').pop() || '';
};

export const computeLineTotals = (item) => {
  const quantity = Number(item.quantity) || 0;
  const unitPrice = Number(item.unit_price) || 0;
  const gross = quantity * unitPrice;
  const discountPercent = Number(item.discount_percent) || 0;
  const discountAmount = Number(item.discount_amount) || (gross * discountPercent) / 100;
  const lineSubtotal = round2(gross - discountAmount);
  const vatRate = Number(item.vat_rate) || 0;
  const lineVat = round2((lineSubtotal * vatRate) / 100);
  const lineTotal = round2(lineSubtotal + lineVat);
  return { discountAmount: round2(discountAmount), lineSubtotal, lineVat, lineTotal };
};

export const computeInvoiceTotals = (items) => {
  const rows = (items || []).map(computeLineTotals);
  const subtotal = round2(rows.reduce((s, r) => s + r.lineSubtotal, 0));
  const discountTotal = round2(rows.reduce((s, r) => s + r.discountAmount, 0));
  const vatTotal = round2(rows.reduce((s, r) => s + r.lineVat, 0));
  const total = round2(subtotal + vatTotal);
  return { subtotal, discountTotal, vatTotal, total };
};