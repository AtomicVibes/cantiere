import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

// Exported for tests: it is the whole comparison semantics of the guard.
export const serialize = (value) => {
  try {
    return JSON.stringify(value === undefined ? null : value);
  } catch {
    // Values that cannot be serialized (circular refs, File objects) are
    // treated as "no comparable baseline" rather than crashing the form.
    return null;
  }
};

/**
 * Guards a create/edit form against losing typed data.
 *
 * - Keeps a baseline snapshot of `value` taken right after the form opens
 *   (and again whenever `markInitial()` is called, e.g. after async data
 *   finishes loading), so untouched forms close without any prompt.
 * - Wraps `onOpenChange` in `handleOpenChange`: closing while dirty asks for
 *   confirmation first, so X / Cancel / Escape never silently discard input.
 * - While dirty, also warns before the browser tab itself is unloaded.
 *
 * Every Radix dismissal path — outside click, backdrop click, Escape, the
 * built-in X and the Cancel button — reaches `onOpenChange`, so wrapping it
 * is what protects the form. The shared dialog primitives are deliberately
 * left untouched: blocking outside interactions or autofocus there would also
 * change the many dialogs that have nothing to protect.
 */
export function useUnsavedChanges(open, value, onOpenChange) {
  const { t } = useTranslation();
  const [baseline, setBaseline] = useState(null);
  const valueRef = useRef(value);
  valueRef.current = value;
  // The state copy is what renders `isDirty`; this ref is what captureBaseline
  // decides against, so it must be updated the moment a baseline is accepted
  // (state updates are not visible to a callback running between renders).
  const baselineRef = useRef(null);
  const timerRef = useRef(null);

  const captureBaseline = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    // Only a form that still matches its accepted baseline may be
    // (re)baselined. Once the value has diverged, the divergence is user
    // input, so an async load finishing later must not swallow it: capturing
    // then would record half-typed fields as pristine and drop the prompt.
    // Consumers that load data call setForm(...) + markInitial() in the same
    // tick, so at this point the value is still the one we accepted.
    if (baselineRef.current !== null && serialize(valueRef.current) !== baselineRef.current) {
      return;
    }
    // Defer one tick so any setState() issued in the same effect/commit has
    // flushed first and valueRef holds the fully initialised form.
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      const snapshot = serialize(valueRef.current);
      // `null` means "not comparable" -> never treat the form as dirty.
      baselineRef.current = snapshot;
      setBaseline(snapshot);
    }, 0);
  }, []);

  useEffect(() => {
    if (!open) {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      baselineRef.current = null;
      setBaseline(null);
      return undefined;
    }
    captureBaseline();
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [open, captureBaseline]);

  // Serialised only while the dialog is open, and only when the value's
  // identity changed: the form objects stay in state, so unrelated re-renders
  // reuse the previous string instead of re-stringifying the whole form.
  // (No consumer mutates a snapshotted value in place, so identity is a safe
  // cache key.)
  const current = useMemo(() => (open ? serialize(value) : null), [open, value]);
  const isDirty = !!open && baseline !== null && current !== null && current !== baseline;

  const confirmClose = useCallback(() => {
    if (!isDirty) return true;
    return window.confirm(t('unsavedChangesConfirm'));
  }, [isDirty, t]);

  const handleOpenChange = useCallback(
    (nextOpen) => {
      if (nextOpen === false && !confirmClose()) return;
      onOpenChange?.(nextOpen);
    },
    [confirmClose, onOpenChange]
  );

  useBeforeUnload(isDirty, t('unsavedChangesConfirm'));

  return { isDirty, markInitial: captureBaseline, confirmClose, handleOpenChange };
}

/**
 * Legacy explicit-dirty variant kept for callers that track dirtiness by hand.
 */
export function useDirtyState(initialValue = {}) {
  const [initialData, setInitialData] = useState(initialValue);
  const [currentData, setCurrentData] = useState(initialValue);
  const [isDirty, setIsDirty] = useState(false);

  const markInitial = useCallback((data) => {
    setInitialData(data);
    setCurrentData(data);
    setIsDirty(false);
  }, []);

  const updateData = useCallback((updater) => {
    setCurrentData(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      setIsDirty(JSON.stringify(next) !== JSON.stringify(initialData));
      return next;
    });
  }, [initialData]);

  const reset = useCallback(() => {
    setCurrentData(initialData);
    setIsDirty(false);
  }, [initialData]);

  const forceDirty = useCallback((dirty = true) => {
    setIsDirty(dirty);
  }, []);

  return {
    initialData,
    currentData,
    isDirty,
    markInitial,
    updateData,
    reset,
    forceDirty,
  };
}

export function useBeforeUnload(isDirty, message = 'You have unsaved changes. Are you sure you want to leave?') {
  useEffect(() => {
    if (!isDirty) return undefined;
    const handleBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = message;
      return message;
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty, message]);
}
