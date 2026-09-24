// Tests for audit-log administration id resolution:
// every delete/archive/restore targets explicit IDs - never WHERE-less.
// Run with: node --test src/lib/auditAdmin.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hasAuditLogTargets, resolveAuditLogIds } from './auditAdmin.js';

describe('resolveAuditLogIds', () => {
  it('single delete targets exactly one id', () => {
    assert.deepEqual(resolveAuditLogIds('single', { id: 'abc' }), ['abc']);
    assert.deepEqual(resolveAuditLogIds('single', {}), []);
  });

  it('bulk delete targets all selected ids', () => {
    assert.deepEqual(
      resolveAuditLogIds('selected', { selectedIds: new Set(['a', 'b', 'c']) }),
      ['a', 'b', 'c']
    );
    assert.deepEqual(resolveAuditLogIds('selected', { selectedIds: new Set() }), []);
  });

  it('delete-all targets the loaded view ids (explicit filter, never unfiltered)', () => {
    const visibleLogs = [{ id: 'a' }, { id: 'b' }];
    assert.deepEqual(resolveAuditLogIds('all', { visibleLogs }), ['a', 'b']);
    assert.deepEqual(resolveAuditLogIds('all', { visibleLogs: [] }), []);
  });

  it('accepts raw id arrays (archive/restore call shapes)', () => {
    assert.deepEqual(resolveAuditLogIds('all', { visibleLogs: ['a', 'b'] }), ['a', 'b']);
  });

  it('unknown modes resolve to nothing (safe abort)', () => {
    assert.deepEqual(resolveAuditLogIds('bogus', { selectedIds: new Set(['a']) }), []);
    assert.deepEqual(resolveAuditLogIds(undefined, {}), []);
  });

  it('hasAuditLogTargets gates every mutation', () => {
    assert.equal(hasAuditLogTargets(['a']), true);
    assert.equal(hasAuditLogTargets([]), false);
    assert.equal(hasAuditLogTargets(null), false);
    assert.equal(hasAuditLogTargets(undefined), false);
  });
});
