# Tutorial de instalação

Passo a passo para instalar o Mammoth Tradutor no Google Chrome, do zero. Leva cerca de
15 minutos, mais o tempo dos downloads.

## Antes de começar

Você precisa de:

- **Google Chrome 138 ou superior**, em um computador (Windows, macOS ou Linux). Para
  conferir a versão, abra `chrome://settings/help`.
- **Uma conta no [Mammoth Club](https://mammothclub.com)** com acesso às aulas. A
  extensão só traduz; ela não dá acesso ao conteúdo.
- **Cerca de 1 GB livre** em disco e uma conexão razoável: no primeiro uso a extensão
  baixa até uns 550 MB de modelos de transcrição, tradução e voz.

## Passo 1 — Instalar o Node.js

O Node.js é usado só para montar a extensão a partir do código.

1. Acesse <https://nodejs.org> e baixe a versão **LTS**.
2. Instale com as opções padrão.
3. Abra um terminal (no Windows: menu Iniciar → "PowerShell") e confira:

   ```bash
   node --version
   ```

   Deve aparecer `v20.19` ou superior.

## Passo 2 — Baixar o código

**Com Git instalado:**

```bash
git clone https://github.com/pato-rocco/mammoth-tradutor.git
cd mammoth-tradutor
```

**Sem Git:** na página do repositório, clique em **Code → Download ZIP**, descompacte
em uma pasta que você não vá apagar e abra o terminal dentro dela.

## Passo 3 — Montar a extensão

No terminal, dentro da pasta do projeto:

```bash
npm install
npm run build
```

O primeiro comando baixa as dependências (alguns minutos). O segundo cria a pasta
`dist`, que é a extensão pronta. Se terminar com `✓ built`, deu certo.

## Passo 4 — Carregar no Chrome

1. Abra `chrome://extensions`.
2. Ative o **Modo do desenvolvedor**, no canto superior direito.
3. Clique em **Carregar sem compactação**.
4. Selecione a pasta **`dist`** (dentro da pasta do projeto, não a pasta do projeto em si).

O "Mammoth Tradutor" aparece na lista. Para deixar o ícone à mão, clique no ícone de
quebra-cabeça na barra do Chrome e fixe a extensão.

> Não mova nem apague a pasta `dist` depois de carregar: o Chrome usa a extensão
> direto de lá.

## Passo 5 — Primeiro uso

1. Entre no Mammoth Club e abra uma aula.
2. Clique no ícone da extensão e ligue **Traduzir esta aula**. Mantenha o popup aberto
   até a mensagem "Baixando o pacote de tradução…" terminar. Esse clique só é
   necessário na primeira vez.
3. Sobre o vídeo aparecem os avisos de download: primeiro o modelo de transcrição,
   depois a voz em português. Na primeira vez isso leva alguns minutos; depois fica
   tudo guardado no computador.
4. O vídeo fica pausado mostrando **"Preparando a tradução: X%"**. Ao chegar na meta,
   ele começa sozinho, do início, com legenda e dublagem.

A partir daí, basta abrir uma aula: a tradução liga sozinha.

## Passo 6 — Ajustar ao seu gosto

No popup da extensão:

| Opção | O que faz |
|---|---|
| Traduzir esta aula | Liga ou desliga a tradução na aba atual |
| Legendas / Dublagem | Liga ou desliga cada uma |
| Preparar antes de tocar | Segura o vídeo até metade do restante da aula estar traduzida |
| Ligar sozinha nas aulas | Inicia a tradução ao abrir uma aula |
| Traduzir a página | Traduz menus, títulos e o material escrito |
| Copiar tradução | Copia o texto traduzido de uma das duas últimas aulas |

Em **Mais opções…** você escolhe a voz (com o botão **Ouvir** para testar), o tamanho
e a posição da legenda, os volumes e o **glossário** — a lista de termos que não devem
ser traduzidos, um por linha.

## Atualizar para uma versão nova

1. Baixe o código novo (`git pull`, ou baixe o ZIP de novo por cima).
2. Rode `npm install` e `npm run build`.
3. Em `chrome://extensions`, clique no botão de recarregar do Mammoth Tradutor.
4. Recarregue a página da aula (F5).

## Problemas comuns

**O vídeo não espera e não aparece legenda.**
Recarregue a página da aula (F5). Se a extensão foi instalada ou atualizada com a aula
já aberta, a página precisa ser recarregada. Confira também se "Ligar sozinha nas
aulas" está ativo, ou ligue pelo popup.

**Aparece "O pacote de tradução ainda não foi baixado".**
Abra o popup, desligue e ligue "Traduzir esta aula" e aguarde o download com o popup
aberto.

**As legendas aparecem, mas não há voz.**
A voz só começa depois do download do modelo (cerca de 260 MB). Confira se "Dublagem"
está ligada e se o volume do computador e o "Volume da voz" nas opções não estão baixos.

**O vídeo está sem som e nada é traduzido.**
Verifique se o player do site não está no mudo.

**A preparação demora muito.**
Em computadores mais lentos a transcrição leva mais tempo. Você pode apertar play duas
vezes para assistir já, ou reduzir o percentual em Mais opções → "Preparar antes de
tocar".

**Nomes de produtos e tecnologias saem traduzidos.**
Adicione-os ao glossário, em Mais opções.

**Quero ver o que está acontecendo por dentro.**
Em Mais opções, ative "Mostrar diagnóstico técnico no popup". O rodapé do popup passa
a mostrar o modo em uso, o progresso e o último problema registrado — inclua esse
texto ao relatar um defeito.

## Remover

Em `chrome://extensions`, clique em **Remover** no Mammoth Tradutor. Isso apaga também
as preferências e os modelos de transcrição e de voz que ela baixou. O pacote de
tradução inglês → português pertence ao próprio Chrome e continua instalado.
