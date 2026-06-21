import { z } from 'zod';

export function createTeamSchema(t, fields) {
  const f = Object.fromEntries(fields.map(f => [f.key, f]));
  return z.object({
    full_name: z.string().min(1, `${f.full_name?.label || 'Name'} ${t('isRequired')}`),
    email: z.string().email(`${t('email')} ${t('isInvalid')}`).optional().or(z.literal('')),
    phone: z.string().optional(),
    job_title: z.string().optional(),
    department: z.string().optional(),
    role_id: z.string().min(1, `${t('role')} ${t('isRequired')}`),
  });
}

export function createInvoiceSchema(t, fields) {
  const f = Object.fromEntries(fields.map(f => [f.key, f]));
  return z.object({
    invoice_number: z.string().min(1, `${f.invoice_number?.label || t('invoiceNumber')} ${t('isRequired')}`),
    amount: z.preprocess(v => Number(v), z.number().min(0)).optional(),
    tax: z.preprocess(v => Number(v), z.number().min(0)).optional(),
    due_date: z.string().optional(),
  });
}
