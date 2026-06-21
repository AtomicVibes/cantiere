import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

/*
  Zod dynamic validation (add to any form page):

  import { z } from 'zod';
  import { useTeamFormFields } from '@/hooks/useFormSchema';

  function TeamForm() {
    const { fields } = useTeamFormFields();
    // Dynamic schema — re-created on every render so labels are fresh
    const schema = useMemo(() => z.object({
      full_name: z.string().min(1, fields[0].label + ' is required'),
      email: z.string().email(fields[1].label + ' is invalid').optional(),
    }), [fields]);
    // useForm({ resolver: zodResolver(schema) }) ...
  }
*/

export function useTeamFormFields() {
  const { t, i18n } = useTranslation();

  return useMemo(() => ({
    fields: [
      { key: 'full_name', label: t('fullName'), type: 'text', required: true },
      { key: 'email', label: t('email'), type: 'email', required: false },
      { key: 'phone', label: t('phone'), type: 'text', required: false },
      { key: 'job_title', label: t('jobTitle'), type: 'select', required: false },
      { key: 'department', label: t('department'), type: 'text', required: false },
      { key: 'role_id', label: t('role'), type: 'select', required: false },
    ],
    jobTitleOptions: [
      { value: 'project_manager', label: t('supervisor') },
      { value: 'project_coordinator', label: t('projectCoordinator') },
      { value: 'supervisor', label: t('supervisor') },
      { value: 'architect', label: t('architect') },
      { value: 'civil_engineer', label: t('civilEngineer') },
      { value: 'interior_designer', label: t('interiorDesigner') },
      { value: 'technician', label: t('technician') },
      { value: 'accountant', label: t('accountant') },
      { value: 'procurement_officer', label: t('procurementOfficer') },
      { value: 'supplier', label: t('supplier') },
      { value: 'contractor', label: t('contractor') },
      { value: 'safety_officer', label: t('safetyOfficer') },
      { value: 'surveyor', label: t('surveyor') },
      { value: 'consultant', label: t('consultant') },
    ],
    statusOptions: [
      { value: 'active', label: t('active') },
      { value: 'inactive', label: t('inactive') },
      { value: 'on_leave', label: t('onLeave') },
    ],
  }), [i18n.language]);
}

export function useInvoiceFormFields() {
  const { t, i18n } = useTranslation();

  return useMemo(() => ({
    fields: [
      { key: 'invoice_number', label: t('invoiceNumber'), type: 'text', required: true },
      { key: 'supplier', label: t('supplier'), type: 'text', required: false },
      { key: 'client_id', label: t('client'), type: 'select', required: false },
      { key: 'project_id', label: t('project'), type: 'select', required: false },
      { key: 'amount', label: `${t('amount')} (€)`, type: 'number', required: false },
      { key: 'tax', label: `${t('tax')} (€)`, type: 'number', required: false },
      { key: 'total', label: `${t('total')} (€)`, type: 'number', required: false },
      { key: 'category', label: t('category'), type: 'select', required: false },
      { key: 'issue_date', label: t('issueDate'), type: 'date', required: false },
      { key: 'due_date', label: t('dueDate'), type: 'date', required: false },
      { key: 'payment_status', label: t('paymentStatus'), type: 'select', required: false },
    ],
    categoryOptions: [
      { value: 'materials', label: t('materials') },
      { value: 'labor', label: t('labor') },
      { value: 'equipment', label: t('equipment') },
      { value: 'architecture', label: t('architecture') },
      { value: 'engineering', label: t('engineering') },
      { value: 'transport', label: t('transport') },
      { value: 'utilities', label: t('utilities') },
      { value: 'miscellaneous', label: t('miscellaneous') },
    ],
    statusOptions: [
      { value: 'draft', label: t('draft') },
      { value: 'pending', label: t('pending') },
      { value: 'paid', label: t('paid') },
      { value: 'partially_paid', label: t('partiallyPaid') },
      { value: 'overdue', label: t('overdue') },
    ],
  }), [i18n.language]);
}

export function useDocumentFormFields() {
  const { t, i18n } = useTranslation();

  return useMemo(() => ({
    fields: [
      { key: 'name', label: t('name'), type: 'text', required: true },
      { key: 'type', label: t('type'), type: 'select', required: false },
      { key: 'notes', label: t('description'), type: 'text', required: false },
    ],
    typeOptions: [
      { value: 'blueprint', label: t('blueprint') },
      { value: 'contract', label: t('contract') },
      { value: 'permit', label: t('permit') },
      { value: 'invoice', label: t('invoice') },
      { value: 'photo', label: t('photo') },
      { value: 'video', label: t('video') },
      { value: 'audio_note', label: t('audioNote') },
      { value: 'cad_file', label: t('cadFile') },
      { value: 'report', label: t('report') },
      { value: 'other', label: t('other') },
    ],
  }), [i18n.language]);
}
