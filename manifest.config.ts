import { defineManifest } from '@crxjs/vite-plugin'
import pkg from './package.json' with { type: 'json' }
import { SITE_HOST } from './src/shared/site.ts'

export default defineManifest({
  manifest_version: 3,
  name: 'Mammoth Tradutor',
  description:
    'Tradução simultânea (inglês → português brasileiro) das videoaulas do Mammoth Club, com legendas e dublagem.',
  version: pkg.version,
  minimum_chrome_version: '138',
  permissions: ['tabCapture', 'offscreen', 'storage', 'activeTab', 'scripting'],
  // supabase.co hospeda os arquivos de vídeo das aulas, lidos direto para traduzir à frente.
  host_permissions: [`https://${SITE_HOST}/*`, `https://*.${SITE_HOST}/*`, 'https://*.supabase.co/*'],
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },
  content_scripts: [
    {
      matches: [`https://${SITE_HOST}/*`, `https://*.${SITE_HOST}/*`],
      js: ['src/content/index.ts'],
      run_at: 'document_idle',
    },
    // O script dos quadros internos (src/content/frame.ts) é acrescentado por scripts/build-frame.mjs.

  ],
  action: {
    default_title: 'Mammoth Tradutor',
    default_popup: 'src/ui/popup/index.html',
  },
  content_security_policy: {
    extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
  },
})
