// Unsaved-changes guard — the invariants that must keep holding.
//
// Three layers, deliberately:
//   1. Behaviour, executed: the real hook is driven by the harness at the
//      bottom of this file (React's hook dispatcher + stubbed timers, because
//      this project has no jsdom/react-test-renderer). It reproduces the
//      async-baseline race, the dirty/clean prompt decision, reopen and
//      save/reopen flows without a browser.
//   2. Wiring contracts (source-level, the same style as budgetCategories and
//      themeSystem tests): every dialog routes close through handleOpenChange,
//      and the confirmation message exists in all four locales.
//   3. Serialisation contract: `serialize` is exported so the comparison
//      rules (nested values, empty values, attachment lists, unserialisable
//      input) are executed directly instead of guessed at.
// Run with: node --test src/lib/unsavedChanges.test.js
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import React from 'react';
import rds from 'react-dom/server';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { useUnsavedChanges, serialize } from '../hooks/useUnsavedChanges.js';

const { renderToString } = rds;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');

const CONSUMERS = [
  'src/components/budget/BudgetManager.jsx',
  'src/components/budget/ExpenseManager.jsx',
  'src/components/budget/RefundManager.jsx',
  'src/components/invoices/InvoiceFormDialog.jsx',
  'src/components/projects/ProjectFormDialog.jsx',
  'src/components/teams/EditMemberDialog.jsx',
  'src/pages/CalendarPage.jsx',
  'src/pages/Clients.jsx',
  'src/pages/Teams.jsx',
];

const count = (haystack, needle) => haystack.split(needle).length - 1;

async function makeI18n() {
  const instance = i18next.createInstance();
  await instance.init({
    lng: 'en',
    resources: { en: { translation: { unsavedChangesConfirm: 'DISCARD?' } } },
  });
  return instance;
}

function Harness({ open, value, onOpenChange, api }) {
  api.hook = useUnsavedChanges(open, value, onOpenChange);
  return null;
}

async function renderHook({ value = { title: '' }, open = true } = {}) {
  const i18n = await makeI18n();
  const api = {};
  renderToString(
    React.createElement(
      I18nextProvider,
      { i18n },
      React.createElement(Harness, { open, value, onOpenChange: api.onOpenChange = () => {}, api })
    )
  );
  return api;
}

describe('behaviour of a freshly opened form (rendered with react-dom/server)', () => {
  it('starts out not dirty', async () => {
    const api = await renderHook({ open: true, value: { title: 'draft' } });
    assert.equal(typeof api.hook.isDirty, 'boolean');
    assert.equal(api.hook.isDirty, false, 'a form that has not been touched must not be dirty');
  });

  it('starts out not dirty while closed', async () => {
    const api = await renderHook({ open: false });
    assert.equal(api.hook.isDirty, false);
  });

  it('forwards a close request without prompting', async () => {
    const i18n = await makeI18n();
    const api = {};
    let confirmCalls = 0;
    const closes = [];
    globalThis.window = {
      confirm() {
        confirmCalls += 1;
        return false;
      },
      setTimeout,
      clearTimeout,
    };
    renderToString(
      React.createElement(
        I18nextProvider,
        { i18n },
        React.createElement(Harness, {
          open: true,
          value: { title: '' },
          onOpenChange: (next) => closes.push(next),
          api,
        })
      )
    );
    api.hook.handleOpenChange(false);
    assert.deepEqual(closes, [false], 'clean form must close');
    assert.equal(confirmCalls, 0, 'window.confirm must not be consulted when the form is clean');
    api.hook.handleOpenChange(true);
    assert.deepEqual(closes, [false, true], 'opening is never intercepted');
    delete globalThis.window;
  });
});

describe('wiring contracts (source-level)', () => {
  it('every dialog that owns a form imports the hook', () => {
    for (const file of CONSUMERS) {
      const src = read(file);
      assert.ok(
        src.includes("from '@/hooks/useUnsavedChanges'"),
        `${file} must import useUnsavedChanges`
      );
    }
  });

  it('every one of those dialogs closes through handleOpenChange', () => {
    for (const file of CONSUMERS) {
      const src = read(file);
      assert.ok(
        src.includes('onOpenChange={handleOpenChange}'),
        `${file} must pass handleOpenChange to <Dialog>`
      );
      assert.ok(
        src.includes('handleOpenChange(false)'),
        `${file} Cancel/X must ask before discarding`
      );
      assert.ok(
        !/<Dialog[^>]*onOpenChange=\{(?:setShowForm|onOpenChange)\}/.test(src),
        `${file} must not bypass the guard with the raw setter`
      );
    }
  });

  it('the shared dialog primitives stay untouched, so unrelated dialogs are unchanged', () => {
    // Protection lives in handleOpenChange (Radix routes outside click,
    // backdrop, Escape and the built-in X through onOpenChange), so the shared
    // primitives must not grow global rules that would also change the ~19
    // dialogs and ~13 alert dialogs that have nothing to protect.
    for (const file of ['src/components/ui/dialog.jsx', 'src/components/ui/alert-dialog.jsx']) {
      const src = read(file);
      for (const forbidden of [
        'keepOpenOnOutsideInteraction',
        'onPointerDownOutside',
        'onInteractOutside',
        'onFocusOutside',
        'onOpenAutoFocus',
        'onPointerDown={(e) => e.preventDefault()}',
      ]) {
        assert.ok(
          !src.includes(forbidden),
          `${file} must not carry a global dialog rule (${forbidden})`
        );
      }
    }
  });

  it('only a dirty close prompts, and the tab warns while dirty', () => {
    const src = read('src/hooks/useUnsavedChanges.js');
    assert.ok(
      src.includes('if (nextOpen === false && !confirmClose()) return;'),
      'close must be intercepted only when the confirmation is refused'
    );
    assert.ok(
      src.includes("window.confirm(t('unsavedChangesConfirm'))"),
      'the prompt must use the translated message'
    );
    assert.ok(
      src.includes('useBeforeUnload(isDirty,'),
      'a dirty form must warn before the tab unloads'
    );
  });

  it('the confirmation message exists in all four locales', () => {
    const src = read('src/i18n.js');
    const keys = count(src, 'unsavedChangesConfirm:');
    assert.equal(keys, 4, `expected 4 locales, found ${keys}`);
    assert.ok(!/unsavedChangesConfirm:\s*''/.test(src), 'no empty translation');
  });

  it('removeFile is declared exactly once per locale (duplicates removed)', () => {
    const src = read('src/i18n.js');
    const keys = count(src, 'removeFile:');
    assert.equal(keys, 4, `expected one per locale, found ${keys}`);
  });

  it('async-loaded forms re-baseline once the data lands', () => {
    for (const file of [
      'src/components/invoices/InvoiceFormDialog.jsx',
      'src/components/projects/ProjectFormDialog.jsx',
      'src/components/teams/EditMemberDialog.jsx',
    ]) {
      const src = read(file);
      assert.ok(
        src.includes('markInitial()'),
        `${file} must re-baseline after loading, or loading looks like unsaved input`
      );
    }
  });

});

describe('serialisation contract (executed)', () => {
  it('treats an absent value as null rather than as "undefined"', () => {
    assert.equal(serialize(undefined), 'null');
    assert.equal(serialize(null), 'null');
    assert.notEqual(serialize(undefined), serialize(''));
  });

  it('separates an empty value from an absent one', () => {
    assert.notEqual(serialize(''), serialize(null));
    assert.notEqual(serialize({ qty: '' }), serialize({ qty: null }));
    assert.equal(serialize({ qty: '' }), serialize({ qty: '' }));
  });

  it('compares nested objects and arrays by content', () => {
    assert.equal(
      serialize({ form: { items: [{ q: 1 }] }, tags: ['a', 'b'] }),
      serialize({ form: { items: [{ q: 1 }] }, tags: ['a', 'b'] })
    );
    assert.notEqual(serialize({ items: [{ q: 1 }] }), serialize({ items: [{ q: 2 }] }));
    assert.notEqual(serialize(['a', 'b']), serialize(['b', 'a']));
  });

  it('notices attachment-list changes, including two files with the same name', () => {
    const one = serialize(['file:report.pdf']);
    const two = serialize(['file:report.pdf', 'file:report.pdf']);
    const removed = serialize([]);
    assert.notEqual(one, two, 'adding a second identical name must count as a change');
    assert.notEqual(one, removed, 'removing an attachment must count as a change');
    assert.notEqual(serialize(['google:https://x/y']), serialize(['file:https://x/y']));
  });

  it('returns null for unserialisable input instead of throwing', () => {
    const circular = { name: 'draft' };
    circular.self = circular;
    assert.equal(serialize(circular), null, 'circular refs must degrade to "not comparable"');
  });
});

describe('defects fixed in this audit (regression contracts)', () => {
  it('the invoice dialog re-reads the record when it is reopened', () => {
    const src = read('src/components/invoices/InvoiceFormDialog.jsx');
    assert.ok(
      /if \(!open \|\| !detail \|\| detailInitRef\.current\) return;/.test(src),
      'detailInitRef must be reset by the open effect, and the load must re-run on reopen'
    );
    assert.ok(
      src.includes('}, [open, detail, markInitial]);'),
      'the detail effect must depend on `open`, or cached detail never reloads'
    );
    assert.ok(
      src.includes('detailInitRef.current = false;'),
      'the open effect must arm the detail loader again'
    );
  });

  it('an already-persisted attachment deletion does not fake an unsaved change', () => {
    const src = read('src/components/invoices/InvoiceFormDialog.jsx');
    assert.ok(
      !/^\s*existing:\s*existing\.map/m.test(src),
      '`existing` must stay out of the snapshot: removals hit storage/DB immediately'
    );
    assert.ok(src.includes('handleRemoveExisting'), 'the immediate deletion path must remain');
    assert.ok(
      src.includes('pending: pending.map(p => `${p.type}:${p.name}`)'),
      'pending uploads are the part that is genuinely unsaved'
    );
  });

  it('the member dialog re-baselines on loaded content, not array identity', () => {
    const src = read('src/components/teams/EditMemberDialog.jsx');
    assert.ok(
      src.includes('const assignedSignature = assignedProjectIds.join'),
      'the baseline must key on assignment content'
    );
    assert.ok(
      src.includes('}, [assignedSignature, markInitial]);'),
      'the assignments effect must depend on the signature'
    );
    assert.ok(
      !src.includes('}, [assignedProjectIds, markInitial]);'),
      'an identity key would re-baseline on every render of the default []'
    );
  });

  it('the guard serialises only while a dialog is open', () => {
    const src = read('src/hooks/useUnsavedChanges.js');
    assert.ok(
      src.includes('open ? serialize(value) : null'),
      'a closed dialog must not stringify its form on every render'
    );
    assert.ok(
      src.includes('export const serialize'),
      'serialize must stay exported so its rules stay covered'
    );
  });

  it('saving closes through the raw setter, and Cancel is the only guarded close', () => {
    for (const file of CONSUMERS) {
      const src = read(file);
      assert.equal(
        count(src, 'handleOpenChange(false)'),
        1,
        `${file} must expose exactly one guarded close (the Cancel/X button)`
      );
      // `handleOpenChange(false)` does not contain this needle (case differs),
      // so this counts only the raw post-save closes.
      const rawSaves = count(src, 'onOpenChange(false)');
      const rawStateCloses = count(src, 'setShowForm(false)');
      assert.ok(
        rawSaves + rawStateCloses >= 1,
        `${file} must close after a successful save without re-prompting`
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Harness: drive the real hook without a DOM.
//
// This project has no jsdom / react-test-renderer, so instead of rendering we
// install React's hook dispatcher ourselves: the real useUnsavedChanges runs,
// its effects fire when the test asks, and window.setTimeout is a queue the
// test drains on demand. That is what makes the async-baseline race — which
// depends on timer ordering — deterministic instead of timing-based.
// ---------------------------------------------------------------------------
const reactDispatcher =
  React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher;

const sameDeps = (a, b) =>
  Array.isArray(a) &&
  Array.isArray(b) &&
  a.length === b.length &&
  a.every((value, i) => Object.is(value, b[i]));

function createHookRunner(hookFn, { i18n } = {}) {
  const props = {};
  const cells = [];
  const layoutEffects = [];
  const passiveEffects = [];
  const timers = new Map();
  let cursor = 0;
  let output = null;
  let dirty = false;
  let timerId = 1;

  const defineEffect = (store, effect, deps) => {
    const i = cursor++;
    const cell = store[i];
    if (!cell) {
      store[i] = { deps, effect, cleanup: null, pending: true };
      return;
    }
    cell.effect = effect;
    if (!sameDeps(cell.deps, deps)) {
      cell.deps = deps;
      cell.pending = true;
    }
  };

  const dispatcher = {
    useContext: () => ({ i18n }),
    useState(initial) {
      const i = cursor++;
      if (!cells[i]) {
        cells[i] = { value: typeof initial === 'function' ? initial() : initial };
        cells[i].set = (next) => {
          const value = typeof next === 'function' ? next(cells[i].value) : next;
          if (!Object.is(value, cells[i].value)) {
            cells[i].value = value;
            dirty = true;
          }
        };
      }
      return [cells[i].value, cells[i].set];
    },
    useRef(initial) {
      const i = cursor++;
      if (!cells[i]) cells[i] = { current: initial };
      return cells[i];
    },
    useMemo(factory, deps) {
      const i = cursor++;
      if (!cells[i] || !sameDeps(cells[i].deps, deps)) cells[i] = { deps, value: factory() };
      return cells[i].value;
    },
    useCallback(fn, deps) {
      return dispatcher.useMemo(() => fn, deps);
    },
    useEffect(effect, deps) {
      defineEffect(passiveEffects, effect, deps);
    },
    useLayoutEffect(effect, deps) {
      defineEffect(layoutEffects, effect, deps);
    },
    useSyncExternalStore(subscribe, getSnapshot) {
      const snapshot = getSnapshot();
      dispatcher.useEffect(() => subscribe(() => { dirty = true; }), [subscribe]);
      return snapshot;
    },
    useDebugValue() {},
  };

  function render() {
    cursor = 0;
    dirty = false;
    reactDispatcher.current = dispatcher;
    try {
      output = hookFn(props);
    } finally {
      reactDispatcher.current = null;
    }
  }

  function runEffects(store) {
    for (const cell of store) {
      if (!cell || !cell.pending) continue;
      cell.pending = false;
      if (cell.cleanup) {
        cell.cleanup();
        cell.cleanup = null;
      }
      const cleanup = cell.effect();
      cell.cleanup = typeof cleanup === 'function' ? cleanup : null;
    }
  }

  function runTimers() {
    if (timers.size === 0) return false;
    const due = [...timers.values()];
    timers.clear();
    for (const fire of due) fire();
    return true;
  }

  return {
    window: {
      setTimeout(fn) {
        const id = timerId++;
        timers.set(id, fn);
        return id;
      },
      clearTimeout(id) {
        timers.delete(id);
      },
      confirm() {
        return false;
      },
      addEventListener() {},
      removeEventListener() {},
    },
    set(partial) {
      Object.assign(props, partial);
    },
    get out() {
      return output;
    },
    pump() {
      for (let step = 0; step < 50; step += 1) {
        render();
        runEffects(layoutEffects);
        runEffects(passiveEffects);
        const fired = runTimers();
        if (!dirty && !fired) return output;
      }
      throw new Error('hook runner did not settle');
    },
  };
}

describe('async baseline race (real hook, no DOM)', () => {
  let runner;
  let confirmCalls;
  let closes;

  beforeEach(async () => {
    confirmCalls = 0;
    closes = [];
    runner = createHookRunner(
      ({ open, value, onOpenChange }) => useUnsavedChanges(open, value, onOpenChange),
      { i18n: await makeI18n() }
    );
    runner.window.confirm = () => { confirmCalls += 1; return false; };
    globalThis.window = runner.window;
  });

  afterEach(() => {
    delete globalThis.window;
  });

  it('never lets a late baseline swallow input typed during the load', () => {
    runner.set({
      open: true,
      value: { title: 'draft', notes: '', audience: [] },
      onOpenChange: (next) => closes.push(next),
    });
    runner.pump();
    assert.equal(runner.out.isDirty, false, 'a freshly opened form is clean');

    // (a) async form data lands while nothing was typed: must not look dirty.
    //     Consumers do setForm(...) then markInitial() in the same tick, so the
    //     hook still sees the previous value when markInitial() runs.
    runner.set({ value: { title: 'draft', notes: '', audience: ['u1'] } });
    runner.out.markInitial();
    runner.pump();
    assert.equal(runner.out.isDirty, false, 'async init must not create a false dirty state');

    // (b) the user starts typing while the next request is still in flight
    runner.set({ value: { title: 'draft', notes: 'half typed', audience: ['u1'] } });
    runner.pump();
    assert.equal(runner.out.isDirty, true, 'typed input is an unsaved change');

    // (c) that request finally answers and re-baselines: it must not clear (b)
    runner.set({ value: { title: 'draft', notes: 'half typed', audience: ['u1', 'u2'] } });
    runner.out.markInitial();
    runner.pump();
    assert.equal(
      runner.out.isDirty,
      true,
      'async loading must not overwrite the baseline once user edits have begun'
    );

    // ...so closing still asks
    runner.out.handleOpenChange(false);
    assert.equal(confirmCalls, 1, 'the dirty form must ask before discarding');
    assert.deepEqual(closes, [], 'a refused close must not reach the parent');
  });

  it('keeps an untouched invoice clean while its audience loads, then guards edits', () => {
    // Mirrors InvoiceFormDialog: the form still holds the previous record
    // when the dialog opens, the detail query answers first, the audience
    // query answers later.
    runner.set({ open: true, value: { title: 'previous record' }, onOpenChange: (next) => closes.push(next) });
    runner.pump();
    assert.equal(runner.out.isDirty, false, 'opening is not a change');

    runner.set({ value: { title: 'invoice 42', audience: [] } });
    runner.out.markInitial(); // setForm(loaded) + markInitial(), same tick
    runner.pump();
    assert.equal(runner.out.isDirty, false, 'loading the record is not a change');

    runner.set({ value: { title: 'invoice 42', audience: ['u1'] } });
    runner.out.markInitial(); // audience lands later
    runner.pump();
    assert.equal(runner.out.isDirty, false, 'the audience landing is not a change');

    runner.set({ value: { title: 'invoice 42 (edited)', audience: ['u1'] } });
    runner.pump();
    assert.equal(runner.out.isDirty, true, 'a typed edit is dirty');

    runner.set({ value: { title: 'invoice 42 (edited)', audience: ['u1', 'u2'] } });
    runner.out.markInitial(); // a later response must not swallow the edit
    runner.pump();
    assert.equal(runner.out.isDirty, true, 'and stays dirty after the next load');
  });

  it('consults window.confirm only while the form is dirty', () => {
    runner.set({ open: true, value: { title: '' }, onOpenChange: (next) => closes.push(next) });
    runner.pump();

    runner.out.handleOpenChange(false);
    assert.deepEqual(closes, [false], 'a clean form closes straight away');
    assert.equal(confirmCalls, 0, 'a clean form must not prompt');

    runner.set({ value: { title: 'typed' } });
    runner.pump();
    runner.window.confirm = () => { confirmCalls += 1; return false; };
    runner.out.handleOpenChange(false);
    assert.deepEqual(closes, [false], 'a refused close must not reach the parent');
    assert.equal(confirmCalls, 1);

    runner.window.confirm = () => { confirmCalls += 1; return true; };
    runner.out.handleOpenChange(false);
    assert.deepEqual(closes, [false, false], 'an accepted close forwards to the parent');
    assert.equal(confirmCalls, 2);
  });

  it('re-establishes the baseline when the dialog reopens or the record switches', () => {
    runner.set({ open: true, value: { title: 'record A' }, onOpenChange: (next) => closes.push(next) });
    runner.pump();
    runner.set({ value: { title: 'record A', notes: 'typed' } });
    runner.pump();
    assert.equal(runner.out.isDirty, true);

    runner.set({ open: false });
    runner.pump();
    assert.equal(runner.out.isDirty, false, 'a closed dialog is never dirty');

    runner.set({ open: true, value: { title: 'record B' } });
    runner.pump();
    assert.equal(runner.out.isDirty, false, 'the switched record starts clean');

    runner.set({ value: { title: 'record B', notes: 'typed' } });
    runner.pump();
    assert.equal(runner.out.isDirty, true, 'and edits after the switch are dirty again');
  });

  it('a successful save leaves nothing to prompt about', () => {
    runner.set({ open: true, value: { title: 'new' }, onOpenChange: (next) => closes.push(next) });
    runner.pump();
    runner.set({ value: { title: 'new (edited)' } });
    runner.pump();
    assert.equal(runner.out.isDirty, true);

    // Save succeeded: the consumer closes through its raw setter (never the
    // guard), then the next record is opened.
    runner.set({ open: false });
    runner.pump();
    assert.equal(runner.out.isDirty, false);

    runner.window.confirm = () => { throw new Error('no prompt is expected after a successful save'); };
    runner.set({ open: true, value: { title: 'saved' } });
    runner.pump();
    assert.equal(runner.out.isDirty, false, 'a reopened saved record is clean');
    runner.out.handleOpenChange(false);
    assert.deepEqual(closes, [false], 'closing it must not ask');
  });

  it('a failed save keeps the form dirty, so closing still prompts', () => {
    runner.set({ open: true, value: { title: 'new' }, onOpenChange: (next) => closes.push(next) });
    runner.pump();
    runner.set({ value: { title: 'new (edited)' } });
    runner.pump();
    assert.equal(runner.out.isDirty, true);

    // Save failed: the dialog stays open (saving flips back) and nothing
    // re-baselines.
    runner.set({ value: { title: 'new (edited)', saving: false } });
    runner.pump();
    assert.equal(runner.out.isDirty, true, 'a failed save must not clear dirty state');

    runner.out.handleOpenChange(false);
    assert.equal(confirmCalls, 1, 'closing after a failed save still asks');
    assert.deepEqual(closes, [], 'the refused close must not reach the parent');
  });
});
