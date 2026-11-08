# IA da luta dos 3 escolhendo o alvo do mesmo jeito da IA do jogo, incluindo o Pokémon do meio (08/11).
# A IA do Quetzal (ChooseMoveOrAction_Doubles 0x081A6078) dá nota a cada alvo pelos scripts de IA, mas só nos lugares 0-3, e a
# tabela de dados dela (gBattleResources->aiData, 0x228 bytes) só comporta 4 Pokémon (o meio é o lugar 4; ver gen_iadados.py).
# Quando o inimigo já escolheu um golpe de dano com alvo escolhido (OpponentHandleChooseMove, 0x08095544), na tripla:
#   - calcula com o AI_CalcDamage do jogo (0x081B19D8, o mesmo dano esperado que a IA usa) o dano do golpe nos 3 do nosso lado
#     (0, 2 e o meio 4, vivos e presentes). Para o meio, põe por um instante a habilidade e o efeito do item dele nos dois pontos
#     da tabela que o cálculo lê para o alvo (abilities[4] = +8, holdEffects[4] = +0x18) e devolve depois;
#   - nota: derruba = 1000; senão, % da vida atual que tira; escolhe a maior, sorteando (Random do jogo) entre os que ficam a
#     até 10 pontos dela (nocaute só empata com nocaute). Ninguém leva dano: fica a escolha da IA.
# Uso: python gen_ia.py -> linhas para TELA_COOP3 (linkhle.js); JSON=arquivo grava em json.
import sys, os, json, struct
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'metaknight'))
from thumb import Asm
R = 0x08000000
E = 0x09FF7780                     # área livre (0x09FF7700.. é do alvo_aliado do game.js, até 0x09FF7764)
GANCHO = 0x08095544                # ldr r4, =gBattlerTarget; ldrb r1, [r4]  -> bl PONTE
PONTE = 0x0808A4E8
FLAG, MONS, TARGET, ABSENT, RES = 0x0203FE00, 0x0203F424, 0x02023205, 0x02023209, 0x02023538
MOVES = 0x0853AD34
CALC, CLIMA, ITEM = 0x081B19D8, 0x081B2C80, 0x0805CE9C      # AI_CalcDamage, AI_GetWeather(aiData), GetBattlerHoldEffect
RANDOM, DIV, MOD = 0x080A69D0, 0x084BE660, 0x084BE6D8       # Random, __divsi3, __modsi3 (os mesmos que a IA chama)
TOL, KO = 10, 1000
ROM = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'roms', 'PokemonQuetzalCoop3Teste.gba')
d = open(ROM, 'rb').read()
assert d[GANCHO - R:GANCHO - R + 4] == bytes([0x0A, 0x4C, 0x21, 0x78])
assert d[CALC - R:CALC - R + 2] == bytes([0xF0, 0xB5])

a = Asm(E)
def chama(reg, f, lab): a.ldr_lit(reg, f | 1); a.bl(lab)
# quadro (r7 = sp depois do sub): +0 clima, +4/+8/+0xC notas dos lugares 0/2/4, +0x10 eficácia (u8, saída do cálculo),
# +0x14/+0x18 guardados da tabela (u16), +0x1C atacante, +0x20 golpe, +0x24 aiData

# ---- aval: r0 = lugar t -> r0 = nota (ou -1). Usa r7 = quadro. Guarda r4-r6 ----
a.label('aval')
a.push(['r4', 'r5', 'r6'], lr=True)
a.movh('r4', 'r0')
a.ldr_lit('r1', ABSENT); a.ldrb_i('r1', 'r1', 0); a.mov('r2', 1); a.h(0x4082)        # lsls r2, r0
a.alu('tst', 'r1', 'r2'); a.bc('ne', 'av_neg')
a.mov('r1', 0x60); a.alu('mul', 'r1', 'r4'); a.ldr_lit('r0', MONS); a.add_r('r1', 'r1', 'r0')
a.ldrh_i('r0', 'r1', 0x2A); a.cmpi('r0', 0); a.bc('eq', 'av_neg')
a.ldr_i('r5', 'r7', 0x24)                                                            # r5 = aiData
a.cmpi('r4', 4); a.bc('ne', 'av_calc')
a.ldrh_i('r0', 'r5', 8); a.strh_i('r0', 'r7', 0x14); a.ldrh_i('r0', 'r5', 0x18); a.strh_i('r0', 'r7', 0x18)
a.ldr_lit('r0', MONS + 4 * 0x60 + 0x20); a.ldrh_i('r0', 'r0', 0); a.strh_i('r0', 'r5', 8)   # habilidade do meio
a.mov('r0', 4); a.mov('r1', 0); chama('r3', ITEM, 'c3a'); a.strh_i('r0', 'r5', 0x18)        # efeito do item do meio
a.label('av_calc')
a.h(0xB082)                                                                          # sub sp, #8 (2 parâmetros na pilha)
a.mov('r0', 1); a.h(0x9000); a.ldr_i('r0', 'r7', 0); a.h(0x9001)                     # [sp] = 1, [sp+4] = clima
a.ldr_i('r0', 'r7', 0x20); a.ldr_i('r1', 'r7', 0x1C); a.movh('r2', 'r4'); a.movh('r3', 'r7'); a.addi('r3', 0x10)
a.ldr_lit('r6', CALC | 1); a.bl('c6a')
a.h(0xB002)                                                                          # add sp, #8
a.movh('r6', 'r0')                                                                   # r6 = dano esperado
a.cmpi('r4', 4); a.bc('ne', 'av_nota')
a.ldrh_i('r0', 'r7', 0x14); a.strh_i('r0', 'r5', 8); a.ldrh_i('r0', 'r7', 0x18); a.strh_i('r0', 'r5', 0x18)   # devolve
a.label('av_nota')
a.mov('r1', 0x60); a.alu('mul', 'r1', 'r4'); a.ldr_lit('r0', MONS); a.add_r('r1', 'r1', 'r0'); a.ldrh_i('r1', 'r1', 0x2A)   # vida
a.alu('cmp', 'r6', 'r1'); a.bc('lt', 'av_pct')
a.ldr_lit('r0', KO); a.b('av_fim')
a.label('av_pct')
a.cmpi('r6', 0); a.bc('le', 'av_zero')
a.mov('r0', 100); a.alu('mul', 'r0', 'r6'); chama('r3', DIV, 'c3a'); a.b('av_fim')    # dano * 100 / vida
a.label('av_zero'); a.mov('r0', 0); a.b('av_fim')
a.label('av_neg'); a.ldr_lit('r0', 0xFFFFFFFF)
a.label('av_fim')
a.pop(['r4', 'r5', 'r6']); a.pop(['r1']); a.bx('r1')
a.label('c3a'); a.bx('r3')
a.label('c6a'); a.bx('r6')
a.pool()

# ---- ia: chamada do gancho (lr = volta; r6 = atacante, r7 = golpe; r0-r4 livres). Sai com r4 = &gBattlerTarget, r1 = alvo ----
if a.here() % 4: a.h(0x46C0)
a.label('ia')
a.push(['r5', 'r6', 'r7'], lr=True)
a.ldr_lit('r0', FLAG); a.ldrb_i('r0', 'r0', 0); a.cmpi('r0', 1); a.bc('ne', 'fim')
a.mov('r0', 1); a.alu('tst', 'r6', 'r0'); a.bc('eq', 'fim')                           # só lugar do inimigo (ímpar)
a.mov('r0', 24); a.alu('mul', 'r0', 'r7'); a.ldr_lit('r1', MOVES); a.add_r('r5', 'r0', 'r1')
a.ldrb_i('r0', 'r5', 0xB); a.cmpi('r0', 2); a.bc('eq', 'fim')                        # golpe de status
a.ldrb_i('r0', 'r5', 2); a.cmpi('r0', 0); a.bc('eq', 'fim')                          # sem poder
a.ldrh_i('r0', 'r5', 8); a.cmpi('r0', 0); a.bc('ne', 'fim')                          # alvo que não é "escolhido"
a.ldr_lit('r0', TARGET); a.ldrb_i('r0', 'r0', 0)
a.mov('r1', 1); a.alu('tst', 'r0', 'r1'); a.bc('ne', 'fim'); a.cmpi('r0', 4); a.bc('hi', 'fim')   # alvo da IA do nosso lado
a.h(0xB08A)                                                                          # sub sp, #0x28
a.h(0x9607); a.h(0x9708)                                                             # str r6, [sp, #0x1c] ; str r7, [sp, #0x20]
a.h(0x466F)                                                                          # mov r7, sp
a.ldr_lit('r0', RES); a.ldr_i('r0', 'r0', 0); a.ldr_i('r0', 'r0', 0x18); a.str_i('r0', 'r7', 0x24)
chama('r3', CLIMA, 'c3'); a.str_i('r0', 'r7', 0)
for k, t in enumerate((0, 2, 4)):
    a.mov('r0', t); a.bl('aval'); a.str_i('r0', 'r7', 4 + 4 * k)
a.ldr_i('r4', 'r7', 4)
for k in (1, 2):
    a.ldr_i('r1', 'r7', 4 + 4 * k); a.alu('cmp', 'r1', 'r4'); a.bc('le', 'm%d' % k); a.movh('r4', 'r1'); a.label('m%d' % k)
a.cmpi('r4', 0); a.bc('le', 'fim2')                                                  # ninguém leva dano: fica a IA
a.movh('r5', 'r4'); a.subi('r5', TOL)                                                # r5 = corte (melhor - 10)
a.mov('r6', 0)
for k in range(3):
    a.ldr_i('r1', 'r7', 4 + 4 * k); a.alu('cmp', 'r1', 'r5'); a.bc('lt', 'c%d' % k); a.cmpi('r1', 0); a.bc('le', 'c%d' % k)
    a.addi('r6', 1); a.label('c%d' % k)
chama('r3', RANDOM, 'c3'); a.movh('r1', 'r6'); chama('r3', MOD, 'c3')                 # r0 = sorteio entre os r6 bons
for k in range(3):
    a.ldr_i('r1', 'r7', 4 + 4 * k); a.alu('cmp', 'r1', 'r5'); a.bc('lt', 'p%d' % k); a.cmpi('r1', 0); a.bc('le', 'p%d' % k)
    a.cmpi('r0', 0); a.bc('ne', 'q%d' % k); a.mov('r6', 2 * k); a.b('escreve')
    a.label('q%d' % k); a.subi('r0', 1)
    a.label('p%d' % k)
a.b('fim2')
a.label('escreve')
a.ldr_lit('r0', TARGET); a.strb_i('r6', 'r0', 0)
a.label('fim2')
a.h(0xB00A)                                                                          # add sp, #0x28
a.label('fim')
a.ldr_lit('r4', TARGET); a.ldrb_i('r1', 'r4', 0)
a.pop(['r5', 'r6', 'r7']); a.pop(['r2']); a.bx('r2')
a.label('c3'); a.bx('r3')
a.pool()
code = a.build()
IA = a.labels['ia']
fim = E + len(code)
assert fim <= 0x09FF7F00 and all(b == 0xFF for b in d[E - R:fim - R]), hex(fim)
ponte = struct.pack('<HHIII', 0x4778, 0x46C0, 0xE59FC000, 0xE12FFF1C, IA | 1)
g = Asm(GANCHO); g.bl(PONTE); gancho = g.build()
patch = [[E - R, list(code)], [PONTE - R, list(ponte)], [GANCHO - R, list(gancho)]]
if os.environ.get('JSON'): json.dump(patch, open(os.environ['JSON'], 'w'))
print('    // IA 0x%08X, código 0x%08X..0x%08X' % (IA | 1, E, fim))
for at, b in patch:
    print('    [0x%X, [%s]],' % (at, ', '.join('0x%02X' % x for x in b)))
