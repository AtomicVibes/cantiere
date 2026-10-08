// Edge Function error handling contracts.
//   - `{ error }` bodies from our own functions become the user message
//   - `APIError` bodies from upstream providers (503/504, isRetryable) are
//     classified as retryable upstream failures, never as data corruption
//   - messages are sanitized before they can reach the UI or a log line
// Run with: node --test src/lib/edgeFunctionErrors.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyEdgeError,
  edgeMessageFrom,
  edgeStatusFrom,
  isRetryableEdgeError,
  sanitizeEdgeMessage,
  withRetryHint,
} from './edgeFunctionErrors.js';

const NVIDIA_OVERLOAD = {
  name: 'APIError',
  data: {
    message: 'Upstream error from Nvidia: Service temporarily overloaded',
    isRetryable: true,
    responseBody: '{"code":503,"message":"Upstream error from Nvidia: Service temporarily overloaded"}',
  },
};

const NVIDIA_IDLE_TIMEOUT = {
  name: 'APIError',
  data: {
    message: 'Upstream idle timeout exceeded',
    isRetryable: true,
    responseBody: '{"code":504,"message":"Upstream idle timeout exceeded"}',
  },
};

describe('edge function error bodies', () => {
  it('uses the { error } body instead of the generic invoke message', () => {
    const result = classifyEdgeError({
      payload: { error: 'Super Admin privileges are required to manage integrations.' },
      rawMessage: 'Edge function returned a non-2xx status code',
      contextStatus: 403,
    });
    assert.equal(result.message, 'Super Admin privileges are required to manage integrations.');
    assert.equal(result.status, 403);
    assert.equal(result.retryable, false);
    assert.ok(!result.message.includes('non-2xx'));
  });

  it('reads an object-shaped error body', () => {
    assert.equal(
      edgeMessageFrom({ error: { message: 'Nested failure.' } }, 'fallback'),
      'Nested failure.',
    );
    assert.equal(edgeMessageFrom({ details: 'Detailed failure.' }, 'fallback'), 'Detailed failure.');
  });

  it('falls back to the raw supabase message and then to the caller fallback', () => {
    assert.equal(
      classifyEdgeError({ payload: null, rawMessage: 'FunctionsRelayError', contextStatus: null })
        .message,
      'FunctionsRelayError',
    );
    assert.equal(edgeMessageFrom(null, ''), '');
  });
});

describe('retryable upstream failures', () => {
  it('treats a 503 overload as retryable, not as a database problem', () => {
    const result = classifyEdgeError({ payload: NVIDIA_OVERLOAD, contextStatus: 503 });
    assert.equal(result.retryable, true);
    assert.equal(result.status, 503);
    assert.match(result.message, /temporarily overloaded/i);
    assert.ok(!/corrupt|database|constraint|duplicate/i.test(result.message));
  });

  it('treats a 504 idle timeout as retryable', () => {
    const result = classifyEdgeError({ payload: NVIDIA_IDLE_TIMEOUT, contextStatus: 504 });
    assert.equal(result.retryable, true);
    assert.equal(result.status, 504);
    assert.match(result.message, /idle timeout/i);
  });

  it('honours an explicit isRetryable flag without a known status', () => {
    assert.equal(isRetryableEdgeError({ data: { isRetryable: true } }, null, 'nope'), true);
    assert.equal(isRetryableEdgeError({ isRetryable: true }, null, 'nope'), true);
  });

  it('does not mark a deliberate rejection as retryable', () => {
    const result = classifyEdgeError({
      payload: { error: 'Invalid activation secret.' },
      contextStatus: 401,
    });
    assert.equal(result.retryable, false);
    assert.equal(result.status, 401);
  });

  it('marks plain network failures as retryable', () => {
    const result = classifyEdgeError({ rawMessage: 'TypeError: NetworkError when attempting to fetch resource.' });
    assert.equal(result.retryable, true);
  });
});

describe('sanitisation', () => {
  it('redacts credential shaped values', () => {
    assert.match(sanitizeEdgeMessage('failed with client_secret=abc123secret'), /\[redacted\]/);
    assert.ok(!sanitizeEdgeMessage('client_secret=abc123secret').includes('abc123secret'));
    assert.match(sanitizeEdgeMessage('Authorization: Bearer abcdef'), /\[redacted\]/);
  });

  it('truncates very long upstream messages', () => {
    const long = `x ${'a'.repeat(1000)}`;
    assert.ok(sanitizeEdgeMessage(long).length <= 400);
  });

  it('never invents a status code from free text', () => {
    assert.equal(edgeStatusFrom({ error: 'HTTP 500 in message only' }, null), null);
    assert.equal(edgeStatusFrom({ status: 9999 }, null), null);
  });
});

describe('retry hint', () => {
  const t = (key) => (key === 'errors.retryableUpstream' ? 'Please retry in a moment.' : key);

  it('is appended only to retryable failures', () => {
    assert.equal(withRetryHint('Upstream idle timeout exceeded', true, t), 'Upstream idle timeout exceeded — Please retry in a moment.');
    assert.equal(withRetryHint('Invalid activation secret.', false, t), 'Invalid activation secret.');
    assert.equal(withRetryHint('Upstream idle timeout exceeded', true, undefined), 'Upstream idle timeout exceeded');
  });
});
