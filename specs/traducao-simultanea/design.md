# Design — Tradução simultânea de videoaulas

**Status:** rascunho, aguardando aprovação (depende da aprovação de `requirements.md`)
**Última revisão:** 2026-10-06

## 0. Revisão 2 (2026-10-06) — leitura à frente e voz neural

Decisões do usuário após o primeiro teste em aula real (legendas funcionando, mas com
atraso e voz robotizada): adotar a **leitura à frente** (antigo ponto A3) e uma **voz
neural local**. Esta seção prevalece sobre as seguintes onde houver conflito.

**Fonte do áudio.** O offscreen baixa o próprio arquivo MP4 da aula (`lesson-audio.ts`):
`fetch` em fluxo → `mp4box` separa a faixa de áudio → `AudioDecoder` (WebCodecs) →
mono 16 kHz → mesmo VAD. Como o download é bem mais rápido que a reprodução, os
trechos ficam prontos antes de tocar. A leitura para ao chegar 5 min à frente do ponto
do vídeo, para não disputar banda com o player. Nada é gravado em disco.

**Sem captura da aba nesse modo.** O som da aula toca normalmente no player; não há
mais reprodução do áudio original pelo offscreen. A captura por `tabCapture` (§2.2)
permanece só como **reserva**, usada se o arquivo não puder ser lido em 2 s (índice no
final do arquivo, formato não suportado, vídeo ainda não carregado).

**Trechos longos (ajuste após o segundo teste).** Com trechos curtos, a transcrição
ficava para trás e apareciam lacunas crescentes: o Whisper custa quase o mesmo para 2 s
ou 25 s de áudio. No modo à frente o VAD agora agrupa a fala em trechos de até 24 s
(pausa de 0,9 s para fechar) e o Whisper devolve frases com marcação de tempo; cada
frase vira uma legenda. No modo de reserva os trechos seguem curtos. Uma fala dublada
em andamento não é mais cortada pela seguinte.

**Pré-carregamento antes de tocar (R6.6).** O offscreen informa à página, a cada
trecho traduzido, até onde a aula está pronta e a duração total (mensagem `PROGRESS`).
A página segura o vídeo (pausa) enquanto o traduzido à frente for menor que
`prebufferPercent` (padrão 50) do restante da aula, e o retoma ao atingir a meta; dois
plays em 2,5 s liberam na hora. Vale só no modo à frente. A leitura do arquivo deixou
de ser limitada pela posição do vídeo: pode ficar até 10 min à frente do que já foi
transcrito.

**Legendas pelo tempo do vídeo.** Cada trecho vira uma legenda (`Cue`) com início e fim
no tempo do vídeo. A página guarda as legendas da aula e, a cada 100 ms, mostra a que
corresponde a `video.currentTime` (`core/cues.ts`). Pausa, avanço e retrocesso passam a
funcionar por construção. A página informa posição/pausa/aula ao offscreen a cada
500 ms (mensagem `VIDEO`); a transcrição prioriza o que ainda vai tocar. No modo de
reserva, a legenda recebe como início o instante em que chega.

**Dublagem.** Voz neural **Supertonic 2** (`onnx-community/Supertonic-TTS-2-ONNX`,
português, ~260 MB, WASM) em um Web Worker próprio. A fala de cada legenda é
sintetizada até 60 s à frente, com velocidade calculada para caber até a legenda
seguinte, e fica guardada no offscreen. A página pede a reprodução (`PLAY_DUB`) quando
a legenda entra e reduz `video.volume` enquanto a fala toca. O `chrome.tts` e a
permissão `tts` foram removidos; a fila com política de atraso (antigo §4) deixou de
existir, pois a fala já nasce sincronizada.

**Dublagem contínua (ajuste após o terceiro teste).** Sintetizar legenda por legenda,
cada uma com sua velocidade, soava picotado e com acelerações bruscas. Agora
(`core/cues.ts`): (1) as legendas de um trecho são agrupadas em **falas** — períodos de
até 10 s / 220 caracteres, fechados em fim de frase ou pausa de 0,8 s — e cada fala é
sintetizada de uma vez; (2) um **plano encadeado** define, para cada fala, o instante de
início (nunca antes de a anterior terminar) e a velocidade, que varia no máximo 0,05
entre falas vizinhas, dentro de 1,0–1,35; a duração real de cada fala calibra a
estimativa das seguintes; (3) a fala toca na velocidade em que foi sintetizada, sem
aceleração na reprodução (que alterava o tom); (4) uma fala que ficaria mais de 6 s
atrasada é pulada para ressincronizar; (5) o volume original desce e sobe em rampa e
permanece reduzido entre falas separadas por menos de 1,5 s.

**Manifesto.** Sai `tts`; entram `scripting` (injetar o script de legendas em páginas
abertas antes da extensão) e o host `https://*.supabase.co/*` (arquivos das aulas).

**Limitações conhecidas.** (1) Com o vídeo acelerado, a dublagem acelera junto e muda
de tom. (2) A voz tem cinco timbres femininos e cinco masculinos (`F1`–`M5`); o seletor
na interface fica para a T25. (3) O desempenho da voz neural no processador desta
máquina ainda não foi medido — o popup mostra o tempo por frase.

## 1. Resumo da solução

Um pipeline 100% local, em quatro estágios, rodando dentro do Chrome:

```
áudio da aba ──► segmentação (VAD) ──► transcrição (Whisper) ──► tradução (Translator API)
                                                                      │
                                              ┌───────────────────────┴──────────────┐
                                              ▼                                      ▼
                                   legenda sobre o vídeo                    dublagem (chrome.tts)
```

| Estágio | Tecnologia | Por quê |
|---|---|---|
| Captura | `chrome.tabCapture` | Funciona com qualquer player, inclusive iframe de terceiros (R9.2) |
| Transcrição | Whisper via Transformers.js (ONNX, WebGPU → fallback WASM) | Gratuito, local, robusto a ruído/música (R2.2, R2.3) |
| Tradução | Translator API embutida do Chrome (`en` → `pt`) | Gratuita, local, sem chave (R3.2) |
| Voz | `chrome.tts` com voz `pt-BR` | Gratuita; toca fora da aba, então não é recapturada (R5.7) |

## 2. Arquitetura

Extensão Manifest V3 com quatro contextos:

```
┌────────────┐  comandos   ┌──────────────────┐  streamId   ┌───────────────────────────┐
│   Popup    │────────────►│  Service Worker  │────────────►│   Documento offscreen     │
│ (controles)│◄────────────│  (orquestrador)  │◄────────────│  captura · VAD · tradução │
└────────────┘   estado    │  sessão · TTS    │  segmentos  │  ┌─────────────────────┐  │
                           └────────┬─────────┘             │  │ Web Worker: Whisper │  │
                    legendas/estado │ ▲ eventos do vídeo    │  └─────────────────────┘  │
                                    ▼ │                     └───────────────────────────┘
                           ┌──────────────────┐
                           │  Content script  │
                           │ overlay · <video>│
                           └──────────────────┘
```

### 2.1 Service worker (`background/`)

Orquestrador e único dono do estado da sessão.

- Mantém a máquina de estados da sessão: `idle → starting → active → stopping → idle`
  (e `error`). Há **uma única sessão por vez**, associada a uma aba (só existe um
  documento offscreen); ligar em outra aba encerra a anterior. Estado em
  `chrome.storage.session`, pois o worker pode ser suspenso.
- Ao ligar: obtém `streamId` com `chrome.tabCapture.getMediaStreamId({ targetTabId })`,
  cria o documento offscreen (se não existir) e envia `START`.
- Roteia mensagens entre offscreen e content script.
- Controla a dublagem (`chrome.tts` só existe aqui, não no offscreen) — ver §4.
- Encerra a sessão em `tabs.onRemoved` e em navegação para fora do site (R1.5).
- Atualiza o badge do ícone (R1.2).

### 2.2 Documento offscreen (`offscreen/`)

Único contexto que pode manter um `MediaStream` vivo e usar WebGPU em MV3.
Motivos declarados: `USER_MEDIA`, `AUDIO_PLAYBACK`.

- **Captura:** `getUserMedia({ audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId } } })`.
- **Reprodução do original:** capturar a aba silencia o áudio dela; por isso o stream é
  religado a `AudioContext.destination` através de um `GainNode`. Esse mesmo nó
  implementa a redução de volume durante a dublagem (R5.2, R9.4).
- **Pré-processamento:** um segundo `AudioContext` a 16 kHz recebe o mesmo stream (o
  navegador reamostra, sem afetar a qualidade do que o usuário ouve) e um
  `AudioWorklet` entrega blocos mono `Float32Array` de ~100 ms.
- **Segmentação (VAD):** detector por energia com histerese — abre o trecho ao
  detectar fala, fecha após ~500 ms de silêncio ou ao atingir 8 s (corte forçado no
  ponto de menor energia). Trechos menores que 400 ms são descartados (R2.3, R2.5).
- **Transcrição:** envia cada trecho a um Web Worker dedicado (§3).
- **Tradução:** aplica glossário → Translator API → restaura glossário (§3.2).
- Emite `SEGMENT` para o service worker.

### 2.3 Content script (`content/`)

Injetado em todo `mammothclub.com` (o site é uma SPA: o usuário pode chegar à aula
sem recarregar a página), apenas no documento principal. Fica inerte até a sessão
ser ativada naquela aba.

- Localiza o `<video>` principal (maior área visível); observa o DOM com
  `MutationObserver` para trocas de aula em SPA (R1.6).
- Renderiza o overlay em **Shadow DOM** (isola o CSS do site), posicionado sobre o
  retângulo do vídeo; em tela cheia, reanexa o overlay a `document.fullscreenElement`
  (R4.4).
- Repassa eventos `play`, `pause`, `seeking`, `ratechange` ao service worker
  (R2.4, R4.8, R5.4).
- Aplica a lógica de exibição das legendas (§5).

**Resultado da inspeção do site (T1, 2026-10-06, aula em `/course-learn/<curso>/<aula>`):**

- O vídeo é um `<video>` nativo no documento principal — **não há iframe de player**
  (o único iframe da página é um preview de código do próprio site). Logo,
  `all_frames` não é necessário.
- Player próprio do site (`controls` desligado, botões customizados, atalho `f` para
  tela cheia). O `<video>` fica dentro de um `div` com `aspect-video` e `tabindex="0"`,
  que é a âncora natural do overlay.
- Fonte: arquivo **MP4 direto** do Supabase Storage (`*.supabase.co`), com
  `crossorigin="anonymous"`. Sem MSE, sem DRM, sem faixas de legenda (`textTracks` vazio).
- O site é uma SPA (bundle Vite em `/build/assets/`), com botões "vídeo anterior /
  próximo": a troca de aula ocorre sem recarregar a página.
- Há um seletor de idioma "English / French" que é da interface do site, não do áudio.

A captura de áudio ocorre no nível da aba e independe desses detalhes.

### 2.4 Popup e página de opções (`ui/`)

- **Popup:** liga/desliga, alternadores de legenda e dublagem, estado atual, erros.
- **Opções:** aparência da legenda, voz/velocidade/volume, glossário, nível de
  qualidade, e o **assistente de primeiro uso** (R6.1, R6.2).

O assistente existe como página própria porque o download do modelo de tradução exige
um gesto do usuário (clique), o que o documento offscreen não tem.

## 3. Modelos locais

### 3.1 Transcrição — Whisper

| Nível | Modelo | Uso |
|---|---|---|
| Rápido (padrão) | `whisper-base.en` quantizado | Menor atraso; exige menos da máquina |
| Preciso | `whisper-small.en` quantizado | Melhor com sotaque/jargão; pede GPU razoável |

- Runtime: Transformers.js 4. O worker carrega o modelo em WebGPU, mede o tempo de um
  trecho curto e, se passar de 2,5 s, carrega também em WASM e fica com o mais rápido.
  O tempo medido é mostrado ao usuário sobre o vídeo.
- **Medição parcial (T2, 2026-10-06):** em uma aba oculta de teste, o WebGPU carregou
  na Iris Xe e transcreveu corretamente, mas levou ~60 s para 5 s de áudio. A aba
  estava congelada pelo Chrome por estar em segundo plano, então o número não é
  confiável — mas motivou a seleção automática acima. A medição que vale é a feita
  dentro da extensão. WASM com múltiplas threads exigiria isolamento de origem
  (COOP/COEP) no manifesto; não foi habilitado por não ter sido possível validar que
  o download dos pesos continua funcionando nessa condição.
- Não há *prompt* de contexto entre trechos nem `no_speech_prob`: a API de pipeline
  do Transformers.js não os expõe. O filtro anti-alucinação é textual (`core/transcript`).
- O runtime ONNX (`.wasm`/`.mjs`) é **empacotado na extensão**; apenas os pesos do
  modelo (dados, não código) são baixados do Hugging Face no primeiro uso e guardados
  no Cache Storage (R8.4, R6.5).
- Um trecho por vez; se a fila passar de 4 trechos, a máquina não está acompanhando —
  os mais antigos são descartados e um aviso aparece sobre o vídeo.
- O download do pacote de tradução é disparado pelo popup, no clique de ligar (exige
  gesto do usuário); o do Whisper ocorre no offscreen, com progresso sobre o vídeo.

**Alternativa a avaliar na T2:** Web Speech API em modo local (`processLocally`)
alimentada pela faixa de áudio da aba. Daria resultados parciais e menor atraso, mas
a disponibilidade e a qualidade precisam ser medidas. Se for claramente melhor, o
design é revisado antes da implementação — a interface `Transcriber` (§6) isola essa troca.

### 3.2 Tradução — Translator API

- `Translator.create({ sourceLanguage: 'en', targetLanguage: 'pt' })`, instância única
  reutilizada na sessão.
- **Glossário (R3.3):** antes de traduzir, cada termo do glossário é trocado por um
  marcador neutro (`⟦0⟧`, `⟦1⟧`…); depois, os marcadores são restaurados.
- **Risco:** a API expõe `pt` genérico, não `pt-BR`. Mitigação: tabela de
  pós-substituição PT-PT → PT-BR para os casos recorrentes, validada na T2.
- Falha → emite o trecho com `translated: false` (R3.4).

## 4. Dublagem

Implementada no service worker com `chrome.tts`.

- Fila FIFO de trechos traduzidos.
- **Ducking:** em `start` do TTS envia `DUCK(nível)` ao offscreen; em `end` da fila
  vazia envia `DUCK(1.0)`. Transição de ganho em rampa de 150 ms para não estalar.
- **Controle de atraso (R5.3):** `atraso = agora − fim do trecho mais antigo na fila`.
  - atraso > 3 s → velocidade = base × 1,25
  - atraso > 6 s → velocidade = base × 1,5
  - atraso > 10 s → descarta os mais antigos até voltar a < 6 s
- `pause`/`seeking` → `chrome.tts.stop()` + esvazia a fila + restaura o ganho (R5.4).
- Vozes: `chrome.tts.getVoices()` filtrado por `lang` iniciando em `pt-BR`; sem
  nenhuma → dublagem desabilitada com aviso (R5.6).

## 5. Exibição das legendas

- Quebra o texto em blocos de até 2 linhas × ~42 caracteres, respeitando pontuação e
  sem separar artigo/preposição da palavra seguinte (R4.2).
- Duração de cada bloco: `max(1,5 s, caracteres ÷ 17 por segundo)`, com teto de 7 s;
  se houver bloco novo esperando, o atual é encurtado até o mínimo (R4.3).
- Some após 2 s sem bloco novo; ao pausar, o temporizador congela (R4.7).
- Modo bilíngue: linha em inglês menor e mais clara acima da tradução (R4.5).
- Aparência por variáveis CSS alimentadas pelas preferências (R4.6).

## 6. Contratos

### 6.1 Mensagens (`shared/messages.ts`)

| Mensagem | De → Para | Conteúdo |
|---|---|---|
| `TOGGLE` | popup → SW | `{ tabId, on }` |
| `START` | SW → offscreen | `{ streamId, settings }` |
| `STOP` | SW → offscreen | — |
| `SEGMENT` | offscreen → SW → content | `{ id, tStart, tEnd, sourceText, text, translated }` |
| `DUCK` | SW → offscreen | `{ gain }` |
| `VIDEO_EVENT` | content → SW → offscreen | `{ type: 'play'｜'pause'｜'seeking'｜'ratechange', rate? }` |
| `STATE` | SW → popup, content | `{ status, error?, backlog }` |
| `SETTINGS_CHANGED` | opções → todos | `{ settings }` |

### 6.2 Interfaces trocáveis

```ts
interface Transcriber { load(onProgress): Promise<void>; transcribe(pcm: Float32Array, prompt?: string): Promise<{ text: string; noSpeechProb: number }>; dispose(): void }
interface TranslatorEngine { load(onProgress): Promise<void>; translate(text: string): Promise<string> }
interface Speaker { speak(text: string, rate: number): Promise<void>; stop(): void; voices(): Promise<Voice[]> }
```

### 6.3 Preferências (`chrome.storage.sync`)

```ts
interface Settings {
  captions: { enabled: boolean; bilingual: boolean; fontSize: number; bgOpacity: number; bottomOffset: number }
  dubbing:  { enabled: boolean; voiceName: string | null; rate: number; volume: number; duckLevel: number }
  quality:  'fast' | 'accurate'
  glossary: string[]
}
```

## 7. Manifesto

- `manifest_version: 3`, `minimum_chrome_version: "138"` (primeira versão com a
  Translator API estável; confirmar na T2).
- `permissions`: `tabCapture`, `offscreen`, `storage`, `tts`, `activeTab`.
- `host_permissions`: somente `mammothclub.com` e subdomínios; na T11 entra
  `https://huggingface.co/*` para baixar os pesos (R8.2). Se a T1 mostrar que o
  player fica em iframe de outro domínio, ele é acrescentado aqui.
- `content_security_policy.extension_pages`: `script-src 'self' 'wasm-unsafe-eval'`.

## 8. Estrutura do projeto

```
src/
  background/   service worker: sessão, roteamento, dublagem
  offscreen/    captura, AudioWorklet, VAD, tradução, worker do Whisper
  content/      overlay de legendas, observador do <video>
  ui/           popup, opções, assistente de primeiro uso
  shared/       mensagens, tipos, preferências
  core/         lógica pura e testável: vad, captionLayout, dubQueue, glossary
tests/          testes unitários de core/
specs/          este diretório
```

Ferramentas: TypeScript, Vite (build multi-entrada), Vitest. `npm run build` gera
`dist/`, carregável em `chrome://extensions` (R10.2).

## 9. Tratamento de erros

| Falha | Reação |
|---|---|
| Captura negada/indisponível | Estado `error` com instrução; nada é alterado no áudio |
| Offscreen/worker cai | Recria uma vez e retoma; segunda queda encerra a sessão (R9.3) |
| WebGPU indisponível | Fallback WASM + aviso de desempenho |
| Modelos não baixados | Popup direciona ao assistente de primeiro uso |
| Translator API ausente | Assistente informa a versão mínima do Chrome (R6.2) |
| Máquina não acompanha | Aviso de atraso + sugestão do nível rápido |

Em qualquer encerramento, o ganho do áudio original volta a 1,0 antes de liberar o stream.

## 10. Riscos e limitações

1. **Atraso inerente (R7.1):** fim da frase + transcrição + tradução. Em máquina sem
   GPU adequada o atraso pode passar de 4 s. A dublagem acrescenta o tempo de fala.
2. **Qualidade da tradução:** o tradutor local é inferior a serviços pagos e traduz
   trecho a trecho, sem contexto amplo. O glossário atenua para jargão.
3. **Variante do português** (§3.2).
4. **Download inicial:** dezenas a algumas centenas de MB, conforme o nível escolhido.
5. **Player desconhecido (A1):** afeta apenas o posicionamento do overlay, não a captura.
6. **Vídeo em velocidade > 1×:** aumenta proporcionalmente a carga; acima de 1,5× a
   dublagem tende a descartar trechos.

## 11. Alternativa em avaliação — transcrição antecipada

A T1 mostrou que a aula é um MP4 simples e legível entre origens (CORS liberado). Isso
permite uma variante em que a extensão **ouve a aula à frente da reprodução** (um
segundo elemento de mídia oculto, tocando adiantado, alimenta a transcrição). Com isso
as legendas sairiam **sincronizadas com a fala, sem atraso**, e a dublagem começaria
junto com a frase original — o que compensa a GPU modesta da máquina-alvo (§12).

Custos: o dobro de tráfego de vídeo, lógica extra para avanço/retrocesso e acoplamento
ao fato de o site servir MP4 direto. **Não adotada sem decisão do usuário**; a
arquitetura atual (captura da aba em tempo real) continua sendo a base, e as etapas de
transcrição, tradução, legenda e dublagem seriam as mesmas nas duas variantes.

## 12. Máquina-alvo

Verificada em 2026-10-06: Intel Core i5-1334U, GPU integrada Intel Iris Xe, 20 GB de
RAM, Chrome 154. Atende à versão mínima. Por ser GPU integrada, o nível "rápido"
(`whisper-base.en`) é o candidato realista; o "preciso" deve ficar acima do atraso da
R7.1. Os números reais saem da T2.

## 13. Estratégia de testes

- **Unitários (Vitest):** `core/` — VAD com sinais sintéticos, quebra de legendas,
  política de atraso da dublagem, glossário (R10.1).
- **Integração manual:** roteiro em `specs/traducao-simultanea/test-plan.md`, um caso
  por critério de aceitação, executado em uma aula real.
- **Medição de atraso:** modo de depuração que registra os tempos de cada estágio por
  trecho, para verificar a R7.1.
