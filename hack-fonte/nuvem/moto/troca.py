# L troca Mach/Acro em movimento. FieldGetPlayerInput (0x080E1580) só marca o L parado ou no quadro em que o
# personagem está no centro do quadrado, e nunca na velocidade máxima. Aqui o aperto fica guardado em TRAVA e
# o pedido sai no próximo centro de quadrado, em qualquer velocidade; a troca em si continua sendo a do jogo.
# uso: python troca.py ROM.gba  -> imprime as linhas do `game.js`
import struct, sys

R = open(sys.argv[1], 'rb').read()
A = 0x08000000
DESVIO, FIM_DESVIO = 0x080E15AC, 0x080E15BE
CAVE, TRAVA = 0x09FF7F80, 0x0203FF5F
AVATAR, MACH_BOTAO = 0x02039070, 0x0826FBA5   # gPlayerAvatar; função chamada no trecho coberto pelo desvio

c = []
pos = {}
saltos = []
pool = []
def h(*x): c.extend(x)
def rot(n): pos[n] = len(c)
def b(cond, n): saltos.append((len(c), cond, n)); c.append(0)
def ldr(rd, v): pool.append((len(c), rd, v)); c.append(0)

ldr(0, MACH_BOTAO)
saltos.append((len(c), 'bl', 'veneer')); h(0, 0)
h(0x0600)                                  # lsls r0, r0, #24
h(0x2800)                                  # cmp r0, #0
b(0xD0, 'trava')                           # beq
h(0x7820, 0x2102, 0x4308, 0x7020)          # ldrb r0,[r4]; movs r1,#2; orrs r0,r1; strb r0,[r4]
rot('trava')
ldr(3, AVATAR)
ldr(2, TRAVA)
h(0x7819, 0x2006, 0x4208)                  # ldrb r1,[r3]; movs r0,#6; tst r0,r1
b(0xD1, 'bike')                            # bne
h(0x2000, 0x7010)                          # movs r0,#0; strb r0,[r2]
b('b', 'fim')
rot('bike')
h(0x2080, 0x0080, 0x4228)                  # movs r0,#0x80; lsls r0,#2; tst r0,r5
b(0xD0, 'pendente')                        # beq
h(0x2001, 0x7010)                          # movs r0,#1; strb r0,[r2]
rot('pendente')
h(0x7810, 0x2800)                          # ldrb r0,[r2]; cmp r0,#0
b(0xD0, 'fim')                             # beq
h(0x2F00)                                  # cmp r7,#0
b(0xD0, 'pede')                            # beq
h(0x2F02)                                  # cmp r7,#2
b(0xD1, 'fim')                             # bne
h(0x4648, 0x2800)                          # mov r0,sb; cmp r0,#0
b(0xD1, 'fim')                             # bne
rot('pede')
h(0x2000, 0x7010)                          # movs r0,#0; strb r0,[r2]
h(0x7860, 0x2101, 0x4308, 0x7060)          # ldrb r0,[r4,#1]; movs r1,#1; orrs r0,r1; strb r0,[r4,#1]
rot('fim')
ldr(0, FIM_DESVIO | 1)
h(0x4700)                                  # bx r0
rot('veneer')
h(0x4700)                                  # bx r0

for at, cond, nome in saltos:
    alvo = pos[nome]
    if cond == 'bl':
        d = (alvo - at - 2) * 2
        c[at] = 0xF000 | ((d >> 12) & 0x7FF)
        c[at + 1] = 0xF800 | ((d >> 1) & 0x7FF)
    elif cond == 'b':
        c[at] = 0xE000 | (((alvo - at - 2)) & 0x7FF)
    else:
        c[at] = (cond << 8) | ((alvo - at - 2) & 0xFF)

if len(c) % 2: c.append(0x46C0)
valores = []
for at, rd, v in pool:
    if v not in valores: valores.append(v)
base = len(c) * 2 + CAVE
for at, rd, v in pool:
    alvo = base + valores.index(v) * 4
    pc = (CAVE + at * 2 + 4) & ~3
    assert (alvo - pc) % 4 == 0 and 0 <= alvo - pc < 1024
    c[at] = 0x4800 | (rd << 8) | ((alvo - pc) // 4)

novo = struct.pack('<%dH' % len(c), *c) + b''.join(struct.pack('<I', v) for v in valores)
assert CAVE - A + len(novo) <= 0x1FF8000
assert set(R[CAVE - A:CAVE - A + len(novo)]) == {0xFF}

n = FIM_DESVIO - DESVIO
desvio = struct.pack('<HHI', 0x4800, 0x4700, CAVE | 1)
desvio += b'\xC0\x46' * ((n - len(desvio)) // 2)
orig = R[DESVIO - A:FIM_DESVIO - A]
print('    [0x%X, "%s", "%s"],   // L troca a bike em movimento: leitura do botão -> 0x%08X; fonte: hack-fonte/nuvem/moto/troca.py' % (DESVIO - A, orig.hex(), desvio.hex(), CAVE))
print('    [0x%X, "%s"],   // L troca a bike em movimento' % (CAVE - A, novo.hex()))
