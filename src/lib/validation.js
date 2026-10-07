import { z } from 'zod';

// Identity rules shared by every account-creation path (frontend mirror of
// the database constraints in 20261017120000_account_uniqueness.sql).
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const USERNAME_REGEX = /^[a-z0-9_.-]{3,30}$/;
export const PASSWORD_MIN_LENGTH = 8;

export const normalizeEmail = (email) => String(email ?? '').trim().toLowerCase();
export const normalizeUsername = (username) => String(username ?? '').trim().toLowerCase();

export const isValidEmail = (email) => EMAIL_REGEX.test(String(email ?? '').trim());
export const isValidUsername = (username) => USERNAME_REGEX.test(String(username ?? '').trim());

// App password requirements: >= 8 chars with at least one letter and one digit.
export const isValidPassword = (password) => {
  const value = String(password ?? '');
  return value.length >= PASSWORD_MIN_LENGTH && /[A-Za-z]/.test(value) && /\d/.test(value);
};

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
