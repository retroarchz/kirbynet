# Luta dos 3: a tela de trocar Pokémon mostra só os Pokémon de quem está escolhendo (pedido do Sandro, print 07/11 22:08:
# o André via o Cubchoo do Sandro e o OLKK/Frigibax do Luan). Ao abrir, o jogo põe a equipe na ordem da batalha
# (UpdatePartyToBattleOrder 0x0823FCBC: equipe[f(i)] = antiga[i], f = 0x0823FC78); logo depois, os espaços dos outros
# (dono do espaço antigo i = i >> 1, o id do cabo) vão para 0x0203F000 e ficam vazios; antes de voltar à ordem do campo
# (UpdatePartyToFieldOrder 0x0823FD0C) eles voltam. Só com a bandeira da luta de 3 (0x0203FE00).
import sys, struct, json
sys.path.insert(0, 'C:/Users/Sandro/Downloads/kirbynet-site-retroarchz/hack-fonte/metaknight')
from thumb import Asm

E = 0x09FF6600
FLAG = 0x0203FE00
GUARDA = 0x0203F000        # 6 x 0x68
MASCARA = 0x0203F3FB       # quais espaços (novos) estão guardados
ASSINA = 0x0203F3FC        # 0xA55A quando a máscara vale (a memória pode ter lixo)
MEU = 0x030055F0           # id do cabo
EQUIPE = 0x020235CC
F = 0x0823FC79             # espaço da batalha -> espaço da tela
MEMCPY = 0x084BFF15
ALLOC = 0x08000BD1
import os
RES2 = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'reserva2.json')))

R = open('C:/Users/Sandro/Downloads/kirbynet-site-retroarchz/hack-fonte/coop3/.runtime/rom-site.gba', 'rb').read()
PROLOGO = bytes.fromhex('70b59c24a400201c')
assert R[0x23FCBC:0x23FCC4] == PROLOGO and R[0x23FD0C:0x23FD14] == PROLOGO

a = Asm(E)
def chama(addr):
    a.ldr_lit('r3', addr); a.bl('via')

def prologo(volta):   # o começo trocado das duas funções (push; r0 = 0x270; Alloc; r5 = bloco; r1 = equipe) e segue
    for h in (0xB570, 0x249C, 0x00A4, 0x1C20): a.h(h)
    chama(ALLOC)
    a.movh('r5', 'r0'); a.ldr_lit('r1', EQUIPE); a.ldr_lit('r3', volta | 1); a.bx('r3')

# --- para a batalha: roda a original e depois esconde
a.label('batalha')
a.push(['r4', 'r5', 'r6', 'r7'], lr=True)
a.bl('orig_b')
a.ldr_lit('r0', FLAG); a.ldrb_i('r0', 'r0', 0); a.cmpi('r0', 0); a.bc('eq', 'bfim')
a.ldr_lit('r0', ASSINA); a.ldrh_i('r0', 'r0', 0); a.ldr_lit('r1', 0xA55A); a.alu('cmp', 'r0', 'r1'); a.bc('eq', 'bfim')
a.ldr_lit('r0', MASCARA); a.mov('r1', 0); a.strb_i('r1', 'r0', 0)
a.ldr_lit('r0', MEU); a.ldrb_i('r6', 'r0', 0)          # r6 = meu id
a.mov('r4', 0)                                          # r4 = espaço antigo i
a.label('blaco')
a.lsl('r0', 'r4', 0); a.h(0x0840)                       # lsrs r0,r0,#1 (dono = i >> 1)
a.alu('cmp', 'r0', 'r6'); a.bc('eq', 'bprox')
a.movh('r0', 'r4'); chama(F); a.lsl('r0', 'r0', 24); a.h(0x0E07)   # lsrs r7,r0,#24 -> r7 = espaço novo
a.cmpi('r7', 5); a.bc('hi', 'bprox')
a.mov('r0', 0x68); a.alu('mul', 'r0', 'r7'); a.movh('r5', 'r0')      # r5 = deslocamento
a.ldr_lit('r1', EQUIPE); a.add_r('r1', 'r1', 'r5'); a.ldr_lit('r0', GUARDA); a.add_r('r0', 'r0', 'r5'); a.mov('r2', 0x68); chama(MEMCPY)   # guarda
a.ldr_lit('r1', EQUIPE); a.add_r('r1', 'r1', 'r5'); a.mov('r0', 0); a.mov('r2', 0x68)
a.label('bzera'); a.subi('r2', 1); a.strb_r('r0', 'r1', 'r2'); a.cmpi('r2', 0); a.bc('ne', 'bzera')   # esvazia
a.mov('r0', 1); a.h(0x40B8)                             # lsls r0,r7 (bit do espaço novo)
a.ldr_lit('r1', MASCARA); a.ldrb_i('r2', 'r1', 0); a.alu('orr', 'r2', 'r0'); a.strb_i('r2', 'r1', 0)
a.label('bprox'); a.addi('r4', 1); a.cmpi('r4', 6); a.bc('lo', 'blaco')
a.ldr_lit('r0', ASSINA); a.ldr_lit('r1', 0xA55A); a.strh_i('r1', 'r0', 0)
chama(RES2['mostra'])                                   # reserva na vaga 3 (gen_reserva2.py)
a.label('bfim'); a.pop(['r4', 'r5', 'r6', 'r7']); a.pop(['r0']); a.bx('r0')
a.label('orig_b'); prologo(0x0823FCCC)
a.label('via'); a.bx('r3')
a.pool()

# --- para o campo: devolve os guardados e roda a original
a.label('campo')
a.push(['r0', 'r4', 'r5', 'r6', 'r7'], lr=True)
a.ldr_lit('r0', ASSINA); a.ldrh_i('r0', 'r0', 0); a.ldr_lit('r1', 0xA55A); a.alu('cmp', 'r0', 'r1'); a.bc('ne', 'cfim')
a.ldr_lit('r0', MASCARA); a.ldrb_i('r6', 'r0', 0)
a.mov('r7', 0)
a.label('claco')
a.mov('r0', 1); a.h(0x40B8); a.alu('tst', 'r0', 'r6'); a.bc('eq', 'cprox')     # lsls r0,r7
a.mov('r0', 0x68); a.alu('mul', 'r0', 'r7'); a.movh('r5', 'r0')
a.ldr_lit('r0', EQUIPE); a.add_r('r0', 'r0', 'r5'); a.ldr_lit('r1', GUARDA); a.add_r('r1', 'r1', 'r5'); a.mov('r2', 0x68); chama(MEMCPY)
a.label('cprox'); a.addi('r7', 1); a.cmpi('r7', 6); a.bc('lo', 'claco')
a.ldr_lit('r0', MASCARA); a.mov('r1', 0); a.strb_i('r1', 'r0', 0); a.ldr_lit('r0', ASSINA); a.strh_i('r1', 'r0', 0)
a.ldr_lit('r0', 0x0203F3AB); a.strb_i('r1', 'r0', 0)        # RESNA = 0 (gen_reserva2.py)
a.label('cfim'); a.pop(['r0', 'r4', 'r5', 'r6', 'r7']); a.pop(['r1']); a.movh('lr', 'r1')
prologo(0x0823FD1C)
a.pool()

code = a.build()
assert E + len(code) <= 0x09FF7F00
salta = lambda alvo: struct.pack('<HHIII', 0x4778, 0x46C0, 0xE59FC000, 0xE12FFF1C, alvo | 1)
lista = [[E - 0x08000000, list(code)],
         [0x0823FCBC - 0x08000000, list(salta(a.labels['batalha']))],
         [0x0823FD0C - 0x08000000, list(salta(a.labels['campo']))]]
# o menu do Pokémon só oferece "trocar" se o espaço 1 da equipe tem Pokémon (GetPartyMenuActionsTypeInBattle 0x0823F6AC);
# com os espaços dos outros vazios isso falhava: agora olha o próprio Pokémon escolhido (r4): "ldr r0,=equipe[1]" -> "adds r0,r4,#0"
assert R[0x23F6B0:0x23F6B2] == bytes.fromhex('0848')
lista.append([0x0823F6B0 - 0x08000000, [0x20, 0x1C]])
json.dump(lista, open('esconde_patch.json', 'w'))
print('código', hex(E), '..', hex(E + len(code)))
