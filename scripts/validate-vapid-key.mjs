/**
 * VAPID P-256 Key Cryptographic Validator
 *
 * Usage:
 *   node scripts/validate-vapid-key.mjs "<base64url-public-key>"
 *
 * If the key is valid, it prints "PASS" and the key details.
 * If the key is invalid, it prints "FAIL" and regenerates a fresh
 * key pair using the web-push library.
 *
 * Examples:
 *   node scripts/validate-vapid-key.mjs "BI2IpPMmOWwihtC8OAeSvXqKuApewLTdDW6HozdYwgG3oHJvNeOWeiF8KRR2mEWPi8OVpjyaagI86gZpURSb_vg"
 */

import { createPublicKey, createECDH, diffieHellman } from 'node:crypto';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function base64urlDecode(str) {
  // Add padding back
  const pad = '='.repeat((4 - (str.length % 4)) % 4);
  const b64 = (str + pad).replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(b64, 'base64');
}

function base64urlEncode(buf) {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/* ------------------------------------------------------------------ */
/*  Validation                                                         */
/* ------------------------------------------------------------------ */

/**
 * Returns true if `rawBytes` (65-byte uncompressed P-256 key) represents
 * a valid point on the secp256r1 (P-256) curve.
 *
 * Node's crypto.createPublicKey will throw during parsing if the point
 * is *obviously* invalid (e.g. wrong length).  To cryptographically
 * *verify* the point is on the curve we do a SPKI round-trip and
 * attempt an ECDH operation, which exercises the underlying OpenSSL
 * curve arithmetic.
 */
function isValidP256Point(rawBytes) {
  if (rawBytes.length !== 65) {
    console.error('  [FAIL] Expected 65 bytes, got ' + rawBytes.length);
    return false;
  }

  if (rawBytes[0] !== 0x04) {
    console.error('  [FAIL] First byte must be 0x04 (uncompressed point indicator), got 0x' + rawBytes[0].toString(16));
    return false;
  }

  // Build a SubjectPublicKeyInfo DER so Node can parse it
  // ── SPKI for EC P-256 uncompressed point ──
  // AlgorithmIdentifier: 1.2.840.10045.2.1 (ecPublicKey) + 1.2.840.10045.3.1.7 (P-256)
  // followed by the raw point as BIT STRING
  const point = Buffer.from(rawBytes);
  const spkiHeader = Buffer.from(
    '3059301306072a8648ce3d020106082a8648ce3d030107034200',
    'hex'
  );
  const spki = Buffer.concat([spkiHeader, point]);

  try {
    const pubKey = createPublicKey({ key: spki, format: 'der', type: 'spki' });

    // Exercise the point on the curve via ECDH
    const ecdh = createECDH('prime256v1');
    ecdh.generateKeys();
    ecdh.computeSecret(pubKey);

    return true;
  } catch (err) {
    console.error('  [FAIL] P-256 validation error:', err.message);
    return false;
  }
}

/* ------------------------------------------------------------------ */
/*  Main                                                               */
/* ------------------------------------------------------------------ */

const keyArg = process.argv[2];

if (!keyArg) {
  console.log('');
  console.log('  VAPID P-256 Key Validator');
  console.log('  ─────────────────────────');
  console.log('');
  console.log('  Usage:');
  console.log('    node scripts/validate-vapid-key.mjs "<public-key>"');
  console.log('');
  console.log('  Example:');
  console.log('    node scripts/validate-vapid-key.mjs "BI2IpPMmOWwihtC8OAeSvXqKuApewLTdDW6HozdYwgG3oHJvNeOWeiF8KRR2mEWPi8OVpjyaagI86gZpURSb_vg"');
  console.log('');
  process.exit(0);
}

console.log('');
console.log('  Validating VAPID public key...');
console.log('  Raw string     :', keyArg);
console.log('  String length  :', keyArg.length);

const rawBytes = base64urlDecode(keyArg);
console.log('  Decoded bytes  :', rawBytes.length);

if (isValidP256Point(rawBytes)) {
  console.log('');
  console.log('  ✓  P A S S  —  Key is a mathematically valid P-256 point.');
  console.log('     The AbortError is NOT caused by the VAPID key itself.');
  console.log('');
  console.log('  Next steps:');
  console.log('    1. Check that the push service endpoint is reachable from');
  console.log('       your network (no firewall/VPN blocking fcm.googleapis.com).');
  console.log('    2. Confirm the service worker file is served with the correct');
  console.log('       MIME type (application/javascript; charset=utf-8).');
  console.log('    3. Verify navigator.serviceWorker.register("/sw.js") resolves');
  console.log('       and the worker enters "activated" state before subscribe().');
  console.log('    4. Test in an incognito/guest window to rule out extension');
  console.log('       interference (ad-blockers often block push endpoints).');
  console.log('');
  process.exit(0);
} else {
  console.log('');
  console.log('  ✗  F A I L  —  Key is NOT a valid P-256 point.');
  console.log('');
  console.log('  Regenerating a fresh VAPID key pair...');
  console.log('');

  // Dynamic import of web-push to avoid requiring it unconditionally
  let webpush;
  try {
    webpush = (await import('web-push')).default;
  } catch {
    // Fallback: generate using Node crypto directly
    const ecdh = createECDH('prime256v1');
    ecdh.generateKeys();
    const pub = ecdh.getPublicKey();
    // web-push format: Base64URL of the raw 65-byte uncompressed point
    const priv = ecdh.getPrivateKey();

    const vapidPublicKey = base64urlEncode(pub);
    const vapidPrivateKey = base64urlEncode(priv);

    console.log('  Generated via Node.js crypto (prime256v1):');
    console.log('');
    console.log('    VAPID_PUBLIC_KEY=' + vapidPublicKey);
    console.log('    VAPID_PRIVATE_KEY=' + vapidPrivateKey);
    console.log('');
    console.log('  Replace these values in:');
    console.log('    - wrangler.jsonc  → vars.VITE_VAPID_PUBLIC_KEY');
    console.log('    - .env            → VITE_VAPID_PUBLIC_KEY');
    console.log('    - Supabase Secrets → VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY');
    console.log('');
    process.exit(1);
  }

  const keys = webpush.generateVAPIDKeys();
  console.log('  Generated via web-push library:');
  console.log('');
  console.log('    VAPID_PUBLIC_KEY=' + keys.publicKey);
  console.log('    VAPID_PRIVATE_KEY=' + keys.privateKey);
  console.log('');
  console.log('  Replace these values in:');
  console.log('    - wrangler.jsonc  → vars.VITE_VAPID_PUBLIC_KEY');
  console.log('    - .env            → VITE_VAPID_PUBLIC_KEY');
  console.log('    - Supabase Secrets → VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY');
  console.log('');
  process.exit(1);
}
