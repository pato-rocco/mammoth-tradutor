// Frases que o Whisper costuma inventar quando o trecho só tem ruído ou música.
const HALLUCINATIONS = new Set([
  'you',
  'thank you',
  'thanks',
  'thanks for watching',
  'thank you for watching',
  'thank you very much',
  'bye',
  'so',
  'okay',
])

/** Limpa a saída do Whisper; devolve `null` quando não há fala real. */
export function cleanTranscript(raw: string): string | null {
  const text = raw
    .replace(/\[[^\]]*\]|\([^)]*\)|\*[^*]*\*|♪[^♪]*♪?/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const bare = text.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '').trim()
  if (bare.length === 0 || HALLUCINATIONS.has(bare)) return null
  return text
}
