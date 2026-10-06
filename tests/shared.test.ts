import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, mergeSettings } from '../src/shared/settings'
import { isSupportedUrl } from '../src/shared/site'
import { rememberTranscript, type SavedTranscript } from '../src/shared/transcripts'

describe('isSupportedUrl', () => {
  it('aceita o domínio do Mammoth Club e subdomínios em https', () => {
    expect(isSupportedUrl('https://mammothclub.com/course/abc')).toBe(true)
    expect(isSupportedUrl('https://www.mammothclub.com/')).toBe(true)
  })

  it('rejeita outros sites, http e valores inválidos', () => {
    expect(isSupportedUrl('https://evilmammothclub.com/')).toBe(false)
    expect(isSupportedUrl('https://mammothclub.com.example.org/')).toBe(false)
    expect(isSupportedUrl('http://mammothclub.com/')).toBe(false)
    expect(isSupportedUrl('chrome://extensions')).toBe(false)
    expect(isSupportedUrl(undefined)).toBe(false)
    expect(isSupportedUrl('não é url')).toBe(false)
  })
})

describe('mergeSettings', () => {
  it('devolve os padrões quando nada foi salvo', () => {
    expect(mergeSettings(undefined)).toEqual(DEFAULT_SETTINGS)
  })

  it('preserva o que foi salvo e completa o restante', () => {
    const merged = mergeSettings({ dubbing: { enabled: true }, glossary: ['Unity'] })
    expect(merged.dubbing).toEqual({ ...DEFAULT_SETTINGS.dubbing, enabled: true })
    expect(merged.captions).toEqual(DEFAULT_SETTINGS.captions)
    expect(merged.glossary).toEqual(['Unity'])
  })
})

describe('rememberTranscript', () => {
  const saved = (key: string, text = key): SavedTranscript => ({ key, title: key, text, until: 10, complete: true, savedAt: 0 })

  it('guarda as duas aulas mais recentes, a mais nova primeiro', () => {
    const list = [saved('a'), saved('b'), saved('c')].reduce(rememberTranscript, [] as SavedTranscript[])
    expect(list.map((entry) => entry.key)).toEqual(['c', 'b'])
  })

  it('atualiza a aula já guardada em vez de duplicá-la', () => {
    const list = rememberTranscript([saved('a', 'antigo'), saved('b')], saved('a', 'novo'))
    expect(list.map((entry) => `${entry.key}:${entry.text}`)).toEqual(['a:novo', 'b:b'])
  })
})