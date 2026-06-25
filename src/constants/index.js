export const getInvoiceStatuses = (t) => [
  { value: 'draft', label: t('draft') },
  { value: 'pending', label: t('pending') },
  { value: 'paid', label: t('paid') },
  { value: 'partially_paid', label: t('partiallyPaid') },
  { value: 'overdue', label: t('overdue') },
];

export const getInvoiceCategories = (t) => [
  { value: 'materials', label: t('materials') },
  { value: 'labor', label: t('labor') },
  { value: 'equipment', label: t('equipment') },
  { value: 'architecture', label: t('architecture') },
  { value: 'engineering', label: t('engineering') },
  { value: 'transport', label: t('transport') },
  { value: 'utilities', label: t('utilities') },
  { value: 'miscellaneous', label: t('miscellaneous') },
];

export const getMemberStatuses = (t) => [
  { value: 'active', label: t('active') },
  { value: 'inactive', label: t('inactive') },
  { value: 'on_leave', label: t('onLeave') },
];

export const getJobTitles = (t) => [
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
];

export const getDocTypes = (t) => [
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
];

export const ROLES = {
  SUPER_ADMIN: 'super_admin',
  ADMIN: 'admin',
  CLIENT: 'client',
};

export const MODES = {
  DIRECT: 'direct',
  INVITE: 'invite',
};

export const REQUEST_STATUSES = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
};

export const getRequestStatuses = (t) => [
  { value: REQUEST_STATUSES.PENDING, label: t('pending') },
  { value: REQUEST_STATUSES.APPROVED, label: t('approved') },
  { value: REQUEST_STATUSES.REJECTED, label: t('rejected') },
];
