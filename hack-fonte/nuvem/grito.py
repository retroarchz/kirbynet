# Pokémon entrando na luta: o menu sobe assim que ele aparece (16/11/2026, pedido do usuário com o Cubchoo).
# No fim da entrada (troca, ou o próximo depois de um desmaio) o controle de cada lugar esperava o GRITO terminar
# (IsCryPlayingOrClearCrySongs 0x080F3C5C) antes de liberar a luta: ~116 quadros (quase 2 s) parados com o Pokémon já
# em campo. Agora a pergunta "o grito ainda toca?" responde sempre "não": o grito continua tocando, mas a luta segue.
# Vale nos 4 controles (jogador, parceiro do cabo, inimigo, inimigo do cabo): pelo cabo todos os aparelhos esperam o
# mais lento, então se um só ficasse esperando o grito a demora continuava. A apresentação do começo da luta não mudou.
# Bytes iguais na Alpha 9 e na Coop 3: entra no QZ_NUVEM.fix do game.js. Uso: python grito.py -> linhas para o game.js.
import os
R = 0x08000000
LUGARES = (0x080901A0, 0x08094F80, 0x080999BC, 0x0820B17C)   # bl IsCryPlayingOrClearCrySongs em cada SwitchIn_HandleSoundAndEnd
NOVO = bytes.fromhex('0020c046')                               # movs r0, #0 ; nop
RAIZ = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
roms = [open(os.path.join(RAIZ, 'roms', f), 'rb').read() for f in ('PokemonQuetzalPtBrAlpha9v1.gba', 'PokemonQuetzalCoop3Teste.gba')]
for at in LUGARES:
    o = at - R
    orig = roms[0][o:o + 4]
    assert all(r[o:o + 4] == orig for r in roms), hex(at)
    assert roms[0][o + 4:o + 10] == bytes.fromhex('00060028') + roms[0][o + 8:o + 10] and roms[0][o + 9] == 0xD1, hex(at)  # lsls r0,#24; cmp r0,#0; bne
    print('    [0x%X, "%s", "%s"],   // entrada na luta não espera o grito; fonte: hack-fonte/nuvem/grito.py' % (o, orig.hex(), NOVO.hex()))
