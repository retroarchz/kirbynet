# Luta dos 3: o 3º Pokémon escolhido entra como reserva (pedido do Sandro 07/11: "cada um escolhe 1, 2 ou 3").
# A equipe da batalha tem 6 espaços (2 por jogador), então o 3º fica fora:
#  1) preparação (coop3.py, etapas livres 5 e 6): cada jogo manda o seu 3º (SaveBlock1 + 0x6A8, escolhido nº 3 de
#     gSelectedOrderFromParty 0x0203EA2C; vazio se escolheu menos de 3) e todos guardam as 3 reservas em RES3;
#  2) durante a luta, em todos os jogos (tarefa do cabo 0x08034308, todo quadro): se um espaço do jogador p está com
#     Pokémon desmaiado e NÃO está em campo (gBattlerPartyIndexes[2p]), troca com a reserva de p (uma vez só). Assim a
#     reserva aparece na tela de troca na próxima vez;
#  3) fim da luta (gen_volta.py): se a reserva foi usada, o que volta no lugar do 3º é o desmaiado guardado em RES3.
import sys, struct, json
sys.path.insert(0, 'C:/Users/Sandro/Downloads/kirbynet-site-retroarchz/hack-fonte/metaknight')
from thumb import Asm

E = 0x09FF6800
FLAG = 0x0203FE00
RES3 = 0x0203F270          # 3 x 0x68 (até 0x0203F3A8)
USADA = 0x0203F3A8         # 3 bytes
VALE = 0x0203F3AC          # 0xA55A quando RES3 foi preenchida nesta luta
PROX = 0x0203F3AE          # etapa que a etapa 4 queria (13 ou 7)
PARTY, PIDX, SEL, SB1 = 0x020235CC, 0x0203F400, 0x0203EA2C, 0x030055BC
RECV = 0x020223C4
GETMON = 0x0809EAC5
F_DONE, F_MASK, F_SEND, F_STATUS, F_RESET, F_MEMCPY = 0x0800C279, 0x0800C1E9, 0x0800C205, 0x0800C2A9, 0x0800C30D, 0x082BEA09
PROXIMA, SAI, REC = 0x09FF055B, 0x09FF0561, 0x09FF03DD

R = open('C:/Users/Sandro/Downloads/kirbynet-site-retroarchz/hack-fonte/coop3/.runtime/rom-site.gba', 'rb').read()
assert R[0x1FF034C:0x1FF0358].hex() == '0d21002800d00721297003e1'
assert R[0x1FF03CE:0x1FF03D8].hex() == '082e04d00a2e02d00c2e'
assert R[0x34308:0x34318].hex() == 'f0b54f464646c0b40006000e80462149'

a = Asm(E)
def chama(addr):
    a.ldr_lit('r3', addr); a.bl('via')
def salta(addr):
    a.ldr_lit('r3', addr); a.bx('r3')

# --- fim da etapa 4 (0x09FF034C; r0 = tem treinador?, r4 = meu id, r5 = &etapa): guarda a próxima e vai para a 5
a.label('fim4')
a.mov('r1', 13); a.cmpi('r0', 0); a.bc('eq', 'f4a'); a.mov('r1', 7)
a.label('f4a'); a.ldr_lit('r0', PROX); a.strb_i('r1', 'r0', 0)
a.mov('r1', 5); a.strb_i('r1', 'r5', 0); salta(SAI)

# --- etapas sem dono (0x09FF03CE; r6 = etapa): 8/10/12 seguem o original; 5 e 6 são as novas
a.label('desp')
a.cmpi('r6', 8); a.bc('eq', 'drec'); a.cmpi('r6', 10); a.bc('eq', 'drec'); a.cmpi('r6', 12); a.bc('eq', 'drec')
a.cmpi('r6', 5); a.bc('eq', 'e5'); a.cmpi('r6', 6); a.bc('eq', 'e6')
salta(SAI)
a.label('drec'); salta(REC)

# etapa 5: copia o meu 3º (ou zeros) para RES3[eu] e manda
a.label('e5')
chama(F_DONE); a.cmpi('r0', 0); a.bc('eq', 'e5sai')
a.mov('r0', 0x68); a.alu('mul', 'r0', 'r4'); a.ldr_lit('r1', RES3); a.add_r('r7', 'r0', 'r1')      # r7 = RES3[eu]
a.mov('r0', 0); a.mov('r2', 0x68)
a.label('e5zera'); a.subi('r2', 1); a.strb_r('r0', 'r7', 'r2'); a.cmpi('r2', 0); a.bc('ne', 'e5zera')
a.ldr_lit('r0', SEL); a.ldrb_i('r1', 'r0', 2); a.subi('r1', 1); a.cmpi('r1', 5); a.bc('hi', 'e5manda')
a.mov('r2', 0x68); a.alu('mul', 'r1', 'r2'); a.ldr_lit('r0', SB1); a.ldr_i('r0', 'r0', 0); a.add_r('r1', 'r1', 'r0')
a.ldr_lit('r0', 0x6A8); a.add_r('r1', 'r1', 'r0'); a.movh('r0', 'r7'); a.mov('r2', 0x68); chama(F_MEMCPY)
a.label('e5manda')
chama(F_MASK); a.movh('r1', 'r7'); a.mov('r2', 0x68); chama(F_SEND)
salta(PROXIMA)
a.label('e5sai'); salta(SAI)

# etapa 6: quando os 3 chegaram, guarda as 3 reservas e volta para a etapa que a 4 queria
a.label('e6')
chama(F_STATUS); a.mov('r1', 7); a.alu('and_', 'r0', 'r1'); a.cmpi('r0', 7); a.bc('ne', 'e5sai')
chama(F_RESET)
a.mov('r7', 0)
a.label('e6laco')
a.mov('r0', 0x68); a.alu('mul', 'r0', 'r7'); a.ldr_lit('r1', RES3); a.add_r('r0', 'r0', 'r1')
a.lsl('r1', 'r7', 8); a.ldr_lit('r2', RECV); a.add_r('r1', 'r1', 'r2'); a.mov('r2', 0x68); chama(F_MEMCPY)
a.ldr_lit('r0', USADA); a.mov('r1', 0); a.strb_r('r1', 'r0', 'r7')
a.addi('r7', 1); a.cmpi('r7', 3); a.bc('lo', 'e6laco')
a.ldr_lit('r0', VALE); a.ldr_lit('r1', 0xA55A); a.strh_i('r1', 'r0', 0)
a.ldr_lit('r0', PROX); a.ldrb_i('r1', 'r0', 0); a.strb_i('r1', 'r5', 0)
salta(SAI)
a.label('via'); a.bx('r3')
a.pool()

# --- todo quadro na luta (tarefa do cabo 0x08034308, r0 = tarefa): troca reserva por desmaiado fora de campo
a.label('tique')
a.push(['r0', 'r4', 'r5', 'r6', 'r7'], lr=True)
a.ldr_lit('r0', FLAG); a.ldrb_i('r0', 'r0', 0); a.cmpi('r0', 0); a.bc('eq', 'tfim')
a.ldr_lit('r0', VALE); a.ldrh_i('r0', 'r0', 0); a.ldr_lit('r1', 0xA55A); a.alu('cmp', 'r0', 'r1'); a.bc('ne', 'tfim')
a.mov('r4', 0)                                              # r4 = jogador p
a.label('tp')
a.ldr_lit('r0', USADA); a.ldrb_r('r0', 'r0', 'r4'); a.cmpi('r0', 0); a.bc('ne', 'tpprox')
a.mov('r0', 0x68); a.alu('mul', 'r0', 'r4'); a.ldr_lit('r1', RES3); a.add_r('r6', 'r0', 'r1')      # r6 = reserva de p
a.movh('r0', 'r6'); a.mov('r1', 0xB); chama(GETMON); a.cmpi('r0', 0); a.bc('eq', 'tpprox')
a.lsl('r5', 'r4', 1)                                        # r5 = espaço 2p (depois 2p+1)
a.label('ts')
a.lsl('r0', 'r4', 2); a.ldr_lit('r1', PIDX); a.add_r('r0', 'r0', 'r1'); a.ldrh_i('r0', 'r0', 0)    # PIDX[2p] (u16, lugar 2p)
a.alu('cmp', 'r0', 'r5'); a.bc('eq', 'tsprox')
a.mov('r0', 0x68); a.alu('mul', 'r0', 'r5'); a.ldr_lit('r1', PARTY); a.add_r('r7', 'r0', 'r1')     # r7 = espaço
a.movh('r0', 'r7'); a.mov('r1', 0xB); chama(GETMON); a.cmpi('r0', 0); a.bc('eq', 'tsprox')
a.movh('r0', 'r7'); a.mov('r1', 0x39); chama(GETMON); a.cmpi('r0', 0); a.bc('ne', 'tsprox')
a.mov('r2', 0x68)                                           # troca byte a byte
a.label('troca'); a.subi('r2', 1); a.ldrb_r('r0', 'r7', 'r2'); a.ldrb_r('r1', 'r6', 'r2'); a.strb_r('r1', 'r7', 'r2'); a.strb_r('r0', 'r6', 'r2')
a.cmpi('r2', 0); a.bc('ne', 'troca')
a.ldr_lit('r0', USADA); a.mov('r1', 1); a.strb_r('r1', 'r0', 'r4'); a.b('tpprox')
a.label('tsprox'); a.lsl('r0', 'r4', 1); a.addi('r0', 1); a.alu('cmp', 'r5', 'r0'); a.bc('eq', 'tpprox'); a.movh('r5', 'r0'); a.b('ts')
a.label('tpprox'); a.addi('r4', 1); a.cmpi('r4', 3); a.bc('lo', 'tp')
a.label('tfim'); a.pop(['r0', 'r4', 'r5', 'r6', 'r7']); a.pop(['r1']); a.movh('lr', 'r1')
for h in (0xB5F0, 0x464F, 0x4646, 0xB4C0, 0x0600, 0x0E00, 0x4680): a.h(h)                 # trocadas de 0x08034308
a.ldr_lit('r1', 0x03005640); salta(0x08034319)
a.pool()

code = a.build()
assert E + len(code) <= 0x09FF7F00, hex(E + len(code))
L = a.labels
ponte = lambda alvo, at: (struct.pack('<HH', 0x4B00, 0x4718) + struct.pack('<I', alvo | 1)) if at % 4 == 0 else \
                         (struct.pack('<HHH', 0x4B01, 0x4718, 0x46C0) + struct.pack('<I', alvo | 1))
salta16 = lambda alvo: struct.pack('<HHIII', 0x4778, 0x46C0, 0xE59FC000, 0xE12FFF1C, alvo | 1)
lista = [[E - 0x08000000, list(code)],
         [0x1FF034C, list(ponte(L['fim4'], 0x09FF034C))],
         [0x1FF03CE, list(ponte(L['desp'], 0x09FF03CE))],
         [0x34308, list(salta16(L['tique']))]]
assert len(lista[1][1]) <= 12 and len(lista[2][1]) <= 10
json.dump(lista, open('reserva_patch.json', 'w'))
print('código', hex(E), '..', hex(E + len(code)), {k: hex(v) for k, v in L.items() if k in ('fim4', 'desp', 'tique')})
