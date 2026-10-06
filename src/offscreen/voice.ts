import type { TtsRequest, TtsResponse } from './tts-worker'

// Quanto de fala sintetizada fica guardado: o que vem logo à frente e o que acabou de tocar.
const KEEP_BEHIND_SECONDS = 20

interface Clip {
  buffer: AudioBuffer
  tStart: number
}

/** Voz neural (em um Web Worker) e reprodução da dublagem. */
export class Voice {
  private readonly worker = new Worker(new URL('./tts-worker.ts', import.meta.url), { type: 'module' })
  private readonly context = new AudioContext()
  private readonly output = this.context.createGain()
  private readonly clips = new Map<number, Clip>()
  private readonly pending = new Map<number, { resolve: (clip: AudioBuffer) => void; reject: (err: Error) => void }>()
  private playing: AudioBufferSourceNode | null = null
  private onProgress: (percent: number) => void = () => undefined
  private loaded: { resolve: (benchMs: number) => void; reject: (err: Error) => void } | null = null

  constructor() {
    this.output.connect(this.context.destination)
    this.worker.onmessage = (event: MessageEvent<TtsResponse>) => {
      const message = event.data
      switch (message.type) {
        case 'progress':
          this.onProgress(message.percent)
          break
        case 'ready':
          this.loaded?.resolve(message.benchMs)
          break
        case 'failed':
          this.loaded?.reject(new Error(message.error))
          break
        case 'audio': {
          const buffer = this.context.createBuffer(1, message.pcm.length, message.sampleRate)
          buffer.copyToChannel(message.pcm as Float32Array<ArrayBuffer>, 0)
          this.pending.get(message.id)?.resolve(buffer)
          this.pending.delete(message.id)
          break
        }
        case 'error':
          this.pending.get(message.id)?.reject(new Error(message.error))
          this.pending.delete(message.id)
          break
      }
    }
  }

  /** Baixa (na primeira vez) e inicializa o modelo. Devolve o tempo de uma frase curta, em ms. */
  load(onProgress: (percent: number) => void): Promise<number> {
    this.onProgress = onProgress
    return new Promise((resolve, reject) => {
      this.loaded = { resolve, reject }
      this.post({ type: 'load' })
    })
  }

  /** Sintetiza a fala de uma legenda e a guarda para tocar depois. Devolve a duração em segundos. */
  async prepare(id: number, tStart: number, text: string, voice: string, speed: number): Promise<number> {
    const buffer = await new Promise<AudioBuffer>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.post({ type: 'speak', id, text, voice, speed })
    })
    this.clips.set(id, { buffer, tStart })
    return buffer.duration
  }

  has(id: number): boolean {
    return this.clips.has(id)
  }

  play(id: number, rate: number, volume: number): void {
    const clip = this.clips.get(id)
    if (!clip) return
    this.stop()
    void this.context.resume()
    this.output.gain.value = volume
    const source = this.context.createBufferSource()
    source.buffer = clip.buffer
    source.playbackRate.value = rate
    source.connect(this.output)
    source.onended = () => {
      if (this.playing === source) this.playing = null
    }
    source.start()
    this.playing = source
  }

  stop(): void {
    this.playing?.stop()
    this.playing = null
  }

  pause(): void {
    void this.context.suspend()
  }

  resume(): void {
    void this.context.resume()
  }

  /** Libera a fala das legendas que já ficaram para trás; devolve os ids liberados. */
  evictBefore(playhead: number): number[] {
    const evicted: number[] = []
    for (const [id, clip] of this.clips) {
      if (clip.tStart < playhead - KEEP_BEHIND_SECONDS) {
        this.clips.delete(id)
        evicted.push(id)
      }
    }
    return evicted
  }

  clear(): void {
    this.stop()
    this.clips.clear()
  }

  dispose(): void {
    this.clear()
    this.worker.terminate()
    void this.context.close()
  }

  private post(request: TtsRequest): void {
    this.worker.postMessage(request)
  }
}
