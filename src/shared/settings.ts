export interface Settings {
  captions: {
    enabled: boolean
    bilingual: boolean
    fontSize: number
    bgOpacity: number
    bottomOffset: number
  }
  dubbing: {
    enabled: boolean
    voiceName: string | null
    rate: number
    volume: number
    duckLevel: number
  }
  quality: 'fast' | 'accurate'
  /** Quanto do restante da aula (0–100%) deve estar traduzido antes de o vídeo tocar; 0 desliga. */
  prebufferPercent: number
  /** Liga a tradução sozinha ao abrir uma aula, sem passar pelo popup. */
  autoStart: boolean
  /** Traduz também o texto da página do curso (menus, títulos, descrições). */
  translatePage: boolean
  glossary: string[]
}

export const DEFAULT_SETTINGS: Settings = {
  captions: { enabled: true, bilingual: false, fontSize: 22, bgOpacity: 0.75, bottomOffset: 12 },
  dubbing: { enabled: true, voiceName: null, rate: 1, volume: 1, duckLevel: 0.15 },
  quality: 'fast',
  prebufferPercent: 50,
  autoStart: true,
  translatePage: true,
  glossary: [],
}

const STORAGE_KEY = 'settings'

type Stored = {
  [K in keyof Settings]?: Settings[K] extends string[] | number | boolean | string ? Settings[K] : Partial<Settings[K]>
}

/** Completa preferências salvas (possivelmente de uma versão anterior) com os padrões. */
export function mergeSettings(stored: Stored | undefined): Settings {
  const s = stored ?? {}
  return {
    captions: { ...DEFAULT_SETTINGS.captions, ...s.captions },
    dubbing: { ...DEFAULT_SETTINGS.dubbing, ...s.dubbing },
    quality: s.quality === 'accurate' ? 'accurate' : DEFAULT_SETTINGS.quality,
    prebufferPercent: typeof s.prebufferPercent === 'number' ? s.prebufferPercent : DEFAULT_SETTINGS.prebufferPercent,
    autoStart: typeof s.autoStart === 'boolean' ? s.autoStart : DEFAULT_SETTINGS.autoStart,
    translatePage: typeof s.translatePage === 'boolean' ? s.translatePage : DEFAULT_SETTINGS.translatePage,
    glossary: Array.isArray(s.glossary) ? s.glossary : DEFAULT_SETTINGS.glossary,
  }
}

export async function loadSettings(): Promise<Settings> {
  const data = await chrome.storage.sync.get(STORAGE_KEY)
  return mergeSettings(data[STORAGE_KEY] as Stored | undefined)
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.sync.set({ [STORAGE_KEY]: settings })
}

export function onSettingsChanged(listener: (settings: Settings) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    const change = changes[STORAGE_KEY]
    if (area === 'sync' && change) listener(mergeSettings(change.newValue as Stored | undefined))
  })
}
