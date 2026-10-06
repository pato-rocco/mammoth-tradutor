import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, mergeSettings } from '../src/shared/settings'
import { isSupportedUrl } from '../src/shared/site'

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
