// End-to-end push pipeline contract tests (static, no browser needed):
//   - VAPID key consistency across frontend artifacts + valid key format
//   - service worker route map mirrors notificationConfig (deep-link safety)
//   - notification destination resolution (no open-homepage fallback abuse)
//   - push error mapping never leaks raw technical text
//   - wiring: relay start, claim-on-login, SW handlers, manifest, sender
// Run with: node --test src/lib/pushPipeline.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { getUserFriendlyMessage } from './userErrors.js';
import { resolveNotificationDestination } from './notificationConfig.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');

function b64UrlToBytes(s) {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const b64 = (s + pad).replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(b64, 'base64');
}

describe('VAPID key consistency', () => {
  it('frontend artifacts share one valid 65-byte public key', () => {
    const wrangler = read('wrangler.jsonc');
    const sw = read('public/sw.js');
    const env = read('.env');
    const fromWrangler = /VITE_VAPID_PUBLIC_KEY":\s*"([^"]+)"/.exec(wrangler)?.[1];
    const fromSw = /APPLICATION_SERVER_KEY = '([^']+)'/.exec(sw)?.[1];
    const fromEnv = /^VITE_VAPID_PUBLIC_KEY=(.+)$/m.exec(env)?.[1]?.trim();
    assert.ok(fromWrangler, 'wrangler key present');
    assert.ok(fromSw, 'sw key present');
    assert.ok(fromEnv, 'env key present');
    assert.equal(fromSw, fromWrangler);
    assert.equal(fromEnv, fromWrangler);
    assert.equal(b64UrlToBytes(fromWrangler).length, 65);
    // The previously broken mismatched key must be gone everywhere.
    assert.ok(!sw.includes('BI2IpPMmOWwihtC8OAeSvXqKuApewLTdDW6HozdYwgG3oHJvNeOWeiF8KRR2mEWPi8OVpjyaagI86gZpURSb_vg'));
    assert.ok(!wrangler.includes('BI2IpPMmOWwihtC8OAeSvXqKuApewLTdDW6HozdYwgG3oHJvNeOWeiF8KRR2mEWPi8OVpjyaagI86gZpURSb_vg'));
  });
});

describe('service worker route mirror', () => {
  it('sw.js NOTIFICATION_ROUTES covers the notificationConfig bases', () => {
    const sw = read('public/sw.js');
    const mapBody = /const NOTIFICATION_ROUTES = \{([\s\S]*?)\};/.exec(sw)?.[1];
    assert.ok(mapBody, 'route map present in sw.js');
    for (const [type, route] of [
      ['message', '/messages'],
      ['project_request', '/requests'],
      ['project_assignment', '/projects'],
      ['document', '/documents'],
      ['invoice_change', '/finance'],
      ['event', '/calendar'],
      ['general', '/dashboard'],
    ]) {
      assert.ok(new RegExp(`${type}:\\s*'${route.replace(/\//g, '\\/')}'`).test(mapBody), `${type} -> ${route}`);
    }
  });

  it('sw.js handles push, click and subscription rotation', () => {
    const sw = read('public/sw.js');
    assert.ok(sw.includes('self.addEventListener(\'push\''), 'push handler');
    assert.ok(sw.includes('showNotification'), 'notification display');
    assert.ok(sw.includes('self.addEventListener(\'notificationclick\''), 'click handler');
    assert.ok(sw.includes('self.addEventListener(\'pushsubscriptionchange\''), 'rotation handler');
    assert.ok(sw.includes('PUSH_SUBSCRIPTION_CHANGED'), 'relay message');
  });
});

describe('notification destination resolution', () => {
  it('routes each type to its own area (never a universal homepage)', () => {
    assert.equal(resolveNotificationDestination({ type: 'event', url: '/calendar/123' }), '/calendar/123');
    assert.equal(resolveNotificationDestination({ type: 'event', url: '/messages' }), '/calendar');
    assert.equal(resolveNotificationDestination({ type: 'message', url: '/messages' }), '/messages');
    assert.equal(
      resolveNotificationDestination({ type: 'project_request', url: '/requests?view=management' }, { isSuperAdmin: true }),
      '/requests?view=management'
    );
    assert.equal(
      resolveNotificationDestination({ type: 'project_request', url: '/requests?view=management' }, { isSuperAdmin: false }),
      '/requests'
    );
    assert.equal(resolveNotificationDestination({ type: 'nope', url: '/messages' }), '/dashboard');
    assert.equal(resolveNotificationDestination(null), '/dashboard');
  });
});

describe('push error mapping', () => {
  const t = (key, fallback) => fallback;
  it('never leaks push internals to users', () => {
    for (const raw of [
      'PushManager.subscribe failed',
      'VAPID credentials missing',
      'Web Push error 410',
      'Failed to fetch',
    ]) {
      const msg = getUserFriendlyMessage({ message: raw }, t, 'errors.pushEnable');
      assert.ok(!msg.includes('PushManager'), raw);
      assert.ok(!msg.includes('VAPID'), raw);
      assert.ok(!msg.includes('410'), raw);
      assert.ok(!msg.includes('Failed to fetch'), raw);
    }
  });
});

describe('pipeline wiring', () => {
  it('app starts the relay and claims the endpoint on login', () => {
    const app = read('App.jsx');
    assert.ok(app.includes('startPushSubscriptionRelay()'), 'relay started');
    assert.ok(app.includes('claimCurrentSubscription'), 'claim wired');
    const hook = read('src/hooks/usePushNotification.js');
    assert.ok(hook.includes('export async function claimCurrentSubscription'), 'claim exported');
    assert.ok(hook.includes("rpc('claim_push_subscription'"), 'claim RPC used');
  });

  it('manifest and dist include PWA push prerequisites', () => {
    const manifest = JSON.parse(read('public/manifest.json'));
    assert.equal(manifest.start_url, '/');
    assert.equal(manifest.scope, '/');
    assert.ok(manifest.icons.some((i) => i.sizes === '192x192'), '192 icon');
    assert.ok(manifest.icons.some((i) => i.sizes === '512x512'), '512 icon');
    assert.ok(read('public/sw.js').includes("const PRECACHE = 'geometra-v3'"), 'sw version bumped');
  });

  it('sender cleans stale subscriptions and logs deliveries', () => {
    const fn = read('supabase/functions/send-push/index.ts');
    assert.ok(fn.includes('[400, 401, 403, 404, 410]'), 'permanent-failure cleanup');
    assert.ok(fn.includes('push_delivery_log'), 'delivery logging');
    assert.ok(!/eyJ[A-Za-z0-9_-]{20,}/.test(fn), 'no embedded JWT/service key literal');
    const mig = read('supabase/migrations/20261005120000_push_delivery_log.sql');
    assert.match(mig, /create table if not exists public\.push_delivery_log/);
    assert.match(mig, /enable row level security/);
    assert.ok(!/drop table/i.test(mig.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n')));
  });

  it('rotated VAPID keys discard dead endpoints instead of re-persisting them', () => {
    const hook = read('src/hooks/usePushNotification.js');
    assert.ok(hook.includes('geometra-push-vapid-key'), 'key fingerprint tracked');
    assert.ok(hook.includes('.unsubscribe('), 'stale endpoint discarded');
    assert.ok(
      hook.indexOf('unsubscribe') > hook.indexOf('getSubscription'),
      'discard happens after reading the existing subscription'
    );
    assert.ok(
      hook.includes('serverKnowsEndpoint'),
      'unknown server-side endpoints trigger a fresh subscribe (covers pre-fix browsers with no stored fingerprint)'
    );
    assert.ok(
      hook.includes("from('push_subscriptions')") && hook.includes('.select('),
      'verification reuses the existing table, no new endpoint'
    );
    assert.ok(
      hook.includes("rpc('claim_push_subscription'"),
      'shared-device endpoints are claimed, not destroyed'
    );
  });

  it('diagnostics helper reports safe booleans only', () => {
    const hook = read('src/hooks/usePushNotification.js');
    assert.ok(hook.includes('export async function getPushDiagnostics'), 'helper exported');
    assert.ok(hook.includes('endpointHash'), 'endpoint redacted to a hash');
    assert.ok(!/console\.log\(.*endpoint[^H]/.test(hook), 'no raw endpoint logging');
    assert.ok(!/VAPID_PRIVATE|SERVICE_ROLE|TEXTBEE|service-role/i.test(hook), 'no secrets referenced');
  });

  it('never chains .catch() on supabase builders (thenables without catch)', () => {
    const hook = read('src/hooks/usePushNotification.js');
    assert.ok(!/supabase\.(rpc|from)\([^;]*?\)\.catch\(/.test(hook), 'no .catch on builders');
    assert.ok(hook.includes('const { error: claimError } = await supabase.rpc('), 'claim awaited with error field');
  });

  it('lookup failure preserves the browser subscription (failure != stale)', () => {
    const hook = read('src/hooks/usePushNotification.js');
    assert.ok(hook.includes('lookupFailed'), 'failure state tracked');
    assert.ok(
      hook.includes('!lookupFailed && !serverKnowsEndpoint'),
      'discard requires a successful lookup proving unknown status'
    );
    assert.ok(
      hook.includes('Lookup failure') && hook.includes('keep the browser subscription'),
      'intent documented'
    );
  });

  it('VAPID subject is always a valid URL, never a bare email', () => {
    const fn = read('supabase/functions/send-push/index.ts');
    assert.ok(fn.includes('resolveVapidSubject'), 'subject resolution centralized');
    assert.ok(fn.includes('mailto:${'), 'bare contact emails normalized to mailto:');
    assert.ok(fn.includes('isValidVapidSubject'), 'validity check exists');
    assert.ok(fn.includes('vapid_subject_is_valid_url'), 'probe reports validity');
    assert.ok(!/VAPID_SUBJECT\s*=\s*['"][^'"]*@[^'"]*['"]/.test(fn), 'no bare-email default in source');
  });

  it('sender resolves an existing subscription by user_id and only that', () => {
    const fn = read('supabase/functions/send-push/index.ts');
    const start = fn.indexOf("from('push_subscriptions')");
    const end = fn.indexOf('if (subError)');
    assert.ok(start >= 0 && end > start, 'lookup block located');
    const fetchBlock = fn.slice(start, end);
    assert.ok(fetchBlock.includes("select('id, subscription')"), 'selects id + payload');
    assert.ok(fetchBlock.includes(".eq('user_id', receiverId)"), 'filters by user_id');
    assert.equal(
      (fetchBlock.match(/\.eq\(/g) || []).length,
      1,
      'user_id is the ONLY filter on the subscription lookup'
    );
    assert.ok(fn.includes('if (caller === \'internal\')') && fn.includes('receiverId = body?.receiver_id'),
      'receiver_id flows from the trigger payload');
  });

  it('delivery attempts every subscription returned for the user', () => {
    const fn = read('supabase/functions/send-push/index.ts');
    assert.ok(fn.includes('subscriptions.map('), 'iterates all rows');
    assert.ok(fn.includes('total: subscriptions.length'), 'reports the full count');
  });

  it('zero subscriptions still reports No subscriptions found', () => {
    const fn = read('supabase/functions/send-push/index.ts');
    assert.ok(fn.includes('subscriptions.length === 0'), 'guarded on empty result');
    assert.ok(fn.includes("error: 'No subscriptions found'"), 'skip message preserved');
  });

  it('database query errors are never converted into No subscriptions found', () => {
    const fn = read('supabase/functions/send-push/index.ts');
    const errIdx = fn.indexOf('if (subError)');
    const emptyIdx = fn.indexOf('subscriptions.length === 0');
    assert.ok(errIdx >= 0 && emptyIdx > errIdx, 'error branch precedes the empty-result branch');
    const errBlock = fn.slice(errIdx, emptyIdx);
    assert.ok(errBlock.includes("return respond({ error: 'Failed to fetch subscriptions' }, 500)"),
      'query error returns 500 before the empty check');
    assert.ok(errBlock.includes('Subscription lookup failed'), 'query error logged distinctly');
    assert.ok(!errBlock.includes('No subscriptions found'), 'error path never writes the empty message');
  });

  it('disabled push preference is reported distinctly from missing subscriptions', () => {
    const fn = read('supabase/functions/send-push/index.ts');
    assert.ok(fn.includes("profile.push_notifications_enabled === false"), 'preference checked separately');
    assert.ok(fn.includes("error: 'Push disabled by user preference'"), 'distinct preference reason');
    const prefIdx = fn.indexOf('Push disabled by user preference');
    const emptyIdx = fn.indexOf('No subscriptions found');
    assert.ok(prefIdx >= 0 && prefIdx < emptyIdx, 'preference short-circuit happens, not masked as empty');
  });

  it('stale subscription removal is logged before the row is deleted (FK safety)', () => {
    const fn = read('supabase/functions/send-push/index.ts');
    const staleLogIdx = fn.indexOf("status: 'stale_removed',");
    const deleteIdx = fn.indexOf('.delete()');
    assert.ok(staleLogIdx >= 0, 'stale removal logged');
    assert.ok(deleteIdx >= 0, 'stale row cleanup still present');
    assert.ok(staleLogIdx < deleteIdx,
      'log precedes delete — logging afterwards violates subscription_id FK and hides the deletion');
    const callStart = fn.lastIndexOf('await writeLog({', staleLogIdx);
    const branch = fn.slice(callStart, deleteIdx);
    assert.ok(branch.includes('subscription_id: sub.id'), 'stale log carries the subscription id');
    assert.ok(fn.includes('[400, 401, 403, 404, 410]'), 'permanent-failure statuses unchanged');
  });
});
