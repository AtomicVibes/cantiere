// Account uniqueness contracts (duplicate email/username prevention):
//   - shared email/username/password rules behave as specified
//   - generated passwords always satisfy the app password requirements
//   - server-side guarantees stay wired up (migration, edge function, UI)
// Run with: node --test src/lib/accountUniqueness.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  EMAIL_REGEX,
  USERNAME_REGEX,
  normalizeEmail,
  normalizeUsername,
  isValidEmail,
  isValidUsername,
  isValidPassword,
} from './validation.js';
import { generatePassword } from './passwordGenerator.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');

const EMAIL_EXISTS_MESSAGE = 'An account already exists with this email address.';
const USERNAME_TAKEN_MESSAGE = 'This username is already taken. Please choose another username.';

describe('identity rules', () => {
  it('normalizes email case-insensitively', () => {
    assert.equal(normalizeEmail('  John@Example.COM '), 'john@example.com');
    assert.ok(isValidEmail('john@example.com'));
    assert.ok(!isValidEmail('john@example'));
    assert.ok(!isValidEmail('not-an-email'));
    assert.ok(EMAIL_REGEX.test('john+tag@sub.example.com'));
  });

  it('enforces the username pattern ^[a-z0-9_.-]{3,30}$', () => {
    assert.ok(isValidUsername('john.smith_1-2'));
    assert.ok(!isValidUsername('Jo'));
    assert.ok(!isValidUsername('ab c'));
    assert.ok(!isValidUsername('x'.repeat(31)));
    assert.ok(!isValidUsername('john smith'));
    // Uppercase input is normalized before validation (case-insensitive rule).
    assert.equal(normalizeUsername('  JohnSmith '), 'johnsmith');
    assert.ok(isValidUsername(normalizeUsername('JohnSmith')));
    assert.ok(USERNAME_REGEX.test(normalizeUsername('JOHN.SMITH-01')));
  });

  it('requires at least 8 chars with a letter and a digit', () => {
    assert.ok(isValidPassword('Abcdef12'));
    assert.ok(!isValidPassword('abc1'));
    assert.ok(!isValidPassword('abcdefgh'));
    assert.ok(!isValidPassword('12345678'));
  });
});

describe('generated passwords', () => {
  it('satisfy the app password requirements and differ per call', () => {
    const first = generatePassword();
    const second = generatePassword();
    assert.equal(first.length, 16);
    assert.ok(isValidPassword(first), 'generated password must be valid');
    assert.ok(/[a-z]/.test(first) && /[A-Z]/.test(first) && /\d/.test(first) && /[^a-zA-Z0-9]/.test(first));
    assert.notEqual(first, second);
  });
});

describe('server-side guarantees', () => {
  const migration = read('supabase/migrations/20261017120000_account_uniqueness.sql');
  const grants = read('supabase/migrations/20261017130000_account_availability_grants.sql');
  const inviteUser = read('supabase/functions/invite-user/index.ts');
  const createClient = read('supabase/functions/create-client/index.ts');
  const inviteClient = read('supabase/functions/invite-client/index.ts');
  const teams = read('src/pages/Teams.jsx');
  const userErrors = read('src/lib/userErrors.js');
  const handleNewUser = migration;

  it('migration owns case-insensitive uniqueness and the availability RPC', () => {
    assert.ok(migration.includes('profiles_email_lower_uidx'));
    assert.ok(migration.includes('profiles_username_lower_uidx'));
    assert.ok(migration.includes('lower(email)'));
    assert.ok(migration.includes('lower(username)'));
    assert.ok(migration.includes('add column if not exists username text'));
    assert.ok(migration.includes('account_identity_available'));
    assert.ok(migration.includes('security definer'));
    assert.ok(migration.includes('revoke execute on function public.account_identity_available'));
    // EXECUTE defaults to PUBLIC in Postgres — anon must be revoked too,
    // otherwise unauthenticated callers can enumerate identities.
    assert.ok(grants.includes('from public, anon'), 'anon/public execute must be revoked');
    assert.ok(grants.includes('to authenticated') && grants.includes('to service_role'));
    // Actionable pre-flight instead of a raw 23505.
    assert.ok(migration.includes('Cannot enable account uniqueness: duplicate identities exist.'));
    assert.ok(migration.includes('Cleanup query'));
  });

  it('handle_new_user rejects duplicates and persists username', () => {
    assert.ok(handleNewUser.includes(`RAISE EXCEPTION '${EMAIL_EXISTS_MESSAGE}'`));
    assert.ok(handleNewUser.includes(`RAISE EXCEPTION '${USERNAME_TAKEN_MESSAGE}'`));
    assert.ok(handleNewUser.includes("raw_user_meta_data ->> 'username'"));
  });

  it('edge functions reject duplicates with 409 and never adopt a user', () => {
    for (const source of [inviteUser, createClient, inviteClient]) {
      assert.ok(source.includes(EMAIL_EXISTS_MESSAGE), 'exact email message required');
      assert.ok(source.includes('409'), 'duplicates must return HTTP 409');
      assert.ok(source.includes('account_identity_available'), 'must probe availability');
      assert.ok(!source.includes('listUsers'), 'duplicate scan via listUsers was removed');
    }
    assert.ok(inviteUser.includes(USERNAME_TAKEN_MESSAGE));
    assert.ok(inviteUser.includes('user_already_exists'));
    assert.ok(inviteUser.includes('23505'));
    // The service-role key must never reach browser code.
    const clientSources = [
      'src/services/accountService.js',
      'src/services/inviteService.js',
      'src/pages/Teams.jsx',
    ].map(read);
    for (const source of clientSources) {
      assert.ok(!source.includes('SERVICE_ROLE'), 'service-role key must stay server-side');
    }
  });

  it('invite-user resolves the default User role instead of trusting role_id: null', () => {
    assert.ok(inviteUser.includes('resolveDefaultUserRoleId'));
    assert.ok(inviteUser.includes('ELEVATED_ROLES'));
    assert.ok(!/role_id:\s*null/.test(teams), 'Add Member must not send role_id: null');
  });

  it('Add Member collects username + password and shows the credential note', () => {
    assert.ok(teams.includes("t('createAccount')"));
    assert.ok(teams.includes("t('creatingAccount')"));
    assert.ok(teams.includes('generatePassword'));
    assert.ok(teams.includes('checkAccountIdentity'));
    assert.ok(teams.includes('copyAccountInformation'));
    assert.ok(teams.includes('confirmAction'));
    assert.ok(teams.includes('passwordEdited'), 'manual password must never be overwritten');
  });

  it('unique violations map to the exact identity messages', () => {
    assert.ok(userErrors.includes("code === '23505'"));
    assert.ok(userErrors.includes("'errors.emailExists'"));
    assert.ok(userErrors.includes("'errors.usernameTaken'"));
  });
});
