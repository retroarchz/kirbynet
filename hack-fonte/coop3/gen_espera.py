# Luta dos 3: a entrada de um Pokémon do jogador (controle 0x080900C4) espera, sem prazo, a caixa de vida e a figura
# pararem (callback = SpriteCallbackDummy) e a marca "animação de brilho terminou" (healthBoxesData[b] +1 bit 0). Ao vivo
# (08/11, logs na nuvem: Frigibax entrando no lugar do meio) uma delas nunca terminava e a luta parava para sempre.
# Agora, na tripla, se o mesmo lugar espera mais de 4 s (240 quadros seguidos), o jogo dá as três como terminadas e segue.
import sys, struct, json
sys.path.insert(0, 'C:/Users/Sandro/Downloads/kirbynet-site-retroarchz/hack-fonte/metaknight')
from thumb import Asm
E = 0x09FF6B00
FLAG, SPRITES, CB_DUMMY = 0x0203FE00, 0x02020630, 0x08007E59
SPR_IDS, HB_IDS, SPRDATA = 0x0203F664, 0x0203F9F8, 0x02023570
VBL = 0x03002680                       # gMain.vblankCounter1
INI, ULT = 0x0203F3B0, 0x0203F3BC      # u16 x 6: quadro em que começou a esperar / última chamada
LIMITE = 240
R = open('C:/Users/Sandro/Downloads/kirbynet-site-retroarchz/hack-fonte/coop3/.runtime/rom-site.gba', 'rb').read()
assert R[0x900C4:0x900D4].hex() == 'f0b5061c274a28483018017808014018', R[0x900C4:0x900D4].hex()
a = Asm(E)
a.push(['r0', 'r4', 'r5', 'r6', 'r7'], lr=True)
a.movh('r6', 'r0')                                              # r6 = lugar
a.ldr_lit('r1', FLAG); a.ldrb_i('r1', 'r1', 0); a.cmpi('r1', 0); a.bc('eq', 'fim')
a.cmpi('r6', 5); a.bc('hi', 'fim')
a.ldr_lit('r0', VBL); a.ldr_i('r4', 'r0', 0); a.lsl('r4', 'r4', 16); a.h(0x0C24)   # lsrs r4,r4,#16 -> quadro (u16)
a.lsl('r5', 'r6', 1)                                            # r5 = 2*lugar
a.ldr_lit('r7', ULT); a.add_r('r7', 'r7', 'r5'); a.ldrh_i('r0', 'r7', 0); a.strh_i('r4', 'r7', 0)
a.h(0x1A20)                                                     # subs r0,r4,r0 (quadros desde a última chamada)
a.lsl('r0', 'r0', 16); a.h(0x0C00)                              # lsrs r0,r0,#16
a.ldr_lit('r7', INI); a.add_r('r7', 'r7', 'r5')
a.cmpi('r0', 5); a.bc('ls', 'segue'); a.strh_i('r4', 'r7', 0)    # espera nova: começa a contar
a.label('segue')
a.ldrh_i('r0', 'r7', 0); a.h(0x1A20); a.lsl('r0', 'r0', 16); a.h(0x0C00)            # r0 = quadros esperando
a.ldr_lit('r1', LIMITE); a.alu('cmp', 'r0', 'r1'); a.bc('lo', 'fim')
a.strh_i('r4', 'r7', 0)                                         # força: marca de brilho, figura e caixa paradas
a.ldr_lit('r0', SPRDATA); a.ldr_i('r0', 'r0', 0); a.ldr_i('r0', 'r0', 4)
a.mov('r1', 12); a.alu('mul', 'r1', 'r6'); a.add_r('r0', 'r0', 'r1'); a.ldrb_i('r1', 'r0', 1); a.mov('r2', 1); a.alu('orr', 'r1', 'r2'); a.strb_i('r1', 'r0', 1)
a.ldr_lit('r3', CB_DUMMY)
for ids in (SPR_IDS, HB_IDS):
    a.ldr_lit('r0', ids); a.ldrb_r('r0', 'r0', 'r6'); a.cmpi('r0', 64); a.bc('hs', 'p%x' % ids)
    a.mov('r1', 0x44); a.alu('mul', 'r0', 'r1'); a.ldr_lit('r1', SPRITES); a.add_r('r0', 'r0', 'r1'); a.str_i('r3', 'r0', 0x1C)
    a.label('p%x' % ids)
a.label('fim')
a.pop(['r0', 'r4', 'r5', 'r6', 'r7']); a.pop(['r1']); a.movh('lr', 'r1')
a.h(0xB5F0); a.h(0x1C06)                                        # trocadas de 0x080900C4
a.ldr_lit('r2', SPRITES); a.ldr_lit('r0', HB_IDS); a.h(0x1830); a.h(0x7801); a.h(0x0108); a.h(0x1840)
a.ldr_lit('r3', 0x080900D5); a.bx('r3')
a.pool()
code = a.build()
assert E + len(code) <= 0x09FF7F00
salta = struct.pack('<HHIII', 0x4778, 0x46C0, 0xE59FC000, 0xE12FFF1C, E | 1)
json.dump([[E - 0x08000000, list(code)], [0x900C4, list(salta)]], open('espera_patch.json', 'w'))
print('código', hex(E), '..', hex(E + len(code)))
