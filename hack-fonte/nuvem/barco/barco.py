# Barco do Sr. Briney (Rota 104, mapa 0.19) que a pessoa pilota sozinha (pedido 15/11/2026).
# Do píer (12,52), A virado para a água (12,53): "Você consegue manobrar esse barco sozinho, gostaria de tentar?" SIM/NÃO.
# SIM: o barco (objeto 7, sprite 88, em 12,54) encosta no píer, some, e o Surf do jogo começa (dofieldeffect 9: no Quetzal
# não tem a animação do Pokémon, é só o pulo) com o desenho do BARCO no lugar do Lapras: a pessoa pula dentro e navega com
# as regras do surf (colisão, descer na praia). Ao descer em terra o site desliga o barco (engine-worker barcoVigia).
#
# Como o desenho é trocado: o surf do Quetzal escolhe o bicho pela espécie (0x08295A74: espécie -> 0, 1, 2 = Gyarados,
# Lapras, Vaporeon; tabelas paleta normal 0x09977684, shiny 0x0997769C, modelos 0x099778D4 (2 por bicho), "pescoço" que fica
# por cima do jogador 0x09977964). As tabelas vão para cópias com uma 4ª vaga (o barco), os 12 ponteiros do código passam a
# apontar para as cópias, e 0x08295A74 desvia: com o byte 0x0203FF39 = 1 devolve 3 (barco). O barco não tem pescoço
# (tileTag 0 no lugar de 0xFFFF faz o código pular a criação).
#
# uso: python barco.py ROM.gba  -> imprime o QZ_BARCO para o game.js
import os, sys, struct, json
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'metaknight'))
from thumb import Asm

R = open(sys.argv[1], 'rb').read()
A = 0x08000000
u32 = lambda a: struct.unpack_from('<I', R, a - A)[0]
FLAG = 0x0203FF39

# ---- endereços na área livre 0x09FF1800..0x09FF1E00 ----
SCR, MOV, TXT, PLACAS, HOOK = 0x09FF1800, 0x09FF1850, 0x09FF1860, 0x09FF18A0, 0x09FF1930
NPAL, SPAL, TPL, OVL = 0x09FF1960, 0x09FF1980, 0x09FF19A0, 0x09FF1A60
FIM_LIVRE = 0x09FF1E00

# ---- texto (mesma tabela do editorqz.js) ----
TAB = {}
for i, c in enumerate("0123456789"): TAB[c] = 0xA1 + i
for i, c in enumerate("ABCDEFGHIJKLMNOPQRSTUVWXYZ"): TAB[c] = 0xBB + i
for i, c in enumerate("abcdefghijklmnopqrstuvwxyz"): TAB[c] = 0xD5 + i
TAB.update({" ": 0x00, "ê": 0x1C, "ç": 0x19, ",": 0xB8, "?": 0xAC})
def texto(linhas):
    out = []
    for k, l in enumerate(linhas):
        out += [TAB[ch] for ch in l]
        if k < len(linhas) - 1: out.append(0xFE)
    return bytes(out + [0xFF])
T = texto(["Você consegue manobrar esse barco", "sozinho, gostaria de tentar?"])

# ---- script ----
def p32(v): return list(struct.pack('<I', v))
s = [0x6A]                                                        # lock
s += [0x0F, 0x00] + p32(TXT) + [0x09, 0x05]                       # msgbox SIM/NÃO
s += [0x21, 0x0D, 0x80, 0x00, 0x00]                               # compare VAR_RESULT, 0 (NÃO)
fim_ref = len(s) + 2; s += [0x06, 0x01, 0, 0, 0, 0]               # goto_if_eq fim
s += [0x68]                                                       # closemessage
s += [0x4F, 0x07, 0x00] + p32(MOV) + [0x51, 0x07, 0x00]           # applymovement barco (sobe 1 até o píer), waitmovement
s += [0x59, 0x07, 0x00, 0x00, 0x13]                               # hideobjectat barco, 0.19 (volta ao entrar no mapa de novo)
s += [0x11, 0x01] + p32(FLAG)                                     # writebytetoaddr 1, marca "de barco"
s += [0x9C, 0x09, 0x00]                                           # dofieldeffect 9 (Surf: pula no barco)
s += [0x6C, 0x02]                                                 # release, end
fim = SCR + len(s); s[fim_ref:fim_ref + 4] = p32(fim)
s += [0x68, 0x6C, 0x02]                                           # fim: closemessage, release, end
assert SCR + len(s) <= MOV
MOVIMENTO = bytes([0x09, 0xFE])                                   # andar devagar para cima (numeração do Emerald), fim

# ---- desvio da escolha do bicho ----
a = Asm(HOOK)
a.push([], lr=True)
a.ldr_lit('r3', FLAG); a.ldrb_i('r3', 'r3', 0); a.cmpi('r3', 0); a.bc('eq', 'orig')
a.mov('r0', 3); a.pop(['r1']); a.bx('r1')
a.label('orig')
a.lsl('r0', 'r0', 16); a.h(0x0C02)                                # lsls r0,r0,#16; lsrs r2,r0,#16 (como o original)
a.mov('r1', 0); a.ldr_lit('r3', 0x08295A7C | 1); a.bx('r3')
a.pool()
HOOKB = a.build(); assert HOOK + len(HOOKB) <= NPAL

# ---- tabelas com a 4ª vaga ----
B = 0x090E2BD4 + 4 * 88; gi = u32(B)                             # sprite 88 = barco do Briney
tag_barco = struct.unpack_from('<H', R, gi - A + 2)[0]
oam, anims, imgs = u32(gi + 16), u32(gi + 24), u32(gi + 28)
npal = R[0x09977684 - A: 0x09977684 - A + 24] + struct.pack('<IHH', 0, tag_barco, 0)
spal = R[0x0997769C - A: 0x0997769C - A + 24] + struct.pack('<IHH', 0, tag_barco, 0)
modelo = struct.pack('<HHIIIII', 0xFFFF, tag_barco, oam, anims, imgs, 0x084C32E0, 0x081DCFD9)
tpl = R[0x099778D4 - A: 0x099778D4 - A + 6 * 24] + modelo + modelo
sem = bytearray(R[0x09977964 - A: 0x09977964 - A + 24]); sem[0:2] = b'\0\0'   # sem pescoço
ovl = R[0x09977964 - A: 0x09977964 - A + 6 * 24] + bytes(sem) + bytes(sem)
assert len(tpl) == len(ovl) == 192 and len(npal) == len(spal) == 32

# ---- ponteiros do código (literais) ----
fix = [[0x295A74, '00b50004020c0021', (struct.pack('<HH', 0x4B00, 0x4718) + struct.pack('<I', HOOK | 1)).hex()]]
for velho, novo, onde in ((0x09977684, NPAL, (0x8295AB8, 0x8295B80, 0x8295F04)), (0x0997769C, SPAL, (0x8295B40, 0x8295EC4)),
                          (0x099778D4, TPL, (0x8295BE4, 0x8295C40, 0x8295F68, 0x8295FC4)), (0x09977964, OVL, (0x8295C48, 0x8295FCC, 0x82961AC))):
    for w in onde:
        assert u32(w) == velho, hex(w)
        fix.append([w - A, struct.pack('<I', velho).hex(), struct.pack('<I', novo).hex()])
assert R[0x295A74:0x295A7C].hex() == '00b50004020c0021', R[0x295A74:0x295A7C].hex()

novo = [[SCR - A, bytes(s).hex()], [MOV - A, MOVIMENTO.hex()], [TXT - A, T.hex()], [HOOK - A, HOOKB.hex()],
        [NPAL - A, npal.hex()], [SPAL - A, spal.hex()], [TPL - A, tpl.hex()], [OVL - A, ovl.hex()]]
for at, h in novo:
    n = len(h) // 2
    assert all(b == 0xFF for b in R[at:at + n]), hex(at)
    assert at + A + n <= FIM_LIVRE

print(json.dumps({'fix': fix, 'novo': novo, 'script': SCR - A, 'placas': PLACAS - A, 'flag': FLAG}))
