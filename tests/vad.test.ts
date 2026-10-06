import { describe, expect, it } from 'vitest'
import { Segmenter, type AudioSegment } from '../src/core/vad'

const RATE = 16000

function silence(seconds: number): Float32Array {
  return new Float32Array(Math.round(seconds * RATE))
}

function tone(seconds: number, amplitude = 0.3): Float32Array {
  const out = new Float32Array(Math.round(seconds * RATE))
  for (let i = 0; i < out.length; i++) out[i] = amplitude * Math.sin((2 * Math.PI * 220 * i) / RATE)
  return out
}

function concat(...parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.length
  }
  return out
}

/** Alimenta em blocos de tamanho irregular, como chega do AudioWorklet. */
function feed(segmenter: Segmenter, audio: Float32Array, chunk = 1777): AudioSegment[] {
  const out: AudioSegment[] = []
  for (let i = 0; i < audio.length; i += chunk) out.push(...segmenter.push(audio.subarray(i, i + chunk)))
  return out
}

describe('Segmenter', () => {
  it('não emite nada em silêncio', () => {
    expect(feed(new Segmenter(), silence(5))).toEqual([])
  })

  it('emite um trecho para uma fala entre silêncios, com pré-rolagem', () => {
    const segments = feed(new Segmenter(), concat(silence(1), tone(1.5), silence(1)))
    expect(segments).toHaveLength(1)
    const [seg] = segments
    expect(seg!.tStart).toBeCloseTo(0.8, 1)
    expect(seg!.tEnd).toBeCloseTo(3.0, 1)
    expect(seg!.pcm.length).toBe(Math.round((seg!.tEnd - seg!.tStart) * RATE))
  })

  it('descarta estalos mais curtos que a fala mínima', () => {
    expect(feed(new Segmenter(), concat(silence(1), tone(0.2), silence(1)))).toEqual([])
  })

  it('separa duas falas divididas por uma pausa longa', () => {
    const segments = feed(new Segmenter(), concat(silence(0.5), tone(1), silence(1), tone(1), silence(1)))
    expect(segments).toHaveLength(2)
    expect(segments[1]!.tStart).toBeGreaterThan(segments[0]!.tEnd)
  })

  it('mantém junta uma fala com pausa curta', () => {
    const segments = feed(new Segmenter(), concat(silence(0.5), tone(1), silence(0.2), tone(1), silence(1)))
    expect(segments).toHaveLength(1)
  })

  it('força o corte de fala contínua no ponto de menor energia', () => {
    // Queda de volume aos 7 s: é onde o corte forçado (limite de 8 s) deve cair.
    const audio = concat(tone(7), tone(0.1, 0.02), tone(6), silence(1))
    const segments = feed(new Segmenter(), audio)
    expect(segments).toHaveLength(2)
    expect(segments[0]!.tEnd).toBeGreaterThan(6.95)
    expect(segments[0]!.tEnd).toBeLessThan(7.15)
    expect(segments[1]!.tStart).toBe(segments[0]!.tEnd)
    for (const seg of segments) expect(seg.tEnd - seg.tStart).toBeLessThanOrEqual(8)
  })

  it('flush entrega o trecho em andamento e reset o descarta', () => {
    const flushed = new Segmenter()
    expect(feed(flushed, concat(silence(0.5), tone(1)))).toEqual([])
    expect(flushed.flush()).toHaveLength(1)

    const dropped = new Segmenter()
    feed(dropped, concat(silence(0.5), tone(1)))
    dropped.reset()
    expect(dropped.flush()).toEqual([])
  })
})
