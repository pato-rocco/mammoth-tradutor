import { pipeline } from '@huggingface/transformers'
import type { Settings } from '../shared/settings'
import { progressReporter, useBundledOnnxRuntime } from './ort-env'

export type Device = 'webgpu' | 'wasm'

/** Uma frase reconhecida, com início e fim em segundos dentro do trecho enviado. */
export interface Phrase {
  start: number
  end: number | null
  text: string
}

export type WorkerRequest =
  | { type: 'load'; quality: Settings['quality']; devices?: Device[] }
  | { type: 'transcribe'; id: number; pcm: Float32Array }

export type WorkerResponse =
  | { type: 'progress'; percent: number }
  | { type: 'ready'; device: Device; benchMs: number }
  | { type: 'failed'; error: string }
  | { type: 'result'; id: number; phrases: Phrase[] }
  | { type: 'error'; id: number; error: string }

interface Recognition {
  text: string
  chunks?: { timestamp: [number, number | null]; text: string }[]
}
type Transcribe = ((audio: Float32Array, options?: object) => Promise<Recognition>) & { dispose?: () => Promise<void> }
type LoosePipeline = (task: string, model: string, options: object) => Promise<Transcribe>

const MODELS: Record<Settings['quality'], string> = {
  fast: 'Xenova/whisper-base.en',
  accurate: 'Xenova/whisper-small.en',
}

// Tempo de um trecho curto abaixo do qual o dispositivo acompanha a aula e não vale testar o próximo.
const FAST_ENOUGH_MS = 2500

useBundledOnnxRuntime()

function post(message: WorkerResponse): void {
  self.postMessage(message)
}

async function build(model: string, device: Device): Promise<Transcribe> {
  const dtype = device === 'webgpu' ? { encoder_model: 'fp32', decoder_model_merged: 'q4' } : 'q8'
  const transcribe = await (pipeline as unknown as LoosePipeline)('automatic-speech-recognition', model, {
    device,
    dtype,
    progress_callback: progressReporter((percent) => post({ type: 'progress', percent })),
  })
  // Aquecimento: compila os shaders e revela cedo uma GPU incompatível.
  await transcribe(new Float32Array(16000))
  return transcribe
}

let transcribe: Transcribe | null = null

/**
 * Carrega o modelo no dispositivo mais rápido. A GPU nem sempre ganha: em placas integradas, e
 * em páginas que não estão visíveis, o WebGPU pode ser muito mais lento que o processador.
 */
async function load(quality: Settings['quality'], devices: Device[]): Promise<void> {
  const model = MODELS[quality]
  let best: { run: Transcribe; device: Device; benchMs: number } | null = null
  let lastError: unknown

  for (const device of devices) {
    try {
      const run = await build(model, device)
      const started = performance.now()
      await run(new Float32Array(16000))
      const benchMs = Math.round(performance.now() - started)
      console.info(`Whisper em ${device}: ${benchMs} ms por trecho curto`)
      if (best && best.benchMs <= benchMs) {
        await run.dispose?.()
      } else {
        await best?.run.dispose?.()
        best = { run, device, benchMs }
      }
      if (benchMs <= FAST_ENOUGH_MS) break
    } catch (err) {
      lastError = err
      console.warn(`Whisper em ${device} falhou`, err)
    }
  }

  if (!best) {
    post({ type: 'failed', error: lastError instanceof Error ? lastError.message : String(lastError) })
    return
  }
  transcribe = best.run
  post({ type: 'ready', device: best.device, benchMs: best.benchMs })
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data
  if (request.type === 'load') {
    await load(request.quality, request.devices ?? ['wasm'])
    return
  }
  try {
    if (!transcribe) throw new Error('modelo não carregado')
    // Com marcações de tempo, um trecho longo volta dividido em frases, cada uma com seu instante.
    const { text, chunks } = await transcribe(request.pcm, { return_timestamps: true })
    const phrases: Phrase[] = chunks?.length
      ? chunks.map((chunk) => ({ start: chunk.timestamp[0], end: chunk.timestamp[1], text: chunk.text }))
      : [{ start: 0, end: null, text }]
    post({ type: 'result', id: request.id, phrases })
  } catch (err) {
    post({ type: 'error', id: request.id, error: err instanceof Error ? err.message : String(err) })
  }
}
