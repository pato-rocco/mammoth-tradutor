export interface VadOptions {
  sampleRate: number
  frameMs: number
  /** Piso absoluto de energia (RMS) para considerar fala. */
  minRms: number
  /** Fala = energia acima de `noiseFactor` × ruído de fundo estimado. */
  noiseFactor: number
  /** Silêncio contínuo que encerra o trecho. */
  hangoverMs: number
  /** Áudio anterior ao início da fala incluído no trecho, para não cortar a primeira sílaba. */
  prerollMs: number
  /** Trechos com menos fala que isso são descartados. */
  minSpeechMs: number
  maxSegmentMs: number
  /** Janela final onde se procura o ponto de menor energia para o corte forçado. */
  cutSearchMs: number
}

export const DEFAULT_VAD_OPTIONS: VadOptions = {
  sampleRate: 16000,
  frameMs: 20,
  minRms: 0.008,
  noiseFactor: 3,
  hangoverMs: 500,
  prerollMs: 200,
  minSpeechMs: 400,
  maxSegmentMs: 8000,
  cutSearchMs: 2000,
}

export interface AudioSegment {
  pcm: Float32Array
  /** Segundos desde o início da captura. */
  tStart: number
  tEnd: number
}

interface Frame {
  samples: Float32Array
  rms: number
  voiced: boolean
}

/** Divide um fluxo contínuo de áudio mono em trechos de fala, por energia com histerese. */
export class Segmenter {
  private readonly opts: VadOptions
  private readonly frameSize: number
  private readonly hangoverFrames: number
  private readonly prerollFrames: number
  private readonly maxFrames: number
  private readonly cutSearchFrames: number

  private pending = new Float32Array(0)
  private preroll: Frame[] = []
  private current: Frame[] = []
  private inSpeech = false
  private silenceRun = 0
  private frameCount = 0
  private startFrame = 0
  private noise: number

  constructor(options: Partial<VadOptions> = {}) {
    this.opts = { ...DEFAULT_VAD_OPTIONS, ...options }
    const { sampleRate, frameMs } = this.opts
    this.frameSize = Math.round((sampleRate * frameMs) / 1000)
    this.hangoverFrames = Math.ceil(this.opts.hangoverMs / frameMs)
    this.prerollFrames = Math.ceil(this.opts.prerollMs / frameMs)
    this.maxFrames = Math.floor(this.opts.maxSegmentMs / frameMs)
    this.cutSearchFrames = Math.ceil(this.opts.cutSearchMs / frameMs)
    this.noise = this.opts.minRms / this.opts.noiseFactor
  }

  push(samples: Float32Array): AudioSegment[] {
    const data = new Float32Array(this.pending.length + samples.length)
    data.set(this.pending)
    data.set(samples, this.pending.length)

    const out: AudioSegment[] = []
    let offset = 0
    for (; offset + this.frameSize <= data.length; offset += this.frameSize) {
      this.processFrame(data.slice(offset, offset + this.frameSize), out)
    }
    this.pending = data.slice(offset)
    return out
  }

  /** Encerra o trecho em andamento (ex.: vídeo pausado). */
  flush(): AudioSegment[] {
    const out: AudioSegment[] = []
    if (this.inSpeech) this.emit(this.current, this.startFrame, out)
    this.toSilence()
    return out
  }

  /** Descarta o trecho em andamento (ex.: avanço/retrocesso do vídeo). */
  reset(): void {
    this.pending = new Float32Array(0)
    this.toSilence()
  }

  private processFrame(samples: Float32Array, out: AudioSegment[]): void {
    let sum = 0
    for (const s of samples) sum += s * s
    const rms = Math.sqrt(sum / samples.length)
    const voiced = rms > Math.max(this.opts.minRms, this.noise * this.opts.noiseFactor)
    if (!voiced) this.noise = this.noise * 0.95 + rms * 0.05
    const frame: Frame = { samples, rms, voiced }
    const index = this.frameCount++

    if (!this.inSpeech) {
      if (!voiced) {
        this.preroll.push(frame)
        if (this.preroll.length > this.prerollFrames) this.preroll.shift()
        return
      }
      this.inSpeech = true
      this.startFrame = index - this.preroll.length
      this.current = [...this.preroll, frame]
      this.preroll = []
      this.silenceRun = 0
      return
    }

    this.current.push(frame)
    this.silenceRun = voiced ? 0 : this.silenceRun + 1

    if (this.silenceRun >= this.hangoverFrames) {
      this.emit(this.current, this.startFrame, out)
      this.toSilence()
    } else if (this.current.length >= this.maxFrames) {
      this.forceCut(out)
    }
  }

  private forceCut(out: AudioSegment[]): void {
    const from = this.current.length - this.cutSearchFrames
    let cut = this.current.length - 1
    for (let i = from; i < this.current.length; i++) {
      if (this.current[i]!.rms < this.current[cut]!.rms) cut = i
    }
    this.emit(this.current.slice(0, cut + 1), this.startFrame, out)
    this.startFrame += cut + 1
    this.current = this.current.slice(cut + 1)
    this.silenceRun = 0
    for (let i = this.current.length - 1; i >= 0 && !this.current[i]!.voiced; i--) this.silenceRun++
  }

  private emit(frames: Frame[], startFrame: number, out: AudioSegment[]): void {
    const speechMs = frames.filter((f) => f.voiced).length * this.opts.frameMs
    if (speechMs < this.opts.minSpeechMs) return
    const pcm = new Float32Array(frames.length * this.frameSize)
    frames.forEach((f, i) => pcm.set(f.samples, i * this.frameSize))
    const frameSec = this.opts.frameMs / 1000
    out.push({ pcm, tStart: startFrame * frameSec, tEnd: (startFrame + frames.length) * frameSec })
  }

  private toSilence(): void {
    this.inSpeech = false
    this.current = []
    this.preroll = []
    this.silenceRun = 0
  }
}
