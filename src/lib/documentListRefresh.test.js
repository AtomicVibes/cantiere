// Document list refresh after upload:
//   - success invalidates ['documents', userId] and resolves true
//   - a failed refetch is surfaced as its own error with a Retry action,
//     never as a thrown upload failure
//   - the Retry action re-runs the refresh until it succeeds
// Run with: node --test src/lib/documentListRefresh.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { refreshDocumentList } from './documentListRefresh.js';

const t = (key) => key;

function makeClient({ reject = false, state = { status: 'success', error: null } } = {}) {
  const client = {
    reject,
    state,
    invalidateCount: 0,
    lastKey: null,
    lastOptions: null,
    async invalidateQueries(filters, options) {
      client.invalidateCount += 1;
      client.lastKey = filters.queryKey;
      client.lastOptions = options;
      if (client.reject) throw new Error('network down');
    },
    getQueryState() {
      return client.state;
    },
  };
  return client;
}

function makeToast() {
  const toasts = [];
  return {
    toasts,
    error(message, options) {
      toasts.push({ message, options });
    },
  };
}

describe('refreshDocumentList', () => {
  it('invalidates the shared documents query and resolves true on success', async () => {
    const client = makeClient();
    const toast = makeToast();
    const result = await refreshDocumentList({ queryClient: client, userId: 'user-1', t, toast });
    assert.equal(result, true);
    assert.equal(client.invalidateCount, 1);
    assert.deepEqual(client.lastKey, ['documents', 'user-1']);
    assert.equal(client.lastOptions?.throwOnError, true);
    assert.equal(toast.toasts.length, 0);
  });

  it('reports a failed refetch with a Retry action instead of throwing', async () => {
    const client = makeClient({ reject: true });
    const toast = makeToast();
    const result = await refreshDocumentList({ queryClient: client, userId: 'user-1', t, toast });
    assert.equal(result, false);
    assert.equal(toast.toasts.length, 1);
    assert.equal(toast.toasts[0].message, 'documentsRefreshFailed');
    assert.equal(toast.toasts[0].options.action.label, 'retry');
    assert.equal(typeof toast.toasts[0].options.action.onClick, 'function');
  });

  it('treats an errored query state as a failed refresh', async () => {
    const client = makeClient({ state: { status: 'error', error: new Error('boom') } });
    const toast = makeToast();
    const result = await refreshDocumentList({ queryClient: client, userId: null, t, toast });
    assert.equal(result, false);
    assert.deepEqual(client.lastKey, ['documents', null]);
    assert.equal(toast.toasts.length, 1);
  });

  it('Retry re-runs the refresh and succeeds once the network recovers', async () => {
    const client = makeClient({ reject: true });
    const toast = makeToast();
    await refreshDocumentList({ queryClient: client, userId: 'user-1', t, toast });
    client.reject = false;
    const retried = await toast.toasts[0].options.action.onClick();
    assert.equal(retried, true);
    assert.equal(client.invalidateCount, 2);
    assert.equal(toast.toasts.length, 1);
  });
});
