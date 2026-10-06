import { env } from '@huggingface/transformers'

/**
 * Aponta o Transformers.js para o runtime ONNX empacotado na extensão (o MV3 proíbe código
 * remoto); só os pesos dos modelos são baixados. Deve rodar antes de criar qualquer pipeline.
 */
export function useBundledOnnxRuntime(): void {
  env.allowLocalModels = false
  env.useWasmCache = false
  const onnx = env.backends.onnx as { wasm?: { wasmPaths?: unknown } }
  if (onnx.wasm) {
    onnx.wasm.wasmPaths = {
      mjs: new URL('/ort/ort-wasm-simd-threaded.asyncify.mjs', self.location.origin).href,
      wasm: new URL('/ort/ort-wasm-simd-threaded.asyncify.wasm', self.location.origin).href,
    }
  }
}

/** Percentual único de download a partir dos eventos por arquivo do Transformers.js. */
export function progressReporter(
  report: (percent: number) => void,
): (event: { status: string; file?: string; loaded?: number; total?: number }) => void {
  const files = new Map<string, { loaded: number; total: number }>()
  let last = -1
  return (event) => {
    // Só os arquivos de pesos contam; os de configuração são minúsculos e distorceriam o percentual.
    if (event.status !== 'progress' || !event.file || !/\.onnx(_data)?$/.test(event.file) || !event.total) return
    files.set(event.file, { loaded: event.loaded ?? 0, total: event.total })
    let loaded = 0
    let total = 0
    for (const f of files.values()) {
      loaded += f.loaded
      total += f.total
    }
    const percent = Math.floor((loaded / total) * 100)
    if (percent !== last) report((last = percent))
  }
}
