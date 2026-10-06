import { blockAt, cueAt, insertCue, type Cue } from '../core/cues'
import { captionDuration } from '../core/captionLayout'
import { send, type Message, type StateMessage, type VideoState } from '../shared/messages'
import { DEFAULT_SETTINGS, loadSettings, onSettingsChanged } from '../shared/settings'
import { findVideo, Overlay } from './overlay'
import { PageTranslator } from './page-translate'

const TICK_MS = 100
// De quanto em quanto tempo a página informa a posição do vídeo ao processador.
const REPORT_EVERY_TICKS = 5
const NOTICE_MS = 6000
// Uma fala só começa se o seu instante passou há pouco; senão ficaria fora de sincronia.
const DUB_START_WINDOW_SECONDS = 1.5
const LIVE_DUB_START_WINDOW_SECONDS = 10
// O volume original continua reduzido se outra fala começa logo em seguida (evita o sobe-e-desce).
const DUCK_HOLD_SECONDS = 1.5
// Fração da diferença de volume percorrida a cada ciclo: transição suave em vez de degrau.
const DUCK_SMOOTHING = 0.2

interface Dub {
  id: number
  /** Instante do vídeo em que a fala deve começar. */
  playAt: number
  duration: number
  live: boolean
  played: boolean
}

const overlay = new Overlay()
let settings = DEFAULT_SETTINGS
const pageTranslator = new PageTranslator(
  () => settings.glossary,
  (node) => overlay.contains(node),
)
let active = false
// Identifica a aula em exibição. Parte do relógio para nunca repetir entre carregamentos da página:
// o processador de áudio sobrevive à navegação e não pode confundir a aula nova com a anterior.
let lesson = Date.now()
let lastSrc: string | null = null
let cues: Cue[] = []
const dubs = new Map<number, Dub>()
let ticks = 0
let lastTime = 0
let lastPaused: boolean | undefined
let lastShown = ''
let noticeTimer: number | undefined
let tickTimer: number | undefined
// Até quando (relógio da página, ms) a fala em andamento toca.
let speakingUntil = 0
// Redução do volume original durante a dublagem: `base` é o volume escolhido pelo usuário.
let duck: { video: HTMLVideoElement; base: number; factor: number; lastSet: number } | null = null

const counts = { received: 0, dubbed: 0 }

// Pré-carregamento: o vídeo é segurado até boa parte da aula estar traduzida.
const HOLD_NOTICE_EVERY_TICKS = 20
// Dois plays seguidos dentro deste intervalo liberam o vídeo sem esperar.
const HOLD_OVERRIDE_MS = 2500
let prepared: { until: number; duration: number; done: boolean } | null = null
// Depois de liberada uma vez, a aula não volta a ser segurada.
let released = false
let resumeWhenReady = false
let lastPlayAttempt = 0
// Posição do vídeo quando esta aula foi vista pela primeira vez, e quando a tradução foi ligada.
let lessonStartTime = 0
let activatedAt = 0
// Só volta o vídeo se ele andou pouco; mais que isso foi o usuário assistindo de propósito.
const MAX_REWIND_SECONDS = 60
// Quanto esperar pelo primeiro sinal do processador antes de soltar o vídeo.
const START_WAIT_MS = 20000
let lastStage = ''

/** Fração (0–1) do necessário que já está traduzida, contando a partir de onde o vídeo está. */
function preparedFraction(time: number): number {
  if (!prepared || settings.prebufferPercent <= 0) return 1
  if (prepared.done) return 1
  const needed = (settings.prebufferPercent / 100) * Math.max(0, prepared.duration - time)
  return needed <= 0 ? 1 : Math.min(1, Math.max(0, prepared.until - time) / needed)
}

function release(video: HTMLVideoElement): void {
  released = true
  overlay.hideNotice()
  if (resumeWhenReady) void video.play().catch(() => undefined)
}

/**
 * Pausa o vídeo para a preparação. O site dá play sozinho ao abrir a aula, então alguns segundos
 * já podem ter passado: o vídeo volta ao ponto em que a aula começou a tocar.
 */
function holdVideo(video: HTMLVideoElement): void {
  if (video.paused) return
  resumeWhenReady = true
  video.pause()
  const played = video.currentTime - lessonStartTime
  if (played > 0 && played < MAX_REWIND_SECONDS) video.currentTime = lessonStartTime
}

/** Segura o vídeo enquanto a tradução não está adiantada o bastante. */
function holdIfPreparing(video: HTMLVideoElement): void {
  if (released || settings.prebufferPercent <= 0) return
  if (!prepared) {
    // Ainda sem notícia do processador (modelos carregando, arquivo abrindo): segura por um
    // tempo limitado, para o vídeo não ficar preso se a leitura à frente não estiver disponível.
    if (performance.now() - activatedAt > START_WAIT_MS) release(video)
    else holdVideo(video)
    return
  }
  const fraction = preparedFraction(video.currentTime)
  if (fraction >= 1) {
    release(video)
    return
  }
  holdVideo(video)
  if (ticks % HOLD_NOTICE_EVERY_TICKS === 0) {
    // Antes do primeiro trecho traduzido, o que está acontecendo é o carregamento dos modelos.
    const what = fraction === 0 && lastStage ? lastStage : `Preparando a tradução: ${Math.floor(fraction * 100)}%.`
    showNotice(`${what} Para assistir já, aperte play duas vezes.`)
  }
}

function resetPreparation(): void {
  prepared = null
  released = false
  resumeWhenReady = false
}

// Os avisos de carregamento dos modelos já chegam enquanto a sessão está iniciando.
function isRunning(status: StateMessage['session']['status']): boolean {
  return status === 'starting' || status === 'active'
}

function videoState(): VideoState {
  const video = findVideo()
  const src = video?.currentSrc || null
  if (src !== lastSrc) {
    // O site trocou de aula: nada da anterior vale mais.
    lastSrc = src
    lesson++
    cues = []
    dubs.clear()
    restoreVolume()
    resetPreparation()
    overlay.hideCaption()
    // Perto do início, considera o começo exato: o play automático do site já consumiu uma fração.
    const time = video?.currentTime ?? 0
    lessonStartTime = time < 3 ? 0 : time
    activatedAt = performance.now()
  }
  return { lesson, src, time: video?.currentTime ?? 0, rate: video?.playbackRate ?? 1, paused: video?.paused ?? true }
}

function restoreVolume(): void {
  if (!duck) return
  duck.video.volume = duck.base
  duck = null
}

/** Leva o volume original, aos poucos, para o nível reduzido (fala tocando) ou de volta ao normal. */
function updateVolume(video: HTMLVideoElement, lowered: boolean): void {
  if (!duck) {
    if (!lowered) return
    duck = { video, base: video.volume, factor: 1, lastSet: video.volume }
  }
  // O usuário mexeu no volume durante a dublagem: passa a valer o novo valor.
  if (Math.abs(video.volume - duck.lastSet) > 0.02) duck.base = Math.min(1, video.volume / duck.factor)

  const target = lowered ? settings.dubbing.duckLevel : 1
  duck.factor += (target - duck.factor) * DUCK_SMOOTHING
  if (Math.abs(target - duck.factor) < 0.01) duck.factor = target
  video.volume = duck.lastSet = duck.base * duck.factor
  if (!lowered && duck.factor === 1) duck = null
}

async function playDub(dub: Dub, video: HTMLVideoElement): Promise<void> {
  dub.played = true
  // Reserva o canal já, para o próximo ciclo não iniciar outra fala enquanto esta é pedida.
  speakingUntil = performance.now() + 500
  // A voz toca na velocidade em que foi sintetizada; só acompanha a velocidade do próprio vídeo.
  const rate = video.playbackRate
  const started = await send<boolean>({ type: 'PLAY_DUB', id: dub.id, rate, volume: settings.dubbing.volume })
  if (!started) return
  counts.dubbed++
  speakingUntil = performance.now() + (dub.duration / rate) * 1000
}

/** A fala cujo instante acabou de chegar, se houver. */
function dueDub(time: number): Dub | undefined {
  let due: Dub | undefined
  for (const dub of dubs.values()) {
    const late = time - dub.playAt
    const window = dub.live ? LIVE_DUB_START_WINDOW_SECONDS : DUB_START_WINDOW_SECONDS
    if (!dub.played && late >= 0 && late < window && (!due || dub.playAt < due.playAt)) due = dub
  }
  return due
}

function dubComingSoon(time: number): boolean {
  for (const dub of dubs.values()) {
    if (!dub.played && dub.playAt > time && dub.playAt - time < DUCK_HOLD_SECONDS) return true
  }
  return false
}

function tick(): void {
  const state = videoState()
  const video = findVideo()
  if (++ticks % REPORT_EVERY_TICKS === 0 || state.paused !== (lastPaused ?? state.paused) || Math.abs(state.time - lastTime) > 1) {
    void send({ type: 'VIDEO', video: state })
  }
  lastPaused = state.paused
  lastTime = state.time
  if (!video) return
  holdIfPreparing(video)

  // Em pausa a fala fica suspensa (o processador a congela); o fim previsto é adiado junto.
  if (state.paused && speakingUntil > performance.now()) speakingUntil += TICK_MS

  const cue = cueAt(cues, state.time)
  const text = cue && settings.captions.enabled ? (cue.translated ? '' : '[EN] ') + blockAt(cue, state.time) : ''
  // Só mexe na página quando o texto muda; o tamanho é reajustado a cada troca (ex.: tela cheia).
  if (text !== lastShown) {
    lastShown = text
    if (cue && text) overlay.showCaption(text, settings.captions.bilingual ? cue.sourceText : null, settings)
    else overlay.hideCaption()
  }

  if (!settings.dubbing.enabled) return
  const speaking = performance.now() < speakingUntil
  // As falas tocam uma após a outra: com uma em andamento, a próxima espera.
  if (!state.paused && !speaking) {
    const due = dueDub(state.time)
    if (due) void playDub(due, video)
  }
  updateVolume(video, speaking || (!state.paused && dubComingSoon(state.time)))
}

function onCue(cue: Cue): void {
  if (cue.lesson !== lesson) return
  counts.received++
  if (cue.live) {
    // Captura em tempo real: a fala já passou; a legenda entra agora e dura o tempo de leitura.
    const now = findVideo()?.currentTime ?? 0
    cue = { ...cue, tStart: now, tEnd: now + captionDuration(cue.text) / 1000 }
  }
  insertCue(cues, cue)
}

function showNotice(text: string): void {
  overlay.showNotice(text, settings)
  clearTimeout(noticeTimer)
  noticeTimer = window.setTimeout(() => overlay.hideNotice(), NOTICE_MS)
}

function setActive(value: boolean): void {
  if (active === value) return
  active = value
  clearInterval(tickTimer)
  if (active) {
    activatedAt = performance.now()
    tickTimer = window.setInterval(tick, TICK_MS)
  } else {
    // Se o vídeo estava segurado por nós, não pode ficar parado depois que a tradução sai.
    const video = findVideo()
    if (video && resumeWhenReady && !released) void video.play().catch(() => undefined)
    cues = []
    dubs.clear()
    restoreVolume()
    resetPreparation()
    clearTimeout(noticeTimer)
    overlay.remove()
  }
}

// Diagnóstico periódico, mostrado no rodapé do popup.
setInterval(() => {
  if (!active) return
  const video = findVideo()
  const ready = [...dubs.values()].length
  const text = [
    `vídeo=${video ? `${video.clientWidth}x${video.clientHeight}` : 'não achado'}`,
    `tempo=${video?.currentTime.toFixed(0) ?? '-'}s`,
    `legendas=${cues.length} (recebidas ${counts.received})`,
    `falas prontas=${ready} tocadas=${counts.dubbed}`,
    `overlay=${overlay.describe()}`,
    `textos da página=${pageTranslator.translatedCount}${pageTranslator.problem ? ` (${pageTranslator.problem})` : ''}`,
  ].join(' ')
  void send({ type: 'CONTENT_DIAG', text })
}, 2000)

chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse: (reply: unknown) => void) => {
  switch (message.type) {
    case 'PING':
      sendResponse(true)
      break
    case 'GET_VIDEO':
      sendResponse(videoState())
      break
    case 'STATE':
      setActive(message.forThisTab === true && isRunning(message.session.status))
      if (message.forThisTab && message.session.status === 'error') {
        showNotice(`Tradução interrompida: ${message.session.error ?? 'erro desconhecido'}`)
      }
      break
    case 'CUE':
      if (active) onCue(message.cue)
      break
    case 'DUB_READY':
      if (active && message.lesson === lesson) {
        const { id, duration, live } = message
        // Em tempo real não há instante planejado: a fala toca assim que chega.
        const playAt = live ? (findVideo()?.currentTime ?? 0) : message.playAt
        dubs.set(id, { id, playAt, duration, live, played: false })
      }
      break
    case 'PROGRESS':
      if (active && message.lesson === lesson) {
        prepared = { until: message.until, duration: message.duration, done: message.done }
      }
      break
    case 'NOTICE':
      // Enquanto o vídeo está segurado, o aviso de preparação tem prioridade sobre os demais.
      lastStage = message.text
      if (active && (released || !prepared)) showNotice(message.text)
      break
  }
})

// Play duas vezes seguidas durante a preparação: o usuário prefere assistir já.
document.addEventListener(
  'play',
  (event) => {
    if (!active || released || event.target !== findVideo()) return
    const now = performance.now()
    if (now - lastPlayAttempt < HOLD_OVERRIDE_MS) {
      released = true
      overlay.hideNotice()
    }
    lastPlayAttempt = now
  },
  true,
)

// Ao voltar o vídeo, as falas daquele trecho podem tocar de novo.
document.addEventListener(
  'seeked',
  (event) => {
    if (!active || event.target !== findVideo()) return
    void send({ type: 'STOP_DUB' })
    speakingUntil = 0
    for (const dub of dubs.values()) dub.played = false
  },
  true,
)

onSettingsChanged((changed) => {
  settings = changed
  void pageTranslator.setEnabled(settings.translatePage)
  if (!settings.dubbing.enabled) {
    void send({ type: 'STOP_DUB' })
    speakingUntil = 0
    restoreVolume()
  }
})

// Início automático: ao abrir uma aula com a tradução desligada, pede para ligar — uma vez por
// página, para não insistir se o usuário desligar.
const LESSON_PATH = '/course-learn/'
const AUTO_START_WAIT_MS = 4000
let autoStartTriedFor = ''
let settingsLoaded = false
setInterval(() => {
  if (active || !settingsLoaded || !settings.autoStart || autoStartTriedFor === location.href) return
  if (!location.pathname.startsWith(LESSON_PATH) || !findVideo()?.currentSrc) return
  autoStartTriedFor = location.href
  // Registra a aula e já segura o vídeo, sem esperar a tradução terminar de ligar.
  videoState()
  const video = findVideo()
  if (video && settings.prebufferPercent > 0) holdVideo(video)
  void send({ type: 'AUTO_START' })
  // O pedido pode ser recusado (ex.: o usuário desligou a tradução pelo popup): nesse caso o
  // vídeo não pode ficar parado à espera de algo que não vem.
  setTimeout(() => {
    if (active || !resumeWhenReady) return
    resumeWhenReady = false
    void findVideo()?.play().catch(() => undefined)
  }, AUTO_START_WAIT_MS)
}, 1000)

void (async () => {
  settings = await loadSettings()
  settingsLoaded = true
  // A tradução da página não depende de a tradução da aula estar ligada.
  void pageTranslator.setEnabled(settings.translatePage)
  const state = await send<StateMessage>({ type: 'GET_STATE' })
  if (state) setActive(state.forThisTab === true && isRunning(state.session.status))
})()
