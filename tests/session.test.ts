import { describe, expect, it } from 'vitest'
import { IDLE_SESSION, transition, type Session, type SessionEvent } from '../src/core/session'

function run(events: SessionEvent[], from: Session = IDLE_SESSION): Session {
  return events.reduce(transition, from)
}

describe('transition', () => {
  it('percorre o ciclo completo ligar → ativo → desligar', () => {
    expect(run([{ type: 'TOGGLE_ON', tabId: 7 }])).toEqual({ tabId: 7, status: 'starting' })
    expect(run([{ type: 'TOGGLE_ON', tabId: 7 }, { type: 'STARTED' }])).toEqual({ tabId: 7, status: 'active' })
    expect(run([{ type: 'TOGGLE_ON', tabId: 7 }, { type: 'STARTED' }, { type: 'TOGGLE_OFF' }])).toEqual({
      tabId: 7,
      status: 'stopping',
    })
    expect(run([{ type: 'TOGGLE_ON', tabId: 7 }, { type: 'STARTED' }, { type: 'TOGGLE_OFF' }, { type: 'STOPPED' }])).toBe(
      IDLE_SESSION,
    )
  })

  it('ignora eventos inválidos para o estado atual', () => {
    expect(transition(IDLE_SESSION, { type: 'STARTED' })).toBe(IDLE_SESSION)
    expect(transition(IDLE_SESSION, { type: 'TOGGLE_OFF' })).toBe(IDLE_SESSION)
    expect(transition(IDLE_SESSION, { type: 'FAILED', error: 'x' })).toBe(IDLE_SESSION)
    const active: Session = { tabId: 7, status: 'active' }
    expect(transition(active, { type: 'TOGGLE_ON', tabId: 9 })).toBe(active)
  })

  it('registra a falha e permite religar ou desligar depois', () => {
    const failed = run([{ type: 'TOGGLE_ON', tabId: 7 }, { type: 'FAILED', error: 'captura negada' }])
    expect(failed).toEqual({ tabId: 7, status: 'error', error: 'captura negada' })
    expect(transition(failed, { type: 'TOGGLE_ON', tabId: 7 })).toEqual({ tabId: 7, status: 'starting' })
    expect(transition(failed, { type: 'TOGGLE_OFF' })).toBe(IDLE_SESSION)
  })

  it('encerra a sessão quando a aba dela some, e só ela', () => {
    const active: Session = { tabId: 7, status: 'active' }
    expect(transition(active, { type: 'TAB_GONE', tabId: 7 })).toEqual({ tabId: 7, status: 'stopping' })
    expect(transition(active, { type: 'TAB_GONE', tabId: 8 })).toBe(active)
    const failed: Session = { tabId: 7, status: 'error', error: 'x' }
    expect(transition(failed, { type: 'TAB_GONE', tabId: 7 })).toBe(IDLE_SESSION)
  })
})
