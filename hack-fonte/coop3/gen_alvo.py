# Luta dos 3: o alvo escolhido de cada lugar fica em gBattleStruct+0xC + 2*lugar (u16, feito para 4 lugares). O do lugar 4
# cai em +0x14, onde a experiência guarda o valor dela (u32, Cmd_getexp 0x080721FE): depois de um nocaute o alvo do Pokémon
# do meio virava lixo (33...) e o golpe dele acertava o Scizor (lugar 0) ou ele mesmo (08/11, "a vida cai mesmo").
# Na escolha (0x08045ABC, r7 = lugar, r0 = alvo) guarda uma cópia do alvo do lugar 4 em SAFE4; o fim da experiência na
# tripla (gen_exp.py, t_fim) devolve a cópia para +0x14. Os dois nunca são usados ao mesmo tempo.
import sys, struct, json
sys.path.insert(0, 'C:/Users/Sandro/Downloads/kirbynet-site-retroarchz/hack-fonte/metaknight')
from thumb import Asm
E = 0x09FF6E30
SAFE4 = 0x0203F3C8
R = open('C:/Users/Sandro/Downloads/kirbynet-site-retroarchz/hack-fonte/coop3/.runtime/rom-site.gba', 'rb').read()
assert R[0x45ABC:0x45ACC].hex() == '1080891949190978802008401e1c0028'
a = Asm(E)
a.h(0x8010)                                     # strh r0,[r2] (o do jogo)
a.cmpi('r7', 4); a.bc('ne', 'segue')
a.push(['r1']); a.ldr_lit('r1', SAFE4); a.strh_i('r0', 'r1', 0); a.pop(['r1'])
a.label('segue')
for h in (0x1989, 0x1949, 0x7809, 0x2080, 0x4008, 0x1C1E, 0x2800): a.h(h)   # o resto do trecho trocado (até cmp r0,#0)
a.push(['r0']); a.ldr_lit('r0', 0x08045ACD); a.h(0x4684); a.pop(['r0']); a.h(0x4760)   # mov ip,r0 ; bx ip (sem mexer nas marcas)
a.pool()
code = a.build()
assert E + len(code) <= 0x09FF7F00
salta = struct.pack('<HHIII', 0x4778, 0x46C0, 0xE59FC000, 0xE12FFF1C, E | 1)
json.dump([[E - 0x08000000, list(code)], [0x45ABC, list(salta)]], open('alvo_patch.json', 'w'))
print('código', hex(E), '..', hex(E + len(code)))
