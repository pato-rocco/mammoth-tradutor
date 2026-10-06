export type SessionStatus = 'idle' | 'starting' | 'active' | 'stopping' | 'error'

export interface Session {
  tabId: number | null
  status: SessionStatus
  error?: string
}

export type SessionEvent =
  | { type: 'TOGGLE_ON'; tabId: number }
  | { type: 'TOGGLE_OFF' }
  | { type: 'STARTED' }
  | { type: 'STOPPED' }
  | { type: 'FAILED'; error: string }
  | { type: 'TAB_GONE'; tabId: number }

export const IDLE_SESSION: Session = { tabId: null, status: 'idle' }

/** Máquina de estados da sessão de tradução. Eventos inválidos para o estado atual são ignorados. */
export function transition(session: Session, event: SessionEvent): Session {
  const { status, tabId } = session
  switch (event.type) {
    case 'TOGGLE_ON':
      return status === 'idle' || status === 'error' ? { tabId: event.tabId, status: 'starting' } : session
    case 'STARTED':
      return status === 'starting' ? { tabId, status: 'active' } : session
    case 'TOGGLE_OFF':
      if (status === 'starting' || status === 'active') return { tabId, status: 'stopping' }
      return status === 'error' ? IDLE_SESSION : session
    case 'STOPPED':
      return status === 'stopping' ? IDLE_SESSION : session
    case 'FAILED':
      return status === 'idle' ? session : { tabId, status: 'error', error: event.error }
    case 'TAB_GONE':
      if (event.tabId !== tabId) return session
      if (status === 'starting' || status === 'active') return { tabId, status: 'stopping' }
      return status === 'error' ? IDLE_SESSION : session
  }
}
