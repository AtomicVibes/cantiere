import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig(({ mode }) => {
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
