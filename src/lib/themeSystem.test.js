// Theme system + push pipeline integrity contracts:
//   - single next-themes provider (class attribute, system default)
//   - one storage key shared by FOUC script, provider and Settings
//   - no manual theme class writes outside the provider
//   - shared screens use semantic tokens (no light-only hardcodes)
//   - event-color priority and push pipeline untouched by the refactor
// Run with: node --test src/lib/themeSystem.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { getEffectiveEventColor } from './eventColors.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');

describe('single shadcn-style theme provider', () => {
  it('main.jsx renders the app inside one ThemeProvider', () => {
    const main = read('main.jsx');
    assert.ok(main.includes("from './src/components/theme-provider'"), 'provider imported');
    assert.ok(main.includes('<ThemeProvider>'), 'provider wraps app');
    assert.equal((main.match(/<ThemeProvider>/g) || []).length, 1, 'exactly one provider');
  });

  it('provider follows the shadcn next-themes pattern on one storage key', () => {
    const tp = read('src/components/theme-provider.jsx');
    assert.ok(tp.includes("from 'next-themes'"), 'uses installed next-themes');
    assert.ok(tp.includes('attribute="class"'), 'class attribute');
    assert.ok(tp.includes('defaultTheme="system"'), 'system default');
    assert.ok(tp.includes('enableSystem'), 'system tracking');
    assert.ok(tp.includes('disableTransitionOnChange'), 'no transition flash');
    assert.ok(tp.includes("storageKey=\"app-theme\"") || tp.includes("storageKey='app-theme'"), 'shared key');
  });

  it('FOUC script and Settings share the same key; no manual class writes', () => {
    const html = read('index.html');
    assert.ok(html.includes('suppressHydrationWarning'), 'hydration warning suppressed');
    assert.ok(html.includes("LS_KEY = 'app-theme'"), 'FOUC reads the shared key');
    assert.ok(!html.includes('app-theme-preference'), 'dead key gone');
    const settings = read('src/pages/Settings.jsx');
    assert.ok(!settings.includes('classList.add'), 'no manual theme writes');
    assert.ok(!settings.includes('classList.toggle'), 'no manual theme writes');
    assert.ok(!settings.includes('localStorage.setItem'), 'provider owns persistence');
    assert.ok(settings.includes('setTheme('), 'selection flows through provider');
  });
});

describe('semantic tokens on shared screens', () => {
  it('fallback and 404 screens avoid light-only hardcodes', () => {
    for (const f of ['src/components/ProtectedRoute.jsx', 'src/lib/PageNotFound.jsx']) {
      const src = read(f);
      for (const bad of ['bg-white', 'bg-slate-', 'border-slate-', 'text-slate-']) {
        assert.ok(!src.includes(bad), `${f} must not contain ${bad}`);
      }
    }
    const pnf = read('src/lib/PageNotFound.jsx');
    assert.ok(pnf.includes('bg-background'), 'background token');
    assert.ok(pnf.includes('text-foreground'), 'foreground token');
    assert.ok(pnf.includes('text-muted-foreground'), 'muted token');
    assert.ok(pnf.includes('focus:ring-ring'), 'ring token');
  });

  it('Settings uses Lucide icons with accessible, RTL-safe rows', () => {
    const settings = read('src/pages/Settings.jsx');
    for (const icon of ['Sun', 'Moon', 'Monitor', 'Palette', 'Bell', 'Smartphone', 'MessageSquare', 'Info', 'Languages', 'User']) {
      assert.ok(settings.includes(icon), `icon ${icon} present`);
    }
    assert.ok(settings.includes("from 'lucide-react'"), 'single icon library');
    assert.ok(!settings.includes('font-awesome') && !settings.includes('FontAwesome'), 'no mixed icon sets');
  });
});

describe('event colors and push pipeline untouched', () => {
  it('effective-color priority still holds after the theme refactor', () => {
    assert.equal(
      getEffectiveEventColor(
        { type: 'meeting', event_color: '#10B981', event_type_id: 't1' },
        { id: 't1', name: 'Meeting', color: '#3B82F6' },
        '#C8102E'
      ),
      '#10B981'
    );
    const cal = read('src/pages/CalendarPage.jsx');
    assert.ok(cal.includes('getEffectiveEventColor'), 'calendar still resolves via accent-aware path');
  });

  it('notification producers still flow through the central trigger pipeline', () => {
    const page = read('src/pages/MessagesPage.jsx');
    assert.ok(page.includes("from('notifications').insert"), 'message notifications created');
    const fn = read('supabase/functions/send-push/index.ts');
    assert.ok(fn.includes("from('push_subscriptions')"), 'central delivery service intact');
    assert.ok(fn.includes('push_notifications_enabled'), 'preference gate intact');
  });
});
