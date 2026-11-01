# Bike do personagem 657

Cada personagem do Quetzal tem 9 sprites seguidos: 0 a pé, 1 Mach Bike, 2 Acro Bike. O 657 tinha Pokémon nas duas bikes (658 com 9 quadros, 659 com 27).

`gerar.py` monta os 36 quadros com a moto da Cynthia (217 e 218) nas cores do 657, com a cabeça dele (quadros a pé) por cima. O resultado vai em `moto.bin`, escrito por cima dos quadros antigos em 0xF4E7D4 (0x4800 bytes, iguais nas duas ROMs), pela linha `fix` do `QZ_NUVEM` no `game.js`. Nada aponta para esses quadros além das tabelas dos sprites 658 e 659.

Sprite do jogador: tabela 0x090EC814, 36 bytes por registro, imagens em +28. Teste da Acro: gPlayerAvatar 0x02039070 (flags = 4) e, em gSprites, anims 0x02020638 = 0x09066184 e images 0x0202063C = 0x090604B4.

## Capacete (tecla 0)

Fora da sala por rollback, a tecla 0 troca os quadros direto na ROM da partida: `Moto` no `game.js` busca `capacete.bin` ou `moto.bin`, o `engine-worker.js` chama `romWrite` do `kncore.js`, em 0xF4E7D4. A escolha fica no navegador e volta ao iniciar o jogo. A ROM não tinha espaço livre sobrando para guardar os dois desenhos, por isso ficam em arquivos.
