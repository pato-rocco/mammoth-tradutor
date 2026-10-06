import { crx } from '@crxjs/vite-plugin'
import { defineConfig } from 'vitest/config'
import manifest from './manifest.config.ts'

export default defineConfig({
  plugins: [crx({ manifest })],
  worker: { format: 'es' },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Páginas que o manifesto não referencia precisam ser declaradas como entrada.
    rollupOptions: { input: { offscreen: 'src/offscreen/index.html' } },
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
})
