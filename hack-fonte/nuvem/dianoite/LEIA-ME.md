# Dia e noite do Quetzal

O jogo já tem dia e noite (Opções > Outros > DIA/NOITE, bit 7 em SaveBlock2 + 0x2B9) e luzes marcadas com o bit 15 nas paletas. O motor não tem RTC, então o jogo ficava em 00:00.

- Relógio: `RtcCalcLocalTime` (0x0802CA8C) desviada para ler hora, minuto e segundo em 0x0203FF58; `gLocalTime` é 0x030054F8. Quem escreve é o `dianoite.js`, depois de cada quadro, nunca na sala por rollback.
- Cores: `noite.py` e `tarde.py` geram as receitas, medidas material por material na imagem de referência do usuário. O resultado fica dentro do `dianoite.js`.
- Não mexe em luzes do jogo, nem nas paletas 13 a 15 de fundo (menus), nem em casas e cavernas (tipo do mapa em 0x02038CB0 + 0x17). Espera a transição de tela acabar (0x02039AC3, bit 7).
- Sombra: a oval do jogo (16x8, bloco 1) vira afim na OAM em 0x03002698, com a matriz 0x90, 0, -0x38, 0x88.
- Hora do jogo: 150 quadros por minuto, um dia em uma hora.

## Batalha

Fundo nas paletas 2 e 3, fora de caverna, prédio e debaixo d'água. `ter.py` separa as cores de céu e chão de cada terreno a partir das capturas de dia; `gt.py` desenha as rampas de tarde e noite e grava a tabela `TERRENOS` no `dianoite.js`. Noite segue as cores das árvores do jogo: verde-oliva escuro com contraste. Cor fora da tabela usa `luz()`.
