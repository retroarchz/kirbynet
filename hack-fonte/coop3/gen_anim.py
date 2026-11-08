# Pokémon do meio (lugar 4) nas animações da luta dos 3 (08/11, pedido do usuário: "no Mist ele fica como um png na tela";
# clarão da mega). O motor de animação conhece só "o parceiro" (lugar XOR 2): do 0 é o 2, e o 4 nunca entra; do próprio 4 o
# parceiro seria 6, que não existe.
# 1) GetBattlePalettesMask (0x080F94B4): os blocos "parceiro do atacante" e "parceiro do alvo" (0x080F9530..0x080F957C) viram
#    "todos os outros do mesmo lado, visíveis, até gBattlersCount" -> o meio pisca/escurece/clareia junto (mega, golpes de lado).
#    Em luta comum dá o mesmo resultado de antes (o único outro do lado é o XOR 2).
# 2) monbg/clearmonbg (comandos 0x0A/0x0B e _static 0x22/0x23 da tabela 0x09129914): com 2 camadas de fundo, o jogo leva para
#    o fundo só o atacante/alvo e o parceiro, e a névoa fica translúcida sobre eles. Na tripla, quando o comando é do lado
#    (argumento >= 2), os outros do mesmo lado que ficaram como figura passam a figura semitransparente (OAM objMode = blend),
#    e voltam ao normal no clearmonbg. Quem foi mudado fica anotado em MUDOU (bit por lugar).
# Uso: python gen_anim.py -> linhas para TELA_COOP3 (linkhle.js); JSON=arquivo grava em json.
import sys, os, json, struct
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'metaknight'))
from thumb import Asm
R = 0x08000000
E = 0x09FF7340                      # depois da IA (gen_ia.py vai até 0x09FF7338)
FLAG, NBAT, SPR_IDS, SPRITES = 0x0203FE00, 0x02023044, 0x0203F664, 0x02020630
ATK, TGT, SCRIPT = 0x02039F1E, 0x02039F1F, 0x02039ED8
VISIVEL = 0x080F4F10                # IsBattlerSpriteVisible(lugar)
MUDOU = 0x0203F3FE                  # RAM livre da luta (aprende vai até 0x0203F3FC)
MASK_DE, MASK_VOLTA = 0x080F9530, 0x080F957C
TAB = 0x09129914
CMDS = {0x0A: 0x080F4D5C, 0x0B: 0x080F54B0, 0x22: 0x080F561C, 0x23: 0x080F56E0}
ROM = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'roms', 'PokemonQuetzalCoop3Teste.gba')
d = open(ROM, 'rb').read()
for k, f in CMDS.items(): assert struct.unpack_from('<I', d, TAB - R + 4 * k)[0] == f | 1, hex(k)
assert d[MASK_DE - R:MASK_DE - R + 4] == bytes([0x48, 0x46, 0x00, 0x28]), d[MASK_DE - R:MASK_DE - R + 4].hex()   # mov r0, sb; cmp r0, #0
assert d[MASK_VOLTA - R:MASK_VOLTA - R + 2] == bytes([0x00, 0x98])                                               # ldr r0, [sp]

a = Asm(E)
def call(reg, f, lab):
    a.ldr_lit(reg, f | 1); a.bl(lab)

# ---- lado: r0 = lugar x, r1 = 0 (máscara: r4 |= paleta 16+b) ou 1 (figura semitransparente + anota em MUDOU) ----
#      percorre b < gBattlersCount, b != x, b != x^2 (esse o jogo já tratou), mesmo lado de x, visível
a.label('lado')
a.push(['r5', 'r6', 'r7'], lr=True)                                                  # r4 não é guardado: no modo 0 é a máscara
a.movh('r5', 'r0'); a.movh('r7', 'r1'); a.mov('r6', 0)
a.label('l_loop')
a.ldr_lit('r0', NBAT); a.ldrb_i('r0', 'r0', 0); a.alu('cmp', 'r6', 'r0'); a.bc('hs', 'l_fim')
a.alu('cmp', 'r6', 'r5'); a.bc('eq', 'l_prox')
a.mov('r0', 2); a.alu('eor', 'r0', 'r5'); a.alu('cmp', 'r6', 'r0'); a.bc('eq', 'l_prox')
a.movh('r0', 'r6'); a.alu('eor', 'r0', 'r5'); a.mov('r1', 1); a.alu('tst', 'r0', 'r1'); a.bc('ne', 'l_prox')
a.movh('r0', 'r6'); call('r3', VISIVEL, 'c3'); a.lsl('r0', 'r0', 24); a.cmpi('r0', 0); a.bc('eq', 'l_prox')
a.cmpi('r7', 0); a.bc('ne', 'l_fig')
a.movh('r0', 'r6'); a.addi('r0', 16); a.mov('r1', 1); a.h(0x4081)                       # lsls r1, r0
a.alu('orr', 'r4', 'r1'); a.b('l_prox')
a.label('l_fig')
a.ldr_lit('r0', SPR_IDS); a.ldrb_r('r0', 'r0', 'r6'); a.mov('r1', 0x44); a.alu('mul', 'r0', 'r1')
a.ldr_lit('r1', SPRITES); a.add_r('r0', 'r0', 'r1'); a.ldrb_i('r1', 'r0', 1)
a.mov('r2', 0x0C); a.alu('bic', 'r1', 'r2'); a.mov('r2', 0x04); a.alu('orr', 'r1', 'r2'); a.strb_i('r1', 'r0', 1)
a.ldr_lit('r0', MUDOU); a.ldrb_i('r1', 'r0', 0); a.mov('r2', 1); a.h(0x40B2)              # lsls r2, r6
a.alu('orr', 'r1', 'r2'); a.strb_i('r1', 'r0', 0)
a.label('l_prox')
a.addi('r6', 1); a.b('l_loop')
a.label('l_fim')
a.pop(['r5', 'r6', 'r7']); a.pop(['r0']); a.bx('r0')
a.label('c3'); a.bx('r3')
a.pool()

# ---- mask: no lugar dos blocos de parceiro de GetBattlePalettesMask. r4 = máscara, sb = parceiro do atacante, sl = do alvo ----
#      (r5, r6, r7 livres ali). Volta em 0x080F957C.
if a.here() % 4: a.h(0x46C0)
a.label('mask')
for reg, quem in (('r9', ATK), ('r10', TGT)):              # sb = r9, sl = r10
    pula = 'mk_' + reg
    a.movh('r0', reg); a.cmpi('r0', 0); a.bc('eq', pula)
    # o próprio XOR 2, como o jogo fazia (só se visível)
    a.ldr_lit('r6', quem); a.ldrb_i('r0', 'r6', 0); a.mov('r1', 2); a.alu('eor', 'r0', 'r1')
    call('r3', VISIVEL, 'c3m'); a.lsl('r0', 'r0', 24); a.cmpi('r0', 0); a.bc('eq', pula + 'b')
    a.ldrb_i('r0', 'r6', 0); a.mov('r1', 2); a.alu('eor', 'r0', 'r1'); a.addi('r0', 16); a.mov('r1', 1); a.h(0x4081)
    a.alu('orr', 'r4', 'r1')
    a.label(pula + 'b')
    # na tripla, os outros do mesmo lado
    a.ldr_lit('r0', FLAG); a.ldrb_i('r0', 'r0', 0); a.cmpi('r0', 1); a.bc('ne', pula)
    a.ldrb_i('r0', 'r6', 0); a.mov('r1', 0); a.bl('lado')
    a.label(pula)
a.ldr_lit('r0', MASK_VOLTA | 1); a.bx('r0')
a.label('c3m'); a.bx('r3')
a.pool()

# ---- monbg / monbg_static: o original leva para o fundo o lugar do comando e o XOR 2 dele (sempre os dois). Na tripla:
#      - se o lugar do comando é o 4 (o meio), o original o esconderia e não conseguiria desenhá-lo no fundo (ele sumia, defeito
#        antigo): não chama o original; avança o script como ele (2 bytes; o monbg comum ainda espera 1 quadro) e deixa o 4 e os
#        parceiros dele (0 e 2) translúcidos;
#      - senão, chama o original e deixa translúcidos os outros do mesmo lado (o 4, quando o lado é o nosso).
def monbg(nome, orig, espera):
    if a.here() % 4: a.h(0x46C0)
    a.label(nome)
    a.push(['r4', 'r5'], lr=True)
    a.ldr_lit('r0', FLAG); a.ldrb_i('r0', 'r0', 0); a.cmpi('r0', 1); a.bc('ne', nome + '_orig')
    a.ldr_lit('r0', SCRIPT); a.ldr_i('r0', 'r0', 0); a.ldrb_i('r4', 'r0', 1)
    a.mov('r0', 1); a.alu('and_', 'r0', 'r4'); a.cmpi('r0', 0); a.bc('eq', nome + '_a')
    a.ldr_lit('r0', TGT); a.b(nome + '_q')
    a.label(nome + '_a'); a.ldr_lit('r0', ATK)
    a.label(nome + '_q'); a.ldrb_i('r5', 'r0', 0)                                       # r5 = lugar do comando
    a.cmpi('r5', 4); a.bc('ne', nome + '_comum')
    # o meio: sem fundo
    a.ldr_lit('r0', SCRIPT); a.ldr_i('r1', 'r0', 0); a.addi('r1', 2); a.str_i('r1', 'r0', 0)
    if espera:
        a.ldr_lit('r0', 0x02039EE4); a.mov('r1', 1); a.strb_i('r1', 'r0', 0)            # sAnimFramesToWait = 1
        a.ldr_lit('r0', 0x02039EE0); a.ldr_lit('r1', 0x080F4445); a.str_i('r1', 'r0', 0) # gAnimScriptCallback = WaitAnimFrameCount
    a.ldr_lit('r0', SPR_IDS); a.ldrb_i('r0', 'r0', 4); a.mov('r1', 0x44); a.alu('mul', 'r0', 'r1')
    a.ldr_lit('r1', SPRITES); a.add_r('r0', 'r0', 'r1'); a.ldrb_i('r1', 'r0', 1)
    a.mov('r2', 0x0C); a.alu('bic', 'r1', 'r2'); a.mov('r2', 0x04); a.alu('orr', 'r1', 'r2'); a.strb_i('r1', 'r0', 1)
    a.ldr_lit('r0', MUDOU); a.ldrb_i('r1', 'r0', 0); a.mov('r2', 0x10); a.alu('orr', 'r1', 'r2'); a.strb_i('r1', 'r0', 0)
    a.mov('r0', 4); a.mov('r1', 1); a.bl('lado'); a.b(nome + '_fim')
    a.label(nome + '_comum')
    call('r3', orig, 'c3' + nome)
    a.movh('r0', 'r5'); a.mov('r1', 1); a.bl('lado'); a.b(nome + '_fim')
    a.label(nome + '_orig')
    call('r3', orig, 'c3' + nome)
    a.label(nome + '_fim')
    a.pop(['r4', 'r5']); a.pop(['r0']); a.bx('r0')
    a.label('c3' + nome); a.bx('r3')
    a.pool()

# ---- clearmonbg / clearmonbg_static: chama o original e devolve ao normal as figuras que ficaram translúcidas ----
def clear(nome, orig):
    if a.here() % 4: a.h(0x46C0)
    a.label(nome)
    a.push(['r4', 'r5'], lr=True)
    call('r3', orig, 'c3' + nome)
    a.ldr_lit('r4', MUDOU); a.ldrb_i('r5', 'r4', 0); a.cmpi('r5', 0); a.bc('eq', nome + '_fim')
    a.mov('r0', 0); a.strb_i('r0', 'r4', 0)
    a.mov('r4', 0)
    a.label(nome + '_loop')
    a.cmpi('r4', 6); a.bc('hs', nome + '_fim')
    a.mov('r0', 1); a.h(0x40A0); a.alu('tst', 'r0', 'r5'); a.bc('eq', nome + '_p')        # lsls r0, r4
    a.ldr_lit('r0', SPR_IDS); a.ldrb_r('r0', 'r0', 'r4'); a.mov('r1', 0x44); a.alu('mul', 'r0', 'r1')
    a.ldr_lit('r1', SPRITES); a.add_r('r0', 'r0', 'r1'); a.ldrb_i('r1', 'r0', 1); a.mov('r2', 0x0C); a.alu('bic', 'r1', 'r2'); a.strb_i('r1', 'r0', 1)
    a.label(nome + '_p'); a.addi('r4', 1); a.b(nome + '_loop')
    a.label(nome + '_fim')
    a.pop(['r4', 'r5']); a.pop(['r0']); a.bx('r0')
    a.label('c3' + nome); a.bx('r3')
    a.pool()

# ---- GetBattleMonSpritePalettesMask (0x080F95CC: jogador esq., jogador dir., inimigo esq., inimigo dir. por posição) ----
#      O bloco do inimigo direito (0x080F967C..0x080F96A7) vira esta rotina: refaz o bloco e, na tripla, se pediram o nosso lado
#      inteiro (esq. e dir.), soma o meio (lugar 4) se visível. r4 = máscara, r5/r6 = jogador esq./dir., r8 = inimigo dir.
POS_DE, POS_VOLTA, LUGAR_EM = 0x080F967C, 0x080F96A8, 0x080F7858
assert d[POS_DE - R:POS_DE - R + 4] == bytes([0x00, 0x28, 0x13, 0xD0]) and d[POS_VOLTA - R:POS_VOLTA - R + 2] == bytes([0x20, 0x1C])
if a.here() % 4: a.h(0x46C0)
a.label('pos')
a.movh('r0', 'r8'); a.cmpi('r0', 0); a.bc('eq', 'pos_extra')
a.mov('r0', 3); call('r3', LUGAR_EM, 'c3pos'); a.lsl('r0', 'r0', 24); a.h(0x0E00)       # lsrs r0, r0, #24
a.movh('r7', 'r0'); call('r3', VISIVEL, 'c3pos'); a.lsl('r0', 'r0', 24); a.cmpi('r0', 0); a.bc('eq', 'pos_extra')
a.movh('r0', 'r7'); a.addi('r0', 16); a.mov('r1', 1); a.h(0x4081); a.alu('orr', 'r4', 'r1')
a.label('pos_extra')
a.ldr_lit('r0', FLAG); a.ldrb_i('r0', 'r0', 0); a.cmpi('r0', 1); a.bc('ne', 'pos_fim')
a.cmpi('r5', 0); a.bc('eq', 'pos_fim'); a.cmpi('r6', 0); a.bc('eq', 'pos_fim')
a.mov('r0', 4); call('r3', VISIVEL, 'c3pos'); a.lsl('r0', 'r0', 24); a.cmpi('r0', 0); a.bc('eq', 'pos_fim')
a.mov('r1', 1); a.lsl('r1', 'r1', 20); a.alu('orr', 'r4', 'r1')
a.label('pos_fim')
a.ldr_lit('r0', POS_VOLTA | 1); a.bx('r0')
a.label('c3pos'); a.bx('r3')
a.pool()

monbg('monbg', CMDS[0x0A], True); clear('clear', CMDS[0x0B]); monbg('monbgS', CMDS[0x22], False); clear('clearS', CMDS[0x23])
code = a.build()
fim = E + len(code)
assert fim <= 0x09FF7F00 and all(b == 0xFF for b in d[E - R:fim - R]), hex(fim)
L = a.labels
ponte = struct.pack('<HHIII', 0x4778, 0x46C0, 0xE59FC000, 0xE12FFF1C, L['mask'] | 1)
assert MASK_DE % 4 == 0 and MASK_DE + 16 <= MASK_VOLTA
ponte2 = struct.pack('<HHIII', 0x4778, 0x46C0, 0xE59FC000, 0xE12FFF1C, L['pos'] | 1)
assert POS_DE % 4 == 0 and POS_DE + 16 <= POS_VOLTA
patch = [[E - R, list(code)], [MASK_DE - R, list(ponte)], [POS_DE - R, list(ponte2)]]
for k, lab in ((0x0A, 'monbg'), (0x0B, 'clear'), (0x22, 'monbgS'), (0x23, 'clearS')):
    patch.append([TAB - R + 4 * k, list(struct.pack('<I', L[lab] | 1))])
if os.environ.get('JSON'): json.dump(patch, open(os.environ['JSON'], 'w'))
print('    // código 0x%08X..0x%08X' % (E, fim))
for at, b in patch:
    print('    [0x%X, [%s]],' % (at, ', '.join('0x%02X' % x for x in b)))
