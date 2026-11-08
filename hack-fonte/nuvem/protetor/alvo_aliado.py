# Protetor Glacial (alvo "eu ou aliado", 0x90) só protegia quem usou, no jogo de quem não é o mestre do cabo (08/11).
# Na escolha do golpe (HandleInputChooseMove), a tela de alvo só abre se o parceiro (lugar XOR 2) está vivo
# (IsBattlerAlive 0x0805D5DC, pela vida em gBattleMons). Na luta pelo cabo só o mestre calcula a batalha: nos outros jogos
# essa vida fica 0 e o golpe ia direto em quem usou. Agora, em luta pelo cabo (gBattleTypeFlags & 2), a tela abre se há
# algum aliado presente no mesmo lado (gAbsentBattlerFlags, igual nos jogos); fora do cabo continua o original.
# Ponte no lugar dos 16 bytes da conferência (0x0808EA9C, alinhado), código em 0x09FF7700. Vale nas duas ROMs (Alpha 9 e
# Coop 3, bytes iguais): entra no QZ_NUVEM do game.js. Uso: python alvo_aliado.py -> linhas para o game.js.
import sys, os, struct
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'metaknight'))
from thumb import Asm
R = 0x08000000
DE, VOLTA, E = 0x0808EA9C, 0x0808EAAC, 0x09FF7700
TIPO, NBAT, AUSENTE, VIVO = 0x02022FBC, 0x02023044, 0x02023209, 0x0805D5DC
ORIG = bytes.fromhex('0220704 0cef79cfd002801d001229146'.replace(' ', ''))
RAIZ = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..')
for f in ('PokemonQuetzalPtBrAlpha9v1.gba', 'PokemonQuetzalCoop3Teste.gba'):
    d = open(os.path.join(RAIZ, 'roms', f), 'rb').read()
    assert d[DE - R:DE - R + 16] == ORIG, f
    assert d[VOLTA - R - 4:VOLTA - R] == bytes.fromhex('01229146')   # movs r2,#1 ; mov sb,r2
a = Asm(E)
# entra aqui só com alvo 0x90 (o jogo já conferiu). r6 = lugar de quem escolhe; sb = pode escolher alvo
a.ldr_lit('r0', TIPO); a.ldr_i('r0', 'r0', 0); a.mov('r1', 2); a.alu('tst', 'r0', 'r1'); a.bc('ne', 'cabo')
a.mov('r0', 2); a.alu('eor', 'r0', 'r6'); a.ldr_lit('r3', VIVO | 1); a.bl('c3'); a.cmpi('r0', 0); a.bc('eq', 'volta'); a.b('pode')
a.label('cabo')
a.push(['r4']); a.mov('r4', 0)
a.label('loop')
a.ldr_lit('r0', NBAT); a.ldrb_i('r0', 'r0', 0); a.alu('cmp', 'r4', 'r0'); a.bc('hs', 'nao')
a.alu('cmp', 'r4', 'r6'); a.bc('eq', 'prox')
a.movh('r0', 'r4'); a.alu('eor', 'r0', 'r6'); a.mov('r1', 1); a.alu('tst', 'r0', 'r1'); a.bc('ne', 'prox')   # outro lado
a.ldr_lit('r0', AUSENTE); a.ldrb_i('r0', 'r0', 0); a.mov('r1', 1); a.h(0x40A1); a.alu('tst', 'r0', 'r1'); a.bc('ne', 'prox')   # lsls r1, r4
a.pop(['r4']); a.b('pode')
a.label('prox'); a.addi('r4', 1); a.b('loop')
a.label('nao'); a.pop(['r4']); a.b('volta')
a.label('pode'); a.mov('r2', 1); a.movh('r9', 'r2')
a.label('volta'); a.ldr_lit('r0', VOLTA | 1); a.bx('r0')
a.label('c3'); a.bx('r3')
a.pool()
code = a.build()
ponte = struct.pack('<HHIII', 0x4778, 0x46C0, 0xE59FC000, 0xE12FFF1C, E | 1)
print('    [0x%X, "%s", "%s"],   // Protetor Glacial em aliado também em quem não é o mestre do cabo; fonte: hack-fonte/nuvem/protetor/alvo_aliado.py' % (DE - R, ORIG.hex(), ponte.hex()))
print('    [0x%X, "%s"],   // Protetor Glacial: tela de alvo abre se há aliado presente (luta pelo cabo)' % (E - R, code.hex()))
