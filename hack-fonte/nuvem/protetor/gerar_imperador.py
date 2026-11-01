# Gera as imagens do Tempo do Imperador: sprite de costas (do desenho do usuário) e fundo de gelo (junção dos fundos do jogo).
# uso: python gerar_imperador.py ROM.gba "Batalha de Cubchoo com Coroas de Gelo.png"
import os, struct, sys
from collections import deque
from PIL import Image
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from lz import lz77
AQUI = os.path.dirname(os.path.abspath(__file__))
R = open(sys.argv[1], 'rb').read()
PRINT = sys.argv[2]
u32 = lambda a: struct.unpack_from('<I', R, a - 0x08000000)[0]
rgb15 = lambda c: (c[0] >> 3) | (c[1] >> 3) << 5 | (c[2] >> 3) << 10

def comprime(d):
    # LZ77 do GBA com distância mínima 2: pode descomprimir direto na VRAM
    o = bytearray([0x10, len(d) & 0xFF, len(d) >> 8 & 0xFF, len(d) >> 16]); i = 0
    while i < len(d):
        fl = len(o); o.append(0); f = 0
        for b in range(8):
            if i >= len(d): break
            mel, dis = 0, 0
            for p in range(max(0, i - 4096), i - 1):
                n = 0
                while n < 18 and i + n < len(d) and d[p + n] == d[i + n]: n += 1
                if n > mel: mel, dis = n, i - p
            if mel >= 3:
                f |= 0x80 >> b; x = (mel - 3) << 12 | (dis - 1); o += bytes((x >> 8, x & 0xFF)); i += mel
            else:
                o.append(d[i]); i += 1
        o[fl] = f
    while len(o) % 4: o.append(0)
    assert lz77(bytes(o), 0)[0] == bytes(d)
    return bytes(o)

# --- sprite de costas, 64x64: recorta do desenho do usuário na grade de pixels do GBA
im = Image.open(PRINT).convert('RGB'); S = 1536 / 240
X0, Y0, W, H = 40, 60, 64, 52                # o quadro do Pokémon de costas na tela: x 40..103, y 60..123
px = [[im.getpixel((int((X0 + x + .5) * S), int((Y0 - 2 + y + .5) * S))) for x in range(W)] for y in range(H + 2)]
fundo = lambda c: (c[0] + c[1] + c[2]) / 3 > 105 and c[2] - c[0] < 34
vis = [[False] * W for _ in range(H + 2)]; q = deque()
for x in range(W): q.append((x, 0))
for y in range(H + 2): q.extend(((0, y), (W - 1, y)))
while q:
    x, y = q.popleft()
    if not (0 <= x < W and 0 <= y < H + 2) or vis[y][x] or not fundo(px[y][x]): continue
    vis[y][x] = True; q.extend(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))
s = Image.new('RGBA', (64, 64), (0, 0, 0, 0))
for y in range(H):
    for x in range(W):
        c = px[y][x]
        if not vis[y][x] and not (c[0] > c[2] + 8):   # o bege da plataforma vazando nos pés fica de fora
            s.putpixel((x, y), c + (255,))
# fecha os pés (no print ficam atrás da caixa de texto)
for x in range(64):
    if s.getpixel((x, H - 1))[3]:
        s.putpixel((x, H), (24, 24, 32, 255))
opaco = Image.new('RGB', (64, 64), (0, 0, 0)); opaco.paste(s, (0, 0), s)
ql = opaco.quantize(colors=15, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
pal = ql.getpalette()[:45]; cores = [tuple(pal[i:i + 3]) for i in range(0, 45, 3)]
idx = [[0] * 64 for _ in range(64)]
for y in range(64):
    for x in range(64):
        if s.getpixel((x, y))[3]: idx[y][x] = ql.getpixel((x, y)) + 1
img = bytearray()
for ty in range(8):
    for tx in range(8):
        for y in range(8):
            for x in range(0, 8, 2):
                img.append(idx[ty * 8 + y][tx * 8 + x] | idx[ty * 8 + y][tx * 8 + x + 1] << 4)
paleta = struct.pack('<16H', 0x7FFF, *(rgb15(c) for c in cores))
s.save(os.path.join(AQUI, 'imperador_costas.png'))
open(os.path.join(AQUI, 'imp_costas.bin'), 'wb').write(comprime(bytes(img)))
open(os.path.join(AQUI, 'imp_costas.pal'), 'wb').write(paleta)

# --- fundo: chão com as plataformas do campo de gelo (1) + paredão e neve do fundo de animação 15 (2)
def pal_rgb(p):
    return [struct.unpack_from('<H', p, 2 * i)[0] for i in range(len(p) // 2)]
def desenha(tiles, mapa, cores, linhas):
    m = struct.unpack('<%dH' % (len(mapa) // 2), mapa); o = [[0] * 256 for _ in range(linhas * 8)]
    for r in range(linhas):
        for c in range(32):
            e = m[r * 32 + c]; t = tiles[(e & 1023) * 32:(e & 1023) * 32 + 32]; b = max((e >> 12) - 2, 0) * 16
            for y in range(8):
                for x in range(8):
                    o[r * 8 + y][c * 8 + x] = cores[b + (t[y * 4 + x // 2] >> (4 * (x & 1)) & 15)]
    return o
LZ = lambda a: lz77(R, a - 0x08000000)[0]
F = desenha(LZ(0x09F31F74), LZ(0x09F325E8), pal_rgb(LZ(0x09F32C18)), 14)
_e = 0x09129530 + 15 * 12
P = desenha(LZ(u32(_e)), LZ(u32(_e + 8)), pal_rgb(LZ(u32(_e + 4))), 20)
# plataforma = o que difere das listras do céu naquela linha
plat = [[F[y][x] != (F[y][0] if y < 80 else F[y][255]) for x in range(256)] for y in range(112)]
T = [[F[y][x] if plat[y][x] else P[min(y + 32, 159)][x] for x in range(256)] for y in range(112)]
blocos = {}
for r in range(14):
    for c in range(32):
        k = tuple(T[r * 8 + y][c * 8 + x] for y in range(8) for x in range(8)); blocos.setdefault(k, []).append((r, c))
linhas = []                                  # paletas 2, 3 e 4 do terreno; 15 cores + a transparente
qual = {}
for k in sorted(blocos, key=lambda k: -len(set(k))):
    u = set(k); mel = None
    for i, l in enumerate(linhas):
        if len(l | u) <= 15 and (mel is None or len(l | u) - len(l) < len(linhas[mel] | u) - len(linhas[mel])): mel = i
    if mel is None: linhas.append(set(u)); mel = len(linhas) - 1; assert mel < 3
    else: linhas[mel] |= u
    qual[k] = mel
linhas = [sorted(l) for l in linhas]
tiles = bytearray(); mapa = [0] * (32 * 14)
for n, (k, pos) in enumerate(blocos.items()):
    l = linhas[qual[k]]; v = [l.index(c) + 1 for c in k]
    for y in range(8):
        for x in range(0, 8, 2): tiles.append(v[y * 8 + x] | v[y * 8 + x + 1] << 4)
    for r, c in pos: mapa[r * 32 + c] = n | (2 + qual[k]) << 12
pal = bytearray()
for i in range(3):
    l = linhas[i] if i < len(linhas) else []
    pal += struct.pack('<16H', 0, *(l + [0] * (15 - len(l))))
assert len(blocos) <= 256
open(os.path.join(AQUI, 'imp_fundo_blocos.bin'), 'wb').write(comprime(bytes(tiles)))
open(os.path.join(AQUI, 'imp_fundo_mapa.bin'), 'wb').write(comprime(struct.pack('<%dH' % len(mapa), *mapa)))
open(os.path.join(AQUI, 'imp_fundo.pal'), 'wb').write(pal)
print('blocos', len(blocos), 'linhas', [len(l) for l in linhas], 'bytes', len(comprime(bytes(tiles))))
