# Luta dos 3: o GBA tem 64 figuras; a luta dos 3 usa ~41-44 (5 caixas de vida x 5, 5 Pokémon...) e animações como a neve
# do Snover (21 flocos) levavam a 64. Se a entrada de um Pokémon caía nesse pico, a figura dele ou da caixa de vida não era
# criada e a luta parava para sempre (travamentos de 07/11: Rotom com neve; Frigibax entrando com neve).
# Agora CreateSpriteAt (0x080076DC, por onde passam todas), na tripla, nega figura de ANIMAÇÃO (etiquetas 10000-10599 e
# 65000-65099: partículas e brilhos de 16 figuras) quando sobram menos de RESERVA
# livres: a animação sai com menos flocos/partículas e a luta sempre tem lugar para Pokémon, Pokébola e caixa de vida.
import sys, struct, json
sys.path.insert(0, 'C:/Users/Sandro/Downloads/kirbynet-site-retroarchz/hack-fonte/metaknight')
from thumb import Asm
E = 0x09FF6B00
FLAG, SPRITES = 0x0203FE00, 0x02020630
RESERVA = 10
R = open('C:/Users/Sandro/Downloads/kirbynet-site-retroarchz/hack-fonte/coop3/.runtime/rom-site.gba', 'rb').read()
assert R[0x76DC:0x76EC].hex() == 'f0b557464e464546e0b48846151c1e1c'
a = Asm(E)
a.push(['r4', 'r5', 'r6', 'r7'])
a.ldr_lit('r4', FLAG); a.ldrb_i('r4', 'r4', 0); a.cmpi('r4', 0); a.bc('eq', 'orig')
a.ldrh_i('r4', 'r1', 0)                                            # etiqueta do modelo (r1)
a.ldr_lit('r5', 10000); a.alu('cmp', 'r4', 'r5'); a.bc('lo', 'f2')
a.ldr_lit('r5', 10600); a.alu('cmp', 'r4', 'r5'); a.bc('lo', 'anim')
a.label('f2')
a.ldr_lit('r5', 65000); a.alu('cmp', 'r4', 'r5'); a.bc('lo', 'orig')
a.ldr_lit('r5', 65100); a.alu('cmp', 'r4', 'r5'); a.bc('hs', 'orig')
a.label('anim')                                                     # conta as livres (inUse = bit 0 de +0x3E)
a.mov('r4', 0); a.ldr_lit('r5', SPRITES + 0x3E); a.mov('r7', 64)
a.label('laco'); a.ldrb_i('r6', 'r5', 0); a.lsl('r6', 'r6', 31); a.bc('ne', 'usada'); a.addi('r4', 1)
a.label('usada'); a.addi('r5', 0x44); a.subi('r7', 1); a.bc('ne', 'laco')
a.cmpi('r4', RESERVA); a.bc('hs', 'orig')
a.pop(['r4', 'r5', 'r6', 'r7']); a.mov('r0', 64); a.bx('lr')       # sem lugar: MAX_SPRITES
a.label('orig'); a.pop(['r4', 'r5', 'r6', 'r7'])
for h in (0xB5F0, 0x4657, 0x464E, 0x4645, 0xB4E0, 0x4688, 0x1C15, 0x1C1E): a.h(h)   # trocadas de 0x080076DC
a.ldr_lit('r4', 0x080076ED); a.bx('r4')                            # r4 é lido de novo em 0x080076EC
a.pool()
code = a.build()
assert E + len(code) <= 0x09FF7F00
salta = struct.pack('<HHIII', 0x4778, 0x46C0, 0xE59FC000, 0xE12FFF1C, E | 1)
json.dump([[E - 0x08000000, list(code)], [0x76DC, list(salta)]], open('figuras_patch.json', 'w'))
print('código', hex(E), '..', hex(E + len(code)))
