# Luta dos 3: na volta de uma tela (lista de golpes, equipe, mochila, dados), a remontagem da batalha
# (CB2_ReshowBattleScreenAfterMenu, estados 7-18: imagem 0x080FB414, Pokémon 0x080FB504, caixa de vida 0x080FB860)
# só refazia os lugares 0-3 da dupla: o Pokémon do meio (lugar 4) sumia, com a caixa de vida. Agora o estado 18
# (caixa do lugar 3, em 0x080FB2F0) faz também os três passos do lugar 4, se a tripla está ligada e ele não está ausente.
import sys, struct, json
sys.path.insert(0, 'C:/Users/Sandro/Downloads/kirbynet-site-retroarchz/hack-fonte/metaknight')
from thumb import Asm

E = 0x09FF6A20
FLAG, ABSENT, COUNT = 0x0203FE00, 0x02023209, 0x02023044
R = open('C:/Users/Sandro/Downloads/kirbynet-site-retroarchz/hack-fonte/coop3/.runtime/rom-site.gba', 'rb').read()
assert R[0xFB2F0:0xFB2F8].hex() == '0320' + R[0xFB2F2:0xFB2F6].hex() + R[0xFB2F6:0xFB2F8].hex()
assert R[0xFB2F0:0xFB2F2].hex() == '0320'

a = Asm(E)
def chama(addr, b):
    a.mov('r0', b); a.ldr_lit('r3', addr | 1); a.bl('via')
a.push(['r4'], lr=True)
chama(0x080FB860, 3)                                         # o que o estado fazia
# escudos do Protetor Glacial (protetor.py, 0x0203FF80 + 16*lugar: +0 fase, +3 sprite+1, +13 última fase, +14/+15 efeitos):
# a remontagem apaga as figuras depois que eles são recriados (estados 3/4); zera o sprite para a tarefa criar de novo,
# sem o efeito de transformação. Antes a tarefa seguia mexendo no número antigo, que passava a ser de outro (o OLKK)
a.ldr_lit('r1', 0x0203FF80); a.mov('r2', 0)
a.label('esc')
a.ldrb_i('r0', 'r1', 0); a.cmpi('r0', 0); a.bc('eq', 'escp')
a.strb_i('r0', 'r1', 13); a.mov('r0', 0); a.strb_i('r0', 'r1', 3); a.strb_i('r0', 'r1', 14); a.strb_i('r0', 'r1', 15)
a.label('escp'); a.addi('r1', 16); a.addi('r2', 1); a.cmpi('r2', 6); a.bc('lo', 'esc')
a.ldr_lit('r0', FLAG); a.ldrb_i('r0', 'r0', 0); a.cmpi('r0', 0); a.bc('eq', 'fim')
a.ldr_lit('r0', COUNT); a.ldrb_i('r0', 'r0', 0); a.cmpi('r0', 4); a.bc('ls', 'fim')
a.ldr_lit('r0', ABSENT); a.ldrb_i('r0', 'r0', 0); a.mov('r1', 0x10); a.alu('tst', 'r0', 'r1'); a.bc('ne', 'fim')
chama(0x080FB414, 4)                                         # imagem
chama(0x080FB504, 4)                                         # Pokémon
chama(0x080FB860, 4)                                         # caixa de vida
a.label('fim')
a.pop(['r4']); a.pop(['r0'])
a.ldr_lit('r3', 0x080FB3D3); a.bx('r3')                      # segue como o "b 0x080FB3D2" do estado (lr do estado já foi)
a.label('via'); a.bx('r3')
a.pool()
# estado 4 (0x080FB254: gReservedSpritePaletteCount = 4): na tripla são 6 (como na abertura do coop3), senão a paleta do
# Pokémon do lugar 4 cai no espaço da paleta das caixas de vida e elas ficam escuras
a.label('paletas')
a.mov('r0', 4); a.ldr_lit('r1', FLAG); a.ldrb_i('r1', 'r1', 0); a.cmpi('r1', 0); a.bc('eq', 'pal'); a.mov('r0', 6)
a.label('pal'); a.ldr_lit('r1', 0x030033BC); a.strb_i('r0', 'r1', 0)
a.ldr_lit('r3', 0x080FB3D3); a.bx('r3')
a.pool()
code = a.build()
assert E + len(code) <= 0x09FF7F00
ponte = struct.pack('<HH', 0x4B00, 0x4718) + struct.pack('<I', E | 1)     # ldr r3,[pc,#0]; bx r3; .word (0x080FB2F0 % 4 == 0)
ponte2 = struct.pack('<HH', 0x4B00, 0x4718) + struct.pack('<I', a.labels['paletas'] | 1)
assert R[0xFB254:0xFB25C].hex()[:8] == '01490420'   # ldr r1,=0x030033BC ; movs r0,#4
lista = [[E - 0x08000000, list(code)], [0x080FB2F0 - 0x08000000, list(ponte)], [0x080FB254 - 0x08000000, list(ponte2)]]
json.dump(lista, open('remonta_patch.json', 'w'))
print('código', hex(E), '..', hex(E + len(code)))
