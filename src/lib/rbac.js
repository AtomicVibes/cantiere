export function isPermissionDenied(error) {
  return error?.code === '42501';
}

export function handleMutationError(error, t, toast) {
  if (isPermissionDenied(error)) {
    toast.error(t('accessDenied'));
    return true;
  }
  return false;
}
