import { protect } from '../core/glossary'
import { send } from '../shared/messages'
import { createTranslator, translatorStatus } from '../shared/translator-api'

// Conteúdo que não é texto para leitura, ou que não deve ser alterado (código, campos de digitação).
const SKIPPED_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'CODE', 'PRE', 'KBD', 'IFRAME'])
const HAS_WORD = /\p{L}{2,}/u
// E-mails, endereços e nomes de usuário/arquivo (uma "palavra" só, com ponto ou arroba) ficam como estão.
const IDENTIFIER = /^\S*(@|:\/\/|\w\.\w)\S*$/
const BATCH_SIZE = 20
const RETRY_BASE_MS = 1500
const RETRY_MAX_MS = 15000

type Translate = (texts: string[]) => Promise<string[]>

interface Entry {
  source: string
  translated: string | null
}

/**
 * Traduz o texto da página no lugar, nó a nó. Só o conteúdo dos nós de texto muda — a estrutura
 * fica intacta, o que convive bem com sites que redesenham a tela por conta própria (onde o
 * tradutor do Google costuma falhar). O que o site redesenhar é traduzido de novo, do cache.
 */
export class PageTranslator {
  private readonly entries = new Map<Text, Entry>()
  private readonly cache = new Map<string, string>()
  private readonly queue = new Set<Text>()
  // Textos de exemplo dos campos (placeholder): o original é guardado para poder restaurar.
  private readonly placeholders = new Map<Element, string>()
  private readonly observer = new MutationObserver((mutations) => this.onMutations(mutations))
  private translate: Translate | null = null
  private enabled = false
  private working = false
  private failures = 0
  /** Motivo de a tradução da página não estar funcionando, se houver. */
  problem = ''

  constructor(
    private readonly glossary: () => string[],
    private readonly isOurs: (node: Node) => boolean,
    /** Em quadros isolados o tradutor do Chrome não é confiável: usa sempre o processador da extensão. */
    private readonly remoteOnly = false,
  ) {}

  get translatedCount(): number {
    return this.cache.size
  }

  async setEnabled(value: boolean): Promise<void> {
    if (this.enabled === value) return
    this.enabled = value
    if (!value) {
      this.observer.disconnect()
      this.queue.clear()
      // Devolve o texto original a tudo que ainda está na página.
      for (const [node, entry] of this.entries) {
        if (node.isConnected && node.nodeValue === entry.translated) node.nodeValue = entry.source
      }
      this.entries.clear()
      for (const [element, source] of this.placeholders) element.setAttribute('placeholder', source)
      this.placeholders.clear()
      return
    }
    this.translate ??= await this.pickEngine()
    if (!this.translate || !this.enabled) return
    this.observer.observe(document.body, { childList: true, subtree: true, characterData: true })
    this.collect(document.body)
  }

  /** O tradutor do Chrome direto na página, quando disponível; senão, pelo processador da extensão. */
  private async pickEngine(): Promise<Translate | null> {
    try {
      if (this.remoteOnly) throw new Error('remoto')
      const status = await translatorStatus()
      if (status === 'available') {
        const translator = await createTranslator()
        return async (texts) => {
          const out: string[] = []
          for (const text of texts) out.push(await translator.translate(text))
          return out
        }
      }
      if (status === 'downloadable' || status === 'downloading') {
        this.problem = 'pacote de tradução ainda não baixado (ligue a tradução da aula uma vez pelo popup)'
        return null
      }
    } catch {
      // segue para o caminho alternativo
    }
    return async (texts) => {
      const reply = await send<string[] | null>({ type: 'TRANSLATE_TEXT', texts })
      if (!reply) throw new Error('o processador da extensão não respondeu')
      return reply
    }
  }

  private onMutations(mutations: MutationRecord[]): void {
    for (const mutation of mutations) {
      if (mutation.type === 'characterData') this.consider(mutation.target as Text)
      else for (const node of mutation.addedNodes) this.collect(node)
    }
  }

  private collect(root: Node): void {
    if (root.nodeType === Node.TEXT_NODE) {
      this.consider(root as Text)
      return
    }
    if (root.nodeType !== Node.ELEMENT_NODE || !this.isTranslatable(root as Element)) return
    void this.translatePlaceholders(root as Element)
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) this.consider(node as Text)
  }

  private async translatePlaceholders(root: Element): Promise<void> {
    const fields = [...root.querySelectorAll('[placeholder]')]
    if (root.hasAttribute('placeholder')) fields.push(root)
    for (const field of fields) {
      const source = field.getAttribute('placeholder') ?? ''
      if (this.placeholders.has(field) || !HAS_WORD.test(source) || !this.translate) continue
      this.placeholders.set(field, source)
      try {
        const translated = this.cache.get(source) ?? (await this.translate([source]))[0]
        if (!translated || !this.enabled) continue
        this.cache.set(source, translated)
        if (field.getAttribute('placeholder') === source) field.setAttribute('placeholder', translated)
      } catch (err) {
        this.problem = err instanceof Error ? err.message : String(err)
      }
    }
  }

  private isTranslatable(element: Element | null): boolean {
    for (let el = element; el; el = el.parentElement) {
      if (SKIPPED_TAGS.has(el.tagName.toUpperCase())) return false
      if (el.getAttribute('translate') === 'no' || el.classList.contains('notranslate')) return false
      if ((el as HTMLElement).isContentEditable || this.isOurs(el)) return false
    }
    return true
  }

  private consider(node: Text): void {
    const value = node.nodeValue ?? ''
    const entry = this.entries.get(node)
    // Alteração feita por nós mesmos: nada a fazer.
    if (entry && value === entry.translated) return
    if (!HAS_WORD.test(value) || IDENTIFIER.test(value.trim()) || !this.isTranslatable(node.parentElement)) {
      this.entries.delete(node)
      return
    }
    this.entries.set(node, { source: value, translated: null })
    const cached = this.cache.get(value.trim())
    if (cached !== undefined) this.apply(node, cached)
    else {
      this.queue.add(node)
      void this.work()
    }
  }

  private apply(node: Text, translated: string): void {
    const entry = this.entries.get(node)
    if (!entry || !node.isConnected || node.nodeValue !== entry.source) return
    // Preserva os espaços das pontas, que separam este texto dos vizinhos.
    const lead = entry.source.match(/^\s*/)?.[0] ?? ''
    const trail = entry.source.match(/\s*$/)?.[0] ?? ''
    entry.translated = lead + translated + trail
    node.nodeValue = entry.translated
  }

  /** O que está visível na tela é traduzido primeiro. */
  private takeBatch(): Text[] {
    const visible: Text[] = []
    const rest: Text[] = []
    for (const node of this.queue) {
      if (!node.isConnected) {
        this.queue.delete(node)
        this.entries.delete(node)
        continue
      }
      const rect = node.parentElement?.getBoundingClientRect()
      const onScreen = rect && rect.bottom > 0 && rect.top < innerHeight && rect.width > 0
      ;(onScreen ? visible : rest).push(node)
      if (visible.length >= BATCH_SIZE) break
    }
    const batch = [...visible, ...rest].slice(0, BATCH_SIZE)
    for (const node of batch) this.queue.delete(node)
    return batch
  }

  private async work(): Promise<void> {
    if (this.working || !this.translate) return
    this.working = true
    try {
      for (let batch = this.takeBatch(); batch.length > 0 && this.enabled; batch = this.takeBatch()) {
        const sources = [...new Set(batch.map((node) => this.entries.get(node)?.source.trim() ?? ''))].filter(Boolean)
        const masked = sources.map((text) => protect(text, this.glossary()))
        try {
          const translated = await this.translate(masked.map((m) => m.text))
          sources.forEach((source, i) => this.cache.set(source, masked[i]!.restore(translated[i] ?? source)))
          this.problem = ''
        } catch (err) {
          // Falha passageira (ex.: a extensão ainda está iniciando): os textos voltam para a fila e
          // a tradução é retomada em seguida, com intervalo crescente.
          this.problem = err instanceof Error ? err.message : String(err)
          for (const node of batch) this.queue.add(node)
          this.failures++
          setTimeout(() => void this.work(), Math.min(RETRY_MAX_MS, RETRY_BASE_MS * this.failures))
          return
        }
        this.failures = 0
        for (const node of batch) {
          const cached = this.cache.get(this.entries.get(node)?.source.trim() ?? '')
          if (cached !== undefined) this.apply(node, cached)
        }
      }
    } finally {
      this.working = false
    }
  }
}
