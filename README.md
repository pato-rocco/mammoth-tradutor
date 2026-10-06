# Mammoth Tradutor

Extensão para o Google Chrome que traduz, de inglês para português brasileiro, as
videoaulas do [Mammoth Club](https://mammothclub.com): legendas sincronizadas, dublagem
com voz neural e tradução do texto da página.

Tudo roda no próprio computador, sem custo e sem chaves de API. O áudio das aulas, as
transcrições e as traduções não são enviados a nenhum serviço.

## O que faz

- **Legendas** em português sobre o vídeo, sincronizadas com a fala.
- **Dublagem** com voz neural em português, reduzindo o volume do áudio original
  enquanto fala. Dez timbres à escolha.
- **Tradução da página**: menus, títulos e o material escrito da aula.
- **Preparação antes de tocar**: o vídeo espera até boa parte da aula estar traduzida,
  para legenda e voz saírem junto com a fala.
- **Início automático** ao abrir uma aula e continuidade ao passar para a próxima.
- **Cópia da tradução**: o texto traduzido das duas últimas aulas fica guardado e pode
  ser copiado pelo popup.

## Requisitos

- Google Chrome **138 ou superior**, no computador (Windows, macOS ou Linux).
- [Node.js](https://nodejs.org) 20.19 ou superior, para compilar (testado no 22).
- Conta no Mammoth Club com acesso às aulas.
- Espaço e banda para os modelos, baixados uma única vez no primeiro uso — até cerca
  de **550 MB** no total:
  - pacote de tradução inglês → português do Chrome;
  - modelo de transcrição Whisper (de 70 a 270 MB, conforme o computador);
  - modelo de voz Supertonic 2 (cerca de 260 MB), só se a dublagem estiver ligada.

## Instalação

Há um [tutorial passo a passo](docs/TUTORIAL.md), com primeiro uso e solução de
problemas. Em resumo:

```bash
npm install
npm run build
```

Depois, no Chrome:

1. Abra `chrome://extensions`.
2. Ative o **Modo do desenvolvedor**.
3. Clique em **Carregar sem compactação** e selecione a pasta `dist`.

Após alterar o código, rode `npm run build` de novo, clique no botão de recarregar da
extensão em `chrome://extensions` e recarregue a página da aula.

## Uso

1. Abra uma aula no Mammoth Club. A tradução liga sozinha.
2. **Na primeira vez**, clique no ícone da extensão e ligue "Traduzir esta aula" com o
   popup aberto: o Chrome só baixa o pacote de tradução a partir de um clique.
3. O vídeo é pausado e mostra "Preparando a tradução: X%". Ao atingir a meta, ele
   começa do início, já com legenda e dublagem. Para assistir sem esperar, aperte play
   duas vezes.

O popup tem os controles do dia a dia (legendas, dublagem, preparação, início
automático, tradução da página) e os botões para copiar a tradução das últimas aulas.
Em **Mais opções…** ficam a aparência da legenda, a escolha da voz, ritmo e volumes, a
qualidade da transcrição e o **glossário** — termos que não devem ser traduzidos, como
nomes de produtos e tecnologias.

## Limitações

- **Só funciona no Mammoth Club** e só traduz de inglês para português.
- **Transcrição e tradução são automáticas**: nomes e termos técnicos podem sair
  errados. O glossário ajuda com os termos que você conhece.
- **Português genérico**: o tradutor do Chrome não distingue a variante brasileira.
- **Dublagem em trechos rápidos**: a voz pode ficar alguns segundos atrás da fala
  original; se o atraso passar de 6 segundos, uma fala é pulada para ressincronizar.
- **Vídeo acelerado**: a dublagem acelera junto e muda de tom.
- **Código e imagens** não são traduzidos: blocos de código ficam em inglês de
  propósito, e texto que faz parte de imagem não é alcançado.
- **Modo reserva**: se o arquivo da aula não puder ser lido diretamente, a extensão
  captura o som da aba em tempo real, com alguns segundos de atraso. Esse modo exige
  ligar pelo ícone da extensão e não foi testado de novo desde a última reescrita.

## Como funciona

```
arquivo MP4 da aula ──► áudio ──► trechos de fala ──► Whisper ──► tradutor do Chrome
   (lido à frente)   (WebCodecs)      (VAD)        (transcrição)        │
                                                                        ├──► legendas no tempo do vídeo
                                                                        └──► voz Supertonic ──► dublagem
```

A extensão lê o arquivo da aula mais rápido do que ele toca, então a tradução fica
pronta antes da fala. Cada frase vira uma legenda com início e fim no tempo do vídeo;
a página mostra a legenda correspondente ao instante atual, o que faz pausa, avanço e
retrocesso funcionarem naturalmente. As frases são agrupadas em falas maiores para a
dublagem, com velocidade ajustada aos poucos para acompanhar a aula.

São quatro partes, no padrão Manifest V3:

| Parte | Pasta | Papel |
|---|---|---|
| Service worker | `src/background` | Estado da sessão e repasse de mensagens |
| Documento offscreen | `src/offscreen` | Leitura do áudio, transcrição, tradução e voz |
| Scripts da página | `src/content` | Legendas, controle do vídeo e tradução do texto |
| Interface | `src/ui` | Popup e página de opções |

A lógica sem dependência do navegador (segmentação da fala, legendas, planejamento da
dublagem, glossário) fica em `src/core` e tem testes unitários.

## Desenvolvimento

| Comando | O que faz |
|---|---|
| `npm run build` | Verifica os tipos e gera a extensão completa em `dist/` |
| `npm test` | Roda os testes unitários |
| `npm run dev` | Recompila ao salvar — **sem** o script dos quadros internos (`frame.js`), que só o `build` gera |

O projeto segue **spec-driven development**: requisitos, design e tarefas ficam em
[`specs/traducao-simultanea/`](specs/traducao-simultanea/) e são atualizados antes do
código. O fluxo está descrito em [`CLAUDE.md`](CLAUDE.md).

Quando algo não funcionar, ative "Mostrar diagnóstico técnico no popup" na página de
opções: o rodapé do popup passa a mostrar o modo em uso, quantos trechos foram
transcritos e traduzidos, a etapa atual e o último problema registrado.
