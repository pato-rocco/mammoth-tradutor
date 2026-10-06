import { pipeline } from '@huggingface/transformers'
import { progressReporter, useBundledOnnxRuntime } from './ort-env'

export type TtsRequest =
  | { type: 'load' }
  | { type: 'speak'; id: number; text: string; voice: string; speed: number }

export type TtsResponse =
  | { type: 'progress'; percent: number }
  | { type: 'ready'; benchMs: number }
  | { type: 'failed'; error: string }
  | { type: 'audio'; id: number; pcm: Float32Array; sampleRate: number }
  | { type: 'error'; id: number; error: string }

interface Speech {
  audio: Float32Array
  sampling_rate: number
}
type Synthesize = (text: string, options: object) => Promise<Speech>
type LoosePipeline = (task: string, model: string, options: object) => Promise<Synthesize>

// Supertonic 2: voz neural multilíngue (inclui português) leve o bastante para rodar no processador.
const MODEL = 'onnx-community/Supertonic-TTS-2-ONNX'
const INFERENCE_STEPS = 5

useBundledOnnxRuntime()

function post(message: TtsResponse, transfer: Transferable[] = []): void {
  self.postMessage(message, { transfer })
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

let synthesize: Synthesize | null = null
// O timbre de cada voz é um arquivo pequeno; baixado uma vez e reaproveitado em todas as frases.
const voices = new Map<string, Float32Array>()

async function voiceStyle(voice: string): Promise<Float32Array> {
  let style = voices.get(voice)
  if (!style) {
    const cache = await caches.open('mammoth-tradutor-vozes')
    const url = `https://huggingface.co/${MODEL}/resolve/main/voices/${voice}.bin`
    let response = await cache.match(url)
    if (!response) {
      response = await fetch(url)
      if (!response.ok) throw new Error(`voz ${voice} indisponível (HTTP ${response.status})`)
      await cache.put(url, response.clone())
    }
    style = new Float32Array(await response.arrayBuffer())
    voices.set(voice, style)
  }
  return style
}

async function speak(text: string, voice: string, speed: number): Promise<Speech> {
  if (!synthesize) throw new Error('modelo de voz não carregado')
  return synthesize(`<pt>${text}</pt>`, {
    // Cópia: o pipeline pode transferir ou alterar o vetor que recebe.
    speaker_embeddings: (await voiceStyle(voice)).slice(),
    num_inference_steps: INFERENCE_STEPS,
    speed,
  })
}

self.onmessage = async (event: MessageEvent<TtsRequest>) => {
  const request = event.data
  if (request.type === 'load') {
    try {
      synthesize = await (pipeline as unknown as LoosePipeline)('text-to-speech', MODEL, {
        device: 'wasm',
        dtype: 'fp32',
        progress_callback: progressReporter((percent) => post({ type: 'progress', percent })),
      })
      const started = performance.now()
      await speak('Tradução pronta para começar.', 'F1', 1)
      post({ type: 'ready', benchMs: Math.round(performance.now() - started) })
    } catch (err) {
      post({ type: 'failed', error: errorText(err) })
    }
    return
  }
  try {
    const { audio, sampling_rate } = await speak(request.text, request.voice, request.speed)
    post({ type: 'audio', id: request.id, pcm: audio, sampleRate: sampling_rate }, [audio.buffer])
  } catch (err) {
    post({ type: 'error', id: request.id, error: errorText(err) })
  }
}
