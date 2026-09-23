import fs from 'node:fs';

function stripComments(src) {
  let out = '';
  let inString = false;
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (inString) {
      out += ch;
      if (ch === '\\' && i + 1 < src.length) {
        out += src[i + 1];
        i += 2;
        continue;
      }
      if (ch === '"') inString = false;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

const raw = fs.readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
const config = JSON.parse(stripComments(raw));
const vars = config.vars || {};

const env = Object.entries(vars)
  .map(([k, v]) => `${k}=${v}`)
  .join('\n');
fs.writeFileSync(new URL('../.env', import.meta.url), env);

console.log('=== Build environment variables detected ===');
for (const [k, v] of Object.entries(vars)) {
  console.log(`  ${k}=${v ? '[SET]' : '[MISSING]'}`);
}
console.log('=== .env generated from wrangler.jsonc ===');