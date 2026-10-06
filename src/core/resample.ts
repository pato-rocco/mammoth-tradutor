/**
 * Reamostrador contínuo para uma taxa menor (ex.: 44,1 kHz → 16 kHz). Cada amostra de saída é a
 * média das amostras de entrada que caem na sua janela — um filtro simples, suficiente para fala.
 */
export class Downsampler {
  private readonly ratio: number
  /** Posição (em amostras de entrada, fracionária) onde começa a próxima amostra de saída. */
  private position = 0
  private consumed = 0
  private sum = 0
  private count = 0

  constructor(inputRate: number, outputRate: number) {
    if (inputRate < outputRate) throw new Error('Downsampler só reduz a taxa de amostragem.')
    this.ratio = inputRate / outputRate
  }

  push(input: Float32Array): Float32Array {
    const out = new Float32Array(Math.ceil(input.length / this.ratio) + 1)
    let written = 0
    for (const sample of input) {
      this.sum += sample
      this.count++
      this.consumed++
      if (this.consumed >= this.position + this.ratio) {
        out[written++] = this.sum / this.count
        this.sum = 0
        this.count = 0
        this.position += this.ratio
      }
    }
    return out.subarray(0, written)
  }
}

/** Mistura canais separados em um único canal mono. */
export function mixToMono(channels: Float32Array[]): Float32Array {
  const first = channels[0]
  if (!first) return new Float32Array(0)
  if (channels.length === 1) return first
  const mono = new Float32Array(first.length)
  for (const channel of channels) {
    for (let i = 0; i < mono.length; i++) mono[i]! += channel[i]! / channels.length
  }
  return mono
}
