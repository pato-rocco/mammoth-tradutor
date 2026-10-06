import type { Settings } from '../shared/settings'

// Largura do player em que o tamanho de fonte configurado vale 1:1; acima disso (tela cheia) cresce junto.
const REFERENCE_WIDTH = 960
const MIN_FONT_PX = 14

const STYLE = `
  :host {
    position: absolute; left: 0; right: 0; z-index: 2147483647;
    display: flex; flex-direction: column; align-items: center; gap: 4px;
    padding: 0 4%; box-sizing: border-box; pointer-events: none;
    font-family: system-ui, "Segoe UI", Roboto, sans-serif; text-align: center;
  }
  div { max-width: 100%; padding: 0.15em 0.5em; border-radius: 0.25em; color: #fff; white-space: pre-line;
        background: rgba(0, 0, 0, var(--bg-opacity)); text-shadow: 0 1px 2px #000; line-height: 1.3; }
  div:empty { display: none; }
  .source { font-size: 0.7em; color: #d8d8d8; }
  .notice { font-size: 0.65em; font-style: italic; color: #ffe9a8; }
`

/** Legendas sobre o player, isoladas do CSS do site por Shadow DOM. */
export class Overlay {
  private readonly host = document.createElement('div')
  private readonly source = document.createElement('div')
  private readonly caption = document.createElement('div')
  private readonly notice = document.createElement('div')

  constructor() {
    const shadow = this.host.attachShadow({ mode: 'closed' })
    const style = document.createElement('style')
    style.textContent = STYLE
    this.source.className = 'source'
    this.notice.className = 'notice'
    shadow.append(style, this.notice, this.source, this.caption)
  }

  /** Posiciona o overlay sobre o vídeo; refeito a cada exibição porque o site recria o player. */
  private attach(settings: Settings): boolean {
    const video = findVideo()
    const container = video?.parentElement
    if (!video || !container) return false
    if (this.host.parentElement !== container) container.append(this.host)
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative'

    const { fontSize, bgOpacity, bottomOffset } = settings.captions
    this.host.style.bottom = `${bottomOffset}%`
    this.host.style.fontSize = `${Math.max(MIN_FONT_PX, (fontSize * video.clientWidth) / REFERENCE_WIDTH)}px`
    this.host.style.setProperty('--bg-opacity', String(bgOpacity))
    return true
  }

  showCaption(text: string, sourceText: string | null, settings: Settings): void {
    if (!this.attach(settings)) return
    this.caption.textContent = text
    this.source.textContent = sourceText ?? ''
  }

  hideCaption(): void {
    this.caption.textContent = ''
    this.source.textContent = ''
  }

  showNotice(text: string, settings: Settings): void {
    if (!this.attach(settings)) return
    this.notice.textContent = text
  }

  hideNotice(): void {
    this.notice.textContent = ''
  }

  /** Indica se o nó faz parte do overlay (que não deve ser traduzido pela tradução da página). */
  contains(node: Node): boolean {
    return node === this.host
  }

  /** Posição e tamanho atuais, para o diagnóstico exibido no popup. */
  describe(): string {
    if (!this.host.isConnected) return 'fora da página'
    const rect = this.host.getBoundingClientRect()
    const text = this.caption.textContent ? 'com texto' : 'vazio'
    return `${Math.round(rect.width)}x${Math.round(rect.height)} em ${Math.round(rect.left)},${Math.round(rect.top)} fonte=${this.host.style.fontSize} ${text}`
  }

  remove(): void {
    this.hideCaption()
    this.hideNotice()
    this.host.remove()
  }
}

/** O vídeo da aula: o maior `<video>` visível na página. */
export function findVideo(): HTMLVideoElement | null {
  let best: HTMLVideoElement | null = null
  let bestArea = 0
  for (const video of document.querySelectorAll('video')) {
    const area = video.clientWidth * video.clientHeight
    if (area > bestArea) {
      best = video
      bestArea = area
    }
  }
  return best
}
