import type { Cue } from '../core/cues'
import type { Session } from '../core/session'
import type { Settings } from './settings'

/** Situação do vídeo da aula, informada periodicamente pela página. */
export interface VideoState {
  /** Muda a cada troca de aula; legendas de outra aula são descartadas. */
  lesson: number
  src: string | null
  time: number
  rate: number
  paused: boolean
}

export type Message =
  | { type: 'TOGGLE'; tabId: number; on: boolean }
  | { type: 'GET_STATE' }
  | { type: 'STATE'; session: Session; forThisTab?: boolean }
  | { type: 'GET_VIDEO' }
  | { type: 'AUTO_START' }
  | { type: 'TRANSLATE_TEXT'; texts: string[]; forwarded?: boolean }
  | { type: 'START'; streamId: string | null; video: VideoState | null; settings: Settings }
  | { type: 'STOP' }
  | { type: 'SETTINGS'; settings: Settings }
  | { type: 'VIDEO'; video: VideoState }
  | { type: 'CUE'; cue: Cue }
  | { type: 'DUB_READY'; id: number; lesson: number; duration: number; playAt: number; live: boolean }
  | { type: 'PROGRESS'; lesson: number; until: number; duration: number; done: boolean }
  | { type: 'PLAY_DUB'; id: number; rate: number; volume: number }
  | { type: 'STOP_DUB' }
  | { type: 'NOTICE'; text: string }
  | { type: 'DIAG'; text: string }
  | { type: 'CONTENT_DIAG'; text: string }
  | { type: 'GET_DIAG' }
  | { type: 'PING' }
  | { type: 'PIPELINE_ERROR'; error: string }

/** Chave em `chrome.storage.session` com o último aviso do processador de áudio. */
export const NOTICE_KEY = 'notice'

/** Resposta do documento offscreen a START/STOP. */
export type PipelineReply = { ok: true } | { ok: false; error: string }

export type StateMessage = Extract<Message, { type: 'STATE' }>

/** Envia a outros contextos da extensão; ignora a ausência de receptor (ex.: popup fechado). */
export async function send<T = void>(message: Message): Promise<T | undefined> {
  try {
    return (await chrome.runtime.sendMessage(message)) as T
  } catch {
    return undefined
  }
}

/** Envia ao content script de uma aba; ignora abas sem o script (ex.: abertas antes da instalação). */
export async function sendToTab<T = void>(tabId: number, message: Message): Promise<T | undefined> {
  try {
    return (await chrome.tabs.sendMessage(tabId, message)) as T
  } catch {
    return undefined
  }
}
