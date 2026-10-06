# Requisitos — Tradução simultânea de videoaulas

**Status:** rascunho, aguardando aprovação
**Última revisão:** 2026-10-06

## 1. Visão geral

Extensão para o Google Chrome que, enquanto o usuário assiste a uma videoaula em
inglês no site Mammoth Club, transcreve a fala, traduz para português brasileiro e
entrega a tradução como **legendas sobrepostas ao vídeo** e como **dublagem em voz
sintetizada**.

### Premissas confirmadas com o usuário

| Tema | Decisão |
|---|---|
| Saída | Legendas + dublagem, cada uma ligável/desligável |
| Fonte do texto | As aulas **não têm legendas**; é preciso transcrever o áudio |
| Custo | **Gratuito, tudo no navegador** — sem chaves de API nem serviços pagos |
| Idiomas | Inglês → português brasileiro (único par) |

### Fora de escopo (desta spec)

- Outros sites ou outros pares de idiomas.
- Serviços de nuvem pagos para transcrição, tradução ou voz.
- Clonagem da voz do instrutor ou sincronia labial.
- Download, gravação ou exportação do vídeo/áudio das aulas.
- Chrome para Android/iOS e outros navegadores.
- Tradução do texto da página (menus, descrições, materiais).

### Pontos em aberto

- ~~**A1.** Domínio e player de vídeo.~~ Resolvido na T1: `mammothclub.com`, `<video>`
  nativo com MP4 direto, sem iframe (detalhes no design §2.3).
- ~~**A2.** Configuração do computador.~~ Resolvido: i5-1334U, Intel Iris Xe, 20 GB
  (design §12).
- ~~**A3.** Transcrição antecipada.~~ Adotada pelo usuário em 2026-10-06, junto com
  voz neural local no lugar das vozes do sistema (design §0).

### Revisão 2 (2026-10-06)

Requisitos alterados pelas decisões acima:

- **R4.9 (novo).** ENQUANTO a aula puder ser lida à frente, O SISTEMA DEVE exibir cada
  legenda sincronizada com a fala original, inclusive após pausa, avanço ou retrocesso.
- **R5.1 (alterado).** A dublagem usa voz neural executada localmente, não as vozes do
  sistema; começa junto com a fala original correspondente.
- **R5.3 (substituído).** O SISTEMA DEVE ajustar a velocidade da fala em português para
  caber no tempo da fala original; não há mais fila com descarte por atraso.
- **R5.5 (alterado).** O usuário escolhe entre os timbres da voz neural.
- **R5.6 (removido).** Não depende mais de vozes instaladas no sistema.
- **R7.1 (alterado).** No modo de leitura à frente, a legenda DEVE aparecer junto com a
  fala (salvo nos primeiros segundos após ligar ou saltar no vídeo). O limite de 4 s
  vale apenas para o modo de reserva em tempo real.
- **R6.6 (novo, pedido do usuário).** ONDE o pré-carregamento estiver ligado (padrão),
  O SISTEMA DEVE segurar o vídeo até que 50% do restante da aula esteja traduzido,
  mostrando o progresso sobre o vídeo, e retomá-lo sozinho ao atingir a meta. QUANDO o
  usuário apertar play duas vezes seguidas, O SISTEMA DEVE liberar o vídeo de imediato.
- **R1.7 (novo, pedido do usuário).** ONDE o início automático estiver ligado (padrão),
  QUANDO o usuário abrir uma página de aula com a tradução desligada, O SISTEMA DEVE
  ligá-la sozinho. SE o usuário desligar a tradução pelo popup, ENTÃO O SISTEMA NÃO DEVE
  religá-la automaticamente até ele ligar de novo. O início automático usa apenas a
  leitura direta do arquivo da aula (o Chrome só autoriza capturar o som da aba após um
  clique na extensão).
- **R11 (novo, pedido do usuário) — Tradução da página.** Deixa de ser fora de escopo.
  ONDE a opção estiver ligada (padrão), O SISTEMA DEVE traduzir para português o texto
  das páginas do Mammoth Club (menus, títulos, descrições), inclusive o que o site
  carregar ou redesenhar depois, independentemente de a tradução da aula estar ligada.
  O SISTEMA NÃO DEVE traduzir código, campos de digitação, e-mails e endereços, nem
  alterar a estrutura da página. QUANDO a opção for desligada, O SISTEMA DEVE restaurar
  o texto original. A tradução é local, com o mesmo tradutor e glossário das legendas.
- **Fora de escopo (esclarecido).** A extensão lê o arquivo da aula apenas em memória,
  para transcrevê-lo; continua sem gravar ou exportar vídeo/áudio.

## 2. Requisitos funcionais

### R1 — Ativação na aula

**História:** Como aluno, quero ligar a tradução com um clique na página da aula,
para não precisar configurar nada a cada vídeo.

1. QUANDO o usuário clicar no ícone da extensão em uma aba do Mammoth Club, O SISTEMA
   DEVE exibir um painel com um controle de ligar/desligar a tradução para aquela aba.
2. QUANDO o usuário ligar a tradução, O SISTEMA DEVE começar a capturar o áudio da
   aba e indicar visualmente que está ativo (ícone da extensão e indicador sobre o vídeo).
3. QUANDO o usuário desligar a tradução, O SISTEMA DEVE encerrar a captura, remover
   as legendas, parar a dublagem e restaurar o volume original do vídeo.
4. SE a aba ativa não for do Mammoth Club, ENTÃO O SISTEMA DEVE mostrar o controle
   desabilitado com a mensagem de que a extensão só funciona nesse site.
5. QUANDO a aba for fechada ou navegar para fora do site, O SISTEMA DEVE encerrar a
   sessão de tradução e liberar todos os recursos.
6. ENQUANTO a tradução estiver ativa, O SISTEMA DEVE continuar funcionando quando o
   usuário trocar de aula dentro do site, sem exigir nova ativação.

### R2 — Transcrição da fala

**História:** Como aluno, quero que a fala em inglês do instrutor seja reconhecida
automaticamente, já que as aulas não têm legenda.

1. ENQUANTO a tradução estiver ativa e o vídeo estiver tocando, O SISTEMA DEVE
   transcrever continuamente a fala em inglês do áudio da aba.
2. O SISTEMA DEVE executar a transcrição localmente no computador do usuário, sem
   enviar áudio para servidores externos.
3. ENQUANTO houver silêncio ou apenas música/ruído, O SISTEMA NÃO DEVE produzir
   texto inventado.
4. QUANDO o vídeo for pausado, O SISTEMA DEVE suspender a transcrição e retomá-la
   quando a reprodução voltar.
5. O SISTEMA DEVE segmentar a fala em trechos correspondentes a frases ou pausas
   naturais, evitando cortar palavras ao meio.

### R3 — Tradução

**História:** Como aluno, quero o texto traduzido em português natural, para entender
o conteúdo sem esforço.

1. QUANDO um trecho for transcrito, O SISTEMA DEVE traduzi-lo de inglês para português.
2. O SISTEMA DEVE executar a tradução localmente, sem custo e sem chave de API.
3. O SISTEMA DEVE preservar sem tradução os termos listados no glossário do usuário
   (ex.: nomes próprios, jargão técnico).
4. SE a tradução de um trecho falhar, ENTÃO O SISTEMA DEVE exibir o trecho original
   em inglês, sinalizado como não traduzido, e seguir com os próximos.

### R4 — Legendas

**História:** Como aluno, quero ler a tradução sobre o vídeo, sincronizada com a fala.

1. QUANDO um trecho traduzido estiver pronto, O SISTEMA DEVE exibi-lo sobreposto à
   parte inferior do vídeo.
2. O SISTEMA DEVE limitar a legenda a no máximo 2 linhas, quebrando trechos longos
   em exibições sucessivas.
3. O SISTEMA DEVE manter cada legenda visível por tempo proporcional ao seu tamanho e
   removê-la quando não houver fala nova.
4. ENQUANTO o vídeo estiver em tela cheia, O SISTEMA DEVE manter as legendas visíveis
   e posicionadas sobre o vídeo.
5. ONDE o usuário habilitar o modo bilíngue, O SISTEMA DEVE exibir o texto original
   em inglês acima da tradução.
6. O SISTEMA DEVE permitir ajustar tamanho da fonte, opacidade do fundo e posição
   vertical da legenda.
7. QUANDO o usuário pausar o vídeo, O SISTEMA DEVE manter a última legenda na tela.
8. QUANDO o usuário avançar ou retroceder o vídeo, O SISTEMA DEVE limpar as legendas
   pendentes do trecho anterior.

### R5 — Dublagem

**História:** Como aluno, quero ouvir a tradução em português, para acompanhar a aula
sem precisar ler.

1. ONDE a dublagem estiver habilitada, QUANDO um trecho traduzido estiver pronto,
   O SISTEMA DEVE falá-lo com voz sintetizada em português do Brasil.
2. ENQUANTO a voz dublada estiver falando, O SISTEMA DEVE reduzir o volume do áudio
   original para um nível configurável (padrão 15%) e restaurá-lo ao terminar.
3. SE a fila de trechos a dublar atrasar além do limite configurado, ENTÃO O SISTEMA
   DEVE acelerar a fala e, persistindo o atraso, descartar os trechos mais antigos.
4. QUANDO o vídeo for pausado, avançado ou retrocedido, O SISTEMA DEVE interromper a
   fala imediatamente e esvaziar a fila de dublagem.
5. O SISTEMA DEVE permitir escolher a voz (entre as vozes pt-BR instaladas), a
   velocidade base e o volume da dublagem.
6. SE não houver voz pt-BR disponível no sistema, ENTÃO O SISTEMA DEVE desabilitar a
   dublagem e informar o motivo, mantendo as legendas funcionando.
7. O SISTEMA NÃO DEVE captar a própria voz dublada como entrada da transcrição.

### R6 — Configuração e primeiro uso

**História:** Como aluno, quero preparar a extensão uma única vez e ter minhas
preferências lembradas.

1. QUANDO a extensão for usada pela primeira vez, O SISTEMA DEVE guiar o usuário no
   download dos modelos locais de transcrição e tradução, mostrando o progresso.
2. SE o navegador ou o computador não atender aos requisitos mínimos, ENTÃO O SISTEMA
   DEVE informar exatamente qual requisito falta e como resolvê-lo.
3. O SISTEMA DEVE persistir as preferências do usuário (legendas, dublagem, aparência,
   voz, glossário, qualidade do modelo) entre sessões.
4. O SISTEMA DEVE oferecer ao menos dois níveis de qualidade de transcrição
   ("rápido" e "preciso"), trocando velocidade por precisão.
5. APÓS o download inicial dos modelos, O SISTEMA DEVE funcionar sem depender de
   nenhum serviço externo além do próprio site da aula.

## 3. Requisitos não funcionais

### R7 — Desempenho

1. Em um computador que atenda aos requisitos mínimos, no nível "rápido", a legenda
   DEVE aparecer em até **4 segundos** após o fim do trecho falado (mediana).
2. A extensão NÃO DEVE causar travamentos perceptíveis na reprodução do vídeo.
3. A extensão NÃO DEVE consumir recursos quando a tradução estiver desligada.

> A tradução é "simultânea" no sentido de acompanhar a aula com poucos segundos de
> atraso; atraso zero não é possível, pois é preciso ouvir a frase antes de traduzi-la.

### R8 — Privacidade e segurança

1. Áudio, transcrições e traduções NÃO DEVEM sair do computador do usuário.
2. A extensão DEVE solicitar apenas as permissões estritamente necessárias e restringir
   o acesso a páginas ao(s) domínio(s) do Mammoth Club.
3. A extensão NÃO DEVE armazenar áudio nem transcrições de forma persistente.
4. A extensão NÃO DEVE executar código remoto (exigência do Manifest V3).

### R9 — Compatibilidade e robustez

1. A extensão DEVE usar Manifest V3 e funcionar no Chrome desktop (Windows, macOS,
   Linux) a partir da versão mínima definida no design.
2. A extensão DEVE funcionar independentemente do player de vídeo usado pelo site,
   inclusive se o vídeo estiver dentro de um iframe de terceiros.
3. SE um componente interno falhar, ENTÃO O SISTEMA DEVE tentar se recuperar uma vez e,
   se não conseguir, encerrar a sessão com uma mensagem clara, restaurando o áudio.
4. O áudio original do vídeo DEVE continuar audível enquanto a tradução estiver ativa
   (salvo a redução temporária da R5.2).

### R10 — Qualidade do código

1. A lógica pura (segmentação, filas, quebra de legendas, glossário) DEVE ter testes
   unitários automatizados.
2. O projeto DEVE ter build reproduzível por um único comando que gere a pasta
   carregável em `chrome://extensions`.
