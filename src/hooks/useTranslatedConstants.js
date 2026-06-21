import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  getInvoiceStatuses,
  getInvoiceCategories,
  getMemberStatuses,
  getJobTitles,
  getDocTypes,
} from '@/constants';

export function useInvoiceConstants() {
  const { t, i18n } = useTranslation();
  return useMemo(() => ({
    statuses: getInvoiceStatuses(t),
    categories: getInvoiceCategories(t),
  }), [i18n.language]);
}

export function useMemberConstants() {
  const { t, i18n } = useTranslation();
  return useMemo(() => ({
    statuses: getMemberStatuses(t),
    jobTitles: getJobTitles(t),
  }), [i18n.language]);
}

export function useDocumentConstants() {
  const { t, i18n } = useTranslation();
  return useMemo(() => ({
    types: getDocTypes(t),
  }), [i18n.language]);
}
