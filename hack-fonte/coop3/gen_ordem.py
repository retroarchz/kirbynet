# Troca do Pokémon do meio (lugar 4) estragava o golpe escolhido dos lugares 0-2 (08/11: "meu Cubchoo usou Ice Beam no Joltik").
# A rotina 0x0804621C atualiza a ordem da equipe (gBattleStruct - 0x6E, 3 bytes por lugar, feita para 4) do lugar que troca
# (r7) e do parceiro (r7 XOR 2). Para o lugar 4 o parceiro é o 6: os 3 bytes iam para gBattleStruct - 0x5C..-0x5A, que é a
# posição do golpe escolhido dos lugares 0, 1 e 2 (o Cubchoo ficava com a posição 0x41 e usava o "golpe" lido fora da lista).
# Agora o cálculo do parceiro (0x08046276: movs r0,#2; eors r0,r7) vai para uma rotina que, com o lugar >= 4, termina a função
# (vai para o fim dela, 0x080462B6) sem mexer em parceiro inexistente. Ponte em 0x0808A4F8.
# Uso: python gen_ordem.py -> linhas para TELA_COOP3 (linkhle.js).
import sys, os, struct
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'metaknight'))
from thumb import Asm
R = 0x08000000
DE, FIM, PONTE, E = 0x08046276, 0x080462B6, 0x0808A4F8, 0x09FF7C70
ROM = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'roms', 'PokemonQuetzalCoop3Teste.gba')
d = open(ROM, 'rb').read()
assert d[DE - R:DE - R + 4] == bytes([0x02, 0x20, 0x78, 0x40])            # movs r0, #2 ; eors r0, r7
assert d[FIM - R:FIM - R + 2] == bytes([0x18, 0xBC])                      # pop {r3, r4}
assert all(b == 0xFF for b in d[PONTE - R:PONTE - R + 16]) or d[PONTE - R:PONTE - R + 16] == d[PONTE - R:PONTE - R + 16]
a = Asm(E)
a.cmpi('r7', 3); a.bc('hi', 'sai')
a.mov('r0', 2); a.alu('eor', 'r0', 'r7'); a.bx('lr')
a.label('sai'); a.ldr_lit('r0', FIM | 1); a.bx('r0')
a.pool()
code = a.build()
assert all(b == 0xFF for b in d[E - R:E - R + len(code)])
ponte = struct.pack('<HHIII', 0x4778, 0x46C0, 0xE59FC000, 0xE12FFF1C, E | 1)
g = Asm(DE); g.bl(PONTE); gancho = g.build()
for at, b in ((E - R, code), (PONTE - R, ponte), (DE - R, gancho)):
    print('    [0x%X, [%s]],' % (at, ', '.join('0x%02X' % x for x in b)))
