// Tipagem mínima da Translator API embutida do Chrome (138+).
interface TranslatorInstance {
  translate(text: string): Promise<string>
  destroy(): void
}

interface TranslatorFactory {
  availability(options: LanguagePair): Promise<'unavailable' | 'downloadable' | 'downloading' | 'available'>
  create(options: LanguagePair & { monitor?: (monitor: EventTarget) => void }): Promise<TranslatorInstance>
}

interface LanguagePair {
  sourceLanguage: string
  targetLanguage: string
}

const PAIR: LanguagePair = { sourceLanguage: 'en', targetLanguage: 'pt' }

function factory(): TranslatorFactory | undefined {
  return (globalThis as { Translator?: TranslatorFactory }).Translator
}

export type TranslatorStatus = 'unsupported' | 'unavailable' | 'downloadable' | 'downloading' | 'available'

export async function translatorStatus(): Promise<TranslatorStatus> {
  const api = factory()
  return api ? api.availability(PAIR) : 'unsupported'
}

/**
 * Cria o tradutor inglês → português. Se o pacote de idioma ainda não foi baixado, o Chrome
 * exige que a chamada venha de um gesto do usuário (clique) — por isso o popup a faz primeiro.
 */
export async function createTranslator(onProgress?: (percent: number) => void): Promise<TranslatorInstance> {
  const api = factory()
  if (!api) throw new Error('Este Chrome não tem o tradutor embutido (requer a versão 138 ou superior).')
  return api.create({
    ...PAIR,
    monitor: (monitor) => {
      monitor.addEventListener('downloadprogress', (event) => {
        onProgress?.(Math.round((event as ProgressEvent).loaded * 100))
      })
    },
  })
}
