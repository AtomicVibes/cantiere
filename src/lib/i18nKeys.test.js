// i18n regressions for the application-wide localization audit:
//   1. audited keys (`time`, `selectProject`, `deleting`, `teamAssignment`,
//      `projectManager`, `unknown`, `page`) resolve to real translations in
//      en/fr/it/ar and never render as a raw key
//   2. static t('...') literal resolution across the ten visibility-related
//      files, in en/fr/it (all previously tracked ar gaps are now translated)
//   3. fr/it/ar keep full key parity with en (no missing, no extra keys)
//   4. keys that previously rendered as raw keys resolve in every locale
//   5. every locale keeps the same {{interpolation}} variables as en
//   6. values that were left in English (close, archive, visibility.label)
//      are translated in fr/it/ar
//   7. the resource defines no duplicate keys, and the previously effective
//      `pending` values survived the duplicate cleanup unchanged
//   8. P0 (Register, ResetPassword) and P1 (archived-request / Logs /
//      Finance / Notifications empty states and Logs table headers) keys
//      resolve in every locale and the call sites are wired to translations
//   9. P2 (Documents area: Documents.jsx, DocumentPreview.jsx,
//      document-errors.js) keys resolve in every locale, the call sites are
//      wired to translations, and the stored notification template plus the
//      English defaults of the shared error helper are left unchanged
//  10. F1 (P3): every getDocumentUserFriendlyError call in Documents.jsx
//      (timeline submit, archive/restore denied branch, archive/restore
//      catch) passes t as the translator argument
// Run with: node --test src/lib/i18nKeys.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parse } from 'acorn';
import i18n from '../i18n.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');

const LANGS = ['en', 'fr', 'it', 'ar'];

const AUDITED_KEYS = {
  en: {
    time: 'Time',
    selectProject: 'Select project (optional)',
    deleting: 'Deleting...',
    teamAssignment: 'Team Assignment',
    projectManager: 'Project Manager',
    unknown: 'Unknown',
    page: 'Page',
  },
  fr: {
    time: 'Heure',
    selectProject: 'Sélectionner un projet (facultatif)',
    deleting: 'Suppression...',
    teamAssignment: "Affectation de l'équipe",
    projectManager: 'Chef de projet',
    unknown: 'Inconnu',
    page: 'Page',
  },
  it: {
    time: 'Ora',
    selectProject: 'Seleziona progetto (facoltativo)',
    deleting: 'Eliminazione...',
    teamAssignment: 'Assegnazione del team',
    projectManager: 'Responsabile del progetto',
    unknown: 'Sconosciuto',
    page: 'Pagina',
  },
  ar: {
    time: 'الوقت',
    selectProject: 'اختر مشروعًا (اختياري)',
    deleting: 'جارٍ الحذف...',
    teamAssignment: 'تعيين الفريق',
    projectManager: 'مدير المشروع',
    unknown: 'غير معروف',
    page: 'الصفحة',
  },
};

const VISIBILITY_FILES = [
  'src/pages/Documents.jsx',
  'src/pages/ProjectDetail.jsx',
  'src/pages/Projects.jsx',
  'src/pages/CalendarPage.jsx',
  'src/pages/Finance.jsx',
  'src/components/invoices/InvoiceFormDialog.jsx',
  'src/components/documents/VisibilitySelect.jsx',
  'src/components/documents/AudiencePicker.jsx',
  'src/components/projects/ProjectFormDialog.jsx',
  'src/components/teams/AgentActivityDashboard.jsx',
];

// Previously tracked Arabic-only gaps (selectedUsers, documentAccessUpdated,
// documentAccessLoadError, documentAccessUpdateError,
// documentAccessPermissionError, documentAccessNetworkError, saveAccess) are
// now translated; the locale-parity test below keeps ar at full en parity.

const literalKeys = (source) => {
  const keys = new Set();
  const re = /\bt\(\s*(['"`])([A-Za-z0-9_.-]+)\1/g;
  let match;
  while ((match = re.exec(source))) keys.add(match[2]);
  return keys;
};

const findResources = (node) => {
  if (!node || typeof node !== 'object') return null;
  if (node.type === 'VariableDeclarator' && node.id?.name === 'resources') return node.init;
  for (const prop of Object.keys(node)) {
    if (prop === 'loc') continue;
    const value = node[prop];
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = findResources(item);
        if (found) return found;
      }
    } else if (value && typeof value === 'object') {
      const found = findResources(value);
      if (found) return found;
    }
  }
  return null;
};

const literalKey = (prop) => {
  if (prop.computed) return null;
  if (prop.key.type === 'Identifier') return prop.key.name;
  if (prop.key.type === 'Literal') return String(prop.key.value);
  return null;
};

const duplicateKeys = (source) => {
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
  const resources = findResources(ast);
  assert.ok(resources, 'resources object found in src/i18n.js');
  const dupes = [];
  const walk = (obj, pathParts) => {
    if (obj.type !== 'ObjectExpression') return;
    const seen = new Set();
    for (const prop of obj.properties) {
      if (prop.type !== 'Property') continue;
      const key = literalKey(prop);
      if (key === null) continue;
      const dotted = pathParts.concat(key).join('.');
      if (seen.has(key)) dupes.push(dotted);
      seen.add(key);
      if (prop.value.type === 'ObjectExpression') walk(prop.value, pathParts.concat(key));
    }
  };
  for (const langProp of resources.properties) {
    const translation = langProp.value?.properties?.find?.((p) => literalKey(p) === 'translation');
    assert.ok(translation, `${literalKey(langProp)} has a translation namespace`);
    walk(translation.value, [literalKey(langProp), 'translation']);
  }
  return dupes;
};

describe('audited keys resolve to translations, never raw keys', () => {
  for (const lng of LANGS) {
    it(`returns the intended translation in ${lng}`, async () => {
      await i18n.changeLanguage(lng);
      for (const [key, expected] of Object.entries(AUDITED_KEYS[lng])) {
        assert.equal(i18n.getResource(lng, 'translation', key), expected, `${lng}.${key} defined`);
        const shown = i18n.t(key);
        assert.equal(shown, expected, `${lng}.${key} resolves to the translation`);
        assert.notEqual(shown, key, `${lng}.${key} never renders as a raw key`);
      }
    });
  }

  it("t('page', 'Page') follows the active language instead of the English default", async () => {
    await i18n.changeLanguage('it');
    assert.equal(i18n.t('page', 'Page'), 'Pagina');
    await i18n.changeLanguage('ar');
    assert.equal(i18n.t('page', 'Page'), 'الصفحة');
    await i18n.changeLanguage('fr');
    assert.equal(i18n.t('page', 'Page'), 'Page');
    await i18n.changeLanguage('en');
    assert.equal(i18n.t('page', 'Page'), 'Page');
  });

  it('keeps the event-form sibling labels consistent with the new time key', async () => {
    await i18n.changeLanguage('fr');
    assert.equal(i18n.t('date'), 'Date');
    assert.equal(i18n.t('time'), 'Heure');
    await i18n.changeLanguage('it');
    assert.equal(i18n.t('date'), 'Data');
    assert.equal(i18n.t('time'), 'Ora');
  });
});

describe('static translation-key resolution in visibility files', () => {
  for (const rel of VISIBILITY_FILES) {
    it(`${rel}: every literal key exists in en, fr and it`, () => {
      const keys = literalKeys(read(rel));
      assert.ok(keys.size > 0, 'extracts t(...) keys');
      for (const key of keys) {
        for (const lng of ['en', 'fr', 'it']) {
          assert.notEqual(
            i18n.getResource(lng, 'translation', key),
            undefined,
            `${rel} -> ${lng}.${key}`
          );
        }
      }
    });

    it(`${rel}: every literal key also resolves in ar`, () => {
      for (const key of literalKeys(read(rel))) {
        assert.notEqual(
          i18n.getResource('ar', 'translation', key),
          undefined,
          `${rel} -> ar.${key}`
        );
      }
    });
  }
});

describe('duplicate translation keys', () => {
  it('src/i18n.js defines no duplicate key inside any language', () => {
    assert.deepEqual(duplicateKeys(read('src/i18n.js')), []);
  });

  it('pending keeps its previously effective value in every language', async () => {
    const expected = { en: 'Pending', fr: 'En Attente', it: 'In Attesa', ar: 'معلق' };
    for (const [lng, value] of Object.entries(expected)) {
      await i18n.changeLanguage(lng);
      assert.equal(i18n.t('pending'), value, `${lng}.pending unchanged`);
      assert.equal(i18n.getResource(lng, 'translation', 'pending'), value);
    }
  });
});

// ---- checks introduced by the application-wide i18n audit ----

const flattenLanguages = (source) => {
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
  const resources = findResources(ast);
  assert.ok(resources, 'resources object found in src/i18n.js');
  const out = {};
  for (const langProp of resources.properties) {
    const lang = literalKey(langProp);
    const translation = langProp.value?.properties?.find?.((p) => literalKey(p) === 'translation');
    assert.ok(translation, `${lang} has a translation namespace`);
    const map = new Map();
    const walk = (node, prefix) => {
      for (const prop of node.properties) {
        if (prop.type !== 'Property') continue;
        const key = literalKey(prop);
        if (key === null) continue;
        const dotted = prefix ? `${prefix}.${key}` : key;
        if (prop.value.type === 'ObjectExpression') walk(prop.value, dotted);
        else if (prop.value.type === 'Literal') map.set(dotted, prop.value.value);
      }
    };
    walk(translation.value, '');
    out[lang] = map;
  }
  return out;
};

const flatten = flattenLanguages(read('src/i18n.js'));

const interpolationVars = (value) =>
  [...String(value).matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)].map((m) => m[1]).sort();

describe('locale parity with en', () => {
  it('fr, it and ar define exactly the same key set as en', () => {
    const enKeys = [...flatten.en.keys()].sort();
    for (const lng of ['fr', 'it', 'ar']) {
      assert.deepEqual([...flatten[lng].keys()].sort(), enKeys, `${lng} key set matches en`);
    }
  });
});

const PREVIOUSLY_RAW_KEYS = [
  'archived',
  'chooseFile',
  'selectCategory',
  'selectTeamMember',
  'submitting',
  'requestVerified',
  'requestApproved',
  'requestRejected',
  'checkEmailMessage',
  'resetLinkSendFailed',
  'saveAccess',
  'selectedUsers',
  'documentAccessUpdated',
  'documentAccessLoadError',
  'documentAccessUpdateError',
  'documentAccessPermissionError',
  'documentAccessNetworkError',
];

describe('previously missing keys resolve in every locale', () => {
  for (const lng of LANGS) {
    it(`resolves in ${lng} without falling back to a raw key`, async () => {
      await i18n.changeLanguage(lng);
      for (const key of PREVIOUSLY_RAW_KEYS) {
        assert.notEqual(i18n.getResource(lng, 'translation', key), undefined, `${lng}.${key} defined`);
        assert.notEqual(i18n.t(key), key, `${lng}.${key} never renders as a raw key`);
      }
    });
  }
});

describe('interpolation parity across locales', () => {
  it('every locale keeps the same {{variables}} as en', () => {
    for (const [key, value] of flatten.en) {
      const expected = interpolationVars(value);
      if (expected.length === 0) continue;
      for (const lng of ['fr', 'it', 'ar']) {
        assert.deepEqual(
          interpolationVars(flatten[lng].get(key)),
          expected,
          `${lng}.${key} interpolation variables`
        );
      }
    }
  });

  it('auditLogs.confirmDeleteDesc carries {{count}} in every locale', () => {
    for (const lng of LANGS) {
      assert.ok(
        interpolationVars(flatten[lng].get('auditLogs.confirmDeleteDesc')).includes('count'),
        `${lng}.auditLogs.confirmDeleteDesc has {{count}}`
      );
    }
  });
});

describe('values that were previously left in English', () => {
  for (const key of ['close', 'archive', 'visibility.label']) {
    it(`${key} is translated in fr, it and ar`, () => {
      for (const lng of ['fr', 'it', 'ar']) {
        assert.notEqual(
          flatten[lng].get(key),
          flatten.en.get(key),
          `${lng}.${key} differs from English`
        );
      }
    });
  }
});

describe('call sites reuse existing translations', () => {
  it('raw restore / total references are gone from the audited call sites', () => {
    assert.ok(!/t\('restore'/.test(read('src/components/budget/BudgetManager.jsx')), 'BudgetManager no longer asks for restore');
    assert.ok(/t\('unarchive'\)/.test(read('src/components/budget/BudgetManager.jsx')), 'BudgetManager reuses unarchive');
    assert.ok(!/t\('restore'/.test(read('src/components/budget/CategoryManager.jsx')), 'CategoryManager no longer asks for restore');
    assert.ok(/t\('unarchive'\)/.test(read('src/components/budget/CategoryManager.jsx')), 'CategoryManager reuses unarchive');
    assert.ok(!/t\('total'/.test(read('src/hooks/useFormSchema.js')), 'useFormSchema no longer asks for total');
    assert.ok(/t\('grandTotal'\)/.test(read('src/hooks/useFormSchema.js')), 'useFormSchema reuses grandTotal');
  });
});

// ---- P0 (Register, ResetPassword) and P1 (empty states, Logs headers) ----

const P0P1_KEYS = [
  // P0 - Register
  'createYourAccount',
  'signUpToGetStarted',
  'alreadyHaveAccount',
  'passwordsDoNotMatch',
  'createAccountFailed',
  'showPassword',
  'hidePassword',
  'emailPlaceholder',
  'fullNamePlaceholder',
  // P0 - ResetPassword
  'newPassword',
  'enterNewPassword',
  'resetting',
  'resetPasswordFailed',
  // P1 - archived request empty states
  'noArchivedRequests',
  // P1 - Finance invoice empty states
  'noInvoices',
  'noArchivedInvoices',
  'createFirstInvoice',
  // P1 - Logs empty states and table headers
  'logs.feature',
  'logs.table',
  'logs.record',
  'logs.user',
  'logsEmpty',
  'noArchivedLogs',
  // P1 - Notifications empty states
  'noNotifications',
  'noArchivedNotifications',
  'allCaughtUp',
];

const P0_FILES = ['src/pages/Register.jsx', 'src/pages/ResetPassword.jsx'];

describe('P0/P1 keys resolve in every locale', () => {
  for (const lng of LANGS) {
    it(`resolves in ${lng} without falling back to a raw key`, async () => {
      await i18n.changeLanguage(lng);
      for (const key of P0P1_KEYS) {
        assert.notEqual(i18n.getResource(lng, 'translation', key), undefined, `${lng}.${key} defined`);
        assert.notEqual(i18n.t(key), key, `${lng}.${key} never renders as a raw key`);
      }
    });
  }
});

describe('P0 auth pages wire up translations', () => {
  for (const rel of P0_FILES) {
    it(`${rel}: every literal key exists in every locale`, () => {
      const keys = literalKeys(read(rel));
      assert.ok(keys.size > 0, 'extracts t(...) keys');
      for (const key of keys) {
        for (const lng of LANGS) {
          assert.notEqual(i18n.getResource(lng, 'translation', key), undefined, `${rel} -> ${lng}.${key}`);
        }
      }
    });

    it(`${rel}: uses useTranslation and no literal toast messages`, () => {
      const source = read(rel);
      assert.ok(source.includes('useTranslation'), `${rel} wires up useTranslation`);
      assert.ok(!/toast\.error\(\s*["']/.test(source), `${rel} has no literal toast.error(...) message`);
    });
  }

  it('Register has no leftover hardcoded English strings', () => {
    const source = read('src/pages/Register.jsx');
    for (const literal of [
      'Create your account',
      'Sign up to get started',
      'Already have an account?',
      'Continue with Google',
      'Creating account...',
      'Create account',
      'you@example.com',
      'John Doe',
      'Full Name',
      'Confirm Password',
      'Show password',
      'Hide password',
      'Passwords do not match.',
      'Failed to create account.',
      'Please enter a valid email address.',
      'Password must be at least 8 characters',
    ]) {
      assert.ok(!source.includes(literal), `Register no longer hardcodes "${literal}"`);
    }
  });

  it('ResetPassword has no leftover hardcoded English strings', () => {
    const source = read('src/pages/ResetPassword.jsx');
    for (const literal of [
      'New password',
      'Enter your new password below',
      'New Password',
      'Confirm Password',
      'Resetting...',
      'Reset password',
      'Show password',
      'Hide password',
      'Passwords do not match.',
      'Failed to reset password. Please try again.',
      'Password must be at least 8 characters',
    ]) {
      assert.ok(!source.includes(literal), `ResetPassword no longer hardcodes "${literal}"`);
    }
  });
});

describe('P1 empty states and table headers use translations', () => {
  it('archived request empty states use noArchivedRequests', () => {
    for (const rel of ['src/pages/AdminInbox.jsx', 'src/pages/ProjectRequests.jsx']) {
      const source = read(rel);
      assert.ok(source.includes("t('noArchivedRequests')"), `${rel} uses noArchivedRequests`);
      assert.ok(!source.includes('No archived requests'), `${rel} no longer hardcodes the archived copy`);
    }
  });

  it('Logs uses translated empty states and table headers', () => {
    const source = read('src/pages/Logs.jsx');
    for (const key of [
      'logs.auditLogs',
      'logsEmpty',
      'noArchivedLogs',
      'logs.time',
      'logs.feature',
      'logs.action',
      'logs.table',
      'logs.record',
      'logs.user',
      'logs.message',
    ]) {
      assert.ok(source.includes(`t('${key}')`), `Logs uses ${key}`);
    }
    assert.ok(!source.includes('No archived logs'), 'Logs no longer hardcodes the archived copy');
    assert.ok(!source.includes('No audit logs recorded yet'), 'Logs no longer hardcodes the empty copy');
    assert.ok(!/TableHead>Timestamp</.test(source), 'Logs no longer hardcodes the Timestamp header');
    assert.ok(!/TableHead>Feature</.test(source), 'Logs no longer hardcodes the Feature header');
    assert.ok(!source.includes('title="Audit Logs"'), 'Logs uses logs.auditLogs for the empty-state title');
  });

  it('Finance invoice empty state uses invoice keys instead of noDocuments', () => {
    const source = read('src/pages/Finance.jsx');
    assert.ok(source.includes("t('noInvoices')"), 'Finance uses noInvoices');
    assert.ok(source.includes("t('noArchivedInvoices')"), 'Finance uses noArchivedInvoices');
    assert.ok(source.includes("t('createFirstInvoice')"), 'Finance uses createFirstInvoice');
    assert.ok(!source.includes("t('noDocuments')"), 'Finance no longer reuses noDocuments');
    assert.ok(!source.includes('No archived invoices'), 'Finance no longer hardcodes the archived copy');
    assert.ok(!source.includes('Create your first invoice'), 'Finance no longer hardcodes the empty copy');
  });

  it('Notifications empty state uses notification keys', () => {
    const source = read('src/pages/Notifications.jsx');
    assert.ok(source.includes("t('noNotifications')"), 'Notifications uses noNotifications');
    assert.ok(source.includes("t('noArchivedNotifications')"), 'Notifications uses noArchivedNotifications');
    assert.ok(source.includes("t('allCaughtUp')"), 'Notifications uses allCaughtUp');
    assert.ok(!source.includes('No archived notifications'), 'Notifications no longer hardcodes the archived copy');
    assert.ok(!source.includes('title="No notifications"'), 'Notifications uses noNotifications for the empty-state title');
  });
});

// ---- P2 (Documents area: Documents.jsx, DocumentPreview.jsx, document-errors.js) ----

const P2_KEYS = [
  'document',
  'documentNameRequired',
  'selectFileRequired',
  'googleDocumentLinked',
  'documentUploadError',
  'documentLinkError',
  'documentUploadPermissionError',
  'documentNoFile',
  'documentDownloadError',
  'documentDownloadPermissionError',
  'restored',
  'deleted',
  'selectAll',
  'archiveSelected',
  'archiveAll',
  'restoreSelected',
  'restoreAll',
  'deleteSelected',
  'restore',
  'download',
  'noArchivedDocuments',
  'openDocument',
  'preview',
  'openInNewTab',
  'documentArchivePermissionError',
  'documentRestorePermissionError',
  'documentArchiveError',
  'documentRestoreError',
  'documentNoLongerAvailable',
  'documentDeleteError',
  'documentDeleteNotApplied',
  'documentStorageDeleteBlocked',
  'couldNotBeUpdated',
  'noLongerExists',
  'couldNotBeDeleted',
  'fileCouldNotBeRemoved',
  'filesCouldNotBeRemoved',
  'and',
  'googleLinkInvalid',
  'documentNotFound',
  'documentDeleteConfirmTitle',
  'documentDeleteConfirmDescription',
  'confirmDelete',
  'projectAssigned',
  'removeProject',
]; // previewPdf is reused from the existing shared keys, not redefined

describe('P2 keys resolve in every locale', () => {
  for (const lng of LANGS) {
    it(`resolves in ${lng} without falling back to a raw key`, async () => {
      await i18n.changeLanguage(lng);
      for (const key of P2_KEYS) {
        const defined = i18n.getResource(lng, 'translation', key);
        assert.notEqual(defined, undefined, `${lng}.${key} defined`);
        assert.equal(i18n.t(key), defined, `${lng}.${key} resolves to the translation`);
        if (defined !== key) {
          assert.notEqual(i18n.t(key), key, `${lng}.${key} never renders as a raw key`);
        }
      }
    });
  }

  it('previewPdf stays a single shared key in every locale', async () => {
    for (const lng of LANGS) {
      await i18n.changeLanguage(lng);
      const defined = i18n.getResource(lng, 'translation', 'previewPdf');
      assert.notEqual(defined, undefined, `${lng}.previewPdf defined`);
      assert.notEqual(i18n.t('previewPdf'), 'previewPdf', `${lng}.previewPdf never renders as a raw key`);
    }
  });
});

describe('P2 Documents.jsx wires up translations', () => {
  const rel = 'src/pages/Documents.jsx';

  it('every literal key exists in every locale', () => {
    const keys = literalKeys(read(rel));
    assert.ok(keys.size > 0, 'extracts t(...) keys');
    for (const key of keys) {
      for (const lng of LANGS) {
        assert.notEqual(i18n.getResource(lng, 'translation', key), undefined, `${rel} -> ${lng}.${key}`);
      }
    }
  });

  it('uses the P2 keys at the call sites', () => {
    const source = read(rel);
    for (const key of [
      'documentNoFile',
      'documentDownloadError',
      'documentDownloadPermissionError',
      'documentNameRequired',
      'googleDocumentLinked',
      'selectFileRequired',
      'documentUploadError',
      'documentLinkError',
      'documentUploadPermissionError',
      'archived',
      'restored',
      'documentArchivePermissionError',
      'documentRestorePermissionError',
      'documentArchiveError',
      'documentRestoreError',
      'couldNotBeUpdated',
      'noLongerExists',
      'documentNoLongerAvailable',
      'deleted',
      'couldNotBeDeleted',
      'filesCouldNotBeRemoved',
      'fileCouldNotBeRemoved',
      'and',
      'documentStorageDeleteBlocked',
      'documentDeleteNotApplied',
      'documentDeleteError',
      'active',
      'selectAll',
      'archiveSelected',
      'archiveAll',
      'restoreSelected',
      'restoreAll',
      'deleteSelected',
      'noArchivedDocuments',
      'download',
      'openDocument',
      'archive',
      'restore',
      'delete',
      'projectAssigned',
      'removeProject',
      'documentDeleteConfirmTitle',
      'documentDeleteConfirmDescription',
      'cancel',
      'confirmDelete',
    ]) {
      assert.ok(source.includes(`t('${key}')`), `${rel} uses ${key}`);
    }
  });

  it('has no leftover hardcoded English strings', () => {
    const source = read(rel);
    for (const literal of [
      'This document has no stored file to download.',
      'Unable to download this document. Please try again.',
      "You don't have permission to download this document.",
      'Please provide a document name.',
      'Google document linked.',
      'Please select a file.',
      'Unable to link the document. Please try again.',
      'Unable to upload document. Please try again.',
      "You don't have permission to upload this document.",
      "archived ? 'Archived' : 'Restored'",
      'could not be updated',
      'no longer exists',
      'This document is no longer available. The list has been refreshed.',
      'Unable to ${action} this document. Please try again.',
      'Deleted ${deletedIds.length}',
      'could not be deleted',
      'could not be removed from storage',
      'The stored file could not be removed from storage, so the document was not deleted. Please try again.',
      'The document was not deleted. It may have already been removed, or you may not have permission to delete it.',
      'Failed to delete the document. Please try again.',
      'Select All',
      'Archive Selected',
      'Archive All',
      'Restore Selected',
      'Restore All',
      'Delete Selected',
      'No archived documents',
      'title="Download"',
      'title="Open document"',
      'title="Archive"',
      'title="Restore"',
      'title="Delete"',
      "|| 'Project assigned'",
      'Remove project',
      'Confirm Permanent Deletion',
      'This action is permanent and will delete everything permanently. Do you still wish to proceed?',
      'Confirm Delete',
    ]) {
      assert.ok(!source.includes(literal), `${rel} no longer hardcodes "${literal}"`);
    }
    assert.ok(!/^\s+Active\s*$/m.test(source), `${rel} no longer hardcodes the Active tab`);
    assert.ok(!/^\s+Archived\s*$/m.test(source), `${rel} no longer hardcodes the Archived tab`);
    assert.ok(!/>\s*Cancel\s*</.test(source), `${rel} uses t('cancel') in the delete dialog`);
  });

  it('keeps the stored notification template and timeline fallback untranslated', () => {
    const source = read(rel);
    assert.ok(source.includes('New document submitted to project timeline.'), 'notification insert keeps its stored English template');
    assert.ok(source.includes("'Document'"), 'timeline insert keeps its stored English fallback title');
  });

  it('still passes t into getDocumentUserFriendlyError for localized branches', () => {
    const source = read(rel);
    const downloadStart = source.indexOf('const handleDownload');
    const downloadEnd = source.indexOf('const openUploadDialog');
    const downloadSrc = source.slice(downloadStart, downloadEnd);
    assert.ok(downloadStart > -1 && downloadEnd > downloadStart, 'locates handleDownload');
    assert.ok(downloadSrc.includes("t('documentDownloadError')"), 'download fallback uses t');
    assert.ok(downloadSrc.includes("t('documentDownloadPermissionError')"), 'download permission uses t');
    assert.ok(/,\s*t\s*\)/.test(downloadSrc), 'download errors pass t as the translator');

    const submitStart = source.indexOf('const handleSubmit');
    const submitEnd = source.indexOf('const currentDocs');
    const submitSrc = source.slice(submitStart, submitEnd);
    assert.ok(submitStart > -1 && submitEnd > submitStart, 'locates handleSubmit');
    assert.ok(submitSrc.includes("t('documentUploadError')"), 'upload fallback uses t');
    assert.ok(submitSrc.includes("t('documentLinkError')"), 'link fallback uses t');
    assert.ok(submitSrc.includes("t('documentUploadPermissionError')"), 'upload permission uses t');
    assert.ok(/,\s*t\s*\)/.test(submitSrc), 'upload errors pass t as the translator');
  });

  it('passes t into every getDocumentUserFriendlyError call (timeline + archive/restore)', () => {
    const source = read(rel);

    const timelineStart = source.indexOf('const submitToTimeline');
    const timelineEnd = source.indexOf('const canDelete');
    const timelineSrc = source.slice(timelineStart, timelineEnd);
    assert.ok(timelineStart > -1 && timelineEnd > timelineStart, 'locates submitToTimeline');
    assert.ok(timelineSrc.includes("t('timelineSubmitError')"), 'timeline fallback uses t');
    assert.ok(timelineSrc.includes("t('errors.permissionDenied')"), 'timeline permission uses the shared translated key');
    assert.ok(/,\s*t\s*\)\s*\)\s*;/.test(timelineSrc), 'timeline errors pass t as the translator');

    const archiveStart = source.indexOf('const setDocumentsArchived');
    const archiveEnd = source.indexOf('const executeArchive');
    const archiveSrc = source.slice(archiveStart, archiveEnd);
    assert.ok(archiveStart > -1 && archiveEnd > archiveStart, 'locates setDocumentsArchived');
    const archiveCalls = archiveSrc.match(/getDocumentUserFriendlyError\(/g) || [];
    assert.equal(archiveCalls.length, 2, 'archive/restore keeps two helper calls (denied branch + catch)');
    const archiveTArgs = archiveSrc.match(/,\s*t\s*\)/g) || [];
    assert.equal(archiveTArgs.length, 2, 'both archive/restore helper calls pass t as the translator');
    assert.ok(archiveSrc.includes('permissionMessage, permissionMessage, t)'), 'denied branch keeps its translated permission message and t');

    for (const lng of LANGS) {
      assert.notEqual(i18n.getResource(lng, 'translation', 'errors.permissionDenied'), undefined, `${lng}.errors.permissionDenied defined`);
    }
  });

  it('keeps the documentAccess* regression guards', () => {
    const source = read(rel);
    for (const key of [
      'documentAccessUpdated',
      'documentAccessLoadError',
      'documentAccessUpdateError',
      'documentAccessPermissionError',
      'selectAudienceRequired',
      'invalidGoogleLink',
      'editAccess',
      'saveAccess',
      'noProject',
      'uploadFirstDocument',
    ]) {
      assert.ok(source.includes(`t('${key}'`), `${rel} still uses ${key}`);
    }
  });
});

describe('P2 DocumentPreview.jsx wires up translations', () => {
  const rel = 'src/components/shared/DocumentPreview.jsx';

  it('uses useTranslation and the preview keys', () => {
    const source = read(rel);
    assert.ok(source.includes('useTranslation'), `${rel} wires up useTranslation`);
    for (const key of ['document', 'previewPdf', 'openDocument', 'preview', 'openInNewTab']) {
      assert.ok(source.includes(`t('${key}')`), `${rel} uses ${key}`);
      for (const lng of LANGS) {
        assert.notEqual(i18n.getResource(lng, 'translation', key), undefined, `${lng}.${key} defined`);
      }
    }
    assert.ok(!source.includes("|| 'Document'"), `${rel} no longer hardcodes the Document fallback`);
    assert.ok(!source.includes("'Preview PDF'"), `${rel} no longer hardcodes Preview PDF`);
    assert.ok(!source.includes("'Open document'"), `${rel} no longer hardcodes Open document`);
    assert.ok(!/>\s*Preview\s*</.test(source), `${rel} no longer hardcodes the Preview label`);
    assert.ok(!source.includes('Open in new tab'), `${rel} no longer hardcodes Open in new tab`);
  });

  it('stays safe for non-React callers through the guarded fallback', () => {
    const source = read(rel);
    assert.ok(source.includes("typeof t === 'function' ? t('document') : 'Document'"), 'getFileName keeps a non-translated internal fallback for the pdf-extension check');
  });
});

describe('P2 document-errors.js stays backward compatible', () => {
  const rel = 'src/lib/document-errors.js';

  it('routes googleLinkInvalid and documentNotFound through tr() with English defaults', () => {
    const source = read(rel);
    assert.ok(source.includes("tr('googleLinkInvalid', 'This Google link is not valid."), 'google link branch uses tr with default');
    assert.ok(source.includes("tr('documentNotFound', 'This document could not be found.')"), 'not-found branch uses tr with default');
    assert.ok(source.includes("permissionMessage = \"You don't have permission to change access for this document.\""), 'permission default preserved for callers without t');
    assert.ok(source.includes("fallback = 'Unable to update document access. Please try again.'"), 'fallback default preserved for callers without t');
    assert.ok(source.includes('export function getDocumentUserFriendlyError'), 'helper export intact');
    assert.ok(source.includes('export function logDocumentError'), 'log helper export intact');
  });

  it('ProjectDetail (no-t caller) still receives the English defaults', () => {
    const source = read('src/pages/ProjectDetail.jsx');
    assert.ok(source.includes('getDocumentUserFriendlyError'), 'ProjectDetail still uses the shared helper');
  });
});
