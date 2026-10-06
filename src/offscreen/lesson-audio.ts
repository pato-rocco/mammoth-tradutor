import { createFile, MP4BoxBuffer, type Movie, type Sample } from 'mp4box'
import { Downsampler, mixToMono } from '../core/resample'

const TARGET_RATE = 16000
const SAMPLES_PER_BATCH = 200
const MAX_DECODE_QUEUE = 50

export interface LessonAudioHandlers {
  /** Áudio mono a 16 kHz, em ordem, desde o início da aula. */
  onPcm: (pcm: Float32Array) => void
  onEnd: () => void
  onError: (err: Error) => void
  /** Devolve `true` enquanto a leitura deve esperar (já há áudio suficiente à frente). */
  shouldWait: (decodedSeconds: number) => boolean
}

interface AudioTrackConfig {
  id: number
  codec: string
  sampleRate: number
  channels: number
  description: Uint8Array | undefined
}

// O AudioSpecificConfig do AAC fica no descritor esds; o decodificador precisa dele.
interface EsdsPath {
  mdia?: { minf?: { stbl?: { stsd?: { entries?: { esds?: { esd?: { descs?: { descs?: { data?: Uint8Array }[] }[] } } }[] } } } }
}

/**
 * Lê o arquivo MP4 da aula direto do servidor, mais rápido que a reprodução, e entrega só o
 * áudio decodificado. É o que permite deixar a tradução pronta antes de a fala tocar.
 */
export class LessonAudio {
  // `true`: manter os dados de mídia — o padrão desta versão do mp4box os descarta ao ler.
  private readonly file = createFile(true)
  private readonly abort = new AbortController()
  private decoder: AudioDecoder | null = null
  private downsampler: Downsampler | null = null
  private track: AudioTrackConfig | null = null
  private otherTracks: number[] = []
  private decodedSamples = 0
  private pendingSamples: Sample[] = []
  private settleReady: { resolve: () => void; reject: (err: Error) => void } | null = null
  private finished = false
  /** Duração da aula em segundos; conhecida depois de open(). */
  duration = 0

  constructor(
    private readonly src: string,
    private readonly handlers: LessonAudioHandlers,
  ) {}

  /**
   * Abre o arquivo e resolve quando a faixa de áudio é reconhecida. Rejeita se isso não acontecer
   * dentro de `timeoutMs` (ex.: arquivo com o índice no final, formato não suportado).
   */
  open(timeoutMs: number): Promise<void> {
    const ready = new Promise<void>((resolve, reject) => {
      this.settleReady = { resolve, reject }
      setTimeout(() => reject(new Error('O arquivo da aula não pôde ser lido a tempo.')), timeoutMs)
    })
    this.file.onReady = (info) => void this.onReady(info).catch((err: Error) => this.settleReady?.reject(err))
    this.file.onError = (_module, message) => this.fail(new Error(message))
    this.file.onSamples = (id, _user, samples) => {
      const last = samples[samples.length - 1]
      if (id === this.track?.id) this.pendingSamples.push(...samples)
      // Liberar as amostras (inclusive as de vídeo, que não usamos) evita guardar o arquivo inteiro.
      else if (last) this.file.releaseUsedSamples(id, last.number + 1)
    }
    void this.read().catch((err: unknown) => this.fail(err instanceof Error ? err : new Error(String(err))))
    return ready
  }

  cancel(): void {
    this.finished = true
    this.abort.abort()
    if (this.decoder?.state !== 'closed') this.decoder?.close()
    this.file.stop()
  }

  private fail(err: Error): void {
    if (this.finished) return
    this.settleReady?.reject(err)
    this.handlers.onError(err)
    this.cancel()
  }

  private async onReady(info: Movie): Promise<void> {
    const audio = info.audioTracks[0]
    if (!audio?.audio) throw new Error('A aula não tem faixa de áudio.')
    this.duration = info.duration / info.timescale
    const trak = this.file.getTrackById(audio.id) as unknown as EsdsPath
    const description = trak.mdia?.minf?.stbl?.stsd?.entries?.[0]?.esds?.esd?.descs?.[0]?.descs?.[0]?.data
    this.track = {
      id: audio.id,
      codec: audio.codec,
      sampleRate: audio.audio.sample_rate,
      channels: audio.audio.channel_count,
      description,
    }
    const config: AudioDecoderConfig = {
      codec: this.track.codec,
      sampleRate: this.track.sampleRate,
      numberOfChannels: this.track.channels,
      description,
    }
    if (!(await AudioDecoder.isConfigSupported(config)).supported) {
      throw new Error(`Áudio em formato não suportado (${this.track.codec}).`)
    }

    this.decoder = new AudioDecoder({
      output: (data) => this.onDecoded(data),
      error: (err) => this.fail(err),
    })
    this.decoder.configure(config)

    this.otherTracks = info.tracks.map((t) => t.id).filter((id) => id !== audio.id)
    this.file.setExtractionOptions(audio.id, undefined, { nbSamples: SAMPLES_PER_BATCH })
    for (const id of this.otherTracks) this.file.setExtractionOptions(id, undefined, { nbSamples: SAMPLES_PER_BATCH })
    this.file.start()
    this.settleReady?.resolve()
  }

  private onDecoded(data: AudioData): void {
    const channels: Float32Array[] = []
    for (let i = 0; i < data.numberOfChannels; i++) {
      const channel = new Float32Array(data.numberOfFrames)
      data.copyTo(channel, { planeIndex: i, format: 'f32-planar' })
      channels.push(channel)
    }
    // A taxa real pode diferir da declarada no contêiner (ex.: HE-AAC); vale a do áudio decodificado.
    this.downsampler ??= new Downsampler(data.sampleRate, TARGET_RATE)
    data.close()
    const pcm = this.downsampler.push(mixToMono(channels))
    this.decodedSamples += pcm.length
    if (pcm.length > 0 && !this.finished) this.handlers.onPcm(pcm)
  }

  private async read(): Promise<void> {
    const response = await fetch(this.src, { signal: this.abort.signal })
    if (!response.ok || !response.body) throw new Error(`O servidor recusou o arquivo da aula (HTTP ${response.status}).`)
    const reader = response.body.getReader()
    let offset = 0

    for (;;) {
      const { done, value } = await reader.read()
      if (done || this.finished) break
      const chunk = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)
      this.file.appendBuffer(MP4BoxBuffer.fromArrayBuffer(chunk, offset))
      offset += value.byteLength
      await this.decodePending()
      // Não baixar muito além do que será assistido em breve: poupa banda para o próprio vídeo.
      while (!this.finished && this.handlers.shouldWait(this.decodedSamples / TARGET_RATE)) {
        await new Promise((resolve) => setTimeout(resolve, 500))
      }
    }
    if (this.finished) return
    this.file.flush()
    await this.decodePending()
    await this.decoder?.flush()
    this.finished = true
    this.handlers.onEnd()
  }

  private async decodePending(): Promise<void> {
    const decoder = this.decoder
    const track = this.track
    if (!decoder || !track) return
    const samples = this.pendingSamples
    this.pendingSamples = []
    for (const sample of samples) {
      if (this.finished || !sample.data) return
      decoder.decode(
        new EncodedAudioChunk({
          type: 'key',
          timestamp: (sample.cts * 1_000_000) / sample.timescale,
          duration: (sample.duration * 1_000_000) / sample.timescale,
          data: sample.data,
        }),
      )
      // Espera pelo evento do decodificador, não por um temporizador: páginas não visíveis (como
      // o documento offscreen) têm os temporizadores atrasados pelo Chrome.
      while (decoder.decodeQueueSize > MAX_DECODE_QUEUE && decoder.state === 'configured') {
        await new Promise((resolve) => decoder.addEventListener('dequeue', resolve, { once: true }))
      }
    }
    const last = samples[samples.length - 1]
    if (last) this.file.releaseUsedSamples(track.id, last.number + 1)
  }
}
