const TOKEN = 'XQZ'

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Troca os termos do glossário por marcadores que o tradutor não altera;
 * `restore` devolve os termos ao texto traduzido.
 */
export function protect(text: string, glossary: string[]): { text: string; restore: (translated: string) => string } {
  // Termos mais longos primeiro, para "Claude Code" não ser quebrado por "Claude".
  const terms = [...new Set(glossary.map((t) => t.trim()).filter(Boolean))].sort((a, b) => b.length - a.length)
  if (terms.length === 0) return { text, restore: (translated) => translated }

  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])(${terms.map(escapeRegExp).join('|')})(?![\\p{L}\\p{N}])`, 'giu')
  const used: string[] = []
  const masked = text.replace(pattern, (match) => {
    const term = terms.find((t) => t.toLowerCase() === match.toLowerCase()) ?? match
    let index = used.indexOf(term)
    if (index < 0) index = used.push(term) - 1
    return `${TOKEN}${index}`
  })

  const restorePattern = new RegExp(`${TOKEN}\\s?(\\d+)`, 'gi')
  return {
    text: masked,
    restore: (translated) => translated.replace(restorePattern, (match, index: string) => used[Number(index)] ?? match),
  }
}
