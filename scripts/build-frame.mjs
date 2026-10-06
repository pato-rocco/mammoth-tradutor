// Compila o script dos quadros internos (src/content/frame.ts) como um arquivo único e o
// registra no manifesto já gerado em dist/.
//
// Ele fica fora do build principal porque o site exibe o material da aula em um iframe isolado
// (sandbox, sem origem própria). Lá o carregador de módulos usado pelos demais scripts não
// consegue importar arquivos da extensão; um arquivo único, sem importações, funciona.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const FILE = 'frame.js'

await build({
  root,
  configFile: false,
  publicDir: false,
  logLevel: 'warn',
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    lib: { entry: 'src/content/frame.ts', formats: ['iife'], name: 'MammothTradutorFrame', fileName: () => FILE },
  },
})

const manifestPath = join(root, 'dist', 'manifest.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
manifest.content_scripts.push({
  matches: manifest.content_scripts[0].matches,
  js: [FILE],
  run_at: 'document_idle',
  all_frames: true,
  // Alcança também quadros sem endereço próprio (srcdoc, about:blank) criados pelo site.
  match_origin_as_fallback: true,
})
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
