# Correção da tela de troca na luta dos 3 (gera as escritas para TELA_COOP3 do linkhle.js)
import sys, struct, json
sys.path.insert(0, 'C:/Users/Sandro/Downloads/kirbynet-site-retroarchz/hack-fonte/metaknight')
from thumb import Asm
FLAG, ORDEM = 0x0203FE00, 0x0203EA34
import os
RES2_RESNA = 0x0203F3AB
RES2 = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'reserva2.json')))
BASE = 0x09FF7AE0                                # (era 0x09FF3600; mudou em 08/11 ao crescer com a reserva)
VEN_BAIXO, VEN_ALTO = 0x0808A492, 0x084BDBD4     # "bx r3" ao alcance de cada ponto
SITES = [  # (endereço, registrador do quadrado, volta "parceiro", volta "meu")
    (0x08230E2A, 2, 0x08230E36, 0x08230E40),
    (0x0823F716, 5, 0x0823F722, 0x0823F744),
    (0x08247DCE, 0, 0x08247DDA, 0x08247DF4),
    (0x082480AA, 0, 0x082480B6, 0x082480CC),
]
a = Asm(BASE); entradas = []
for k, (site, reg, P, N) in enumerate(SITES):
    a.label('h%d' % k); entradas.append(('h%d' % k, site, VEN_ALTO))
    a.push(['r0', 'r1', 'r2'], lr=True)
    if reg: a.h(0x1C00 | reg << 3 | 0)                 # adds r0, rX, #0
    if site == 0x0823F716:                             # TrySwitchInPokemon (r5 = vaga): reserva escolhida na vaga 3 (gen_reserva2.py)
        a.ldr_lit('r2', FLAG); a.ldrb_i('r2', 'r2', 0); a.cmpi('r2', 0); a.bc('eq', 'R%d' % k)
        a.ldr_lit('r3', RES2['escolhe']); a.bl('X%d' % k); a.h(0x1C05)   # adds r5, r0, #0 (vaga a usar)
        a.label('R%d' % k)
    for v in (1, 4, 5): a.cmpi('r0', v); a.bc('eq', 'P%d' % k)
    a.cmpi('r0', 3); a.bc('ne', 'N%d' % k)
    a.ldr_lit('r2', FLAG); a.ldrb_i('r2', 'r2', 0); a.cmpi('r2', 0); a.bc('eq', 'N%d' % k)
    a.ldr_lit('r2', RES2_RESNA); a.ldrb_i('r2', 'r2', 0); a.cmpi('r2', 1); a.bc('ne', 'P%d' % k)   # luta de 3: quadrado 3 é de parceiro,
                                                                                             # a não ser que mostre a reserva do jogador (azul, dele)
    a.label('N%d' % k); a.ldr_lit('r2', N | 1); a.b('S%d' % k)
    a.label('P%d' % k); a.ldr_lit('r2', P | 1)
    a.label('S%d' % k); a.str_i('r2', 'sp', 12) if False else a.h(0x9203)   # str r2,[sp,#12]
    a.pop(['r0', 'r1', 'r2']); a.pop([], pc=True)
    if site == 0x0823F716: a.label('X%d' % k); a.bx('r3')
    a.pool()
# ordem da tela de troca: os 2 do jogador nos quadrados 0 e 2, os dos outros em 1,3,4,5 (só na luta de 3)
a.label('ordem'); entradas.append(('ordem', 0x08091B96, VEN_BAIXO))
a.push(['r2'], lr=True)
a.ldr_lit('r2', FLAG); a.ldrb_i('r2', 'r2', 0); a.cmpi('r2', 0); a.bc('eq', 'orig')
a.ldr_lit('r3', ORDEM)
a.cmpi('r7', 0); a.bc('eq', 'b0'); a.cmpi('r7', 2); a.bc('eq', 'b2'); a.cmpi('r7', 4); a.bc('ne', 'orig')
for i, v in enumerate((0x40, 0x51, 0x23)): a.mov('r2', v); a.strb_i('r2', 'r3', i)
a.b('orig')
a.label('b0'); a.mov('r2', 0x02); a.strb_i('r2', 'r3', 0); a.mov('r2', 0x13); a.strb_i('r2', 'r3', 1); a.b('w45')
a.label('b2'); a.mov('r2', 0x20); a.strb_i('r2', 'r3', 0); a.mov('r2', 0x31); a.strb_i('r2', 'r3', 1)
a.label('w45'); a.mov('r2', 0x45); a.strb_i('r2', 'r3', 2)
a.label('orig')                       # o que o jogo fazia: r0 = [sb] & 0x40000 (r1 = 0x40000); zero -> 0x08091BEC
a.movh('r1', 'r9'); a.ldr_i('r0', 'r1', 0); a.ldr_lit('r1', 0x40000); a.alu('and_', 'r0', 'r1')
a.cmpi('r0', 0); a.bc('eq', 'oz'); a.ldr_lit('r2', 0x08091BA5); a.b('os')
a.label('oz'); a.ldr_lit('r2', 0x08091BED)
a.label('os'); a.h(0x9201)            # str r2,[sp,#4]
a.pop(['r2']); a.pop([], pc=True)
a.pool()
code = a.build()
assert BASE + len(code) <= 0x09FF7F00, hex(len(code))
esc = [[BASE - 0x08000000, list(code)]]
for lab, site, ven in entradas:
    alvo = a.labels[lab] | 1
    off = (ven - (site + 2 + 4)) >> 1
    bl = struct.pack('<HH', 0xF000 | (off >> 11) & 0x7FF, 0xF800 | off & 0x7FF)
    b = struct.pack('<H', 0x4B01) + bl + struct.pack('<I', alvo)     # ldr r3,[pc,#4]; bl "bx r3"; literal
    assert (site + 2) % 4 == 0 and (site + 6) % 4 == 0, hex(site)
    esc.append([site - 0x08000000, list(b)])
print('código', len(code), 'bytes; entradas', {l: hex(a.labels[l]) for l, _, _ in entradas})
json.dump(esc, open('troca_patch.json', 'w'))
for at, b in esc: print('    [0x%X, [%s]],' % (at, ', '.join('0x%02X' % x for x in b)))
