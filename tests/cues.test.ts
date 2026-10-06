import { describe, expect, it } from 'vitest'
import {
  blockAt,
  cueAt,
  DUB_BASE_SPEED,
  groupUtterances,
  insertCue,
  nextToProcess,
  planDub,
  transcriptText,
  type Cue,
  type Utterance,
} from '../src/core/cues'
import { Downsampler, mixToMono } from '../src/core/resample'

function cue(id: number, tStart: number, tEnd: number, text = `legenda ${id}`): Cue {
  return { id, lesson: 1, tStart, tEnd, live: false, sourceText: '', text, translated: true }
}

describe('insertCue', () => {
  it('mantém a ordem por início mesmo chegando fora de ordem', () => {
    const cues: Cue[] = []
    for (const c of [cue(1, 10, 12), cue(2, 2, 4), cue(3, 6, 8)]) insertCue(cues, c)
    expect(cues.map((c) => c.id)).toEqual([2, 3, 1])
  })

  it('substitui a legenda de mesmo id', () => {
    const cues: Cue[] = [cue(1, 2, 4)]
    insertCue(cues, cue(1, 20, 22))
    expect(cues).toHaveLength(1)
    expect(cues[0]!.tStart).toBe(20)
  })
})

describe('cueAt', () => {
  const cues = [cue(1, 2, 4), cue(2, 4.5, 9), cue(3, 20, 20.4)]

  it('mostra a legenda durante a fala e um pouco depois', () => {
    expect(cueAt(cues, 1)).toBeNull()
    expect(cueAt(cues, 3)?.id).toBe(1)
    expect(cueAt(cues, 9.5)?.id).toBe(2)
    expect(cueAt(cues, 11)).toBeNull()
  })

  it('não invade o início da legenda seguinte', () => {
    expect(cueAt(cues, 4.2)?.id).toBe(1)
    expect(cueAt(cues, 4.6)?.id).toBe(2)
  })

  it('dá tempo mínimo de leitura a falas muito curtas', () => {
    expect(cueAt(cues, 21.2)?.id).toBe(3)
    expect(cueAt(cues, 21.6)).toBeNull()
  })
})

describe('blockAt', () => {
  it('distribui os blocos de um texto longo ao longo da fala', () => {
    const text = Array.from({ length: 30 }, (_, i) => `palavra${i}`).join(' ')
    const long = cue(1, 10, 20, text)
    const first = blockAt(long, 10)
    const last = blockAt(long, 19.9)
    expect(first.startsWith('palavra0')).toBe(true)
    expect(last.endsWith('palavra29')).toBe(true)
    expect(first).not.toBe(last)
    expect(blockAt(long, 25)).toBe(last)
  })
})

describe('nextToProcess', () => {
  const pending = [{ tEnd: 5 }, { tEnd: 12 }, { tEnd: 30 }]

  it('prioriza o que ainda vai tocar', () => {
    expect(nextToProcess(pending, 10)).toBe(pending[1])
  })

  it('volta ao mais antigo quando nada à frente está pendente', () => {
    expect(nextToProcess(pending, 100)).toBe(pending[0])
    expect(nextToProcess([], 0)).toBeUndefined()
  })
})

describe('transcriptText', () => {
  it('junta as legendas em parágrafos, separados nas pausas longas', () => {
    const cues = [cue(1, 0, 2, 'Primeira frase.'), cue(2, 2.2, 4, 'Segunda frase.'), cue(3, 8, 10, 'Outro assunto.')]
    expect(transcriptText(cues)).toBe('Primeira frase. Segunda frase.\n\nOutro assunto.')
    expect(transcriptText([])).toBe('')
  })
})

describe('groupUtterances', () => {
  let id = 0
  const group = (cues: Cue[]) => groupUtterances(cues, () => id++)

  it('junta frases seguidas em uma fala só', () => {
    const [first, ...rest] = group([cue(1, 0, 1.5, 'Nesta aula'), cue(2, 1.6, 3, 'vamos ver agentes.')])
    expect(rest).toHaveLength(0)
    expect(first).toMatchObject({ tStart: 0, tEnd: 3, text: 'Nesta aula vamos ver agentes.' })
  })

  it('separa em fim de frase, em pausa longa e ao passar do tamanho máximo', () => {
    expect(group([cue(1, 0, 3, 'Primeira frase.'), cue(2, 3.1, 5, 'Segunda frase.')])).toHaveLength(2)
    expect(group([cue(1, 0, 1, 'antes da pausa'), cue(2, 3, 4, 'depois da pausa')])).toHaveLength(2)
    expect(group([cue(1, 0, 6, 'trecho longo'), cue(2, 6.1, 12, 'outro trecho longo')])).toHaveLength(2)
  })

  it('ignora legendas não traduzidas', () => {
    const untranslated = { ...cue(1, 0, 2, 'still english'), translated: false }
    expect(group([untranslated])).toEqual([])
  })
})

describe('planDub', () => {
  const utterance = (tStart: number, tEnd: number, chars: number): Utterance => ({
    id: 1,
    lesson: 1,
    tStart,
    tEnd,
    text: 'x'.repeat(chars),
    live: false,
  })

  it('começa no instante da fala original quando não há fala anterior', () => {
    expect(planDub(utterance(10, 14, 60), null, 15, 15)?.playAt).toBe(10)
  })

  it('espera a fala anterior terminar, sem cortá-la', () => {
    const plan = planDub(utterance(10, 14, 60), { end: 11, speed: 1.1 }, 15, 15)
    expect(plan?.playAt).toBeCloseTo(11.15)
  })

  it('muda a velocidade só um pouco de uma fala para a outra', () => {
    // Texto longo para pouco tempo: pediria muito mais velocidade, mas sobe um degrau por vez.
    const rushed = planDub(utterance(10, 12, 200), { end: 9, speed: 1.1 }, 12, 15)
    expect(rushed?.speed).toBeCloseTo(1.15)
    // Texto curto com tempo sobrando: desacelera um degrau, nunca abaixo da velocidade normal.
    expect(planDub(utterance(10, 20, 20), { end: 9, speed: 1.1 }, 20, 15)?.speed).toBeCloseTo(1.05)
    expect(planDub(utterance(10, 20, 20), { end: 9, speed: 1 }, 20, 15)?.speed).toBe(1)
    expect(planDub(utterance(10, 20, 20), null, 20, 15)?.speed).toBeCloseTo(DUB_BASE_SPEED - 0.05)
  })

  it('desiste da fala que ficaria atrasada demais', () => {
    expect(planDub(utterance(10, 12, 40), { end: 17, speed: 1.2 }, 13, 15)).toBeNull()
  })
})
describe('Downsampler', () => {
  it('produz a quantidade certa de amostras, mesmo em blocos irregulares', () => {
    const down = new Downsampler(44100, 16000)
    let total = 0
    for (let i = 0; i < 100; i++) total += down.push(new Float32Array(441 + (i % 7))).length
    const inputSamples = 100 * 441 + [...Array(100).keys()].reduce((n, i) => n + (i % 7), 0)
    expect(Math.abs(total - (inputSamples * 16000) / 44100)).toBeLessThan(2)
  })

  it('preserva um sinal constante e reduz 48 kHz em 3:1', () => {
    const out = new Downsampler(48000, 16000).push(new Float32Array(480).fill(0.5))
    expect(out.length).toBe(160)
    for (const sample of out) expect(sample).toBeCloseTo(0.5)
  })
})

describe('mixToMono', () => {
  it('faz a média dos canais', () => {
    const mono = mixToMono([new Float32Array([1, 0]), new Float32Array([0, 1])])
    expect([...mono]).toEqual([0.5, 0.5])
  })
})
