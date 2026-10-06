export const MAX_LINE_CHARS = 42
export const MAX_LINES = 2

const MIN_DURATION_MS = 1500
const MAX_DURATION_MS = 7000
const CHARS_PER_SECOND = 17

// Palavras que não devem ficar soltas no fim de uma linha.
const CLINGS_TO_NEXT = new Set(
  'a o as os um uma uns umas de da do das dos em na no nas nos e ou que para por com sem ao aos à às se'.split(' '),
)

export function wrapLines(text: string, maxChars = MAX_LINE_CHARS): string[] {
  const lines: string[] = []
  let line: string[] = []
  const length = (words: string[]) => words.join(' ').length

  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line.length > 0 && length([...line, word]) > maxChars) {
      const last = line[line.length - 1]!
      const carry = line.length > 1 && CLINGS_TO_NEXT.has(last.toLowerCase()) ? [line.pop()!] : []
      lines.push(line.join(' '))
      line = carry
    }
    line.push(word)
  }
  if (line.length > 0) lines.push(line.join(' '))
  return lines
}

/** Divide o texto em blocos de até `maxLines` linhas, exibidos em sequência. */
export function layoutCaption(text: string, maxChars = MAX_LINE_CHARS, maxLines = MAX_LINES): string[] {
  const lines = wrapLines(text, maxChars)
  const blocks: string[] = []
  for (let i = 0; i < lines.length; i += maxLines) blocks.push(lines.slice(i, i + maxLines).join('\n'))
  return blocks
}

/** Tempo de exibição proporcional ao tamanho; encurtado quando há outro bloco esperando. */
export function captionDuration(block: string, waiting = false): number {
  const natural = Math.min(MAX_DURATION_MS, Math.max(MIN_DURATION_MS, (block.length / CHARS_PER_SECOND) * 1000))
  return waiting ? Math.max(MIN_DURATION_MS, natural * 0.6) : natural
}
