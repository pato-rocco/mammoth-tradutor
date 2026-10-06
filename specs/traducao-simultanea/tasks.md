# Tarefas — Tradução simultânea de videoaulas

**Status:** rascunho, aguardando aprovação (depende de `requirements.md` e `design.md`)
**Última revisão:** 2026-10-06

Executar em ordem. Cada tarefa termina com o projeto compilando e os testes passando.
Entre parênteses, os requisitos atendidos.

## Fase 0 — Descoberta (antes de escrever código de produto)

- [x] **T1. Inspecionar o site.** Com o usuário logado, identificar domínio(s), player
  de vídeo, se o `<video>` está em iframe e como o site troca de aula (SPA ou
  recarga). Registrar o resultado no design §2.3/§7 e fechar o ponto A1. (R9.2, R8.2)
- [x] **T2. Prova de conceito dos modelos.** Página isolada que mede, na máquina do
  usuário: (a) Whisper base/small em WebGPU e WASM — tempo por trecho de 5 s;
  (b) Translator API `en→pt` — disponibilidade, qualidade e variante do português;
  (c) Web Speech API local como alternativa; (d) vozes pt-BR do `chrome.tts`.
  Registrar números no design §3 e revisar decisões se necessário. Fecha A2. (R7.1, R6.2)

## Fase 1 — Esqueleto

- [x] **T3.** Projeto TypeScript + Vite + Vitest, build multi-entrada gerando `dist/`
  carregável; manifesto MV3 com permissões do design §7. (R9.1, R10.2, R8.2)
- [x] **T4.** `shared/`: tipos de mensagens, `Settings` com valores padrão e
  leitura/gravação em `chrome.storage.sync`. (R6.3)
- [x] **T5.** Service worker: máquina de estados da sessão por aba, persistida em
  `storage.session`; badge do ícone. (R1.2, R1.5)
- [x] **T6.** Popup mínimo: liga/desliga, estado, desabilitado fora do site. (R1.1, R1.4)

## Fase 2 — Captura de áudio

> T7 e T10 estão implementadas; ficam em aberto até a verificação manual no Chrome
> (carregar `dist/`, ligar em uma aula e conferir som, badge e encerramento).

- [x] **T7.** Offscreen: receber `streamId`, abrir o stream da aba e religar o áudio
  original à saída através de `GainNode`. Verificar que o som da aula não muda. (R9.4)
- [x] **T8.** `AudioWorklet` de conversão para mono 16 kHz. (R2.1)
- [x] **T9.** `core/vad`: segmentação por energia com histerese, corte forçado e
  descarte de trechos curtos — com testes unitários. (R2.3, R2.5, R10.1)
- [ ] **T10.** Encerramento limpo: `STOP`, fechamento de aba, navegação para fora;
  ganho restaurado e stream liberado. (R1.3, R1.5, R7.3)

> **Estado em 2026-10-06:** T11–T18 e T20–T23 estão implementadas e com testes unitários onde cabem,
> mas permanecem em aberto até a validação em uma aula real (T19). T2 foi parcial: ver design §3.1.

## Fase 3 — Transcrição

- [x] **T11.** Web Worker com Transformers.js + Whisper atrás da interface
  `Transcriber`; runtime ONNX empacotado, pesos em cache. (R2.1, R2.2, R8.4)
- [x] **T12.** Seleção WebGPU/WASM, níveis "rápido"/"preciso", filtro anti-alucinação
  e *prompt* de contexto entre trechos. (R2.3, R6.4)
- [ ] **T13.** Fila de trechos com medição de atraso e aviso de sobrecarga. (R7.1, R7.2)

## Fase 4 — Tradução e legendas (primeira versão utilizável)

- [x] **T14.** `TranslatorEngine` sobre a Translator API; fallback para o original
  em caso de falha. (R3.1, R3.2, R3.4)
- [x] **T15.** `core/glossary`: proteção e restauração de termos, pós-substituição
  PT-BR — com testes. (R3.3, R10.1)
- [x] **T16.** Content script: localizar o `<video>`, overlay em Shadow DOM, tela
  cheia, reação a trocas de aula. (R4.1, R4.4, R1.6, R9.2)
- [x] **T17.** `core/captionLayout`: quebra em 2 linhas e cálculo de duração — com
  testes; integração no overlay, incluindo modo bilíngue. (R4.2, R4.3, R4.5, R10.1)
- [x] **T18.** Eventos do vídeo: pausa suspende a transcrição e congela a legenda;
  avanço/retrocesso limpa pendências. (R2.4, R4.7, R4.8)
- [x] **T19.** **Marco:** validar legendas de ponta a ponta em uma aula real e medir
  o atraso. Parar para revisão do usuário. (R7.1)

## Fase 5 — Dublagem

- [ ] **T20.** `Speaker` sobre `chrome.tts`: listagem de vozes pt-BR e desabilitação
  quando não houver. (R5.1, R5.6)
- [x] **T21.** `core/dubQueue`: fila com política de aceleração e descarte — com
  testes. (R5.3, R10.1)
- [ ] **T22.** Ducking do áudio original com rampa de ganho. (R5.2)
- [ ] **T23.** Interrupção em pausa/avanço/retrocesso; verificar que a voz dublada
  não entra na transcrição. (R5.4, R5.7)

## Fase 6 — Configuração e acabamento

- [ ] **T24.** Assistente de primeiro uso: checagem de requisitos e download dos
  modelos com progresso. (R6.1, R6.2, R6.5)
- [x] **T25.** Página de opções: aparência da legenda, voz/velocidade/volume,
  glossário, qualidade; aplicação imediata na sessão ativa. (R4.6, R5.5, R6.3, R6.4)
- [ ] **T26.** Recuperação de falhas do offscreen/worker e mensagens de erro. (R9.3)
- [ ] **T27.** Escrever `test-plan.md` (um caso por critério de aceitação) e executá-lo
  em aula real; registrar resultados. (todos)
- [x] **T28.** README com instalação, uso e limitações conhecidas.

## Fase 7 — Revisão 2: leitura à frente e voz neural (design §0)

> Implementadas em 2026-10-06; em aberto até a validação em aula real.

- [x] **T29.** `lesson-audio`: ler o MP4 da aula em fluxo (mp4box + WebCodecs) e entregar áudio mono 16 kHz, com limite de 5 min à frente. (R4.9, R7.1)
- [x] **T30.** `core/resample` e `core/cues` (ordenação, legenda no instante, blocos, prioridade, velocidade da fala) — com testes. (R4.9, R5.3, R10.1)
- [x] **T31.** Página exibe legendas por `video.currentTime` e informa posição/pausa/troca de aula. (R4.7, R4.8, R4.9, R1.6)
- [x] **T32.** Voz neural Supertonic 2 em Web Worker; síntese até 60 s à frente; reprodução sincronizada com redução do volume original. (R5.1, R5.2, R5.3, R5.4)
- [ ] **T33.** Reserva em tempo real (`tabCapture`) quando o arquivo não puder ser lido. (R9.2, R9.3)
- [x] **T34.** Medir na máquina-alvo: tempo por frase da voz e sincronismo percebido. (R7.1)
- [x] **T35.** Pré-carregamento: segurar o vídeo até 50% do restante estar traduzido, com retomada automática e volta ao início. (R6.6)
- [x] **T36.** Dublagem contínua: falas agrupadas, plano encadeado de velocidade, volume em rampa. (R5.1, R5.3)
- [x] **T37.** Troca de aula sem intervenção e início automático ao abrir uma aula. (R1.6, R1.7)

> **Validado pelo usuário em aula real (2026-10-06):** legendas sincronizadas, dublagem neural contínua,
> pré-carregamento, troca de aula e início automático. Pendentes: T10, T13, T20, T22–T28 e T33
> (várias superadas pela Revisão 2; revisar ao retomar), além do seletor de voz e da página de opções.
- [x] **T38.** Tradução do texto da página, inclusive do material da aula em quadro isolado (script próprio, arquivo único) e dos textos de exemplo dos campos; novas tentativas em caso de falha. Validado pelo usuário. (R11)
- [x] **T39.** Página de opções com amostra de legenda e de voz; diagnóstico do popup oculto por padrão. Validada pelo usuário. (R6.7)
- [x] **T40.** Guardar a tradução das duas últimas aulas e copiar pelo popup. Validada pelo usuário. (R12)
