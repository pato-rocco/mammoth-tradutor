import { IDLE_SESSION, transition, type Session, type SessionEvent } from '../core/session'
import {
  NOTICE_KEY,
  send,
  sendToTab,
  type Message,
  type PipelineReply,
  type StateMessage,
  type VideoState,
} from '../shared/messages'
import { loadSettings, onSettingsChanged } from '../shared/settings'
import { isSupportedUrl } from '../shared/site'

const SESSION_KEY = 'session'
const MANUAL_OFF_KEY = 'manualOff'
const OFFSCREEN_URL = 'src/offscreen/index.html'

async function loadSession(): Promise<Session> {
  const data = await chrome.storage.session.get(SESSION_KEY)
  return (data[SESSION_KEY] as Session | undefined) ?? IDLE_SESSION
}

const BADGE: Record<Session['status'], { text: string; color: string }> = {
  idle: { text: '', color: '#666666' },
  starting: { text: '…', color: '#b26a00' },
  active: { text: 'PT', color: '#1a7f37' },
  stopping: { text: '…', color: '#666666' },
  error: { text: '!', color: '#c62828' },
}

async function updateBadge(session: Session): Promise<void> {
  const { text, color } = BADGE[session.status]
  await chrome.action.setBadgeText({ text })
  await chrome.action.setBadgeBackgroundColor({ color })
}

// Só pode existir um documento offscreen, e vários pedidos chegam juntos ao abrir a página (início
// automático da aula e tradução do texto): todos esperam a mesma criação.
let creatingOffscreen: Promise<void> | null = null

async function ensureOffscreen(): Promise<void> {
  if (await chrome.offscreen.hasDocument()) return
  creatingOffscreen ??= chrome.offscreen
    .createDocument({
      url: OFFSCREEN_URL,
      reasons: [chrome.offscreen.Reason.USER_MEDIA, chrome.offscreen.Reason.AUDIO_PLAYBACK],
      justification: 'Transcrever e traduzir o áudio da aula e reproduzir a dublagem em português.',
    })
    .finally(() => {
      creatingOffscreen = null
    })
  await creatingOffscreen
}

async function startPipeline(tabId: number): Promise<void> {
  await ensureContentScript(tabId)
  await ensureOffscreen()

  const settings = await loadSettings()
  const video = (await sendToTab<VideoState | null>(tabId, { type: 'GET_VIDEO' })) ?? null
  // Só é usado se o arquivo da aula não puder ser lido direto. Obtido por último porque expira
  // em poucos segundos.
  // No início automático não houve clique na extensão, e o Chrome não autoriza a captura: segue
  // só com a leitura direta do arquivo da aula.
  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }).catch(() => null)
  const reply = await send<PipelineReply>({ type: 'START', streamId, video, settings })
  if (!reply) throw new Error('O processador de áudio não respondeu.')
  if (!reply.ok) throw new Error(reply.error)
}

async function stopPipeline(): Promise<void> {
  if (!(await chrome.offscreen.hasDocument())) return
  // Fechar o documento libera o stream e devolve o áudio à aba; o STOP antes evita um corte seco.
  await send<PipelineReply>({ type: 'STOP' })
  await chrome.offscreen.closeDocument()
}

// Eventos são aplicados em série: o worker pode receber vários antes de gravar o estado.
let queue: Promise<unknown> = Promise.resolve()

function dispatch(event: SessionEvent): Promise<Session> {
  const run = queue.then(() => apply(event))
  queue = run.catch(() => undefined)
  return run
}

async function apply(event: SessionEvent): Promise<Session> {
  const previous = await loadSession()
  let session = transition(previous, event)
  if (session === previous) return session
  const tabId = session.tabId ?? previous.tabId
  await commit(session, tabId)

  if (session.status === 'starting' && session.tabId !== null) {
    try {
      await startPipeline(session.tabId)
      session = transition(session, { type: 'STARTED' })
    } catch (err) {
      await stopPipeline().catch(() => undefined)
      session = transition(session, { type: 'FAILED', error: errorText(err) })
    }
    await commit(session, tabId)
  } else if (session.status === 'stopping') {
    await stopPipeline().catch(() => undefined)
    session = transition(session, { type: 'STOPPED' })
    await commit(session, tabId)
  } else if (session.status === 'error') {
    // Falha com a sessão em andamento: nada pode ficar capturando o áudio.
    await stopPipeline().catch(() => undefined)
  }
  return session
}

async function commit(session: Session, tabId: number | null): Promise<void> {
  await chrome.storage.session.set({ [SESSION_KEY]: session })
  if (session.status === 'idle' || session.status === 'starting') await chrome.storage.session.remove(NOTICE_KEY)
  await updateBadge(session)
  await send({ type: 'STATE', session })
  if (tabId !== null) await sendToTab(tabId, { type: 'STATE', session, forThisTab: session.tabId === tabId })
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

const relay = { ok: 0, failed: 0, lastError: '', injection: '-', content: 'sem resposta do script da página' }

/** Repassa à aba da sessão o que o processador de áudio produz. */
async function relayToSessionTab(message: Message): Promise<void> {
  const { tabId } = await loadSession()
  if (tabId === null) return
  try {
    await chrome.tabs.sendMessage(tabId, message)
    relay.ok++
  } catch (err) {
    relay.failed++
    relay.lastError = errorText(err)
  }
}

/**
 * Páginas abertas antes de a extensão ser instalada ou recarregada não têm o script de
 * legendas; nesse caso ele é injetado na hora.
 */
async function ensureContentScript(tabId: number): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'PING' } satisfies Message)
    relay.injection = 'já estava na página'
  } catch {
    try {
      const files = chrome.runtime.getManifest().content_scripts?.[0]?.js ?? []
      await chrome.scripting.executeScript({ target: { tabId }, files })
      relay.injection = 'injetado agora'
    } catch (err) {
      relay.injection = `falhou: ${errorText(err)}`
    }
  }
}

function diagnostics(): string {
  const problem = relay.lastError ? ` erro=${relay.lastError}` : ''
  return [
    `repasse: ok=${relay.ok} falhas=${relay.failed} script=${relay.injection}${problem}`,
    `página: ${relay.content}`,
  ].join('\n')
}

chrome.runtime.onMessage.addListener((message: Message, sender, sendResponse: (reply: StateMessage) => void) => {
  switch (message.type) {
    case 'PREVIEW_VOICE': {
      // Amostra de voz pedida pela página de opções; responde com o texto do erro, ou nulo se tocou.
      if (message.forwarded) return false
      const respond = sendResponse as (reply: unknown) => void
      ensureOffscreen()
        .then(() => send<string | null>({ ...message, forwarded: true }))
        .then(
          (problem) => respond(problem === undefined ? 'O processador de áudio não respondeu.' : problem),
          (err: unknown) => respond(errorText(err)),
        )
      return true
    }
    case 'TRANSLATE_TEXT': {
      // Pedido da página: garante que o processador existe, repassa e sempre devolve uma resposta
      // (nula em caso de falha), para a página poder tentar de novo.
      if (message.forwarded) return false
      const respond = sendResponse as (reply: unknown) => void
      ensureOffscreen()
        .then(() => send<string[] | null>({ ...message, forwarded: true }))
        .then(
          (reply) => respond(reply ?? null),
          () => respond(null),
        )
      return true
    }
    case 'AUTO_START': {
      const tabId = sender.tab?.id
      if (tabId === undefined) return false
      void chrome.storage.session.get(MANUAL_OFF_KEY).then((data) => {
        // Se o usuário desligou pelo popup, a decisão dele vale até ele religar.
        if (!data[MANUAL_OFF_KEY]) void dispatch({ type: 'TOGGLE_ON', tabId })
      })
      return false
    }
    case 'TOGGLE': {
      void chrome.storage.session.set({ [MANUAL_OFF_KEY]: !message.on })
      const event: SessionEvent = message.on ? { type: 'TOGGLE_ON', tabId: message.tabId } : { type: 'TOGGLE_OFF' }
      dispatch(event).then((session) => sendResponse({ type: 'STATE', session }))
      return true
    }
    case 'GET_STATE':
      loadSession().then((session) =>
        sendResponse({ type: 'STATE', session, forThisTab: sender.tab?.id !== undefined && sender.tab.id === session.tabId }),
      )
      return true
    case 'CUE':
    case 'DUB_READY':
    case 'PROGRESS':
      void relayToSessionTab(message)
      return false
    case 'NOTICE':
      // Guardado para o popup mostrar o último aviso mesmo se for aberto depois.
      void chrome.storage.session.set({ [NOTICE_KEY]: message.text })
      void relayToSessionTab(message)
      return false
    case 'CONTENT_DIAG':
      relay.content = message.text
      return false
    case 'GET_DIAG':
      ;(sendResponse as (reply: unknown) => void)(diagnostics())
      return false
    case 'PIPELINE_ERROR':
      void dispatch({ type: 'FAILED', error: message.error })
      return false
    default:
      return false
  }
})

chrome.tabs.onRemoved.addListener((tabId) => {
  void dispatch({ type: 'TAB_GONE', tabId })
})

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Sem permissão no destino a URL vem indefinida, o que também significa "saiu do site".
  if (changeInfo.status === 'loading' && !isSupportedUrl(tab.url)) {
    void dispatch({ type: 'TAB_GONE', tabId })
  }
})

// O documento offscreen não tem acesso ao chrome.storage; as preferências chegam por mensagem.
onSettingsChanged((settings) => {
  void send({ type: 'SETTINGS', settings })
})

// Uma sessão não sobrevive ao reinício do navegador ou da extensão.
chrome.runtime.onStartup.addListener(() => void commit(IDLE_SESSION, null))
chrome.runtime.onInstalled.addListener(() => void commit(IDLE_SESSION, null))
