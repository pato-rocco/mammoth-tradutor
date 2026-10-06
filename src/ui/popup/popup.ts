import type { Session } from '../../core/session'
import { NOTICE_KEY, send, type Message, type StateMessage } from '../../shared/messages'
import { loadTranscripts } from '../../shared/transcripts'
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from '../../shared/settings'
import { isSupportedUrl } from '../../shared/site'
import { createTranslator, translatorStatus } from '../../shared/translator-api'

const power = document.querySelector<HTMLInputElement>('#power')!
const captions = document.querySelector<HTMLInputElement>('#captions')!
const dubbing = document.querySelector<HTMLInputElement>('#dubbing')!
const prebuffer = document.querySelector<HTMLInputElement>('#prebuffer')!
const autoStart = document.querySelector<HTMLInputElement>('#autostart')!
const translatePage = document.querySelector<HTMLInputElement>('#translate-page')!
const status = document.querySelector<HTMLParagraphElement>('#status')!
const diag = document.querySelector<HTMLPreElement>('#diag')!

const STATUS_TEXT: Record<Session['status'], string> = {
  idle: 'Desligada.',
  starting: 'Iniciando…',
  active: 'Traduzindo esta aula.',
  stopping: 'Encerrando…',
  error: 'Erro',
}

let currentTabId: number | undefined
let supported = false
let preparing = false

function render(session: Session): void {
  if (preparing) return
  const elsewhere = session.status !== 'idle' && session.tabId !== currentTabId
  const busy = session.status === 'starting' || session.status === 'stopping'

  power.checked = !elsewhere && (session.status === 'starting' || session.status === 'active')
  power.disabled = !supported || busy
  status.classList.toggle('error', session.status === 'error' && !elsewhere)

  if (!supported) {
    status.textContent = 'Funciona apenas nas aulas do Mammoth Club.'
  } else if (elsewhere) {
    status.textContent = 'Ativa em outra aba. Ligue aqui para trocar.'
  } else if (session.status === 'error') {
    status.textContent = `Erro: ${session.error ?? 'falha desconhecida'}`
  } else {
    status.textContent = STATUS_TEXT[session.status]
    if (session.status === 'active') void showLastNotice()
  }
}

async function showLastNotice(): Promise<void> {
  const data = await chrome.storage.session.get(NOTICE_KEY)
  const text = data[NOTICE_KEY] as string | undefined
  if (text) status.textContent = text
}

function fail(text: string): void {
  preparing = false
  power.checked = false
  power.disabled = !supported
  status.classList.add('error')
  status.textContent = text
}

/**
 * Garante que o pacote de tradução inglês → português está baixado. Precisa acontecer aqui,
 * dentro do clique do usuário: o Chrome não permite iniciar esse download sem um gesto.
 */
async function prepareTranslator(): Promise<boolean> {
  const state = await translatorStatus()
  if (state === 'unsupported') {
    fail('Este Chrome não tem o tradutor embutido (requer a versão 138 ou superior).')
    return false
  }
  if (state === 'unavailable') {
    fail('O tradutor do Chrome não oferece inglês → português neste computador.')
    return false
  }
  if (state === 'available') return true
  try {
    status.textContent = 'Baixando o pacote de tradução…'
    const translator = await createTranslator((percent) => {
      status.textContent = `Baixando o pacote de tradução… ${percent}%`
    })
    translator.destroy()
    return true
  } catch (err) {
    fail(`Não foi possível baixar o tradutor: ${err instanceof Error ? err.message : String(err)}`)
    return false
  }
}

async function toggle(on: boolean): Promise<void> {
  if (currentTabId === undefined) return
  if (on) {
    preparing = true
    power.disabled = true
    status.classList.remove('error')
    status.textContent = 'Preparando o tradutor…'
    if (!(await prepareTranslator())) return
    preparing = false
  }
  const current = await send<StateMessage>({ type: 'GET_STATE' })
  // Uma sessão em outra aba é encerrada antes de iniciar nesta.
  if (on && current && current.session.status !== 'idle' && current.session.tabId !== currentTabId) {
    await send({ type: 'TOGGLE', tabId: current.session.tabId ?? currentTabId, on: false })
  }
  const reply = await send<StateMessage>({ type: 'TOGGLE', tabId: currentTabId, on })
  if (reply) render(reply.session)
}

function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
}

/** Lista as traduções guardadas (as duas aulas mais recentes), cada uma com seu botão de copiar. */
async function showTranscripts(): Promise<void> {
  const box = document.querySelector<HTMLDivElement>('#transcripts')!
  box.replaceChildren()
  for (const saved of await loadTranscripts()) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'link'
    const progress = saved.complete ? 'completa' : `até ${clock(saved.until)}`
    button.textContent = `Copiar tradução: ${saved.title} (${progress})`
    button.title = saved.title
    button.addEventListener('click', async () => {
      await navigator.clipboard.writeText(saved.text)
      status.classList.remove('error')
      status.textContent = saved.complete
        ? 'Tradução da aula copiada.'
        : `Copiado até ${clock(saved.until)}; essa aula não foi traduzida até o fim.`
    })
    box.append(button)
  }
}
async function savePreference(): Promise<void> {
  const settings = await loadSettings()
  settings.captions.enabled = captions.checked
  settings.dubbing.enabled = dubbing.checked
  settings.prebufferPercent = prebuffer.checked ? DEFAULT_SETTINGS.prebufferPercent : 0
  settings.autoStart = autoStart.checked
  settings.translatePage = translatePage.checked
  await saveSettings(settings)
}

async function init(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  currentTabId = tab?.id
  supported = isSupportedUrl(tab?.url)

  const settings = await loadSettings()
  captions.checked = settings.captions.enabled
  dubbing.checked = settings.dubbing.enabled
  prebuffer.checked = settings.prebufferPercent > 0
  autoStart.checked = settings.autoStart
  translatePage.checked = settings.translatePage
  diag.hidden = !settings.showDiagnostics

  const reply = await send<StateMessage>({ type: 'GET_STATE' })
  render(reply?.session ?? { tabId: null, status: 'idle' })

  power.addEventListener('change', () => void toggle(power.checked))
  captions.addEventListener('change', () => void savePreference())
  dubbing.addEventListener('change', () => void savePreference())
  prebuffer.addEventListener('change', () => void savePreference())
  autoStart.addEventListener('change', () => void savePreference())
  translatePage.addEventListener('change', () => void savePreference())
  void showTranscripts()
  document.querySelector<HTMLButtonElement>('#options')!.addEventListener('click', () => void chrome.runtime.openOptionsPage())
}

chrome.runtime.onMessage.addListener((message: Message) => {
  if (message.type === 'STATE') render(message.session)
  else if (message.type === 'NOTICE' && !preparing) status.textContent = message.text
  else if (message.type === 'DIAG') audioDiag = message.text
})

// Diagnóstico: o processador de áudio envia o dele; o do service worker e da página é consultado.
let audioDiag = ''
setInterval(() => {
  void send<string>({ type: 'GET_DIAG' }).then((rest) => {
    diag.textContent = audioDiag ? `${audioDiag}\n${rest ?? ''}` : ''
  })
}, 2000)

void init()
