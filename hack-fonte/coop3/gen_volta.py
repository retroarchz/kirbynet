# Fim da luta dos 3: a equipe de cada um voltava pela conta do coop de 2 (id 0 pega os espaços 0-2 da batalha, os outros
# 3-5): o André ficava com o Cubchoo do Sandro, o Sandro e o Luan perdiam Pokémon. Desvio em 0x080B1A1C (dentro da
# função de devolver 0x080B19A4): na luta de 3 (bandeira 0x0203FE00), o jogador p (id 0x030055F0) recebe os espaços
# 2p e 2p+1 da batalha nas posições dos 2 primeiros escolhidos (gSelectedOrderFromParty 0x0203EA2C, base 1) e o 3º
# escolhido volta igual ao save (SaveBlock1 + 0x6A8). Fora da luta de 3, faz o que o jogo fazia.
import sys, struct, json
sys.path.insert(0, 'C:/Users/Sandro/Downloads/kirbynet-site-retroarchz/hack-fonte/metaknight')
from thumb import Asm
E = 0x09FF3C00; SITE = 0x080B1A1C; VEN = 0x0808A492
PARTY, SEL, MYID, FLAG, SB1, MEMCPY = 0x020235CC, 0x0203EA2C, 0x030055F0, 0x0203FE00, 0x030055BC, 0x084BFF15
a = Asm(E)
a.push(['r4', 'r5', 'r6', 'r7'], lr=True)                   # sp+16 = lr (volta); sp+20 = sp do chamador (área temporária)
a.ldr_lit('r0', FLAG); a.ldrb_i('r0', 'r0', 0); a.cmpi('r0', 0); a.bc('ne', 'tripla')
# --- original: id != 0 -> 0x080B1AB8; senão r5 = equipe, r0 = sp do chamador -> 0x080B1A28
a.ldr_lit('r0', MYID); a.ldrb_i('r0', 'r0', 0); a.cmpi('r0', 0); a.bc('eq', 'id0')
a.ldr_lit('r1', 0x080B1AB9); a.h(0x9104); a.pop(['r4', 'r5', 'r6', 'r7']); a.pop([], pc=True)   # str r1,[sp,#16]
a.label('id0')
a.ldr_lit('r1', 0x080B1A29); a.h(0x9104); a.pop(['r4', 'r5', 'r6', 'r7'])
a.ldr_lit('r5', PARTY); a.h(0xA801)                           # add r0, sp, #4 (sp do chamador)
a.pop([], pc=True)
# --- luta de 3: área temporária [0] = batalha[2p], [1] = batalha[2p+1], [2] = save[escolhido 3 - 1]; depois o código
# original (0x080B1A4C) põe cada um na posição do escolhido (r5 = equipe, r6 = área+0x68, r7 = área+0xD0)
a.label('tripla')
a.ldr_lit('r6', MYID); a.ldrb_i('r6', 'r6', 0); a.lsl('r6', 'r6', 1)          # r6 = 2p
for k in (0, 1):
    a.h(0xA805 + 0)                                           # add r0, sp, #20
    if k: a.addi('r0', 0x68)
    a.movh('r1', 'r6')
    if k: a.addi('r1', 1)
    a.mov('r2', 0x68); a.alu('mul', 'r1', 'r2'); a.ldr_lit('r2', PARTY); a.add_r('r1', 'r1', 'r2')
    a.mov('r2', 0x68); a.ldr_lit('r3', MEMCPY); a.bl('via')
a.ldr_lit('r0', SEL); a.ldrb_i('r1', 'r0', 2); a.subi('r1', 1); a.cmpi('r1', 5); a.bc('hi', 'fim')
a.mov('r2', 0x68); a.alu('mul', 'r1', 'r2'); a.ldr_lit('r0', SB1); a.ldr_i('r0', 'r0', 0); a.add_r('r1', 'r1', 'r0'); a.ldr_lit('r0', 0x6A8); a.add_r('r1', 'r1', 'r0')
a.h(0xA805); a.addi('r0', 0xD0); a.mov('r2', 0x68); a.ldr_lit('r3', MEMCPY); a.bl('via')
a.label('fim')
a.ldr_lit('r1', 0x080B1A4D); a.h(0x9104); a.pop(['r4', 'r5', 'r6', 'r7'])
a.ldr_lit('r5', PARTY); a.h(0xAE1B); a.h(0xAF35)              # add r6, sp, #0x6C ; add r7, sp, #0xD4
a.pop([], pc=True)
a.label('via'); a.bx('r3'); a.pool()
code = a.build()
assert E + len(code) <= 0x09FF3E00, hex(E + len(code))
off = (VEN - (SITE + 2 + 4)) >> 1
site = struct.pack('<H', 0x4B01) + struct.pack('<HH', 0xF000 | (off >> 11) & 0x7FF, 0xF800 | off & 0x7FF) + struct.pack('<H', 0x46C0) + struct.pack('<I', E | 1)
assert SITE % 4 == 0
esc = [[E - 0x08000000, list(code)], [SITE - 0x08000000, list(site)]]
json.dump(esc, open('volta_patch.json', 'w'))
for at, b in esc: print('    [0x%X, [%s]],' % (at, ', '.join('0x%02X' % x for x in b)))
