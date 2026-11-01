# Bike do personagem 657: troca os Pokémon da Mach Bike (658, 9 quadros) e da Acro Bike
# (659, 27 quadros) pela moto da Cynthia (217 e 218), com a cabeça do 657 (quadros a pé) por cima.
# uso: python gerar.py ROM.gba  -> moto.bin (0x4800 bytes para 0xF4E7D4), capacete.bin (mesmo tamanho), previa.png
import os, struct, sys
from PIL import Image

R = open(sys.argv[1], 'rb').read()
AQUI = os.path.dirname(os.path.abspath(__file__))
A = 0x08000000
GFX = 0x090EC814 - A
u32 = lambda o: struct.unpack_from('<I', R, o)[0]
quadro = lambda ident, f: u32(u32(u32(GFX + 4 * ident) - A + 28) - A + 8 * f)
BLOCO, FIM = 0x08F4E7D4, 0x08F52FD4

def cores(a):
    return [((c & 31) * 8, ((c >> 5) & 31) * 8, ((c >> 10) & 31) * 8) for c in struct.unpack_from('<16H', R, a - A)]

P657 = cores(0x08F549D4)
def paleta_tag(tag):
    b = struct.pack('<HH', tag, 0); o = -1
    while True:
        o = R.find(b, o + 1)
        if o < 0: raise SystemExit('paleta não achada')
        if o % 4 == 0 and R[o - 1] in (8, 9) and u32(o - 4) % 2 == 0: return u32(o - 4)
PCYN = cores(paleta_tag(0x3AAE))

def ler(a, w, h):
    g = [[0] * w for _ in range(h)]; tw = w // 8
    for ty in range(h // 8):
        for tx in range(tw):
            o = a - A + (ty * tw + tx) * 32
            for y in range(8):
                for x in range(4):
                    b = R[o + y * 4 + x]
                    g[ty * 8 + y][tx * 8 + x * 2] = b & 15
                    g[ty * 8 + y][tx * 8 + x * 2 + 1] = b >> 4
    return g

def gravar(g):
    b = bytearray(0x200)
    for ty in range(4):
        for tx in range(4):
            o = (ty * 4 + tx) * 32
            for y in range(8):
                for x in range(4):
                    b[o + y * 4 + x] = g[ty * 8 + y][tx * 8 + x * 2] | (g[ty * 8 + y][tx * 8 + x * 2 + 1] << 4)
    return bytes(b)

# cores da moto -> tons de cinza do 657; loiro e pele da Cynthia somem (ficam sob a cabeça, cor de roupa)
PELE = (6, 7, 8, 10, 11, 13, 14)
perto = lambda c: min((i for i in range(1, 15) if i not in PELE), key=lambda i: sum((a - b) ** 2 for a, b in zip(c, P657[i])))
MAPA = {c: perto(PCYN[c]) for c in range(1, 16)}
for c in range(1, 9): MAPA[c] = 3

CABECA = {d: ler(quadro(657, f), 16, 32) for d, f in ((0, 0), (1, 1), (2, 2))}
QUADROS = [ler(quadro(217, f), 32, 32) for f in range(9)] + [ler(quadro(218, f), 32, 32) for f in range(27)]
BASE = {d: QUADROS[d] for d in (0, 1, 2)}
CAPACETE = {0: (8, 5, 16, 18), 1: (8, 5, 16, 18), 2: (9, 5, 15, 14)}   # x, y, largura, altura no quadro de referência
ESCUROS = (10, 11, 12, 13)

def achar(g):
    """direção e deslocamento do capacete no quadro (as manobras movem a moto)"""
    melhor = None
    for d, (x, y, w, h) in CAPACETE.items():
        t = BASE[d]
        for dy in range(-8, 9):
            for dx in range(-8, 9):
                certo = n = 0
                for yy in range(h):
                    for xx in range(w):
                        v = t[y + yy][x + xx]
                        if not v: continue
                        n += 1
                        X, Y = x + xx + dx, y + yy + dy
                        if 0 <= X < 32 and 0 <= Y < 32 and (g[Y][X] == v or (g[Y][X] in ESCUROS and v in ESCUROS)): certo += 1
                r = certo / max(n, 1)
                if not melhor or r > melhor[0]: melhor = (r, d, dx, dy)
    return melhor[1:]

def montar(g):
    d, dx, dy = achar(g)
    o = [[MAPA[c] if c else 0 for c in linha] for linha in g]
    for y in range(24):
        for x in range(16):
            c = CABECA[d][y][x]
            if d == 1 and c in (10, 11, 13, 14): continue   # de costas: sem as mãos a pé
            X, Y = 8 + dx + x, y + dy - 5
            if c and 0 <= X < 32 and 0 <= Y < 32: o[Y][X] = c
    return o

# capacete (tecla 0): sem a cabeça; o loiro vira visor azul e o balanço do cabelo some na borda do capacete
CAP = dict(MAPA)
CAP.update({5: 9, 6: 8, 7: 7, 8: 6, 4: 6, 1: 8, 2: 8, 3: 7})
def capacete(g):
    d, dx, dy = achar(g)
    topo = 5 + dy
    return [[(2 if y < topo + 2 and c in (5, 6, 7, 8) else CAP[c]) if c else 0 for c in linha] for y, linha in enumerate(g)]

saida = [montar(g) for g in QUADROS]
cap = [capacete(g) for g in QUADROS]
ordem = sorted(range(36), key=lambda n: quadro(658, n) if n < 9 else quadro(659, n - 9))
assert quadro(659, 0) == BLOCO and quadro(658, 8) + 0x200 == FIM
dados = b''.join(gravar(saida[n]) for n in ordem)
assert len(dados) == 0x4800
open(os.path.join(AQUI, 'moto.bin'), 'wb').write(dados)
open(os.path.join(AQUI, 'capacete.bin'), 'wb').write(b''.join(gravar(cap[n]) for n in ordem))

S = 3
im = Image.new('RGB', (12 * (32 * S + 3), 6 * (32 * S + 3)), (120, 190, 150))
px = im.load()
for n, g in enumerate(saida + cap):
    ox, oy = (n % 12) * (32 * S + 3), (n // 12) * (32 * S + 3)
    for y in range(32):
        for x in range(32):
            if g[y][x]:
                for a in range(S):
                    for b in range(S): px[ox + x * S + a, oy + y * S + b] = P657[g[y][x]]
im.save(os.path.join(AQUI, 'previa.png'))
print('ok', len(dados))
