# Protetor Glacial: recorta os escudos dos prints do usuário (1536x1024 = tela do GBA x 6,4), reduz para pixels do GBA
# e gera as 4 imagens 4bpp + a paleta. uso: python gerar.py   -> escudos.bin, escudos.pal, previa.png
import struct
from PIL import Image, ImageDraw
D = 'C:/Users/Sandro/Downloads/'
F2 = Image.open(D + 'Batalha Pixelada com Escudos de Gelo.png').convert('RGB')   # fase 2: coroa
ESC = 6.4

def corta(img, poli, larg, alt, cx, cy):
    """poli em px do print; devolve larg x alt de (r, g, b) ou None, com o centro (cx,cy) do print no meio do sprite"""
    x0 = cx - larg * ESC / 2; y0 = cy - alt * ESC / 2
    mask = Image.new('L', img.size, 0); ImageDraw.Draw(mask).polygon(poli, fill=255)
    o = []
    for y in range(alt):
        for x in range(larg):
            bx = (int(x0 + x * ESC), int(y0 + y * ESC), int(x0 + (x + 1) * ESC), int(y0 + (y + 1) * ESC))
            if bx[1] >= img.size[1]: o.append(None); continue
            pm = list(mask.crop(bx).get_flattened_data())
            if sum(pm) / 255 / len(pm) < 0.5: o.append(None); continue
            px = [p for p, k in zip(img.crop(bx).get_flattened_data(), pm) if k]
            o.append(tuple(sum(c[i] for c in px) // len(px) for i in range(3)))
    return o

def faceta(x, y):
    return (235, 245, 255) if (x + y) % 19 == 0 else (214, 234, 252) if (x + y) // 7 % 3 == 0 else (190, 220, 248)

# placa: a linha fina do contorno some ao reduzir o print (ESCUDO OFC.png), então ela é desenhada pixel a pixel nas
# medidas dele. Cantos em relação ao sprite 32x64 (cima-esq, cima-dir, baixo-dir, baixo-esq).
CONTORNO, CORPO, CORPO2, CLARO, BRANCO = (106, 155, 224), (182, 212, 246), (166, 200, 243), (212, 232, 252), (232, 243, 255)
def placa(cantos, faixas):
    img = Image.new('RGB', (32, 64), (0, 0, 0))
    dr = ImageDraw.Draw(img)
    dr.polygon(cantos, fill=CORPO, outline=CONTORNO)
    o = [None] * (32 * 64)
    (xe, ye), (xd, yd), (xd2, yb), (xe2, yb2) = cantos
    for y in range(64):
        for x in range(32):
            c = img.getpixel((x, y))
            if c == (0, 0, 0): continue
            if c == CORPO:
                d = x + y
                if d >= sum(cantos[2]) - 9: c = CORPO2                     # canto de baixo mais fundo
                for a, l in faixas:
                    if a <= d < a + l: c = BRANCO if d - a < l - 1 else CLARO   # reflexos em diagonal
                if x == xe + 1 or x == xd - 2: c = CLARO                   # brilho na beira esquerda e a dobra da direita
                topo = ye + (yd - ye) * (x - xe) / (xd - xe)
                if y <= topo + 2: c = CLARO                                # brilho logo abaixo do contorno de cima
            o[y * 32 + x] = c
    return o
PLACA = placa([(5, 14), (27, 20), (27, 49), (5, 42)], ((33, 2), (46, 2)))
PLACA_I = placa([(4, 19), (28, 25), (28, 45), (4, 40)], ((36, 2), (47, 2)))
COROA = corta(F2, [(268, 575), (302, 450), (345, 485), (470, 352), (560, 470), (628, 450), (640, 620), (690, 716), (225, 716)], 64, 64, 455, 540)
for y in range(20, 64):
    for x in range(14, 52):
        if COROA[y * 64 + x] is not None: COROA[y * 64 + x] = faceta(x, y)
COROA_I = corta(F2, [(895, 412), (908, 258), (932, 282), (982, 205), (1022, 272), (1062, 288), (1072, 455), (1084, 470), (1010, 472), (900, 442)], 32, 64, 990, 332)

# paleta de 15 cores: as 5 da placa, fixas, e 10 tiradas da coroa
todos = [p for img in (COROA, COROA_I) for p in img if p is not None]
amostra = Image.new('RGB', (len(todos), 1)); amostra.putdata(todos)
q = amostra.quantize(10, Image.MEDIANCUT)
pal = q.getpalette()[:30]
cores = [CONTORNO, CORPO, CORPO2, CLARO, BRANCO] + [tuple(pal[i:i + 3]) for i in range(0, 30, 3)]
def idx(p):
    if p is None: return 0
    if p in cores[:5]: return 1 + cores.index(p)
    return 6 + min(range(10), key=lambda k: sum((a - b) ** 2 for a, b in zip(p, cores[5 + k])))
def bpp4(img, larg, alt):
    px = [idx(p) for p in img]
    s = bytearray()
    for ty in range(alt // 8):
        for tx in range(larg // 8):
            for y in range(8):
                for x in range(0, 8, 2):
                    s.append(px[(ty * 8 + y) * larg + tx * 8 + x] | px[(ty * 8 + y) * larg + tx * 8 + x + 1] << 4)
    return bytes(s)
open('escudos.bin', 'wb').write(bpp4(PLACA, 32, 64) + bpp4(PLACA_I, 32, 64) + bpp4(COROA, 64, 64) + bpp4(COROA_I, 32, 64))
open('escudos.pal', 'wb').write(b'\xff\x7f' + b''.join(struct.pack('<H', r >> 3 | (g >> 3) << 5 | (b >> 3) << 10) for r, g, b in cores))
pv = Image.new('RGB', (160, 64), (120, 128, 120))
for img, l, ox in ((PLACA, 32, 0), (PLACA_I, 32, 32), (COROA, 64, 64), (COROA_I, 32, 128)):
    for y in range(64):
        for x in range(l):
            if img[y * l + x] is not None: pv.putpixel((ox + x, y), cores[idx(img[y * l + x]) - 1])
pv.resize((960, 384), Image.NEAREST).save('previa.png')
