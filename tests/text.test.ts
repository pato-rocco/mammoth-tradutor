import { describe, expect, it } from 'vitest'
import { captionDuration, layoutCaption, wrapLines } from '../src/core/captionLayout'
import { protect } from '../src/core/glossary'
import { cleanTranscript } from '../src/core/transcript'

describe('glossary', () => {
  it('protege os termos e os devolve após a tradução', () => {
    const p = protect('Open claude code and ask Claude to run it.', ['Claude', 'Claude Code'])
    expect(p.text).toBe('Open XQZ0 and ask XQZ1 to run it.')
    expect(p.restore('Abra o XQZ0 e peça ao xqz 1 para executar.')).toBe('Abra o Claude Code e peça ao Claude para executar.')
  })

  it('não mexe em palavras que apenas contêm o termo', () => {
    expect(protect('The agents are ready.', ['agent']).text).toBe('The agents are ready.')
  })

  it('sem glossário, não altera nada', () => {
    const p = protect('Hello.', [])
    expect(p.text).toBe('Hello.')
    expect(p.restore('Olá.')).toBe('Olá.')
  })
})

describe('cleanTranscript', () => {
  it('remove anotações e espaços extras', () => {
    expect(cleanTranscript('  [BLANK_AUDIO] So this is  the first step. (music) ')).toBe('So this is the first step.')
  })

  it('descarta silêncio e alucinações típicas', () => {
    expect(cleanTranscript('[BLANK_AUDIO]')).toBeNull()
    expect(cleanTranscript(' Thank you. ')).toBeNull()
    expect(cleanTranscript('...')).toBeNull()
    expect(cleanTranscript('Thank you for joining this course.')).not.toBeNull()
  })
})

describe('captionLayout', () => {
  it('respeita o limite de caracteres por linha', () => {
    const lines = wrapLines('Nesta aula você vai aprender a configurar o seu ambiente de desenvolvimento completo.')
    expect(lines.length).toBeGreaterThan(1)
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(42)
  })

  it('não deixa artigo ou preposição solto no fim da linha', () => {
    // A quebra natural cairia depois de "de"; a preposição desce para a linha seguinte.
    expect(wrapLines('aaaa bbbb cccc de dddd', 15)).toEqual(['aaaa bbbb cccc', 'de dddd'])
  })

  it('divide textos longos em blocos de duas linhas', () => {
    const text = Array.from({ length: 40 }, (_, i) => `palavra${i}`).join(' ')
    const blocks = layoutCaption(text)
    expect(blocks.length).toBeGreaterThan(1)
    for (const block of blocks) expect(block.split('\n').length).toBeLessThanOrEqual(2)
    expect(blocks.join(' ').replace(/\n/g, ' ')).toBe(text)
  })

  it('calcula a duração dentro dos limites e encurta com fila', () => {
    expect(captionDuration('Oi.')).toBe(1500)
    expect(captionDuration('x'.repeat(500))).toBe(7000)
    expect(captionDuration('x'.repeat(68))).toBe(4000)
    expect(captionDuration('x'.repeat(68), true)).toBe(2400)
  })
})
