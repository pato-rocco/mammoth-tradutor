import { layoutCaption } from './captionLayout'

export interface Cue {
  id: number
  /** Identifica a aula (muda quando o site troca o vídeo). */
  lesson: number
  /** Segundos no tempo do vídeo. Em trechos ao vivo, preenchidos na chegada. */
  tStart: number
  tEnd: number
  /** Veio da captura em tempo real: não tem posição conhecida no vídeo. */
  live: boolean
  sourceText: string
  text: string
  translated: boolean
}

// Uma legenda curta fica um pouco além do fim da fala, para dar tempo de ler.
const LINGER_SECONDS = 1
const MIN_VISIBLE_SECONDS = 1.5

/** Insere mantendo a ordem por início; substitui a legenda de mesmo id. */
export function insertCue(cues: Cue[], cue: Cue): void {
  const existing = cues.findIndex((c) => c.id === cue.id)
  if (existing >= 0) cues.splice(existing, 1)
  let index = cues.length
  while (index > 0 && cues[index - 1]!.tStart > cue.tStart) index--
  cues.splice(index, 0, cue)
}

function visibleUntil(cues: Cue[], index: number): number {
  const cue = cues[index]!
  const wanted = Math.max(cue.tEnd + LINGER_SECONDS, cue.tStart + MIN_VISIBLE_SECONDS)
  const next = cues[index + 1]
  return next ? Math.min(wanted, Math.max(next.tStart, cue.tEnd)) : wanted
}

/** A legenda que deve estar na tela no instante `time` do vídeo. */
export function cueAt(cues: Cue[], time: number): Cue | null {
  for (let i = cues.length - 1; i >= 0; i--) {
    if (cues[i]!.tStart <= time) return time < visibleUntil(cues, i) ? cues[i]! : null
  }
  return null
}

/** Textos longos viram vários blocos de duas linhas, distribuídos ao longo da fala. */
export function blockAt(cue: Cue, time: number, text = cue.text): string {
  const blocks = layoutCaption(text)
  if (blocks.length <= 1) return blocks[0] ?? ''
  const progress = (time - cue.tStart) / Math.max(0.001, cue.tEnd - cue.tStart)
  return blocks[Math.min(blocks.length - 1, Math.max(0, Math.floor(progress * blocks.length)))]!
}

/** Entre os trechos pendentes, o próximo a processar: o primeiro que ainda vai tocar; senão, o mais antigo. */
export function nextToProcess<T extends { tEnd: number }>(pending: T[], playhead: number): T | undefined {
  return pending.find((item) => item.tEnd > playhead) ?? pending[0]
}

/** Uma fala da dublagem: uma ou mais legendas seguidas, ditas de uma vez só. */
export interface Utterance {
  id: number
  lesson: number
  tStart: number
  tEnd: number
  text: string
  live: boolean
}

const MAX_UTTERANCE_SECONDS = 10
const MAX_UTTERANCE_CHARS = 220
const MIN_SENTENCE_SECONDS = 2
// Pausa na fala original que separa uma fala da seguinte.
const UTTERANCE_GAP_SECONDS = 0.8

/**
 * Junta legendas vizinhas em falas maiores. Sintetizar frase por frase deixa a voz picotada;
 * com o período inteiro a entonação sai natural.
 */
export function groupUtterances(cues: Cue[], nextId: () => number): Utterance[] {
  const out: Utterance[] = []
  let current: Utterance | null = null
  for (const cue of cues) {
    if (!cue.translated) continue
    if (current) {
      const duration = current.tEnd - current.tStart
      const sentenceDone = /[.!?…]["')\]]?$/.test(current.text) && duration >= MIN_SENTENCE_SECONDS
      const fits =
        cue.tEnd - current.tStart <= MAX_UTTERANCE_SECONDS &&
        current.text.length + cue.text.length < MAX_UTTERANCE_CHARS
      if (cue.live || sentenceDone || !fits || cue.tStart - current.tEnd > UTTERANCE_GAP_SECONDS) {
        out.push(current)
        current = null
      }
    }
    if (current) {
      current.tEnd = cue.tEnd
      current.text += ` ${cue.text}`
    } else {
      current = { id: nextId(), lesson: cue.lesson, tStart: cue.tStart, tEnd: cue.tEnd, text: cue.text, live: cue.live }
    }
  }
  if (current) out.push(current)
  return out
}

export interface DubPlan {
  /** Instante do vídeo em que a fala começa. */
  playAt: number
  speed: number
}

export const DUB_BASE_SPEED = 1.1
const DUB_MIN_SPEED = 1
const DUB_MAX_SPEED = 1.35
// Quanto a velocidade pode mudar de uma fala para a seguinte sem o ouvido estranhar.
const DUB_MAX_SPEED_STEP = 0.05
const DUB_PAUSE_SECONDS = 0.15
// Atraso em relação à fala original a partir do qual é melhor pular uma fala e ressincronizar.
const DUB_MAX_LAG_SECONDS = 6

/**
 * Decide quando e em que velocidade uma fala toca. As falas tocam em sequência, nunca cortando a
 * anterior; a velocidade se ajusta aos poucos para a dublagem não se afastar da fala original.
 * Devolve `null` quando a fala ficaria atrasada demais.
 */
export function planDub(
  utterance: Utterance,
  previous: { end: number; speed: number } | null,
  nextStart: number | null,
  charsPerSecond: number,
): DubPlan | null {
  const playAt = previous ? Math.max(utterance.tStart, previous.end + DUB_PAUSE_SECONDS) : utterance.tStart
  if (playAt - utterance.tStart > DUB_MAX_LAG_SECONDS) return null

  const slot = Math.max(1, (nextStart ?? utterance.tEnd + 1) - playAt)
  const wanted = utterance.text.length / charsPerSecond / slot
  const around = previous?.speed ?? DUB_BASE_SPEED
  const stepped = Math.min(around + DUB_MAX_SPEED_STEP, Math.max(around - DUB_MAX_SPEED_STEP, wanted))
  return { playAt, speed: Math.min(DUB_MAX_SPEED, Math.max(DUB_MIN_SPEED, stepped)) }
}