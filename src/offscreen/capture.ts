import { DEFAULT_VAD_OPTIONS, Segmenter, type AudioSegment } from '../core/vad'
import workletUrl from './pcm-worklet.ts?worker&url'

const DUCK_RAMP_SECONDS = 0.15

/**
 * Captura o áudio da aba. Capturar silencia a aba, então o som original é devolvido à saída
 * por um GainNode (que também faz a redução de volume da dublagem). A análise usa um segundo
 * AudioContext a 16 kHz, para o navegador reamostrar sem degradar o que o usuário ouve.
 */
export class TabCapture {
  private stream: MediaStream | null = null
  private playback: AudioContext | null = null
  private analysis: AudioContext | null = null
  private gain: GainNode | null = null
  private segmenter = new Segmenter()
  private paused = false
  /** Blocos de áudio recebidos desde o início; zero indica que a captura não está entregando som. */
  blocks = 0
  private peak = 0

  /** Estado resumido da captura, para o diagnóstico exibido no popup. */
  diagnostics(): string {
    const track = this.stream?.getAudioTracks()[0]
    const peak = this.peak
    this.peak = 0
    return [
      `saída=${this.playback?.state ?? '-'}`,
      `análise=${this.analysis?.state ?? '-'}`,
      `trilha=${track ? `${track.readyState}${track.muted ? ',muda' : ''}` : '-'}`,
      `blocos=${this.blocks}`,
      `nível=${peak.toFixed(3)}`,
      `ganho=${this.gain?.gain.value.toFixed(2) ?? '-'}`,
    ].join(' ')
  }

  constructor(private readonly onSegment: (segment: AudioSegment) => void) {}

  async start(streamId: string): Promise<void> {
    await this.stop()
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } },
      } as MediaStreamConstraints)

      this.playback = new AudioContext()
      this.gain = this.playback.createGain()
      this.playback.createMediaStreamSource(this.stream).connect(this.gain).connect(this.playback.destination)

      this.analysis = new AudioContext({ sampleRate: DEFAULT_VAD_OPTIONS.sampleRate })
      await this.analysis.audioWorklet.addModule(workletUrl)
      const node = new AudioWorkletNode(this.analysis, 'pcm')
      node.port.onmessage = (event: MessageEvent<Float32Array>) => {
        this.blocks++
        for (const sample of event.data) this.peak = Math.max(this.peak, Math.abs(sample))
        if (!this.paused) this.deliver(this.segmenter.push(event.data))
      }
      this.analysis.createMediaStreamSource(this.stream).connect(node)

      // Sem gesto do usuário neste documento, os contextos podem nascer suspensos — e, como a
      // captura silencia a aba, a aula ficaria muda.
      await Promise.all([this.playback.resume(), this.analysis.resume()])
      if (this.playback.state !== 'running' || this.analysis.state !== 'running') {
        throw new Error('O Chrome não liberou a reprodução do áudio capturado.')
      }
    } catch (err) {
      await this.stop()
      throw err
    }
  }

  async stop(): Promise<void> {
    this.stream?.getTracks().forEach((track) => track.stop())
    await this.playback?.close().catch(() => undefined)
    await this.analysis?.close().catch(() => undefined)
    this.stream = this.playback = this.analysis = this.gain = null
    this.segmenter = new Segmenter()
    this.paused = false
    this.blocks = 0
  }

  /** Volume do áudio original (1 = normal), em rampa para não estalar. */
  duck(level: number): void {
    if (!this.gain || !this.playback) return
    const now = this.playback.currentTime
    this.gain.gain.cancelScheduledValues(now)
    this.gain.gain.setValueAtTime(this.gain.gain.value, now)
    this.gain.gain.linearRampToValueAtTime(Math.min(1, Math.max(0, level)), now + DUCK_RAMP_SECONDS)
  }

  /** Vídeo pausado: entrega o que já foi falado e para de segmentar. */
  pause(): void {
    this.paused = true
    this.deliver(this.segmenter.flush())
  }

  resume(): void {
    this.paused = false
  }

  /** Avanço/retrocesso: o trecho em andamento não vale mais. */
  discardPending(): void {
    this.segmenter.reset()
  }

  private deliver(segments: AudioSegment[]): void {
    segments.forEach(this.onSegment)
  }
}
