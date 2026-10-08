import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';

const STATUS_KEYS = {
  pending: 'sageSyncPending',
  syncing: 'sageSyncSyncing',
  synced: 'sageSyncSynced',
  error: 'sageSyncError',
  skipped: 'sageSyncSkipped',
};

const STATUS_VARIANT = {
  synced: 'secondary',
  error: 'destructive',
  syncing: 'outline',
  pending: 'outline',
  skipped: 'outline',
};

/**
 * Sage synchronization state of an invoice. Hidden for `not_synced` so the
 * normal invoice UI stays unchanged for records that never touched Sage.
 */
export default function SageSyncBadge({ status, error, className = '' }) {
  const { t } = useTranslation();
  if (!status || status === 'not_synced') return null;

  const key = STATUS_KEYS[status];
  if (!key) return null;

  return (
    <Badge variant={STATUS_VARIANT[status] || 'outline'} className={className} title={error || undefined}>
      {t(key)}
    </Badge>
  );
}
