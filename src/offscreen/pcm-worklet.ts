// Roda no AudioWorkletGlobalScope: mistura os canais em mono e envia blocos de ~100 ms.
declare const sampleRate: number
declare function registerProcessor(name: string, ctor: new () => unknown): void
declare class AudioWorkletProcessor {
  readonly port: MessagePort
}

class PcmProcessor extends AudioWorkletProcessor {
  private buffer = new Float32Array(Math.round(sampleRate / 10))
  private filled = 0

  process(inputs: Float32Array[][]): boolean {
    const channels = inputs[0]
    const first = channels?.[0]
    if (!channels || !first) return true

    for (let i = 0; i < first.length; i++) {
      let sum = 0
      for (const channel of channels) sum += channel[i] ?? 0
      this.buffer[this.filled++] = sum / channels.length
      if (this.filled === this.buffer.length) {
        this.port.postMessage(this.buffer.slice())
        this.filled = 0
      }
    }
    return true
  }
}

registerProcessor('pcm', PcmProcessor)
