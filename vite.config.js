import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'

function stripJsonComments(src) {
  let out = ''
  let inString = false
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (inString) {
      out += ch
      if (ch === '\\' && i + 1 < src.length) {
        out += src[i + 1]
        i += 2
        continue
      }
      if (ch === '"') inString = false
      i += 1
      continue
    }
    if (ch === '"') {
      inString = true
      out += ch
      i += 1
      continue
    }
    if (ch === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i += 1
      continue
    }
    if (ch === '/' && src[i + 1] === '*') {
      i += 2
      while (i + 1 < src.length && !(src[i] === '*' && src[i + 1] === '/')) i += 1
      i += 2
      continue
    }
    out += ch
    i += 1
  }
  return out
}

function sha12(value) {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 12)
}

export default defineConfig(({ mode }) => {
  const wranglerPath = path.resolve(__dirname, 'wrangler.jsonc')
  let canonicalVapid
  try {
    const wrangler = JSON.parse(stripJsonComments(fs.readFileSync(wranglerPath, 'utf8')))
    canonicalVapid = wrangler?.vars?.VITE_VAPID_PUBLIC_KEY
  } catch (err) {
    console.error(`\n  Cannot read wrangler.jsonc: ${err.message}\n`)
    process.exit(1)
  }
  if (!canonicalVapid) {
    console.error(
      '\n  wrangler.jsonc is missing vars.VITE_VAPID_PUBLIC_KEY.\n' +
        '  The frontend VAPID public key must come from the server key pair config.\n'
    )
    process.exit(1)
  }
  const injectedVapid = process.env.VITE_VAPID_PUBLIC_KEY
  if (injectedVapid && injectedVapid !== canonicalVapid) {
    console.warn(
      '\n  Overriding stale injected VITE_VAPID_PUBLIC_KEY ' +
        `(sha256 ${sha12(injectedVapid)}) with the wrangler.jsonc value ` +
        `(sha256 ${sha12(canonicalVapid)}).\n` +
        '  The frontend key must always match the server VAPID key pair,\n' +
        '  otherwise push subscriptions are rejected with 403.\n'
    )
  }
  process.env.VITE_VAPID_PUBLIC_KEY = canonicalVapid

  const env = loadEnv(mode, process.cwd(), 'VITE_')

  const required = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY']
  const missing = required.filter((name) => !env[name])

  if (missing.length > 0) {
    console.error(
      `\n  Missing required Vite environment variables:\n` +
      missing.map((name) => `    - ${name}`).join('\n') +
      `\n\n  Make sure they are set before building.\n` +
      `  Local:   Add them to a .env file or pass them inline.\n` +
      `  CI/CD:   Set them as Cloudflare Pages build environment variables.\n`
    )
    process.exit(1)
  }

  return {
    root: './',
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
  }
})
