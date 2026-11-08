# IA da luta dos 3 mirando o Pokémon do meio (08/11, pedido do usuário: o Wattson usou golpe Elétrico em quem resiste em vez
# do pássaro do meio). A IA do Quetzal pontua alvos só nos lugares 0-3; o do meio é o lugar 4. Quando o inimigo já escolheu
# golpe e alvo (OpponentHandleChooseMove, 0x08095544, logo antes de mandar a escolha), na tripla e só para golpe de dano com alvo
# escolhido: calcula a eficácia do tipo do golpe (tabela 20x20 em 0x08538110, u32, 0x1000 = 1x) contra os 3 do nosso lado
# (lugares 0, 2 e 4, vivos e presentes) e sorteia o alvo com peso = eficácia (2x, 1x, 1x -> 50%, 25%, 25%).
# Uso: python gen_ia.py -> linhas para TELA_COOP3 (linkhle.js); JSON=arquivo grava em json.
import sys, os, json, struct
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'metaknight'))
from thumb import Asm
R = 0x08000000
E = 0x09FF71C0                     # depois da fuga (gen_fuga.py vai até 0x09FF71A4)
GANCHO = 0x08095544                # ldr r4, =gBattlerTarget; ldrb r1, [r4]  -> bl PONTE
PONTE = 0x0808A4E8                 # fim da rotina de item antiga (copiada para 0x09FF6E80 em gen_item.py): livre
FLAG, MONS, TARGET, ABSENT, RANDOM = 0x0203FE00, 0x0203F424, 0x02023205, 0x02023209, 0x080A69D0
MOVES, TIPOS, NTIPOS = 0x0853AD34, 0x08538110, 20
ROM = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'roms', 'PokemonQuetzalCoop3Teste.gba')
d = open(ROM, 'rb').read()
assert d[GANCHO - R:GANCHO - R + 4] == bytes([0x0A, 0x4C, 0x21, 0x78])
assert struct.unpack_from('<I', d, (((GANCHO + 4) & ~3) + 0x28) - R)[0] == TARGET
assert struct.unpack_from('<9I', d, TIPOS - R) == (0x1000,) * 5 + (0x800, 0x1000, 0, 0x800)   # linha Normal

a = Asm(E)
# ---- eff: r0 = lugar, r5 = tipo do golpe -> r0 = multiplicador (0x1000 = 1x) ou -1 (ausente/desmaiado) ----
a.label('eff')
a.push(['r4'], lr=True)
a.ldr_lit('r1', ABSENT); a.ldrb_i('r1', 'r1', 0); a.mov('r2', 1); a.h(0x4082)        # lsls r2, r0
a.alu('tst', 'r1', 'r2'); a.bc('ne', 'e_neg')
a.mov('r1', 0x60); a.alu('mul', 'r1', 'r0'); a.ldr_lit('r4', MONS); a.add_r('r4', 'r4', 'r1')
a.addi('r4', 0x20)                                                                   # r4 = mon + 0x20 (ldrb só alcança 31)
a.ldrh_i('r1', 'r4', 0x0A); a.cmpi('r1', 0); a.bc('eq', 'e_neg')                     # vida (+0x2A)
a.mov('r1', NTIPOS * 4); a.alu('mul', 'r1', 'r5'); a.ldr_lit('r2', TIPOS); a.add_r('r3', 'r1', 'r2')   # r3 = linha do tipo
a.ldr_lit('r0', 0x1000)
for k, off in enumerate((0x02, 0x03, 0x04)):                                       # tipos em +0x22..0x24
    pula = 'e_t%d' % k
    a.ldrb_i('r1', 'r4', off); a.cmpi('r1', NTIPOS); a.bc('hs', pula)
    if off == 0x04: a.cmpi('r1', 9); a.bc('eq', pula)                                 # 3º tipo "nenhum"
    for prev in (0x02, 0x03)[:k]:
        a.ldrb_i('r2', 'r4', prev); a.alu('cmp', 'r1', 'r2'); a.bc('eq', pula)        # tipo repetido conta uma vez
    a.lsl('r1', 'r1', 2); a.h(0x5800 | (1 << 6) | (3 << 3) | 1)                         # ldr r1, [r3, r1]
    a.alu('mul', 'r0', 'r1'); a.h(0x0B00 | (12 << 6) | (0 << 3) | 0)                    # lsrs r0, r0, #12  (0x0800|imm<<6)
    a.label(pula)
a.label('e_fim')
a.pop(['r4']); a.pop(['r1']); a.bx('r1')
a.label('e_neg')
a.ldr_lit('r0', 0xFFFFFFFF); a.b('e_fim')
a.pool()

# ---- ia: chamada do gancho (lr = volta). Usa r0-r4 livres, guarda r5-r7. Sai com r4 = &gBattlerTarget, r1 = alvo ----
if a.here() % 4: a.h(0x46C0)
a.label('ia')
a.push(['r5', 'r6', 'r7'], lr=True)
a.ldr_lit('r0', FLAG); a.ldrb_i('r0', 'r0', 0); a.cmpi('r0', 1); a.bc('ne', 'fim')
a.mov('r0', 1); a.alu('tst', 'r6', 'r0'); a.bc('eq', 'fim')                           # só lugar do inimigo (ímpar)
a.mov('r0', 24); a.alu('mul', 'r0', 'r7'); a.ldr_lit('r1', MOVES); a.add_r('r5', 'r0', 'r1')
a.ldrb_i('r0', 'r5', 0xB); a.cmpi('r0', 2); a.bc('eq', 'fim')                        # golpe de status
a.ldrb_i('r0', 'r5', 2); a.cmpi('r0', 0); a.bc('eq', 'fim')                          # sem poder
a.ldrh_i('r0', 'r5', 8); a.cmpi('r0', 0); a.bc('ne', 'fim')                          # alvo que não é "escolhido"
a.ldrb_i('r5', 'r5', 3)                                                              # r5 = tipo
a.h(0xB083)                                                                          # sub sp, #12
for k, b in enumerate((0, 2, 4)):
    a.mov('r0', b); a.bl('eff'); a.h(0x9000 | k)                                     # str r0, [sp, #4k]
# pesos = eficácia (desmaiado/ausente = 0); sorteio proporcional (pedido do usuário em 08/11: "sempre no mais fraco" parecia
# marcação: com Thunderbolt contra Voador no meio, 12 de 12 iam nele). Ex.: 2x, 1x, 1x -> 50%, 25%, 25%.
for k in range(3):
    a.h(0x9900 | k); a.cmpi('r1', 0); a.bc('ge', 'z%d' % k); a.mov('r1', 0); a.h(0x9100 | k); a.label('z%d' % k)   # str r1, [sp, #4k]
a.h(0x9C00); a.h(0x9901); a.add_r('r4', 'r4', 'r1'); a.h(0x9902); a.add_r('r4', 'r4', 'r1')                      # r4 = total
a.cmpi('r4', 0); a.bc('eq', 'fim2')                                                  # ninguém pode levar: fica a IA
a.ldr_lit('r0', TARGET); a.ldrb_i('r6', 'r0', 0)
a.mov('r0', 1); a.alu('tst', 'r6', 'r0'); a.bc('ne', 'fim2')                         # alvo atual tem que ser do nosso lado
a.cmpi('r6', 4); a.bc('hi', 'fim2')
a.ldr_lit('r3', RANDOM | 1); a.bl('c3r')                                             # r0 = Random() (0..65535)
a.alu('mul', 'r0', 'r4'); a.h(0x0C00)                                                # lsrs r0, r0, #16 -> 0..total-1
for k in range(2):
    a.h(0x9900 | k); a.alu('cmp', 'r0', 'r1'); a.bc('lo', 'p%d' % k); a.h(0x1A40)  # subs r0, r0, r1
a.mov('r6', 4); a.b('escreve')
for k in range(2):
    a.label('p%d' % k); a.mov('r6', 2 * k); a.b('escreve')
a.label('c3r'); a.bx('r3')
a.label('escreve')
a.ldr_lit('r0', TARGET); a.strb_i('r6', 'r0', 0)
a.label('fim2')
a.h(0xB003)                                                                          # add sp, #12
a.label('fim')
a.ldr_lit('r4', TARGET); a.ldrb_i('r1', 'r4', 0)
a.pop(['r5', 'r6', 'r7']); a.pop(['r2']); a.bx('r2')
a.pool()
code = a.build()
IA = a.labels['ia']
fim = E + len(code)
assert fim <= 0x09FF7F00 and all(b == 0xFF for b in d[E - R:fim - R])
ponte = struct.pack('<HHIII', 0x4778, 0x46C0, 0xE59FC000, 0xE12FFF1C, IA | 1)
g = Asm(GANCHO); g.bl(PONTE); gancho = g.build()
patch = [[E - R, list(code)], [PONTE - R, list(ponte)], [GANCHO - R, list(gancho)]]
if os.environ.get('JSON'): json.dump(patch, open(os.environ['JSON'], 'w'))
print('    // IA 0x%08X, fim 0x%08X' % (IA | 1, fim))
for at, b in patch:
    print('    [0x%X, [%s]],' % (at, ', '.join('0x%02X' % x for x in b)))
