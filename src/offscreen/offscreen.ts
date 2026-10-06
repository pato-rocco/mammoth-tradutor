import {
  groupUtterances,
  insertCue,
  nextToProcess,
  DUB_BASE_SPEED,
  planDub,
  type Cue,
  type DubPlan,
  type Utterance,
} from '../core/cues'
import { protect } from '../core/glossary'
import { cleanTranscript } from '../core/transcript'
import { Segmenter, type AudioSegment } from '../core/vad'
import { send, type Message, type PipelineReply, type VideoState } from '../shared/messages'
import type { Settings } from '../shared/settings'
import { createTranslator, translatorStatus } from '../shared/translator-api'
import { TabCapture } from './capture'
import { LessonAudio } from './lesson-audio'
import { Transcriber } from './transcriber'
import { Voice } from './voice'

// Tempo para reconhecer o arquivo da aula antes de desistir e capturar o som da aba em tempo real.
// Curto porque a autorização de captura obtida no clique expira em poucos segundos.
const OPEN_TIMEOUT_MS = 3000
// Ao trocar de aula não há essa pressa: o servidor pode demorar a responder.
const NEXT_LESSON_TIMEOUT_MS = 20000
const NEXT_LESSON_ATTEMPTS = 3
// Quanto áudio já lido pode ficar esperando a transcrição (limita memória e uso de banda).
const READ_AHEAD_SECONDS = 600
// Até que distância à frente a fala em português é sintetizada.
const DUB_AHEAD_SECONDS = 60
// Na captura em tempo real, acima disso a máquina não está acompanhando: os mais antigos são descartados.
const MAX_LIVE_BACKLOG = 4
// Transcrição de um trecho curto acima disso não acompanha a fala em tempo real.
const SLOW_BENCH_MS = 4000
// Um salto maior que isso entre dois avisos da página é um avanço/retrocesso, não reprodução normal.
const SEEK_JUMP_SECONDS = 2

/**
 * O Whisper custa quase o mesmo para 2 s ou 25 s de áudio (sempre processa uma janela de 30 s).
 * Lendo à frente não há pressa, então a fala é agrupada em trechos longos, só cortados em pausas
 * maiores — muito menos chamadas, e o modelo ainda enxerga a frase inteira. Em tempo real os
 * trechos seguem curtos, para a legenda não demorar.
 */
function newSegmenter(): Segmenter {
  return mode === 'ahead'
    ? new Segmenter({ hangoverMs: 900, maxSegmentMs: 24000, cutSearchMs: 6000 })
    : new Segmenter()
}

interface Pending extends AudioSegment {
  lesson: number
}

type DubState = 'none' | 'working' | 'ready' | 'skipped'

let settings: Settings | null = null
let mode: 'ahead' | 'live' = 'live'
let video: VideoState = { lesson: 0, src: null, time: 0, rate: 1, paused: true }
let lessonAudio: LessonAudio | null = null
let segmenter = newSegmenter()
let pending: Pending[] = []
let cues: Cue[] = []
let utterances: Utterance[] = []
const dubs = new Map<number, DubState>()
const plans = new Map<number, DubPlan & { end: number }>()
// Ritmo da voz sintetizada (caracteres por segundo na velocidade 1), calibrado a cada fala.
let charsPerSecond = 15
let nextUtteranceId = 0

// Até onde a aula já foi transcrita e traduzida, e se o arquivo já foi lido até o fim.
let processedUntil = 0
let readEnded = false

let transcriber: Transcriber | null = null
let translator: Awaited<ReturnType<typeof createTranslator>> | null = null
let voice: Voice | null = null
let voiceReady = false
let transcribing = false
let synthesizing = false
let nextCueId = 0

const capture = new TabCapture((segment) => {
  pending.push({ ...segment, lesson: video.lesson })
  void pump()
})

// Diagnóstico periódico, mostrado no rodapé do popup.
let stage = 'iniciando'
const counts = { heard: 0, transcribed: 0, sent: 0, dubbed: 0 }
let lastProblem = ''
setInterval(() => {
  const text = [
    mode === 'ahead'
      ? `modo=à frente posição=${video.time.toFixed(0)}s traduzido até=${(cues[cues.length - 1]?.tEnd ?? 0).toFixed(0)}s`
      : `modo=tempo real ${capture.diagnostics()}`,
    `ouvidos=${counts.heard} transcritos=${counts.transcribed} enviados=${counts.sent} dublados=${counts.dubbed} fila=${pending.length}`,
    `etapa: ${stage}`,
    lastProblem && `problema: ${lastProblem}`,
  ]
    .filter(Boolean)
    .join('\n')
  void send({ type: 'DIAG', text })
}, 2000)

function notice(text: string): void {
  stage = text
  void send({ type: 'NOTICE', text })
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Encerra a sessão com uma mensagem visível; o service worker devolve o áudio à aba. */
function fail(err: unknown): void {
  lastProblem = errorText(err)
  void send({ type: 'PIPELINE_ERROR', error: errorText(err) })
}

// Nenhuma falha aqui pode passar em silêncio: com a aba capturada, o usuário ficaria sem som.
self.addEventListener('error', (event) => fail(event.error ?? event.message))
self.addEventListener('unhandledrejection', (event) => fail(event.reason))

/** Começa a ler o arquivo da aula à frente da reprodução. Rejeita se o arquivo não puder ser lido. */
async function openLesson(src: string, timeoutMs = OPEN_TIMEOUT_MS): Promise<void> {
  const lesson = video.lesson
  const reader = new LessonAudio(src, {
    onPcm: (pcm) => {
      if (lesson !== video.lesson) return
      for (const segment of segmenter.push(pcm)) pending.push({ ...segment, lesson })
      void pump()
    },
    onEnd: () => {
      if (lesson !== video.lesson) return
      for (const segment of segmenter.flush()) pending.push({ ...segment, lesson })
      readEnded = true
      reportProgress()
      void pump()
    },
    onError: (err) => {
      if (lesson === video.lesson) lastProblem = `leitura da aula: ${err.message}`
    },
    shouldWait: (decodedSeconds) => decodedSeconds > Math.max(video.time, processedUntil) + READ_AHEAD_SECONDS,
  })
  lessonAudio = reader
  try {
    await reader.open(timeoutMs)
    reportProgress()
  } catch (err) {
    reader.cancel()
    if (lessonAudio === reader) lessonAudio = null
    throw err
  }
}

/** Informa à página quanto da aula já está traduzido (para o pré-carregamento antes de tocar). */
function reportProgress(): void {
  if (mode !== 'ahead' || !lessonAudio) return
  void send({
    type: 'PROGRESS',
    lesson: video.lesson,
    until: processedUntil,
    duration: lessonAudio.duration,
    done: readEnded && pending.length === 0,
  })
}

function resetLesson(): void {
  lessonAudio?.cancel()
  lessonAudio = null
  processedUntil = 0
  readEnded = false
  segmenter = newSegmenter()
  pending = []
  cues = []
  utterances = []
  dubs.clear()
  plans.clear()
  voice?.clear()
}

async function loadModels(current: Settings): Promise<void> {
  const status = await translatorStatus()
  if (status === 'unsupported' || status === 'unavailable') {
    throw new Error('O tradutor embutido do Chrome não está disponível para inglês → português.')
  }
  if (status !== 'available') {
    throw new Error('O pacote de tradução ainda não foi baixado. Desligue e ligue a tradução pelo popup.')
  }
  translator = await createTranslator()

  notice('Carregando o modelo de transcrição…')
  const whisper = new Transcriber()
  const { device, benchMs } = await whisper.load(current.quality, (percent) => {
    notice(`Baixando o modelo de transcrição… ${percent}%`)
  })
  transcriber = whisper
  const speed = `${device === 'webgpu' ? 'placa de vídeo' : 'processador'}, ${(benchMs / 1000).toFixed(1)} s por trecho`
  notice(
    benchMs <= SLOW_BENCH_MS
      ? `Legendas prontas (${speed}).`
      : `Legendas prontas, mas lentas neste computador (${speed}).`,
  )
  void pump()

  // A voz carrega por último e sem bloquear as legendas: é o maior download (cerca de 260 MB).
  if (current.dubbing.enabled) await loadVoice()
}

// Carregamento em andamento: quem pedir a voz nesse meio-tempo espera o mesmo carregamento.
let voiceLoading: Promise<void> | null = null

function loadVoice(): Promise<void> {
  voiceLoading ??= startVoice()
  return voiceLoading
}

async function startVoice(): Promise<void> {
  if (voice) return
  const engine = new Voice()
  voice = engine
  try {
    const benchMs = await engine.load((percent) => notice(`Baixando a voz em português… ${percent}%`))
    voiceReady = true
    notice(`Dublagem pronta (${(benchMs / 1000).toFixed(1)} s por frase).`)
    void pumpVoice()
  } catch (err) {
    voice = null
    voiceLoading = null
    engine.dispose()
    lastProblem = `voz: ${errorText(err)}`
    notice('Não foi possível carregar a voz em português; seguindo só com legendas.')
  }
}

function takeNext(): Pending | undefined {
  if (mode === 'live' && pending.length > MAX_LIVE_BACKLOG) {
    pending = pending.slice(-MAX_LIVE_BACKLOG)
    notice('O computador não está acompanhando a aula; parte da fala foi pulada.')
  }
  const next = mode === 'ahead' ? nextToProcess(pending, video.time) : pending[0]
  if (next) pending.splice(pending.indexOf(next), 1)
  return next
}

async function pump(): Promise<void> {
  if (transcribing || !transcriber || !translator || !settings) return
  transcribing = true
  try {
    for (let segment = takeNext(); segment; segment = takeNext()) {
      counts.heard++
      try {
        const { tStart, tEnd, lesson } = segment
        const phrases = await transcriber.transcribe(segment.pcm)
        counts.transcribed++
        const segmentCues: Cue[] = []
        // Um trecho longo volta dividido em frases; cada uma vira uma legenda no seu instante.
        for (const [index, phrase] of phrases.entries()) {
          const sourceText = cleanTranscript(phrase.text)
          if (!sourceText) continue
          const glossary = protect(sourceText, settings.glossary)
          let text = sourceText
          let translated = true
          try {
            text = glossary.restore(await translator.translate(glossary.text))
          } catch (err) {
            translated = false
            lastProblem = `tradução: ${errorText(err)}`
          }
          if (lesson !== video.lesson) break
          const start = Math.min(tEnd, tStart + Math.max(0, phrase.start))
          const nextStart = phrases[index + 1]?.start
          const end = Math.min(tEnd, tStart + (phrase.end ?? nextStart ?? Infinity))
          const cue: Cue = {
            id: nextCueId++,
            lesson,
            tStart: start,
            tEnd: Math.max(end, start + 0.2),
            live: mode === 'live',
            sourceText,
            text,
            translated,
          }
          insertCue(cues, cue)
          segmentCues.push(cue)
          counts.sent++
          void send({ type: 'CUE', cue })
        }
        // A dublagem trabalha com falas inteiras, não com cada legenda isolada.
        for (const utterance of groupUtterances(segmentCues, () => nextUtteranceId++)) {
          let index = utterances.length
          while (index > 0 && utterances[index - 1]!.tStart > utterance.tStart) index--
          utterances.splice(index, 0, utterance)
          dubs.set(utterance.id, 'none')
        }
        void pumpVoice()
      } catch (err) {
        lastProblem = `transcrição: ${errorText(err)}`
      }
      if (segment.lesson === video.lesson) {
        processedUntil = Math.max(processedUntil, segment.tEnd)
        reportProgress()
      }
    }
  } finally {
    transcribing = false
  }
}

/** A próxima fala que precisa de voz: ainda não sintetizada e prestes a tocar. */
function nextToDub(): Utterance | undefined {
  return utterances.find((utterance) => {
    if (dubs.get(utterance.id) !== 'none') return false
    return utterance.live || (utterance.tEnd > video.time && utterance.tStart < video.time + DUB_AHEAD_SECONDS)
  })
}

async function pumpVoice(): Promise<void> {
  if (synthesizing || !voice || !voiceReady || !settings?.dubbing.enabled) return
  synthesizing = true
  try {
    for (let utterance = nextToDub(); utterance; utterance = nextToDub()) {
      dubs.set(utterance.id, 'working')
      try {
        // O plano encadeia as falas: cada uma começa depois da anterior e ajusta a velocidade aos
        // poucos. Uma fala já planejada (ex.: o usuário voltou o vídeo) mantém o mesmo plano.
        const index = utterances.indexOf(utterance)
        const before = utterances[index - 1]
        const previous = (before && !utterance.live && plans.get(before.id)) || null
        const nextStart = utterance.live ? null : (utterances[index + 1]?.tStart ?? null)
        const plan = plans.get(utterance.id) ?? planDub(utterance, previous, nextStart, charsPerSecond)
        if (!plan) {
          // Atrasada demais: pular esta fala devolve a dublagem ao ritmo da aula.
          dubs.set(utterance.id, 'skipped')
          continue
        }
        const { id, lesson, tStart, text, live } = utterance
        const speed = plan.speed * settings.dubbing.rate
        const duration = await voice.prepare(id, tStart, text, settings.dubbing.voiceName ?? 'F1', speed)
        if (lesson !== video.lesson) continue

        // A duração real calibra a estimativa usada no planejamento das próximas falas.
        const measured = text.length / (duration * speed)
        charsPerSecond = charsPerSecond * 0.8 + measured * 0.2
        plans.set(id, { ...plan, end: plan.playAt + duration })
        dubs.set(id, 'ready')
        counts.dubbed++
        void send({ type: 'DUB_READY', id, lesson, duration, playAt: plan.playAt, live })
      } catch (err) {
        // Fica marcada como em andamento para não ser tentada de novo a cada ciclo.
        lastProblem = `voz: ${errorText(err)}`
      }
    }
  } finally {
    synthesizing = false
  }
}

/** Troca de aula: abre o arquivo novo, insistindo algumas vezes antes de avisar o usuário. */
async function openNextLesson(target: VideoState): Promise<void> {
  if (!target.src) return
  notice('Nova aula: preparando a tradução…')
  let problem = ''
  for (let attempt = 0; attempt < NEXT_LESSON_ATTEMPTS; attempt++) {
    // O usuário pode ter trocado de aula de novo enquanto esta abria.
    if (target.lesson !== video.lesson || target.src !== video.src) return
    try {
      await openLesson(target.src, NEXT_LESSON_TIMEOUT_MS)
      return
    } catch (err) {
      problem = errorText(err)
    }
  }
  lastProblem = `leitura da aula: ${problem}`
  notice(`Não foi possível ler esta aula: ${problem}`)
}

// Tradutor para o texto da página, usado quando o tradutor do Chrome não está acessível de lá.
// Separado do da aula, que só existe enquanto a sessão está ativa.
let pageTranslator: Promise<Awaited<ReturnType<typeof createTranslator>>> | null = null

async function translatePageTexts(texts: string[]): Promise<string[]> {
  pageTranslator ??= createTranslator()
  // Uma falha ao criar não pode ficar guardada: o próximo pedido tenta de novo.
  pageTranslator.catch(() => (pageTranslator = null))
  const engine = await pageTranslator
  const out: string[] = []
  for (const text of texts) out.push(await engine.translate(text))
  return out
}

// Identificador reservado para a amostra de voz da página de opções (fora da numeração das falas).
const PREVIEW_CLIP_ID = -1
const PREVIEW_TEXT = 'Olá! Esta é a voz que vai narrar as suas aulas em português.'

/** Sintetiza e toca uma frase de amostra com a voz escolhida na página de opções. */
async function previewVoice(name: string, rate: number, volume: number): Promise<void> {
  await loadVoice()
  if (!voice || !voiceReady) throw new Error('Não foi possível carregar a voz.')
  // Instante infinito: a amostra nunca é confundida com fala antiga a liberar.
  await voice.prepare(PREVIEW_CLIP_ID, Infinity, PREVIEW_TEXT, name, DUB_BASE_SPEED * rate)
  voice.resume()
  voice.play(PREVIEW_CLIP_ID, 1, volume)
}

function onVideo(next: VideoState): void {
  const previous = video
  video = next

  if (next.lesson !== previous.lesson || next.src !== previous.src) {
    resetLesson()
    video = next
    if (mode === 'ahead' && next.src) void openNextLesson(next)
    return
  }

  if (next.paused !== previous.paused) {
    if (next.paused) {
      voice?.pause()
      if (mode === 'live') capture.pause()
    } else {
      voice?.resume()
      if (mode === 'live') capture.resume()
    }
  }
  if (Math.abs(next.time - previous.time) > SEEK_JUMP_SECONDS) {
    voice?.stop()
    if (mode === 'live') {
      capture.discardPending()
      pending = []
    } else {
      void pump()
    }
  }
  // A fala que ficou para trás é liberada; se o usuário voltar, é sintetizada de novo.
  for (const id of voice?.evictBefore(next.time) ?? []) dubs.set(id, 'none')
  void pumpVoice()
}

async function start(streamId: string | null, initial: VideoState | null, current: Settings): Promise<void> {
  settings = current
  if (initial) video = initial
  try {
    if (!initial?.src) throw new Error('vídeo ainda não carregado')
    mode = 'ahead'
    segmenter = newSegmenter()
    // Sem autorização de captura não há prazo a cumprir: pode esperar mais pelo arquivo.
    await openLesson(initial.src, streamId ? OPEN_TIMEOUT_MS : NEXT_LESSON_TIMEOUT_MS)
  } catch (err) {
    if (!streamId) {
      throw new Error(`Não foi possível ler o arquivo da aula (${errorText(err)}). Ligue pelo ícone da extensão.`)
    }
    lastProblem = `sem leitura à frente (${errorText(err)}); usando o som da aba em tempo real`
    mode = 'live'
    resetLesson()
    await capture.start(streamId)
  }
}

async function stop(): Promise<void> {
  resetLesson()
  await capture.stop()
  transcriber?.dispose()
  translator?.destroy()
  voice?.dispose()
  transcriber = translator = voice = null
  voiceReady = false
  voiceLoading = null
}

chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse: (reply: unknown) => void) => {
  const reply = (value: PipelineReply | boolean | string[]) => sendResponse(value)
  switch (message.type) {
    case 'START':
      // Responde assim que o áudio está chegando; os modelos carregam em seguida, e os trechos
      // falados nesse intervalo ficam na fila.
      start(message.streamId, message.video, message.settings).then(
        () => {
          reply({ ok: true })
          loadModels(message.settings).catch(fail)
        },
        (err: unknown) => reply({ ok: false, error: errorText(err) }),
      )
      return true
    case 'STOP':
      stop().then(() => reply({ ok: true }))
      return true
    case 'SETTINGS': {
      const wasDubbing = settings?.dubbing.enabled
      settings = message.settings
      if (!settings.dubbing.enabled) voice?.stop()
      else if (!wasDubbing && transcriber) void loadVoice()
      return false
    }
    case 'VIDEO':
      onVideo(message.video)
      return false
    case 'PLAY_DUB': {
      const ready = voice?.has(message.id) ?? false
      if (ready) voice?.play(message.id, message.rate, message.volume)
      reply(ready)
      return false
    }
    case 'STOP_DUB':
      voice?.stop()
      return false
    case 'PREVIEW_VOICE':
      if (!message.forwarded) return false
      previewVoice(message.voice, message.rate, message.volume).then(
        () => sendResponse(null),
        (err: unknown) => sendResponse(errorText(err)),
      )
      return true
    case 'TRANSLATE_TEXT':
      // Só atende o pedido repassado pelo service worker; o original, vindo da página, é dele.
      if (!message.forwarded) return false
      translatePageTexts(message.texts).then(reply, () => sendResponse(null))
      return true
    default:
      return false
  }
})
