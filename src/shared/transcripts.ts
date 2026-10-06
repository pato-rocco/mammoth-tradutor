/** Tradução de uma aula, guardada para o usuário copiar depois. */
export interface SavedTranscript {
  /** Identifica a aula (caminho da página). */
  key: string
  title: string
  text: string
  /** Segundos de aula cobertos pelo texto. */
  until: number
  /** `true` quando a aula inteira já foi traduzida. */
  complete: boolean
  savedAt: number
}

export const MAX_SAVED_TRANSCRIPTS = 2

const STORAGE_KEY = 'transcripts'

/** Põe a aula no topo da lista (substituindo a versão anterior dela) e mantém só as mais recentes. */
export function rememberTranscript(list: SavedTranscript[], entry: SavedTranscript): SavedTranscript[] {
  return [entry, ...list.filter((saved) => saved.key !== entry.key)].slice(0, MAX_SAVED_TRANSCRIPTS)
}

export async function loadTranscripts(): Promise<SavedTranscript[]> {
  const data = await chrome.storage.local.get(STORAGE_KEY)
  return (data[STORAGE_KEY] as SavedTranscript[] | undefined) ?? []
}

export async function saveTranscript(entry: SavedTranscript): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: rememberTranscript(await loadTranscripts(), entry) })
}
