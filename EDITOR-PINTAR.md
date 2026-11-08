# Editor — Pintar: o padrão para todo lugar novo

> Pedido do Sandro (08/11/2026): *"isso vai ser muito importante futuramente! guarde em md e em código
> pra lembrar pras próximas coisas também serem assim, quando formos sair da terra e ver os itens"*.
>
> **Regra:** todo conjunto de peças novo (terra, cidades, cavernas, casas, itens…) segue este padrão:
> **objetos prontos com imagem e nome** (um toque põe o objeto inteiro), **categorias em botões**, e
> **paredes iguais às do jogo**. Ninguém deve precisar pôr bloco por bloco.

## Como funciona hoje (aba 🎨 Pintar do 🛠️ Eventos)

| O que | Onde no código |
|---|---|
| Peças do lugar desenhadas (folha 16 colunas, vinda da VRAM) | `editorqz.js` → `pecas()` |
| Valor típico de cada peça (colisão/altura) e objetos achados sozinhos nos mapas do jogo | `editorqz.js` → `usoTileset()` |
| **Tabela de conjuntos** (categorias, peças fixas, paredes, brilho, **objetos prontos**) | `editor.js` → `CONJUNTOS` |
| Categoria de cada peça | `editor.js` → `categorias()` |
| Colisão ao escolher uma peça (lugar atual → como o jogo usa → tipo) | `editor.js` → `padrao()` |
| Objetos/carimbos (põe centrado no toque, ↶ volta inteiro) | `editor.js` → `pinta()` com `pc.carimbo` |
| Lista em 8 colunas, arrastar = carimbo | `editor.js` → `desenhaPincel()` |
| 🔢 Baixar folha de peças com números | `editor.js` → `baixaFolha()` |
| Gravação na ROM (pintura no lugar, mapas novos, mergulho) | `editorqz.js` → `montarMapas()` |

### Por que 8 colunas

Os tilesets do Emerald/Quetzal foram desenhados em **8 colunas** (como no Porymap). Na folha em 8
colunas os objetos aparecem **inteiros**: uma pedra 2×3 são as peças `1ª, 1ª+1, 1ª+8, 1ª+9, 1ª+16, 1ª+17`.
Por isso um objeto pronto é só `[nome, 1ª peça, largura, altura]`, e a peça (x, y) dele é `1ª + y×8 + x`.

### Achar sozinho × montar à mão

- **Sozinho** (`usoTileset`): olha todos os mapas do jogo com o mesmo tileset. Duas peças vizinhas na
  folha (id+1 à direita, id+8 embaixo) que aparecem juntas em ≥ 40% das vezes são do mesmo objeto.
  Funciona bem em rotas e cidades (casas, árvores, placas…).
- **À mão** (`CONJUNTOS[ts].objs`): quando o jogo monta as coisas peça por peça (os paredões do fundo
  do mar são assim), a detecção não acha. Aí se monta olhando a folha.

## Receita: ligar um conjunto novo (ex.: "quando formos sair da terra")

1. No jogo, vá até um lugar que use o tileset (ex.: uma rota), abra 🛠️ Eventos → 🎨 Pintar.
2. Aperte **🔢 Baixar folha de peças com números**: sai `folha-<tileset>.png`, com 8 colunas, o número de cada
   peça e o número em **vermelho** quando o jogo usa aquela peça como parede.
3. Em `editor.js`, em `CONJUNTOS`, crie uma entrada com a chave do tileset secundário (o número do nome do
   arquivo, ex.: `0x0878931C`):
   ```js
   0x0878931C: {
     nome: "Rotas",
     cats: [["objetos", "🧩 Objetos prontos"], ["tudo", "Tudo"], ["arvores", "🌳 Árvores"], ["casas", "🏠 Casas"], ["chao", "🟩 Chão"], ["gerais", "🧱 Peças gerais"]],
     fixo: { arvores: [/* peças */], casas: [/* peças */] },
     comp: { 0x02: "mato" },                 // comportamento -> categoria (opcional)
     parede: [/* peças em vermelho na folha */],
     paredeCats: ["arvores", "casas"],       // já vêm com 🚧 Parede
     brilho: [[0, "chao"]],                  // o que sobrar
     objs: [["Árvore", 0x2A0, 2, 2], ["Casa", 0x240, 5, 4]],
   },
   ```
4. Recarregue o site, abra o Pintar no lugar e **confira cada objeto na aba 🧩 Objetos prontos**. Ele tem que
   aparecer inteiro e bonito. Ponha um no mapa e veja no jogo se a parede está certa.
5. Teste no site (Chrome sem janela) como nos testes `e2e_objs.js`/`e2e_cats.js` (scratchpad da sessão de
   08/11, pasta `moca`).

> Se só o padrão automático bastar (as rotas costumam ter muitos objetos achados sozinhos), não precisa
> de entrada: o editor já mostra "🧩 Objetos prontos (N)" e "Todas as peças".

## Itens (próximo passo combinado)

Quando formos "ver os itens", o padrão é o mesmo: **lista com imagem e nome, categorias em botões, um toque
põe**. Hoje o editor de eventos já tem item no chão (📦, sprite 59 = baú) e dar item; a lista de itens é
texto (nomes em `0x091E0360`). O próximo passo é mostrar a imagem de cada item (ícones do jogo) e separar por
tipo (Poké Bolas, remédios, pedras de evolução, TMs…), igual ao fundo do mar.

## Fundo do mar (o primeiro conjunto feito)

- Tileset secundário `0x087896F4` (o mesmo de todos os fundos do jogo: 0.50–0.56, 24.x). 236 peças.
- Entradas: peças sob as portas das cavernas embaixo d'água (`0x224`, `0x22E`, `0x26E`) e buracos parecidos.
- Paredes: medidas nos 12 fundos do jogo (colisão em > 50% das vezes).
- Brilho: > 105 areia clara, < 45 fendas (relevo escuro), no meio o chão roxo.
- 22 objetos montados à mão (pedras, crateras, entradas, algas, submarino), conferidos um a um.
- O "navio afundado" (`0x08789814`, mapas 24.60/24.64) ficou de fora a pedido.

## Coisas do jogo que valem para tudo isto

- Mapa novo (fundo do mar): `0.57+`, `GetMapLayout` (0x080C0F00) desviado para ids `0xFF00+`; o lugar
  cresce só para a direita/baixo; limite `(w+15)*(h+14) <= 0x2800`.
- Pintura num lugar do jogo reescreve os blocos **no lugar** (casas iguais por dentro mudam juntas).
- Espaço livre na ROM: ~20 KB (`EditorQZ.LIVRE`), dividido entre eventos e mapas novos.
- Com a trapaça (Alt), Surf/Mergulhar/etc. sem insígnia (`LinkHLE.campoLivre`).
