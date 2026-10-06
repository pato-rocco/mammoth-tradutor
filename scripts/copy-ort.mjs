// Copia o runtime ONNX (WebAssembly) para public/ort, de onde o Vite o leva para dist/.
// O Manifest V3 proíbe carregar código de CDN, então ele precisa ir dentro da extensão.
import { copyFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
// O Transformers.js traz sua própria versão do onnxruntime-web; é ela que precisa ser copiada.
const requireFromTransformers = createRequire(createRequire(import.meta.url).resolve('@huggingface/transformers'))
const source = dirname(requireFromTransformers.resolve('onnxruntime-web'))
const target = join(root, 'public', 'ort')

mkdirSync(target, { recursive: true })
for (const file of ['ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm']) {
  copyFileSync(join(source, file), join(target, file))
}
