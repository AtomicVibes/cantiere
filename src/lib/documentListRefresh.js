import { logDocumentError } from './document-errors.js';

// Refreshes the shared documents list query after a successful upload and
// waits for the refetch to settle. Returns true when the list holds fresh
// data. A failed refetch never throws: the upload itself already persisted,
// so it is reported as its own localized error with a Retry action instead.
export async function refreshDocumentList({ queryClient, userId, t, toast }) {
  const queryKey = ['documents', userId];
  try {
    await queryClient.invalidateQueries({ queryKey }, { throwOnError: true });
    const state = queryClient.getQueryState(queryKey);
    if (state?.error) throw state.error;
    return true;
  } catch (error) {
    logDocumentError('Document list refresh failed', error, { userId: userId || null });
    toast.error(t('documentsRefreshFailed'), {
      duration: 10000,
      action: {
        label: t('retry'),
        onClick: () => refreshDocumentList({ queryClient, userId, t, toast }),
      },
    });
    return false;
  }
}
