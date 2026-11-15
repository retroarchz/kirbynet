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
TXT, PLACAS, HOOK = 0x09FF1860, 0x09FF18A0, 0x09FF1930
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

# ---- scripts (área 0x09FF1B20..0x09FF1E00) ----
# Estado no save (variáveis sem uso no Quetzal, zeradas no save do sandro; conferido 15/11):
#   V_EST 0x409B: 0 = barco no píer da Rota 104, 1 = navegando, 0x8000 | grupo << 8 | num = estacionado nesse mapa
#   V_POS 0x409D: x | y << 8 de onde ele ficou (coordenadas do mapa, sem o +7)
#   V_DIR 0x4065: o site escreve a cada quadro a direção do jogador a pé/bike fora da água (1 S, 2 N, 3 O, 4 L), senão 0
# O barco estacionado é um objeto de verdade (localId 0xF0) que o site põe na lista do mapa (engine-worker barcoVigia).
V_EST, V_POS, V_DIR, ID_BARCO = 0x409B, 0x409D, 0x4065, 0xF0
SCR0 = 0x09FF1B20
def p32(v): return list(struct.pack('<I', v))
def p16(v): return list(struct.pack('<H', v))
class Scr:
    def __init__(self, base): self.base, self.b, self.lab, self.ref = base, [], {}, []
    def __call__(self, *x): self.b += list(x); return self
    def L(self, n): self.lab[n] = self.base + len(self.b)
    def P(self, n): self.ref.append((len(self.b), n)); self.b += [0, 0, 0, 0]
    def build(self):
        for at, n in self.ref:
            v = self.lab[n] if isinstance(n, str) else n
            self.b[at:at + 4] = p32(v)
        return bytes(self.b)
s = Scr(SCR0)
def msg_simnao(): s(0x0F, 0x00); s.P(TXT); s(0x09, 0x05)                    # msgbox SIM/NÃO
def se(var, val, cond, lab): s(0x21, *p16(var), *p16(val), 0x06, cond); s.P(lab)   # compare + goto_if (1 =, 5 ≠)
def mover(quem, lab): s(0x4F, *p16(quem)); s.P(lab); s(0x51, 0x00, 0x00)   # applymovement + waitmovement 0
def embarca(id_barco):   # liga a marca e começa o surf com o desenho do barco; o site tira o barco parado quando o de
    # navegar já apareceu (senão ficava um instante sem barco nenhum)
    s(0x16, *p16(V_EST), *p16(1))                                           # setvar V_EST, 1 (navegando)
    s(0x11, 0x01); s.P(FLAG)                                                # writebytetoaddr 1, marca do desenho
    s(0x9C, 0x09, 0x00, 0x6C, 0x02)                                         # dofieldeffect 9 (pulo escondido), release, end
# píer da Rota 104: anda para dentro do barco (como o Sr. Briney faz), some e o barco sai com você dentro
s.L('pier')
s(0x6A); se(V_EST, 0, 5, 'mudo')                                            # barco não está no píer: nada
msg_simnao(); se(0x800D, 0, 1, 'nao'); s(0x68)
mover(0xFF, 'm_desce')                                                      # anda 2 para baixo, até o quadrado do barco
s(0x59, 0xFF, 0x00, 0x00, 0x13)                                             # hideobjectat jogador (fica dentro do barco)
mover(0xFF, 'viraN')                                                        # escondido, vira para onde o barco do píer aponta
embarca(7)
s.L('nao'); s(0x68); s.L('mudo'); s(0x6C, 0x02)
# barco estacionado (objeto 0xF0): anda para dentro dele, some, volta escondido e o surf "pula" para o barco
s.L('parado')
s(0x6A); se(V_DIR, 0, 1, 'mudo')                                            # na água (surfando) ou sem direção: nada
msg_simnao(); se(0x800D, 0, 1, 'nao'); s(0x68)
for d, nome in ((1, 'S'), (2, 'N'), (3, 'O'), (4, 'L')): se(V_DIR, d, 1, 'v' + nome)
s(0x6C, 0x02)
for nome in ('S', 'N', 'O', 'L'):
    # entra andando; escondido, vira para onde o barco parado aponta (o contrário de onde entrou): o barco não "vira" na troca
    s.L('v' + nome); mover(0xFF, 'ida' + nome); s(0x59, 0xFF, 0x00, 0x00, 0x00); mover(0xFF, 'vira' + {'S': 'N', 'N': 'S', 'O': 'L', 'L': 'O'}[nome]); s(0x05); s.P('sai')
s.L('sai'); embarca(ID_BARCO)
# chamados pelo site (sem trava): pôr o barco estacionado / tirar o barco do píer
s.L('poe'); s(0x55, *p16(ID_BARCO), 0x59, *p16(ID_BARCO), 0x00, 0x00, 0x02)   # addobject 0xF0 já escondido (o site põe o mapa nos 2 zeros)
s.L('tira7'); s(0x53, 0x07, 0x00, 0x02)                                     # removeobject 7
s.L('tiraF0'); s(0x53, *p16(ID_BARCO), 0x02)                                # removeobject 0xF0
# movimentos: 0x08-0x0B andar (baixo, cima, esq., dir.), 0x00-0x03 virar, 0xFE fim
s.L('m_desce'); s(0x08, 0x08, 0xFE)
for nome, ida, vira in (('S', 0x08, 0x00), ('N', 0x09, 0x01), ('O', 0x0A, 0x02), ('L', 0x0B, 0x03)):
    s.L('ida' + nome); s(ida, 0xFE); s.L('vira' + nome); s(vira, 0xFE)
SCRB = s.build(); assert SCR0 + len(SCRB) <= 0x09FF1E00, hex(len(SCRB))
SCRIPTS = {k: s.lab[k] for k in ('pier', 'parado', 'poe', 'tira7', 'tiraF0')}

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

# ---- surf começa no lugar (pedido 15/11 "mais natural"): tarefa do surf 0x08115961, estado 3 (0x08115A74) ----
# Com a marca: o barco nasce no quadrado onde você já está (destino da tarefa = posição atual), em vez do pulo vem só
# "virar" (0x080D7204) e a altura vira a da água (0x11), senão a água em volta ficava bloqueada. Sem a marca: igual ao jogo.
# Troca 14 bytes em 0x08115A9C (adds r0,r4 / bl ClearHeldMovementIfFinished / ldrb / lsrs / bl GetJumpSpecial) e volta
# em 0x08115AAA com r0 = ação.
HOOK2 = 0x09FF1D60
a2 = Asm(HOOK2)
a2.h(0x1C20)                                                       # adds r0, r4, #0
a2.ldr_lit('r3', 0x080D712C | 1); a2.bl('callr3')                 # ObjectEventClearHeldMovementIfFinished(obj)
a2.ldr_lit('r0', FLAG); a2.ldrb_i('r0', 'r0', 0); a2.cmpi('r0', 0); a2.bc('eq', 'normal')
a2.ldrh_i('r0', 'r4', 0x10); a2.strh_i('r0', 'r5', 0xA); a2.ldrh_i('r0', 'r4', 0x12); a2.strh_i('r0', 'r5', 0xC)
a2.mov('r0', 0x11); a2.strb_i('r0', 'r4', 0xB)
# no mesmo quadro: você continua escondido (a troca de desenho do surf mostrava você 1 quadro) e o barco parado nesse
# quadrado (sprite 88) some, senão 1 quadro com dois barcos; o site tira ele depois
a2.ldrb_i('r0', 'r4', 1); a2.mov('r1', 0x20); a2.alu('orr', 'r0', 'r1'); a2.strb_i('r0', 'r4', 1)
a2.ldr_lit('r2', 0x02038D10); a2.mov('r3', 16)
a2.label('obj')
a2.ldrb_i('r0', 'r2', 0); a2.mov('r1', 1); a2.alu('tst', 'r0', 'r1'); a2.bc('eq', 'prox')
a2.ldrh_i('r0', 'r2', 4); a2.cmpi('r0', 88); a2.bc('ne', 'prox')
a2.ldrh_i('r0', 'r2', 0x10); a2.ldrh_i('r1', 'r4', 0x10); a2.alu('cmp', 'r0', 'r1'); a2.bc('ne', 'prox')
a2.ldrh_i('r0', 'r2', 0x12); a2.ldrh_i('r1', 'r4', 0x12); a2.alu('cmp', 'r0', 'r1'); a2.bc('ne', 'prox')
a2.ldrb_i('r0', 'r2', 1); a2.mov('r1', 0x20); a2.alu('orr', 'r0', 'r1'); a2.strb_i('r0', 'r2', 1)
a2.label('prox'); a2.addi('r2', 0x24); a2.subi('r3', 1); a2.bc('ne', 'obj')
a2.ldrb_i('r0', 'r4', 0x18); a2.h(0x0900)                       # lsrs r0, r0, #4
a2.ldr_lit('r3', 0x080D7204 | 1); a2.bl('callr3'); a2.b('volta')
a2.label('normal')
a2.ldrb_i('r0', 'r4', 0x18); a2.h(0x0900); a2.ldr_lit('r3', 0x080D7414 | 1); a2.bl('callr3')
a2.label('volta'); a2.ldr_lit('r3', 0x08115AAA | 1); a2.bx('r3')
a2.label('callr3'); a2.bx('r3')
a2.pool()
HOOK2B = a2.build(); assert HOOK2 + len(HOOK2B) <= 0x09FF1E00
assert R[0x115A9C:0x115AAA].hex() == '201cc1f745fb207e0009c1f7b5fc', R[0x115A9C:0x115AAA].hex()
SITE2 = Asm(0x08115A9C); SITE2.ldr_lit('r1', HOOK2 | 1); SITE2.bx('r1'); SITE2.pool()
SITE2B = SITE2.build(); SITE2B = SITE2B + bytes([0xC0, 0x46] * ((14 - len(SITE2B)) // 2)); assert len(SITE2B) == 14, len(SITE2B)

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
fix.append([0x115A9C, R[0x115A9C:0x115AAA].hex(), SITE2B.hex()])

novo = [[SCR0 - A, SCRB.hex()], [TXT - A, T.hex()], [HOOK - A, HOOKB.hex()], [HOOK2 - A, HOOK2B.hex()],
        [NPAL - A, npal.hex()], [SPAL - A, spal.hex()], [TPL - A, tpl.hex()], [OVL - A, ovl.hex()]]
for at, h in novo:
    n = len(h) // 2
    assert all(b == 0xFF for b in R[at:at + n]), hex(at)
    assert at + A + n <= FIM_LIVRE

print(json.dumps({'fix': fix, 'novo': novo, 'script': SCRIPTS['pier'] - A, 'placas': PLACAS - A, 'flag': FLAG,
                  'scripts': {k: v - A for k, v in SCRIPTS.items()}, 'vars': [V_EST, V_POS, V_DIR], 'id': ID_BARCO}))
