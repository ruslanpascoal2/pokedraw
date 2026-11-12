# PokéDraw 🎨 — Quem é esse Pokémon?

Jogo multiplayer de desenho no navegador. A cada rodada aparece a **silhueta** de um Pokémon da 1ª geração (#1–#151), no estilo do "Quem é esse Pokémon?" do desenho. Todos desenham dentro do tempo, votam no melhor desenho (**votação cega**) e no fim da rodada aparece um **pódio**. No fim da partida, o pódio geral.

Também tem um **modo treino** para desenhar sozinho, com timer opcional, guia de silhueta transparente sobre a tela, revelar o Pokémon e salvar o PNG.

## Ferramentas de desenho

| Ferramenta | Atalho | Como funciona |
|---|---|---|
| ✏️ Lápis | `P` | Traço fino com textura de grafite |
| 🖌️ Pincel duro | `B` | Borda nítida, opacidade uniforme por pincelada |
| ☁️ Pincel suave | `S` | Borda difusa (aerógrafo) |
| 💧 Aquarela | `W` | Manchas irregulares, borda molhada, granulação do papel e mistura por *multiply* |
| 🎨 Tinta a óleo | `O` | Cerdas individuais, pinta seca quando a tinta acaba e mistura com a cor que já está na tela |
| 🧽 Borracha | `E` | Apaga para o branco |
| 🪣 Balde | `G` | Preenchimento com tolerância ajustável |
| 🌈 Gradiente | `D` | Linear ou radial, da cor principal para a secundária, na área clicada ou na tela toda |
| 💉 Conta-gotas | `I` ou `Alt`+clique | Pega uma cor da tela |

Outros atalhos: `Ctrl+Z` / `Ctrl+Y` desfazer/refazer, `X` troca as cores, `[` `]` tamanho do pincel. Suporta pressão de caneta (tablet).

## Estrutura

```
client/   front-end estático (HTML/CSS/JS puro, sem build) → GitHub Pages
server/   Node + Socket.IO (salas, rodadas, votação, pódio) → Render (free)
```

O servidor também serve o `client/`, então a URL do Render sozinha já roda o jogo completo.

## Rodando localmente

```bash
cd server
npm install
npm start
# abra http://localhost:3000 (use duas abas para testar o multiplayer)
```

## Deploy

- **Front-end**: GitHub Actions publica `client/` no GitHub Pages a cada push na `main`.
- **Back-end**: [![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/ruslanpascoal2/pokedraw) — usa o `render.yaml` (plano free).
- O cliente no GitHub Pages aponta para o servidor configurado em `client/js/config.js` (`DEPLOYED_SERVER`). Para testar outro servidor sem mudar o código: `?server=https://seu-servidor`.

> O plano gratuito do Render "dorme" após 15 min sem uso; a primeira conexão pode levar ~1 minuto.

## Créditos

Fan game não oficial, sem fins lucrativos. Pokémon e nomes relacionados © Nintendo / Creatures / Game Freak / The Pokémon Company. Imagens e nomes carregados em tempo de execução da [PokeAPI](https://pokeapi.co/) — nenhuma imagem é distribuída neste repositório.
