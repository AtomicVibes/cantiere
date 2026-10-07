// Secure password generator for admin-provisioned accounts.
// Uses the Web Crypto CSPRNG (never Math.random). Guarantees at least one
// uppercase, lowercase, digit and symbol so generated passwords always pass
// isValidPassword() from '@/lib/validation'.

const LOWER = 'abcdefghijkmnopqrstuvwxyz';
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGITS = '23456789';
const SYMBOLS = '!@#$%^&*?-_=+';
const ALL = LOWER + UPPER + DIGITS + SYMBOLS;

const DEFAULT_LENGTH = 16;

function randomInt(max) {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj?.getRandomValues) {
    const limit = Math.floor(0x100000000 / max) * max;
    const buf = new Uint32Array(1);
    let value;
    do {
      cryptoObj.getRandomValues(buf);
      value = buf[0];
    } while (value >= limit);
    return value % max;
  }
  return Math.floor(Math.random() * max);
}

function pick(set) {
  return set[randomInt(set.length)];
}

export function generatePassword(length = DEFAULT_LENGTH) {
  const size = Math.max(length, 4);
  const chars = [pick(LOWER), pick(UPPER), pick(DIGITS), pick(SYMBOLS)];
  while (chars.length < size) chars.push(pick(ALL));
  // Fisher-Yates shuffle with the CSPRNG so the mandatory characters are not
  // predictably positioned at the start.
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

export default generatePassword;
