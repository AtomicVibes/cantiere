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
});
