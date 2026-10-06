import type { Settings } from '../shared/settings'
import type { Device, Phrase, WorkerRequest, WorkerResponse } from './whisper-worker'

export interface LoadResult {
  device: Device
  /** Tempo medido para transcrever um trecho curto, em ms. */
  benchMs: number
}

/** Whisper rodando em um Web Worker, para não travar a captura de áudio. */
export class Transcriber {
  private readonly worker = new Worker(new URL('./whisper-worker.ts', import.meta.url), { type: 'module' })
  private readonly pending = new Map<number, { resolve: (phrases: Phrase[]) => void; reject: (err: Error) => void }>()
  private nextId = 0
  private onProgress: (percent: number) => void = () => undefined
  private loaded: { resolve: (result: LoadResult) => void; reject: (err: Error) => void } | null = null

  constructor() {
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data
      switch (message.type) {
        case 'progress':
          this.onProgress(message.percent)
          break
        case 'ready':
          this.loaded?.resolve({ device: message.device, benchMs: message.benchMs })
          break
        case 'failed':
          this.loaded?.reject(new Error(message.error))
          break
        case 'result':
          this.pending.get(message.id)?.resolve(message.phrases)
          this.pending.delete(message.id)
          break
        case 'error':
          this.pending.get(message.id)?.reject(new Error(message.error))
          this.pending.delete(message.id)
          break
      }
    }
  }

  /** Baixa (na primeira vez) e inicializa o modelo no dispositivo mais rápido disponível. */
  load(quality: Settings['quality'], onProgress: (percent: number) => void): Promise<LoadResult> {
    this.onProgress = onProgress
    const devices: Device[] = 'gpu' in navigator ? ['webgpu', 'wasm'] : ['wasm']
    return new Promise((resolve, reject) => {
      this.loaded = { resolve, reject }
      this.post({ type: 'load', quality, devices })
    })
  }

  transcribe(pcm: Float32Array): Promise<Phrase[]> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.post({ type: 'transcribe', id, pcm }, [pcm.buffer])
    })
  }

  dispose(): void {
    this.worker.terminate()
  }

  private post(request: WorkerRequest, transfer: Transferable[] = []): void {
    this.worker.postMessage(request, transfer)
  }
}
