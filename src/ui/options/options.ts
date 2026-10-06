import { send } from '../../shared/messages'
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type Settings } from '../../shared/settings'

const DEFAULT_VOICE = 'F1'
const SAVE_DELAY_MS = 300

const fields = [...document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-path]')]
const outputs = [...document.querySelectorAll<HTMLOutputElement>('output[data-for]')]
const glossary = document.querySelector<HTMLTextAreaElement>('#glossary')!
const saved = document.querySelector<HTMLSpanElement>('#saved')!
const previewCaption = document.querySelector<HTMLDivElement>('#preview-caption')!
const previewSource = document.querySelector<HTMLSpanElement>('#preview-source')!
const previewVoice = document.querySelector<HTMLButtonElement>('#preview-voice')!
const voiceStatus = document.querySelector<HTMLParagraphElement>('#voice-status')!

let settings: Settings = structuredClone(DEFAULT_SETTINGS)
let saveTimer: number | undefined

type Bag = Record<string, unknown>

/** Lê um valor das preferências pelo caminho do campo (ex.: "captions.fontSize"). */
function read(path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => (value as Bag)[key], settings)
}

function write(path: string, value: unknown): void {
  const keys = path.split('.')
  const last = keys.pop()!
  const target = keys.reduce<Bag>((value, key) => value[key] as Bag, settings as unknown as Bag)
  target[last] = value
}

function show(): void {
  for (const field of fields) {
    const value = read(field.dataset.path!)
    if (field instanceof HTMLInputElement && field.type === 'checkbox') field.checked = Boolean(value)
    else field.value = String(value ?? DEFAULT_VOICE)
  }
  glossary.value = settings.glossary.join('\n')
  refresh()
}

/** Atualiza os valores exibidos ao lado dos controles e a amostra da legenda. */
function refresh(): void {
  for (const output of outputs) {
    const value = Number(read(output.dataset.for!))
    output.textContent = 'percent' in output.dataset ? `${Math.round(value * 100)}%` : `${value}${output.dataset.unit ?? ''}`
  }
  const { enabled, bilingual, fontSize, bgOpacity, bottomOffset } = settings.captions
  previewCaption.hidden = !enabled
  previewSource.hidden = !bilingual
  previewCaption.style.setProperty('--size', `${fontSize}px`)
  previewCaption.style.setProperty('--bg-opacity', String(bgOpacity))
  previewCaption.style.setProperty('--offset', `${bottomOffset}%`)
}

function scheduleSave(): void {
  refresh()
  clearTimeout(saveTimer)
  saveTimer = window.setTimeout(async () => {
    await saveSettings(settings)
    saved.textContent = 'Salvo.'
    window.setTimeout(() => (saved.textContent = ''), 1500)
  }, SAVE_DELAY_MS)
}

for (const field of fields) {
  field.addEventListener('input', () => {
    const path = field.dataset.path!
    if (field instanceof HTMLInputElement && field.type === 'checkbox') write(path, field.checked)
    else if (field instanceof HTMLInputElement && field.type === 'range') write(path, Number(field.value))
    else write(path, field.value)
    scheduleSave()
  })
}

glossary.addEventListener('input', () => {
  settings.glossary = glossary.value
    .split('\n')
    .map((term) => term.trim())
    .filter(Boolean)
  scheduleSave()
})

document.querySelector<HTMLButtonElement>('#reset')!.addEventListener('click', () => {
  settings = structuredClone(DEFAULT_SETTINGS)
  show()
  scheduleSave()
})

previewVoice.addEventListener('click', async () => {
  previewVoice.disabled = true
  voiceStatus.classList.remove('error')
  voiceStatus.textContent = 'Preparando a voz… Na primeira vez há um download de cerca de 260 MB.'
  const voice = settings.dubbing.voiceName ?? DEFAULT_VOICE
  const { rate, volume } = settings.dubbing
  const problem = await send<string | null>({ type: 'PREVIEW_VOICE', voice, rate, volume })
  previewVoice.disabled = false
  voiceStatus.classList.toggle('error', Boolean(problem))
  voiceStatus.textContent = problem === undefined ? 'A extensão não respondeu.' : (problem ?? '')
})

void loadSettings().then((loaded) => {
  settings = loaded
  show()
})
