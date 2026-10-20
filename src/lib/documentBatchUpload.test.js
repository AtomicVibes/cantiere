// Batch document upload + ZIP support contracts.
//
// Dynamic (mocked) tests exercise the real service module end to end:
//   - ZIP archives are accepted through the upload path, with browser-dependent
//     MIME types and mislabeled archives rejected
//   - multi-file batches give every file a distinct storage path + document row
//   - visibility/audience are persisted, and selected visibility without an
//     audience fails exactly like the database RPC does
//   - partial failures preserve successful uploads, retries never duplicate
//     records, and failed uploads leave no orphaned storage objects
//   - unauthorized uploads stay blocked and single-file uploads still work
//
// Static assertions cover the UI wiring and the four-locale translations.
// Run with: node --test src/lib/documentBatchUpload.test.js
import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { parse as parseAcorn } from 'acorn';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');

// The service imports the Supabase-backed base44 client and the telemetry
// tracker through the Vite "@/" alias. Node cannot resolve that alias and
// must not touch real credentials, so a resolve hook maps "@/" onto src/ and
// a load hook substitutes in-memory fakes for the two infrastructure modules.
// Behavior is driven through globalThis.__base44Mock so each scenario can
// change responses without re-importing anything.
const base44Fake = `
export const base44 = {
  integrations: {
    Core: {
      UploadFile: async (args) => globalThis.__base44Mock.uploadFile(args),
      DeleteFile: async (args) => globalThis.__base44Mock.deleteFile(args),
    },
  },
  entities: {
    Document: {
      create: async (payload) => globalThis.__base44Mock.documentCreate(payload),
    },
  },
};
`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@/')) {
      const srcRoot = new URL('../../src/', context.parentURL);
      return nextResolve(new URL(specifier.slice(2) + '.js', srcRoot).href, context);
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith('/src/api/base44Client.js')) {
      return { format: 'module', source: base44Fake, shortCircuit: true };
    }
    if (url.endsWith('/src/lib/activityTracking.js')) {
      return { format: 'module', source: 'export function logAction() {}', shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

const { uploadDocumentFile, uploadDocumentsBatch, validateDocumentFile, isZipArchive, isArchiveFile, MAX_DOCUMENT_SIZE } =
  await import('@/services/documentUploadService');

const makeFile = (name, type = 'image/png', size = 1024) => ({ name, type, size });

const state = {
  uploads: [],
  deletes: [],
  documents: [],
  createBehavior: null,
};

function resetMock() {
  state.uploads = [];
  state.deletes = [];
  state.documents = [];
  state.createBehavior = null;
  globalThis.__base44Mock = {
    uploadFile: async ({ file }) => {
      const filePath = `user-1/${crypto.randomUUID()}-${file.name}`;
      state.uploads.push({ name: file.name, filePath });
      return { file_url: filePath };
    },
    deleteFile: async ({ filePath }) => {
      state.deletes.push(filePath);
      return { removed: true, skipped: false };
    },
    documentCreate: async (payload) => {
      if (state.createBehavior) state.createBehavior(payload);
      if (payload.visibility === 'selected' && (!payload.audience_user_ids || payload.audience_user_ids.length === 0)) {
        throw new Error('Selected visibility requires at least one audience user');
      }
      const document = { id: `doc-${state.documents.length + 1}`, ...payload };
      state.documents.push(document);
      return document;
    },
  };
}

before(() => {
  resetMock();
});

beforeEach(() => {
  resetMock();
});

after(() => {
  delete globalThis.__base44Mock;
});

describe('ZIP archive validation', () => {
  it('accepts .zip archives regardless of the browser-reported MIME type', () => {
    for (const type of ['application/zip', 'application/x-zip-compressed', 'application/x-zip', '', 'application/octet-stream']) {
      const file = makeFile('plans.zip', type);
      assert.doesNotThrow(() => validateDocumentFile(file), `accepts ${type || '(empty)'} MIME`);
      assert.equal(isZipArchive(file), true, `isZipArchive ${type || '(empty)'}`);
    }
  });

  it('accepts a ZIP declared by MIME type alone, without a .zip extension', () => {
    const file = makeFile('plans', 'application/zip');
    assert.doesNotThrow(() => validateDocumentFile(file));
    assert.equal(isZipArchive(file), true);
  });

  it('rejects an archive filename paired with a known non-archive MIME type', () => {
    for (const file of [makeFile('evil.zip', 'application/x-msdownload'), makeFile('evil.7z', 'application/x-msdownload'), makeFile('evil.rar', 'application/x-msdownload')]) {
      assert.throws(
        () => validateDocumentFile(file),
        (error) => error.code === 'ARCHIVE_UNSUPPORTED',
      );
    }
  });

  it('rejects unsupported file types with a translated-code error', () => {
    for (const file of [makeFile('notes.txt', 'text/plain'), makeFile('run.exe', 'application/x-msdownload')]) {
      assert.throws(
        () => validateDocumentFile(file),
        (error) => error.code === 'UNSUPPORTED_FILE_TYPE',
      );
    }
  });

  it('rejects oversized files and oversized archives with distinct codes', () => {
    const big = MAX_DOCUMENT_SIZE + 1;
    assert.throws(
      () => validateDocumentFile(makeFile('big.png', 'image/png', big)),
      (error) => error.code === 'FILE_TOO_LARGE',
    );
    for (const file of [makeFile('big.zip', 'application/zip', big), makeFile('big.7z', 'application/x-7z-compressed', big), makeFile('big.rar', 'application/x-rar-compressed', big)]) {
      assert.throws(
        () => validateDocumentFile(file),
        (error) => error.code === 'ARCHIVE_TOO_LARGE',
      );
    }
  });
});

describe('7z and RAR archive validation', () => {
  it('accepts .7z archives regardless of the browser-reported MIME type', () => {
    for (const type of ['application/x-7z-compressed', 'application/7z', '', 'application/octet-stream']) {
      const file = makeFile('plans.7z', type);
      assert.doesNotThrow(() => validateDocumentFile(file), `accepts ${type || '(empty)'} MIME`);
      assert.equal(isArchiveFile(file), true, `isArchiveFile ${type || '(empty)'}`);
    }
  });

  it('accepts .7zip archives regardless of the browser-reported MIME type', () => {
    for (const type of ['application/x-7z-compressed', 'application/7z', '', 'application/octet-stream']) {
      const file = makeFile('plans.7zip', type);
      assert.doesNotThrow(() => validateDocumentFile(file), `accepts ${type || '(empty)'} MIME`);
      assert.equal(isArchiveFile(file), true, `isArchiveFile ${type || '(empty)'}`);
    }
  });

  it('accepts .rar archives regardless of the browser-reported MIME type', () => {
    for (const type of ['application/x-rar-compressed', 'application/rar', '', 'application/octet-stream']) {
      const file = makeFile('plans.rar', type);
      assert.doesNotThrow(() => validateDocumentFile(file), `accepts ${type || '(empty)'} MIME`);
      assert.equal(isArchiveFile(file), true, `isArchiveFile ${type || '(empty)'}`);
    }
  });

  it('accepts an archive declared by MIME type alone, without a known extension', () => {
    for (const file of [makeFile('plans', 'application/x-7z-compressed'), makeFile('plans', 'application/x-rar-compressed')]) {
      assert.doesNotThrow(() => validateDocumentFile(file));
      assert.equal(isArchiveFile(file), true);
    }
  });

  it('treats an empty or generic MIME archive as valid when the extension is allowed', () => {
    for (const file of [makeFile('data.7z', ''), makeFile('data.rar', ''), makeFile('data.zip', 'application/octet-stream')]) {
      assert.doesNotThrow(() => validateDocumentFile(file));
    }
  });

  it('rejects a .7z filename paired with a known non-archive MIME type', () => {
    assert.throws(
      () => validateDocumentFile(makeFile('evil.7z', 'application/x-msdownload')),
      (error) => error.code === 'ARCHIVE_UNSUPPORTED',
    );
  });

  it('rejects a .rar filename paired with a known non-archive MIME type', () => {
    assert.throws(
      () => validateDocumentFile(makeFile('evil.rar', 'application/x-msdownload')),
      (error) => error.code === 'ARCHIVE_UNSUPPORTED',
    );
  });
});

describe('batch upload', () => {
  it('uploads multiple files, each with a distinct storage path and document record', async () => {
    const files = [makeFile('a.png'), makeFile('b.pdf', 'application/pdf'), makeFile('c.zip', 'application/zip'), makeFile('d.7z', 'application/x-7z-compressed'), makeFile('e.rar', 'application/x-rar-compressed')];
    const { results, successCount, failedCount } = await uploadDocumentsBatch({
      files,
      name: 'Batch',
      visibility: 'private',
    });

    assert.equal(successCount, 5);
    assert.equal(failedCount, 0);
    assert.deepEqual(results.map((r) => r.status), ['succeeded', 'succeeded', 'succeeded', 'succeeded', 'succeeded']);

    const paths = state.uploads.map((u) => u.filePath);
    assert.equal(new Set(paths).size, 5, 'every file gets a unique storage path');
    assert.equal(state.documents.length, 5, 'one document record per file');
    assert.equal(new Set(state.documents.map((d) => d.id)).size, 5, 'document records are distinct');
    for (const document of state.documents) {
      assert.equal(document.name, 'Batch');
      assert.equal(document.visibility, 'private');
    }
  });

  it('persists visibility and audience on every document', async () => {
    const audience = ['user-2', 'user-3'];
    await uploadDocumentsBatch({
      files: [makeFile('a.png'), makeFile('b.png')],
      name: 'Shared',
      visibility: 'selected',
      audience_user_ids: audience,
    });

    assert.equal(state.documents.length, 2);
    for (const document of state.documents) {
      assert.equal(document.visibility, 'selected');
      assert.deepEqual(document.audience_user_ids, audience);
    }
  });

  it('fails the file when selected visibility has no audience, like the database RPC', async () => {
    const { results, successCount, failedCount } = await uploadDocumentsBatch({
      files: [makeFile('a.png')],
      name: 'Shared',
      visibility: 'selected',
      audience_user_ids: [],
    });

    assert.equal(successCount, 0);
    assert.equal(failedCount, 1);
    assert.equal(results[0].status, 'failed');
    assert.match(results[0].error.message, /audience/);
    assert.equal(state.documents.length, 0, 'no document row is created');
  });

  it('preserves successful uploads when part of the batch fails', async () => {
    state.createBehavior = (payload) => {
      if (payload.name === 'Batch' && payload.file_url.includes('bad')) {
        throw new Error('database exploded');
      }
    };
    const files = [makeFile('good-1.png'), makeFile('bad.png'), makeFile('good-2.png')];
    const { results, successCount, failedCount } = await uploadDocumentsBatch({ files, name: 'Batch' });

    assert.equal(successCount, 2);
    assert.equal(failedCount, 1);
    assert.deepEqual(
      results.map((r) => r.status),
      ['succeeded', 'failed', 'succeeded'],
    );
    assert.equal(state.documents.length, 2, 'successful files keep their records');
    assert.equal(state.deletes.length, 1, 'the failed file cleans up its storage object');
  });

  it('marks invalid files without attempting an upload', async () => {
    const files = [makeFile('ok.png'), makeFile('notes.txt', 'text/plain')];
    const { results, successCount, failedCount } = await uploadDocumentsBatch({ files, name: 'Batch' });

    assert.equal(successCount, 1);
    assert.equal(failedCount, 1);
    assert.equal(results[1].status, 'invalid');
    assert.equal(results[1].error.code, 'UNSUPPORTED_FILE_TYPE');
    assert.equal(state.uploads.length, 1, 'only the valid file reaches storage');
  });

  it('retries a failed file without duplicating successful records', async () => {
    let failFlaky = true;
    state.createBehavior = (payload) => {
      if (failFlaky && payload.file_url.includes('flaky')) {
        throw new Error('database exploded');
      }
    };

    const first = await uploadDocumentsBatch({
      files: [makeFile('good.png'), makeFile('flaky.png')],
      name: 'Batch',
    });
    assert.equal(first.successCount, 1);
    assert.equal(first.failedCount, 1);
    assert.equal(state.documents.length, 1);
    const goodDocument = state.documents[0];

    failFlaky = false;
    const retry = await uploadDocumentsBatch({
      files: [first.results.find((r) => r.status === 'failed').file],
      name: 'Batch',
    });

    assert.equal(retry.successCount, 1);
    assert.equal(retry.results[0].status, 'succeeded');
    assert.equal(state.documents.length, 2, 'retry adds exactly one record');
    assert.equal(state.documents[0].id, goodDocument.id, 'the earlier success is untouched');
    assert.equal(state.uploads.length, 3, 'two attempts for flaky.png + one for good.png');
    const flakyPaths = state.uploads.filter((u) => u.name === 'flaky.png').map((u) => u.filePath);
    assert.equal(new Set(flakyPaths).size, 2, 'each attempt uses a fresh storage path');
  });

  it('cleans up the storage object when the database insert fails', async () => {
    state.createBehavior = () => {
      throw new Error('insert refused');
    };
    const { results } = await uploadDocumentsBatch({ files: [makeFile('a.png')], name: 'Batch' });

    assert.equal(results[0].status, 'failed');
    assert.equal(state.uploads.length, 1, 'the object reached storage');
    assert.equal(state.deletes.length, 1, 'cleanup deletes the orphaned object');
    assert.equal(state.deletes[0], state.uploads[0].filePath, 'cleanup targets the exact path');
    assert.equal(state.documents.length, 0, 'no incomplete document record remains');
  });

  it('does not create cleanup work when the storage upload itself fails', async () => {
    globalThis.__base44Mock.uploadFile = async () => {
      throw Object.assign(new Error('storage unavailable'), { statusCode: 500 });
    };
    const { results, failedCount } = await uploadDocumentsBatch({ files: [makeFile('a.png')], name: 'Batch' });

    assert.equal(failedCount, 1);
    assert.equal(results[0].status, 'failed');
    assert.equal(results[0].error.statusCode, 500);
    assert.equal(state.deletes.length, 0, 'nothing was stored, so nothing needs cleanup');
    assert.equal(state.documents.length, 0);
  });

  it('keeps unauthorized uploads blocked', async () => {
    globalThis.__base44Mock.uploadFile = async () => {
      throw Object.assign(new Error('Not authenticated — cannot upload file'), { statusCode: 403 });
    };
    const { results, successCount } = await uploadDocumentsBatch({ files: [makeFile('a.png')], name: 'Batch' });

    assert.equal(successCount, 0);
    assert.equal(results[0].status, 'failed');
    assert.equal(results[0].error.statusCode, 403);
    assert.equal(state.documents.length, 0);
  });

  it('still supports the single-file upload path', async () => {
    const document = await uploadDocumentFile({
      file: makeFile('single.png'),
      name: 'Single',
      visibility: 'public',
    });

    assert.equal(document.name, 'Single');
    assert.equal(document.visibility, 'public');
    assert.equal(state.uploads.length, 1);
    assert.equal(state.documents.length, 1);
  });

  it('reports per-file status transitions through the progress callback', async () => {
    const seen = [];
    await uploadDocumentsBatch({
      files: [makeFile('a.png'), makeFile('b.png')],
      name: 'Batch',
      onFileStatus: (index, status) => seen.push([index, status]),
    });

    const byIndex = new Map();
    for (const [index, status] of seen) byIndex.set(index, [...(byIndex.get(index) || []), status]);
    for (const index of [0, 1]) {
      assert.deepEqual(byIndex.get(index), ['uploading', 'succeeded'], `file ${index} transitions`);
    }
  });
});

describe('UI wiring (static assertions)', () => {
  it('Documents.jsx routes uploads through the batch service with per-file status', () => {
    const src = read('src/pages/Documents.jsx');
    assert.ok(src.includes('uploadDocumentsBatch'), 'batch service is used');
    assert.ok(src.includes('onFileStatus'), 'per-file status is tracked');
    assert.ok(src.includes('retryFailedFiles'), 'failed files can be retried');
    assert.ok(src.includes("t('retryUpload')"), 'retry action is translated');
    assert.ok(src.includes("t('batchSettingsApplyToAll'"), 'shared-settings note is translated');
    assert.ok(src.includes("t('batchAllSuccess'"), 'batch success message is translated');
    assert.ok(src.includes("t('batchPartialSuccess'"), 'partial success message is translated');
    assert.ok(src.includes("t('batchSomeFailed'"), 'failure summary is translated');
    assert.ok(src.includes("t('uploadInProgress'"), 'progress is translated');
    assert.ok(src.includes('getDocumentFileValidationError'), 'validation errors are translated');
    assert.ok(!src.includes('className=""'), 'no malformed className attributes');
  });

  it('DocumentDropZone supports multiple selection with per-file errors', () => {
    const src = read('src/components/shared/DocumentDropZone.jsx');
    assert.ok(src.includes('onFilesSelect'), 'multi-file selection is wired');
    assert.ok(src.includes('multiple={multiple}'), 'the file input accepts multiple files');
    assert.ok(src.includes('fileErrors.find'), 'per-file validation errors are rendered');
    assert.ok(src.includes('removeFile'), 'files can be removed individually');
    assert.ok(!src.includes('key={${'), 'file list keys are well-formed');
  });

  it('the storage client keeps uploads authenticated and private', () => {
    const src = read('src/api/base44Client.js');
    assert.ok(src.includes('Not authenticated — cannot upload file'), 'uploads require a session');
    assert.ok(src.includes("from('documents')"), 'objects stay in the documents bucket');
    assert.ok(src.includes('upsert: false'), 'storage paths never overwrite existing objects');
  });
});

describe('translations', () => {
  const REQUIRED_KEYS = [
    'batchAllSuccess',
    'batchPartialSuccess',
    'batchSomeFailed',
    'dropFileMultipleSelected',
    'dropFilesHint',
    'filesSelected',
    'noFilesSelected',
    'retryUpload',
    'uploadComplete',
    'uploadFailed',
    'uploadInProgress',
    'zipFileUnsupported',
    'zipFileTooLarge',
    'documentFileTypeUnsupported',
    'documentFileTooLarge',
    'batchSettingsApplyToAll',
  ];

  const LANGS = ['en', 'fr', 'it', 'ar'];

  const flattenLanguages = (source) => {
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
    const ast = parseAcorn(source, { ecmaVersion: 'latest', sourceType: 'module' });
    const resources = findResources(ast);
    assert.ok(resources, 'resources object found in src/i18n.js');
    const out = {};
    for (const langProp of resources.properties) {
      const lang = literalKey(langProp);
      const translation = langProp.value?.properties?.find?.((p) => literalKey(p) === 'translation');
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

  it('every required key exists in en, fr, it and ar', async () => {
    const source = read('src/i18n.js');
    const flatten = flattenLanguages(source);
    for (const key of REQUIRED_KEYS) {
      for (const lng of LANGS) {
        assert.notEqual(flatten[lng]?.get(key), undefined, `${lng}.${key} defined`);
      }
    }
  });

  it('interpolation variables match English in every locale', async () => {
    const source = read('src/i18n.js');
    const flatten = await flattenLanguages(source);
    const vars = (value) => [...String(value).matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)].map((m) => m[1]).sort();
    for (const key of REQUIRED_KEYS) {
      const expected = vars(flatten.en.get(key));
      if (expected.length === 0) continue;
      for (const lng of ['fr', 'it', 'ar']) {
        assert.deepEqual(vars(flatten[lng].get(key)), expected, `${lng}.${key} interpolation`);
      }
    }
  });

  it('zipFileUnsupported is generalized to "archive" in every locale', async () => {
    const source = read('src/i18n.js');
    const flatten = flattenLanguages(source);
    assert.equal(flatten.en.get('zipFileUnsupported'), 'This archive is not supported.');
    assert.equal(flatten.en.get('zipFileTooLarge'), 'This archive is too large. The maximum size is 50 MB.');
    assert.notEqual(flatten.en.get('zipFileUnsupported'), flatten.fr.get('zipFileUnsupported'));
    assert.notEqual(flatten.en.get('zipFileUnsupported'), flatten.it.get('zipFileUnsupported'));
    assert.notEqual(flatten.en.get('zipFileUnsupported'), flatten.ar.get('zipFileUnsupported'));
    assert.match(flatten.fr.get('documentFileTypeUnsupported'), /7Z/);
    assert.match(flatten.it.get('documentFileTypeUnsupported'), /7Z/);
    assert.match(flatten.ar.get('documentFileTypeUnsupported'), /7Z/);
  });
});
