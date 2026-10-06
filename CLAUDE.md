# Extensão Chrome — Tradução simultânea de videoaulas (Mammoth Club)

Extensão Chrome (Manifest V3) que traduz em tempo real, de inglês para português
brasileiro, as videoaulas do site Mammoth Club, com legendas e dublagem.

## Fluxo de trabalho: Spec-Driven Development

Este projeto é desenvolvido **spec-first**. Nenhum código é escrito sem spec aprovada.

Cada funcionalidade vive em `specs/<funcionalidade>/` com três documentos, nesta ordem:

1. `requirements.md` — histórias de usuário e critérios de aceitação em EARS
   (`QUANDO <gatilho>, O SISTEMA DEVE <resposta>`), numerados (`R1.2`).
2. `design.md` — arquitetura, componentes, contratos de mensagens, decisões e riscos.
3. `tasks.md` — checklist de implementação; cada tarefa cita os requisitos que atende.

Regras:

- Cada documento precisa de aprovação do usuário antes de avançar para o seguinte.
- Implementar uma tarefa por vez, na ordem de `tasks.md`, marcando `[x]` ao concluir.
- Se a implementação revelar que a spec está errada, **atualize a spec primeiro**
  (requisito → design → tarefa) e só então o código.
- Mudança de escopo = nova spec ou revisão de `requirements.md`, nunca só código.
- Documentação e interface em português brasileiro; identificadores de código em inglês.

## Specs

- `specs/traducao-simultanea/` — funcionalidade principal (legendas + dublagem).
